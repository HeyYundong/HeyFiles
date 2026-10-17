package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// The CA may only vouch for private-network addresses and LAN-only domain
// suffixes. Even if ca.key leaks, it cannot be used to impersonate public sites.
var (
	permittedCIDRs = []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8",
		"169.254.0.0/16",
		"100.64.0.0/10",
		"fc00::/7",
		"fe80::/10",
		"::1/128",
	}
	permittedDomains = []string{"localhost", "local", "lan", "home.arpa", "internal"}
)

const (
	caValidity   = 10 * 365 * 24 * time.Hour
	leafValidity = 397 * 24 * time.Hour // Apple rejects longer-lived server certs
)

type CertAuthority struct {
	cert    *x509.Certificate
	key     *ecdsa.PrivateKey
	certPEM []byte

	extraNames []string

	mu    sync.Mutex
	cache map[string]*tls.Certificate
}

// LoadOrCreateCA reads ca.crt/ca.key from dir, generating them on first run.
func LoadOrCreateCA(dir string, extraNames []string) (*CertAuthority, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	certPath := filepath.Join(dir, "ca.crt")
	keyPath := filepath.Join(dir, "ca.key")

	ca := &CertAuthority{extraNames: extraNames, cache: map[string]*tls.Certificate{}}

	certPEM, certErr := os.ReadFile(certPath)
	keyPEM, keyErr := os.ReadFile(keyPath)
	if certErr == nil && keyErr == nil {
		if err := ca.parse(certPEM, keyPEM); err != nil {
			return nil, fmt.Errorf("load CA from %s: %w", dir, err)
		}
		return ca, nil
	}
	if !errors.Is(certErr, os.ErrNotExist) && certErr != nil {
		return nil, certErr
	}

	certPEM, keyPEM, err := generateCA()
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		return nil, err
	}
	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil {
		return nil, err
	}
	if err := ca.parse(certPEM, keyPEM); err != nil {
		return nil, err
	}
	return ca, nil
}

func generateCA() (certPEM, keyPEM []byte, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	var ranges []*net.IPNet
	for _, c := range permittedCIDRs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			return nil, nil, err
		}
		ranges = append(ranges, n)
	}

	hostname, _ := os.Hostname()
	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber: randomSerial(),
		Subject: pkix.Name{
			CommonName:   "HeyFiles Local CA (" + hostname + ")",
			Organization: []string{"HeyFiles"},
		},
		NotBefore:                   now.Add(-time.Hour),
		NotAfter:                    now.Add(caValidity),
		IsCA:                        true,
		BasicConstraintsValid:       true,
		MaxPathLenZero:              true,
		KeyUsage:                    x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		PermittedDNSDomainsCritical: true,
		PermittedDNSDomains:         permittedDomains,
		PermittedIPRanges:           ranges,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return certPEM, keyPEM, nil
}

func (ca *CertAuthority) parse(certPEM, keyPEM []byte) error {
	cb, _ := pem.Decode(certPEM)
	kb, _ := pem.Decode(keyPEM)
	if cb == nil || kb == nil {
		return errors.New("invalid PEM")
	}
	cert, err := x509.ParseCertificate(cb.Bytes)
	if err != nil {
		return err
	}
	key, err := x509.ParseECPrivateKey(kb.Bytes)
	if err != nil {
		return err
	}
	ca.cert, ca.key, ca.certPEM = cert, key, certPEM
	return nil
}

// CertPEM returns the CA certificate devices install to trust HeyFiles.
func (ca *CertAuthority) CertPEM() []byte { return ca.certPEM }

// Fingerprint is the SHA-256 of the CA cert, shown so users can compare it on each device.
func (ca *CertAuthority) Fingerprint() string {
	sum := sha256Hex(ca.cert.Raw)
	var parts []string
	for i := 0; i < len(sum); i += 2 {
		parts = append(parts, strings.ToUpper(sum[i:i+2]))
	}
	return strings.Join(parts, ":")
}

// WindowsThumbprint is the SHA-1 thumbprint in the format Windows shows in its
// "Security Warning" dialog when installing the CA (8-digit groups).
func (ca *CertAuthority) WindowsThumbprint() string {
	sum := sha1.Sum(ca.cert.Raw)
	h := strings.ToUpper(hex.EncodeToString(sum[:]))
	var parts []string
	for i := 0; i < len(h); i += 8 {
		parts = append(parts, h[i:i+8])
	}
	return strings.Join(parts, " ")
}

// GetCertificate issues (and caches) a leaf for whatever address the client
// dialed: the SNI name if it is a LAN domain, otherwise the local IP of the
// connection. This way the right cert is served even if the host's IP changes.
func (ca *CertAuthority) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	name := strings.TrimSuffix(strings.ToLower(hello.ServerName), ".")
	if name == "" || !domainPermitted(name) {
		name = ""
		if hello.Conn != nil {
			if addr, ok := hello.Conn.LocalAddr().(*net.TCPAddr); ok {
				name = addr.IP.String()
			}
		}
	}
	if name == "" {
		name = "127.0.0.1"
	}

	ca.mu.Lock()
	defer ca.mu.Unlock()
	if c, ok := ca.cache[name]; ok && time.Until(c.Leaf.NotAfter) > 7*24*time.Hour {
		return c, nil
	}
	c, err := ca.issue(name)
	if err != nil {
		return nil, err
	}
	ca.cache[name] = c
	return c, nil
}

func (ca *CertAuthority) issue(primary string) (*tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber: randomSerial(),
		Subject:      pkix.Name{CommonName: primary, Organization: []string{"HeyFiles"}},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(leafValidity),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	for _, n := range append([]string{primary, "localhost", "127.0.0.1"}, ca.extraNames...) {
		if ip := net.ParseIP(n); ip != nil {
			if ipPermitted(ip) {
				tmpl.IPAddresses = appendIPOnce(tmpl.IPAddresses, ip)
			}
		} else if domainPermitted(n) {
			tmpl.DNSNames = appendOnce(tmpl.DNSNames, n)
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		return nil, err
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	return &tls.Certificate{
		Certificate: [][]byte{der, ca.cert.Raw},
		PrivateKey:  key,
		Leaf:        leaf,
	}, nil
}

func ipPermitted(ip net.IP) bool {
	for _, c := range permittedCIDRs {
		_, n, _ := net.ParseCIDR(c)
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func domainPermitted(name string) bool {
	for _, d := range permittedDomains {
		if name == d || strings.HasSuffix(name, "."+d) {
			return true
		}
	}
	return false
}

func appendOnce(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

func appendIPOnce(list []net.IP, v net.IP) []net.IP {
	for _, x := range list {
		if x.Equal(v) {
			return list
		}
	}
	return append(list, v)
}

func randomSerial() *big.Int {
	n, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	return n
}
