//! Los comandos de ventana son `async` para no bloquear el hilo principal:
//! Tauri despacha cada operación de ventana al hilo de la interfaz.

use crate::error::AppResult;
use crate::events;
use crate::presentation::monitors::{suggest_projection_monitor, MonitorInfo};
use crate::presentation::window::{self, ProjectionStatus};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
pub async fn list_monitors(app: AppHandle) -> MonitorList {
    let monitors = window::list_monitors(&app);
    MonitorList {
        suggested: suggest_projection_monitor(&monitors).cloned(),
        monitors,
    }
}

#[derive(serde::Serialize)]
pub struct MonitorList {
    pub monitors: Vec<MonitorInfo>,
    /// Monitor sugerido para proyectar en la primera ejecución.
    pub suggested: Option<MonitorInfo>,
}

#[tauri::command]
pub async fn get_projection_status(app: AppHandle) -> ProjectionStatus {
    window::status(&app)
}

/// Presenta en el monitor elegido y lo recuerda para la próxima vez.
#[tauri::command]
pub async fn present_projection(monitor_id: String, app: AppHandle) -> AppResult<ProjectionStatus> {
    let status = window::present(&app, &monitor_id)?;
    if let Some(monitor) = &status.monitor {
        let state = app.state::<AppState>();
        let reference = monitor.to_ref();
        if let Ok(saved) = state.update_settings(|settings| {
            settings.projection.monitor = Some(reference);
            settings.projection.monitor_prompt_answered = true;
        }) {
            let _ = app.emit(events::SETTINGS, &saved);
        }
    }
    Ok(status)
}

#[tauri::command]
pub async fn exit_presentation(app: AppHandle) -> AppResult<ProjectionStatus> {
    window::exit_presentation(&app)
}

#[tauri::command]
pub async fn show_projection(app: AppHandle) -> AppResult<ProjectionStatus> {
    window::show(&app)
}

#[tauri::command]
pub async fn hide_projection(app: AppHandle) -> AppResult<ProjectionStatus> {
    window::hide(&app)
}

#[tauri::command]
pub async fn recover_projection(app: AppHandle) -> AppResult<ProjectionStatus> {
    window::recover(&app)
}
