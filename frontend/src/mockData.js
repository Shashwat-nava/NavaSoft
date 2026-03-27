// ─── src/mockData.js ──────────────────────────────────────────────────────────
// Compatibility shim — all real logic lives in src/api.js.
// Pages that import from '../../mockData' keep working unchanged.

export { fetchEvents, fetchCameras } from './api';

// Empty arrays so any file still referencing the old static import
// gets [] instead of a crash.
export const sharedEvents  = [];
export const sharedCameras = [];