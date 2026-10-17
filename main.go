package main

import (
	"bufio"
	"crypto/sha256"
	"crypto/tls"
	"embed"
	"encoding/hex"
	"errors"
	"html/template"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"
	"time"
)

//go:embed all:web/dist
var webDist embed.FS

//go:embed setup.html
var setupHTML string

func main() {
	port := env("HEYFILES_PORT", "7000")
	dataDir := env("HEYFILES_DATA", "./data")
	var extraNames []string
	for _, n := range strings.Split(os.Getenv("HEYFILES_HOSTS"), ",") {
		if n = strings.TrimSpace(n); n != "" {
			extraNames = append(extraNames, n)
		}
	}

	ca, err := LoadOrCreateCA(dataDir, extraNames)
	if err != nil {
		log.Fatalf("certificate authority: %v", err)
	}

	hub := NewHub()
	httpsHandler := secureHeaders(appRoutes(hub, ca))
	httpHandler := setupRoutes(ca)

	ln, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatal(err)
	}

	tlsLn := newChanListener(ln.Addr())
	plainLn := newChanListener(ln.Addr())

	tlsCfg := &tls.Config{
		GetCertificate: ca.GetCertificate,
		MinVersion:     tls.VersionTLS12,
		NextProtos:     []string{"http/1.1"},
	}
	go serve(&http.Server{Handler: httpsHandler, ReadHeaderTimeout: 10 * time.Second}, tls.NewListener(tlsLn, tlsCfg))
	go serve(&http.Server{Handler: httpHandler, ReadHeaderTimeout: 10 * time.Second}, plainLn)

	log.Printf("HeyFiles listening on :%s (HTTPS and HTTP share this port)", port)
	log.Printf("CA certificate SHA-256: %s", ca.Fingerprint())
	log.Printf("CA thumbprint (Windows, SHA-1): %s", ca.WindowsThumbprint())
	for _, ip := range lanIPs() {
		log.Printf("  open http://%s:%s on each device to install the certificate", ip, port)
	}

	for {
		conn, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			log.Printf("accept: %v", err)
			time.Sleep(50 * time.Millisecond)
			continue
		}
		go route(conn, tlsLn, plainLn)
	}
}

// route peeks at the first byte: 0x16 starts a TLS handshake, anything else is plain HTTP.
func route(conn net.Conn, tlsLn, plainLn *chanListener) {
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	br := bufio.NewReader(conn)
	first, err := br.Peek(1)
	if err != nil {
		conn.Close()
		return
	}
	conn.SetReadDeadline(time.Time{})
	pc := &peekedConn{Conn: conn, r: br}
	if first[0] == 0x16 {
		tlsLn.push(pc)
	} else {
		plainLn.push(pc)
	}
}

func appRoutes(hub *Hub, ca *CertAuthority) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.ServeWS)
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		// Lets the HTTP setup page detect whether this device already trusts the CA.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "no-store")
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("/ca.crt", caHandler(ca))
	mux.Handle("/", spaHandler())
	return mux
}

func setupRoutes(ca *CertAuthority) http.Handler {
	tmpl := template.Must(template.New("setup").Parse(setupHTML))
	mux := http.NewServeMux()
	mux.HandleFunc("/ca.crt", caHandler(ca))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		tmpl.Execute(w, map[string]string{
			"HTTPSURL":    "https://" + r.Host,
			"Fingerprint": ca.Fingerprint(),
			"Thumbprint":  ca.WindowsThumbprint(),
		})
	})
	return mux
}

func caHandler(ca *CertAuthority) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-x509-ca-cert")
		w.Header().Set("Content-Disposition", `attachment; filename="HeyFiles-CA.crt"`)
		w.Write(ca.CertPEM())
	}
}

func spaHandler() http.Handler {
	dist, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	files := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(dist, p); err != nil {
			r.URL.Path = "/"
			p = "index.html"
		}
		if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func serve(srv *http.Server, ln net.Listener) {
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// chanListener is a net.Listener fed by the protocol router.
type chanListener struct {
	addr  net.Addr
	conns chan net.Conn
	once  sync.Once
	done  chan struct{}
}

func newChanListener(addr net.Addr) *chanListener {
	return &chanListener{addr: addr, conns: make(chan net.Conn, 64), done: make(chan struct{})}
}

func (l *chanListener) push(c net.Conn) {
	select {
	case l.conns <- c:
	case <-l.done:
		c.Close()
	}
}

func (l *chanListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.conns:
		return c, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}

func (l *chanListener) Close() error {
	l.once.Do(func() { close(l.done) })
	return nil
}

func (l *chanListener) Addr() net.Addr { return l.addr }

type peekedConn struct {
	net.Conn
	r *bufio.Reader
}

func (c *peekedConn) Read(p []byte) (int, error) { return c.r.Read(p) }

func lanIPs() []string {
	var out []string
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && !n.IP.IsLoopback() && ipPermitted(n.IP) {
			out = append(out, n.IP.String())
		}
	}
	return out
}

func sha256Hex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
