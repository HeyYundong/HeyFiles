package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// The hub only introduces devices to each other and relays WebRTC
// offers/answers. File bytes never pass through the server.

const (
	maxSignalSize = 64 << 10
	pingInterval  = 25 * time.Second
)

type Peer struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	IP   string `json:"ip"`
}

type client struct {
	Peer
	send chan []byte
}

type Hub struct {
	mu      sync.Mutex
	clients map[string]*client
}

func NewHub() *Hub { return &Hub{clients: map[string]*client{}} }

type inMsg struct {
	Type    string          `json:"type"`
	Name    string          `json:"name,omitempty"`
	Kind    string          `json:"kind,omitempty"`
	To      string          `json:"to,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(maxSignalSize)

	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	c := &client{Peer: Peer{ID: newID(), IP: ip, Kind: "desktop"}, send: make(chan []byte, 32)}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go h.writeLoop(ctx, conn, c)
	c.send <- mustJSON(map[string]any{"type": "welcome", "id": c.ID})

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			break
		}
		var m inMsg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.Type {
		case "hello":
			h.mu.Lock()
			c.Name = clip(m.Name, 40)
			if m.Kind == "phone" || m.Kind == "tablet" || m.Kind == "laptop" || m.Kind == "desktop" {
				c.Kind = m.Kind
			}
			h.clients[c.ID] = c
			h.mu.Unlock()
			h.broadcastPeers()
		case "signal":
			h.mu.Lock()
			target := h.clients[m.To]
			h.mu.Unlock()
			if target == nil {
				c.trySend(mustJSON(map[string]any{"type": "gone", "id": m.To}))
				continue
			}
			target.trySend(mustJSON(map[string]any{"type": "signal", "from": c.ID, "payload": m.Payload}))
		}
	}

	h.mu.Lock()
	delete(h.clients, c.ID)
	h.mu.Unlock()
	h.broadcastPeers()
	conn.Close(websocket.StatusNormalClosure, "")
}

func (h *Hub) writeLoop(ctx context.Context, conn *websocket.Conn, c *client) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case msg := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := conn.Write(wctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				conn.Close(websocket.StatusGoingAway, "write failed")
				return
			}
		case <-ticker.C:
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				conn.Close(websocket.StatusGoingAway, "ping timeout")
				return
			}
		}
	}
}

func (h *Hub) broadcastPeers() {
	h.mu.Lock()
	peers := make([]Peer, 0, len(h.clients))
	targets := make([]*client, 0, len(h.clients))
	for _, c := range h.clients {
		peers = append(peers, c.Peer)
		targets = append(targets, c)
	}
	h.mu.Unlock()
	sort.Slice(peers, func(i, j int) bool { return peers[i].Name < peers[j].Name })
	msg := mustJSON(map[string]any{"type": "peers", "peers": peers})
	for _, c := range targets {
		c.trySend(msg)
	}
}

func (c *client) trySend(msg []byte) {
	select {
	case c.send <- msg:
	default:
		log.Printf("dropping message to slow client %s", c.ID)
	}
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
