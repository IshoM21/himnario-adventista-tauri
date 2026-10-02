// Eventos Rust → React. Deben coincidir con src-tauri/src/events.rs.
export const EVENTS = {
  playback: "playback-state",
  settings: "settings-changed",
  projection: "projection-status",
  monitors: "monitors-changed",
  notice: "app-notice",
} as const;
