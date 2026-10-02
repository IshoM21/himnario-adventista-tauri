//! Nombres de los eventos Rust → React. Deben coincidir con `src/lib/events.ts`.

/// Instantánea completa de reproducción y presentación (`PlaybackSnapshot`).
pub const PLAYBACK: &str = "playback-state";
/// Configuración guardada (`Settings`).
pub const SETTINGS: &str = "settings-changed";
/// Estado de la ventana de proyección (`ProjectionStatus`).
pub const PROJECTION: &str = "projection-status";
/// Lista de monitores conectados (`MonitorInfo[]`).
pub const MONITORS: &str = "monitors-changed";
/// Aviso breve para el operador (texto).
pub const NOTICE: &str = "app-notice";
