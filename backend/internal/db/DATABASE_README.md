# NAVA — Database Check Guide

Quick reference for inspecting the `nava` PostgreSQL database locally.

---

## Connect to the Database

```bash
psql -U postgres -d nava
```

You will be prompted for your postgres password.

---

## Table Overview

```sql
-- List all tables
\dt

-- Describe a specific table's columns
\d users
\d videos
\d jobs
\d events
```

---

## Users

Check all users who have signed up via the landing page.

```sql
SELECT id, name, email, company, role, created_at
FROM users
ORDER BY created_at DESC;
```

Count total signups:

```sql
SELECT COUNT(*) AS total_users FROM users;
```

Find a specific user by email:

```sql
SELECT * FROM users WHERE email = 'your@email.com';
```

---

## Videos

Check all videos that have been uploaded.

```sql
SELECT id, file_name, user_id, status, created_at
FROM videos
ORDER BY created_at DESC
LIMIT 20;
```

Videos uploaded by a specific user:

```sql
SELECT v.id, v.file_name, v.status, v.created_at
FROM videos v
JOIN users u ON u.id = v.user_id
WHERE u.email = 'your@email.com'
ORDER BY v.created_at DESC;
```

---

## Jobs + Selected Metrics

This is the key table — shows which features each company selected when running analysis.

**All recent jobs with user email and selected features:**

```sql
SELECT j.id, u.email, u.company, j.selected_metrics, j.status, j.created_at
FROM jobs j
JOIN users u ON u.id = j.user_id
ORDER BY j.created_at DESC
LIMIT 20;
```

**See which features are most popular across all users:**

```sql
SELECT
  CASE
    WHEN selected_metrics LIKE '%ppe_compliance%'      THEN 'PPE Compliance'
    WHEN selected_metrics LIKE '%near_miss%'           THEN 'Near Miss'
    WHEN selected_metrics LIKE '%zone_violation%'      THEN 'Zone Violation'
    WHEN selected_metrics LIKE '%pedestrian_exposure%' THEN 'Pedestrian Exposure'
  END AS feature,
  COUNT(*) AS times_selected
FROM jobs
GROUP BY feature
ORDER BY times_selected DESC;
```

**Jobs by a specific company:**

```sql
SELECT j.id, j.selected_metrics, j.status, j.created_at
FROM jobs j
JOIN users u ON u.id = j.user_id
WHERE u.company = 'nava'
ORDER BY j.created_at DESC;
```

**Jobs still processing or queued:**

```sql
SELECT j.id, u.email, j.status, j.created_at
FROM jobs j
JOIN users u ON u.id = j.user_id
WHERE j.status IN ('queued', 'processing')
ORDER BY j.created_at DESC;
```

---

## Events

Check all safety events detected by the AI.

```sql
SELECT id, event_type, severity, camera, zone, confidence, video_id, frame_index
FROM events
ORDER BY timestamp DESC
LIMIT 20;
```

Events for a specific video:

```sql
SELECT id, event_type, severity, zone, confidence, frame_index
FROM events
WHERE video_id = 'YOUR_VIDEO_ID'
ORDER BY frame_index ASC;
```

Event counts by type:

```sql
SELECT event_type, COUNT(*) AS total
FROM events
GROUP BY event_type
ORDER BY total DESC;
```

Event counts by severity:

```sql
SELECT severity, COUNT(*) AS total
FROM events
GROUP BY severity
ORDER BY total DESC;
```

---

## Full Pipeline Check

Run this to see the full journey of a single analysis — user → video → job → events:

```sql
SELECT
  u.name,
  u.email,
  u.company,
  v.file_name,
  j.selected_metrics,
  j.status AS job_status,
  COUNT(e.id) AS events_detected,
  j.created_at
FROM jobs j
JOIN users  u ON u.id = j.user_id
JOIN videos v ON v.id = j.video_id
LEFT JOIN events e ON e.video_id = v.id
GROUP BY u.name, u.email, u.company, v.file_name, j.selected_metrics, j.status, j.created_at
ORDER BY j.created_at DESC
LIMIT 10;
```

---

## Useful psql Shortcuts

| Command | What it does |
|---|---|
| `\dt` | List all tables |
| `\d jobs` | Show columns of a table |
| `\q` | Quit psql |
| `\x` | Toggle expanded (vertical) display — useful for wide rows |
| `\timing` | Show query execution time |

---

## Quick Sanity Check After a Test Run

After uploading a video and clicking Run Analysis on the landing page, run these three queries to confirm data is flowing correctly:

```sql
-- 1. Did the video get stored?
SELECT id, file_name, status FROM videos ORDER BY created_at DESC LIMIT 1;

-- 2. Did the job get created with selected metrics?
SELECT id, selected_metrics, status FROM jobs ORDER BY created_at DESC LIMIT 1;

-- 3. Did events get detected?
SELECT event_type, severity, confidence FROM events ORDER BY timestamp DESC LIMIT 5;
```

All three returning rows means your full pipeline is working end to end.
