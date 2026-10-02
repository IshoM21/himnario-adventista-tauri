use crate::content::Hymn;
use crate::playback::session::PlaybackSnapshot;
use crate::settings::Settings;
use crate::state::{AppPaths, AppState};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub version: String,
    pub platform: &'static str,
    pub snapshot: PlaybackSnapshot,
    pub hymn: Option<Hymn>,
    pub settings: Settings,
    pub content_error: Option<String>,
    pub warnings: Vec<String>,
    pub paths: AppPaths,
}

/// Estado inicial de una ventana que acaba de cargar (o recargar).
///
/// Solo lee datos propios (sin consultar ventanas ni monitores, que dependen
/// del hilo de la interfaz): así nunca puede dejar la pantalla en "Cargando…".
/// Monitores y proyección se piden aparte con `list_monitors` y
/// `get_projection_status`.
#[tauri::command]
pub fn get_bootstrap(window: tauri::WebviewWindow, app: AppHandle) -> Bootstrap {
    log::info!("Arranque solicitado por la ventana {}", window.label());
    let state = app.state::<AppState>();
    let (snapshot, hymn) = {
        let session = state.session();
        (session.snapshot(), session.current_hymn().map(|hymn| hymn.as_ref().clone()))
    };
    let bootstrap = Bootstrap {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        snapshot,
        hymn,
        settings: state.settings_snapshot(),
        content_error: state.content_error.clone(),
        warnings: state.startup_warnings.clone(),
        paths: state.paths.clone(),
    };
    log::info!("Arranque entregado a la ventana {}", window.label());
    bootstrap
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrontendLevel {
    Error,
    Warn,
    Info,
}

/// Errores de la interfaz al mismo archivo de log que el motor.
#[tauri::command]
pub fn log_frontend(level: FrontendLevel, message: String) {
    let message: String = message.chars().take(2000).collect();
    match level {
        FrontendLevel::Error => log::error!(target: "frontend", "{message}"),
        FrontendLevel::Warn => log::warn!(target: "frontend", "{message}"),
        FrontendLevel::Info => log::info!(target: "frontend", "{message}"),
    }
}
