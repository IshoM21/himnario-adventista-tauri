use crate::error::AppResult;
use crate::events;
use crate::settings::Settings;
use crate::state::AppState;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings_snapshot()
}

/// Reemplaza las preferencias editables. Las secciones que administra la
/// propia aplicación (ventana del operador, último himno) se conservan.
#[tauri::command]
pub fn update_settings(settings: Settings, app: AppHandle, state: State<'_, AppState>) -> AppResult<Settings> {
    let saved = state.update_settings(|current| {
        let operator = current.operator.clone();
        // La vista (completa/compacta) solo cambia con `set_compact_mode`.
        let compact = current.ui.compact;
        *current = settings;
        current.operator = operator;
        current.ui.compact = compact;
    })?;
    // «Siempre visible» y tamaño mínimo se aplican al instante.
    crate::presentation::operator_window::apply(&app, &saved, false);
    let _ = app.emit(events::SETTINGS, &saved);
    Ok(saved)
}

#[tauri::command]
pub fn reset_settings(app: AppHandle, state: State<'_, AppState>) -> AppResult<Settings> {
    let compact = state.settings_snapshot().ui.compact;
    let saved = state.update_settings(|current| {
        let operator = current.operator.clone();
        let monitor = current.projection.monitor.clone();
        *current = Settings::default();
        current.operator = operator;
        current.projection.monitor = monitor;
        current.projection.monitor_prompt_answered = true;
        // La vista actual (completa/compacta) no cambia al restablecer.
        current.ui.compact = compact;
    })?;
    crate::presentation::operator_window::apply(&app, &saved, false);
    let _ = app.emit(events::SETTINGS, &saved);
    log::info!("Preferencias restablecidas");
    Ok(saved)
}
