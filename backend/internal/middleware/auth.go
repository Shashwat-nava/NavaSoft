package middleware

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"
)

type contextKey string

const UserIDKey contextKey = "userID"

type tokenEntry struct {
	userID    int
	expiresAt time.Time
}

type TokenStore struct {
	mu     sync.RWMutex
	tokens map[string]tokenEntry
}

func NewTokenStore() *TokenStore {
	ts := &TokenStore{tokens: make(map[string]tokenEntry)}
	go ts.cleanup()
	return ts
}

func (ts *TokenStore) Set(token string, userID int, ttl time.Duration) {
	ts.mu.Lock()
	ts.tokens[token] = tokenEntry{userID: userID, expiresAt: time.Now().Add(ttl)}
	ts.mu.Unlock()
}

func (ts *TokenStore) Get(token string) (int, bool) {
	ts.mu.RLock()
	entry, ok := ts.tokens[token]
	ts.mu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return 0, false
	}
	return entry.userID, true
}

func (ts *TokenStore) Delete(token string) {
	ts.mu.Lock()
	delete(ts.tokens, token)
	ts.mu.Unlock()
}

func (ts *TokenStore) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		ts.mu.Lock()
		for k, v := range ts.tokens {
			if now.After(v.expiresAt) {
				delete(ts.tokens, k)
			}
		}
		ts.mu.Unlock()
	}
}

func setCORSOnError(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
}

func AuthMiddleware(ts *TokenStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "OPTIONS" {
				next.ServeHTTP(w, r)
				return
			}

			token := ""
			auth := r.Header.Get("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				token = strings.TrimPrefix(auth, "Bearer ")
			}
			if token == "" {
				token = r.URL.Query().Get("token")
			}

			if token == "" {
				setCORSOnError(w, r)
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			userID, ok := ts.Get(token)
			if !ok {
				setCORSOnError(w, r)
				http.Error(w, "token expired or invalid", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetUserID(r *http.Request) int {
	if v, ok := r.Context().Value(UserIDKey).(int); ok {
		return v
	}
	return 0
}
