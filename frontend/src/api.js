// ─── src/api.js ───────────────────────────────────────────────────────────────
// Single source of truth for all backend API calls.

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8080';

/**
 * Reads the JWT token from localStorage (set by EmailGateModal or legacy login).
 * Returns an Authorization header object if a token exists, otherwise {}.
 */
function getAuthHeaders() {
  try {
    const user = JSON.parse(localStorage.getItem('nava_user'))
      || JSON.parse(localStorage.getItem('userData'));
    if (user?.token) return { Authorization: `Bearer ${user.token}` };
  } catch { /* ignore */ }
  return {};
}

/**
 * Upload a video + zones/metrics to the backend.
 * Returns { videoId, jobId }.
 *
 * Used by: LandingPage (runAnalysis) and any future upload flows.
 */
export async function uploadVideo(file, zones = [], metrics = []) {
  const fd = new FormData();
  fd.append('video', file, file.name);
  fd.append('zones',   JSON.stringify(zones));
  fd.append('metrics', JSON.stringify(metrics));

  const res = await fetch(`${BACKEND_URL}/api/upload`, {
    method: 'POST',
    headers: getAuthHeaders(),   // auth header added — token may be absent for demo users
    body: fd,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Start server-side analysis on an already-uploaded video.
 * Returns { jobId, videoId, status }.
 *
 * NOTE: LandingPage uses /api/analyze-stream (SSE) directly.
 *       This function is kept for EventGrid / Reports pages that may
 *       trigger batch analysis separately.
 */
export async function startAnalysis(videoId, zones = [], metrics = []) {
  const res = await fetch(`${BACKEND_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ videoId, zones, metrics }),
  });
  if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch all processed safety events from the backend.
 * Accepts an optional cameraName to filter server-side.
 * Returns: { id, timestamp, eventType, severity, camera, zone, confidence }[]
 *
 * Auth header included — demo users without a token will still receive public
 * events; authenticated users may see their own history depending on the backend.
 */
export async function fetchEvents(cameraName = null) {
  const url = cameraName
    ? `${BACKEND_URL}/api/events?camera=${encodeURIComponent(cameraName)}`
    : `${BACKEND_URL}/api/events`;

  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Events fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();

  const raw = data.events || data || [];
  return raw.map((e, i) => ({
    id:         e.id          || e.event_id                || `EVT-${String(i + 1).padStart(3, '0')}`,
    timestamp:  e.timestamp   || e.time                    || '—',
    eventType:  e.eventType   || e.event_type  || e.type   || 'Unknown',
    severity:   e.severity                                 || deriveSeverity(e.confidence),
    camera:     e.camera      || e.camera_name             || '—',
    zone:       e.zone        || e.zone_label              || '—',
    confidence: e.confidence  != null ? Math.round(e.confidence) : null,
  }));
}

/**
 * Fetch the list of configured cameras from the backend.
 */
export async function fetchCameras() {
  const res = await fetch(`${BACKEND_URL}/api/cameras`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Cameras fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.cameras || data || [];
}

/**
 * Backend health check — used on app startup or reconnect logic.
 */
export async function healthCheck() {
  const res = await fetch(`${BACKEND_URL}/api/health`);
  return res.ok;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function deriveSeverity(confidence) {
  if (confidence == null) return 'Medium';
  if (confidence >= 90)   return 'High';
  if (confidence >= 70)   return 'Medium';
  return 'Low';
}