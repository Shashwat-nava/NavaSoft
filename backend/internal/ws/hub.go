package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 64 * 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Message struct {
	Type           string      `json:"type"`
	JobID          string      `json:"jobId,omitempty"`
	FrameIndex     int         `json:"frameIndex,omitempty"`
	Timestamp      string      `json:"timestamp,omitempty"`
	AnnotatedFrame string      `json:"annotatedFrame,omitempty"` // base64 JPEG
	Detections     interface{} `json:"detections,omitempty"`
	Metrics        interface{} `json:"metrics,omitempty"`
	Progress       float64     `json:"progress,omitempty"`
	ProcessedURL   string      `json:"processedUrl,omitempty"`
	TotalFrames    int         `json:"totalFrames,omitempty"`
	Error          string      `json:"error,omitempty"`
}

type client struct {
	conn   *websocket.Conn
	send   chan []byte
	jobID  string
	userID int
}

type Hub struct {
	mu         sync.RWMutex
	clients    map[*client]struct{}
	jobClients map[string]map[*client]struct{} // jobID -> set of clients
	register   chan *client
	unregister chan *client
}

func NewHub() *Hub {
	h := &Hub{
		clients:    make(map[*client]struct{}),
		jobClients: make(map[string]map[*client]struct{}),
		register:   make(chan *client, 64),
		unregister: make(chan *client, 64),
	}
	go h.run()
	return h
}

func (h *Hub) run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = struct{}{}
			if _, ok := h.jobClients[c.jobID]; !ok {
				h.jobClients[c.jobID] = make(map[*client]struct{})
			}
			h.jobClients[c.jobID][c] = struct{}{}
			h.mu.Unlock()
			log.Printf("ws: client connected for job=%s (user=%d)", c.jobID, c.userID)

		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				if jc, ok := h.jobClients[c.jobID]; ok {
					delete(jc, c)
					if len(jc) == 0 {
						delete(h.jobClients, c.jobID)
					}
				}
				close(c.send)
			}
			h.mu.Unlock()
			log.Printf("ws: client disconnected for job=%s", c.jobID)
		}
	}
}

func (h *Hub) SendToJob(jobID string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("ws: marshal error: %v", err)
		return
	}

	h.mu.RLock()
	clients := h.jobClients[jobID]
	h.mu.RUnlock()

	for c := range clients {
		select {
		case c.send <- data:
		default:
			go func(cl *client) { h.unregister <- cl }(c)
		}
	}
}

func (h *Hub) HasSubscribers(jobID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.jobClients[jobID]) > 0
}

func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	jobID := r.URL.Query().Get("jobId")
	if jobID == "" {
		http.Error(w, "jobId required", http.StatusBadRequest)
		return
	}

	userID := 0
	if uid := r.URL.Query().Get("userId"); uid != "" {
		// parse user ID from query param (in production use JWT)
		fmt.Sscanf(uid, "%d", &userID)
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws: upgrade error: %v", err)
		return
	}

	c := &client{
		conn:   conn,
		send:   make(chan []byte, 256),
		jobID:  jobID,
		userID: userID,
	}

	h.register <- c
	go c.writePump()
	go c.readPump(h)
}

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

func (c *client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *client) readPump(h *Hub) {
	defer func() {
		h.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(4096)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
	}
}
