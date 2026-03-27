package db

import (
	"database/sql"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var DB *sql.DB

type User struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Company   string    `json:"company"`
	Password  string    `json:"-"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type Video struct {
	ID        string    `json:"id"`
	FileName  string    `json:"fileName"`
	UserID    int       `json:"userId"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type Event struct {
	ID         string    `json:"id"`
	Timestamp  time.Time `json:"timestamp"`
	EventType  string    `json:"eventType"`
	Severity   string    `json:"severity"`
	Camera     string    `json:"camera"`
	Zone       string    `json:"zone"`
	Confidence int       `json:"confidence"`
	VideoID    string    `json:"videoId"`
	FrameIndex int       `json:"frameIndex"`
}

type Job struct {
	ID              string    `json:"id"`
	VideoID         string    `json:"videoId"`
	UserID          int       `json:"userId"`
	Status          string    `json:"status"`
	SelectedMetrics string    `json:"selectedMetrics"` // comma-separated e.g. "ppe_compliance,near_miss,zone_violation"
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

func InitDB(databaseURL string) error {
	var err error
	DB, err = sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}

	DB.SetMaxOpenConns(10)
	DB.SetMaxIdleConns(5)

	if err := DB.Ping(); err != nil {
		return err
	}

	sqlStmt := `
	CREATE TABLE IF NOT EXISTS users (
		id SERIAL PRIMARY KEY,
		name TEXT NOT NULL,
		email TEXT UNIQUE NOT NULL,
		company TEXT NOT NULL,
		password TEXT NOT NULL,
		role TEXT DEFAULT 'Plant Manager',
		created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS videos (
		id TEXT PRIMARY KEY,
		file_name TEXT NOT NULL,
		user_id INTEGER,
		status TEXT DEFAULT 'uploaded',
		created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY(user_id) REFERENCES users(id)
	);
	CREATE TABLE IF NOT EXISTS events (
		id TEXT PRIMARY KEY,
		timestamp TIMESTAMPTZ NOT NULL,
		event_type TEXT NOT NULL,
		severity TEXT NOT NULL,
		camera TEXT,
		zone TEXT,
		confidence INTEGER,
		video_id TEXT,
		frame_index INTEGER,
		FOREIGN KEY(video_id) REFERENCES videos(id)
	);
	CREATE TABLE IF NOT EXISTS jobs (
		id TEXT PRIMARY KEY,
		video_id TEXT NOT NULL,
		user_id INTEGER NOT NULL,
		status TEXT DEFAULT 'queued',
		selected_metrics TEXT DEFAULT '',
		created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY(video_id) REFERENCES videos(id),
		FOREIGN KEY(user_id) REFERENCES users(id)
	);
	CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
	CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
	CREATE INDEX IF NOT EXISTS idx_events_video ON events(video_id);
	`
	_, err = DB.Exec(sqlStmt)
	if err != nil {
		return err
	}

	// Migration: add selected_metrics to existing jobs table if it doesn't exist yet.
	// Safe to run every startup — IF NOT EXISTS equivalent for columns via DO block.
	migrationStmt := `
	DO $$
	BEGIN
		IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'jobs' AND column_name = 'selected_metrics'
		) THEN
			ALTER TABLE jobs ADD COLUMN selected_metrics TEXT DEFAULT '';
		END IF;
	END
	$$;
	`
	_, err = DB.Exec(migrationStmt)
	return err
}

func InsertUser(user User) error {
	_, err := DB.Exec(
		"INSERT INTO users (name, email, company, password, role) VALUES ($1, $2, $3, $4, $5)",
		user.Name, user.Email, user.Company, user.Password, user.Role,
	)
	return err
}

func GetUserByEmail(email string) (User, error) {
	var u User
	err := DB.QueryRow(
		"SELECT id, name, email, company, password, role, created_at FROM users WHERE email = $1",
		email,
	).Scan(&u.ID, &u.Name, &u.Email, &u.Company, &u.Password, &u.Role, &u.CreatedAt)
	return u, err
}

func InsertVideo(v Video) error {
	_, err := DB.Exec(
		"INSERT INTO videos (id, file_name, user_id, status) VALUES ($1, $2, $3, $4)",
		v.ID, v.FileName, v.UserID, v.Status,
	)
	return err
}

func GetVideoByID(id string) (Video, error) {
	var v Video
	err := DB.QueryRow(
		"SELECT id, file_name, user_id, status, created_at FROM videos WHERE id = $1",
		id,
	).Scan(&v.ID, &v.FileName, &v.UserID, &v.Status, &v.CreatedAt)
	return v, err
}

func InsertEvent(e Event) error {
	_, err := DB.Exec(
		"INSERT INTO events (id, timestamp, event_type, severity, camera, zone, confidence, video_id, frame_index) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
		e.ID, e.Timestamp, e.EventType, e.Severity, e.Camera, e.Zone, e.Confidence, e.VideoID, e.FrameIndex,
	)
	return err
}

func InsertJob(j Job) error {
	_, err := DB.Exec(
		`INSERT INTO jobs (id, video_id, user_id, status, selected_metrics)
		 VALUES ($1, $2, $3, $4, $5)`,
		j.ID, j.VideoID, j.UserID, j.Status, j.SelectedMetrics,
	)
	return err
}

func UpdateJobStatus(id, status string) error {
	_, err := DB.Exec(
		"UPDATE jobs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		status, id,
	)
	return err
}

func GetJobsByUser(userID int, limit int) ([]Job, error) {
	rows, err := DB.Query(
		`SELECT id, video_id, user_id, status, selected_metrics, created_at, updated_at
		 FROM jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []Job
	for rows.Next() {
		var j Job
		if err := rows.Scan(&j.ID, &j.VideoID, &j.UserID, &j.Status, &j.SelectedMetrics, &j.CreatedAt, &j.UpdatedAt); err != nil {
			continue
		}
		jobs = append(jobs, j)
	}
	return jobs, nil
}