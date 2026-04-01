package main

import (
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/gorilla/mux"

	"github.com/shashwatmani201/back/internal/api"
	"github.com/shashwatmani201/back/internal/db"
	"github.com/shashwatmani201/back/internal/jobs"
	"github.com/shashwatmani201/back/internal/middleware"
	"github.com/shashwatmani201/back/internal/mlclient"
	"github.com/shashwatmani201/back/internal/ws"
)

func main() {
	mime.AddExtensionType(".webm", "video/webm")

	if err := db.InitDB(envOr("DATABASE_URL", "postgres://nava:nava@localhost:5432/nava?sslmode=disable")); err != nil {
		log.Fatal(err)
	}
	defer db.DB.Close()

	mlAddr := envOr("MLSERVER_ADDR", "localhost:50051")
	ml, err := mlclient.New(mlAddr)
	if err != nil {
		log.Fatalf("mlserver connect (%s): %v", mlAddr, err)
	}
	defer ml.Close()
	log.Printf("connected to mlserver at %s", mlAddr)

	hub := ws.NewHub()

	tokenStore := middleware.NewTokenStore()
	api.Tokens = tokenStore

	processor := jobs.NewProcessor(ml, hub, 4)
	api.JobProcessor = processor

	os.MkdirAll("./uploads", 0755)
	os.MkdirAll("./processed_videos", 0755)

	r := mux.NewRouter()

	// Public routes
	r.HandleFunc("/api/auth/register", api.RegisterHandler).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/auth/login", api.LoginHandler).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/health", api.HealthHandler).Methods("GET")
	r.HandleFunc("/api/upload", api.UploadHandler).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/analyze", api.AnalyzeHandler).Methods("POST", "OPTIONS")

	// Protected routes (auth middleware)
	protected := r.PathPrefix("/api").Subrouter()
	protected.Use(middleware.AuthMiddleware(tokenStore))
	protected.HandleFunc("/events", api.EventsHandler).Methods("GET", "OPTIONS")
	protected.HandleFunc("/cameras", api.CamerasHandler).Methods("GET", "OPTIONS")

	// WebSocket (token via query param)
	r.HandleFunc("/api/ws/detect", hub.HandleWS).Methods("GET")

	// Static files
	r.PathPrefix("/processed_videos/").Handler(
		http.StripPrefix("/processed_videos/", http.FileServer(http.Dir("./processed_videos"))),
	)

	port := envOr("PORT", "8080")
	srv := &http.Server{Addr: ":" + port, Handler: corsMiddleware(r)}

	go func() {
		log.Printf("backend listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down backend...")
	processor.Shutdown()
	srv.Close()
	log.Println("backend stopped")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func corsMiddleware(next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, origin := range strings.Split(envOr("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001"), ",") {
		trimmed := strings.TrimSpace(origin)
		if trimmed != "" {
			allowed[trimmed] = true
		}
	}
	allowAll := allowed["*"]

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if allowAll && origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "86400")
		} else if allowed[origin] || strings.HasPrefix(origin, "http://192.168.") || strings.HasPrefix(origin, "http://127.0.0.1") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "86400")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
