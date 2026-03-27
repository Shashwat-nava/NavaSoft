package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/shashwatmani201/back/internal/analysis"
	"github.com/shashwatmani201/back/internal/db"
	"github.com/shashwatmani201/back/internal/jobs"
	"github.com/shashwatmani201/back/internal/middleware"
)

var (
	JobProcessor *jobs.Processor
	Tokens       *middleware.TokenStore
)

type UploadResponse struct {
	VideoID string `json:"videoId"`
	JobID   string `json:"jobId"`
}

func UploadHandler(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("video")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	videoID := uuid.New().String()
	fileName := videoID + "_" + header.Filename
	filePath := filepath.Join("./uploads", fileName)
	out, err := os.Create(filePath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer out.Close()
	if _, err = io.Copy(out, file); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	userID := middleware.GetUserID(r)
	if userID == 0 {
		userID = 1
	}

	videoRec := db.Video{
		ID:       videoID,
		FileName: fileName,
		UserID:   userID,
		Status:   "uploaded",
	}
	if err := db.InsertVideo(videoRec); err != nil {
		log.Printf("db insert video: %v", err)
	}

	var zones []analysis.Zone
	if zp := r.FormValue("zones"); zp != "" {
		json.Unmarshal([]byte(zp), &zones)
	}

	var metrics []string
	if mp := r.FormValue("metrics"); mp != "" {
		json.Unmarshal([]byte(mp), &metrics)
	}

	job := &jobs.Job{
		ID:        uuid.New().String(),
		VideoID:   videoID,
		UserID:    userID,
		VideoPath: filePath,
		Zones:     zones,
		Metrics:   metrics,
	}

	if JobProcessor != nil {
		JobProcessor.Submit(job)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(UploadResponse{
		VideoID: videoID,
		JobID:   job.ID,
	})
}

// AnalyzeHandler starts analysis on an already-uploaded video.
func AnalyzeHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		VideoID string          `json:"videoId"`
		Zones   []analysis.Zone `json:"zones"`
		Metrics []string        `json:"metrics"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	videoRec, err := db.GetVideoByID(req.VideoID)
	if err != nil {
		http.Error(w, "video not found", http.StatusNotFound)
		return
	}

	userID := middleware.GetUserID(r)
	if userID == 0 {
		userID = 1
	}

	job := &jobs.Job{
		ID:        uuid.New().String(),
		VideoID:   req.VideoID,
		UserID:    userID,
		VideoPath: filepath.Join("./uploads", videoRec.FileName),
		Zones:     req.Zones,
		Metrics:   req.Metrics,
	}

	if JobProcessor != nil {
		JobProcessor.Submit(job)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"jobId":   job.ID,
		"videoId": req.VideoID,
		"status":  "queued",
	})
}

func EventsHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(`
		SELECT id, timestamp, event_type, severity, camera, zone, confidence, video_id, frame_index
		FROM events
		ORDER BY timestamp DESC
		LIMIT 100
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var events []map[string]interface{}
	for rows.Next() {
		var id, eventType, severity, camera, zone, videoID string
		var timestamp time.Time
		var confidence, frameIndex int
		if err := rows.Scan(&id, &timestamp, &eventType, &severity, &camera, &zone, &confidence, &videoID, &frameIndex); err != nil {
			continue
		}
		events = append(events, map[string]interface{}{
			"id":         id,
			"timestamp":  timestamp,
			"eventType":  eventType,
			"severity":   severity,
			"camera":     camera,
			"zone":       zone,
			"confidence": confidence,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

func CamerasHandler(w http.ResponseWriter, r *http.Request) {
	cameras := []map[string]interface{}{
		{"id": 1, "name": "Camera 1", "location": "Loading Dock", "status": "active"},
		{"id": 2, "name": "Camera 2", "location": "Production Floor", "status": "active"},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cameras)
}

type RegisterRequest struct {
	Name          string `json:"name"`
	Email         string `json:"email"`
	Company       string `json:"company"`
	Role          string `json:"role"`
	PlantLocation string `json:"plant_location"`
	Password      string `json:"password"`
	Identifier    string `json:"identifier"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	user := db.User{
		Name:     req.Name,
		Email:    req.Email,
		Company:  req.Company,
		Password: string(hashed),
		Role:     req.Role,
	}
	if err := db.InsertUser(user); err != nil {
		log.Printf("insert user: %v", err)
		http.Error(w, "email already registered", http.StatusConflict)
		return
	}

	inserted, err := db.GetUserByEmail(req.Email)
	if err != nil {
		http.Error(w, "user created but could not retrieve", http.StatusInternalServerError)
		return
	}

	token := uuid.New().String()
	if Tokens != nil {
		Tokens.Set(token, inserted.ID, 24*time.Hour)
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      inserted.ID,
		"name":    inserted.Name,
		"email":   inserted.Email,
		"company": inserted.Company,
		"role":    inserted.Role,
		"token":   token,
		"message": "user created",
	})
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	user, err := db.GetUserByEmail(req.Email)
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	token := uuid.New().String()
	if Tokens != nil {
		Tokens.Set(token, user.ID, 24*time.Hour)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      user.ID,
		"name":    user.Name,
		"email":   user.Email,
		"company": user.Company,
		"role":    user.Role,
		"token":   token,
	})
}

func HealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
