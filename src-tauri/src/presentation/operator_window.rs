//! Ventana del operador: vista completa o compacta, cada una con su tamaño y
//! posición recordados, y «siempre visible» solo en modo compacto.

use super::window::{list_monitors, OPERATOR};
use crate::error::AppResult;
use crate::events;
use crate::settings::{Settings, WindowBounds};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const FULL_MIN: (f64, f64) = (1024.0, 640.0);
const FULL_DEFAULT: (f64, f64) = (1280.0, 820.0);
const COMPACT_MIN: (f64, f64) = (360.0, 520.0);
const COMPACT_DEFAULT: (f64, f64) = (430.0, 760.0);

fn operator(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(OPERATOR)
}

/// Tamaño y posición actuales (físicos). En la vista completa maximizada se
/// conserva el tamaño "normal" anterior.
fn current_bounds(window: &WebviewWindow, previous: Option<&WindowBounds>) -> Option<WindowBounds> {
    if window.is_minimized().unwrap_or(false) {
        return previous.cloned();
    }
    if window.is_maximized().unwrap_or(false) {
        return previous.cloned().map(|mut bounds| {
            bounds.maximized = true;
            bounds
        });
    }
    let (position, size) = (window.outer_position().ok()?, window.outer_size().ok()?);
    Some(WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: false,
    })
}

fn slot(settings: &Settings, compact: bool) -> Option<&WindowBounds> {
    if compact {
        settings.operator.compact_window.as_ref()
    } else {
        settings.operator.window.as_ref()
    }
}

/// Aplica tamaño mínimo, «siempre visible» y (opcionalmente) el tamaño y la
/// posición guardados del modo. Una posición fuera de las pantallas conectadas
/// se descarta y la ventana se centra: nunca queda inaccesible.
pub fn apply(app: &AppHandle, settings: &Settings, restore_bounds: bool) {
    let Some(window) = operator(app) else {
        return;
    };
    let compact = settings.ui.compact;
    let (min, default) = if compact { (COMPACT_MIN, COMPACT_DEFAULT) } else { (FULL_MIN, FULL_DEFAULT) };
    let _ = window.set_min_size(Some(LogicalSize::new(min.0, min.1)));
    let _ = window.set_always_on_top(compact && settings.ui.always_on_top_compact);
    if !restore_bounds {
        return;
    }
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }
    let visible_on_screen = |bounds: &WindowBounds| {
        let center_x = bounds.x + (bounds.width / 2) as i32;
        let center_y = bounds.y + (bounds.height / 2) as i32;
        list_monitors(app)
            .iter()
            .any(|monitor| monitor.contains_point(center_x, center_y))
    };
    match slot(settings, compact).filter(|bounds| visible_on_screen(bounds)) {
        Some(bounds) => {
            let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
            let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
            if bounds.maximized && !compact {
                let _ = window.maximize();
            }
        }
        None => {
            let _ = window.set_size(LogicalSize::new(default.0, default.1));
            let _ = window.center();
        }
    }
}

/// Guarda el tamaño y la posición del modo actual (al salir o al cambiar de modo).
pub fn save_bounds(app: &AppHandle) {
    let (Some(window), Some(state)) = (operator(app), app.try_state::<AppState>()) else {
        return;
    };
    let current = state.settings_snapshot();
    let compact = current.ui.compact;
    let Some(bounds) = current_bounds(&window, slot(&current, compact)) else {
        return;
    };
    let result = state.update_settings(|settings| {
        if compact {
            settings.operator.compact_window = Some(bounds);
        } else {
            settings.operator.window = Some(bounds);
        }
    });
    if let Err(error) = result {
        log::warn!("No se guardó la posición de la ventana: {error}");
    }
}

/// Cambia entre la vista completa y la compacta.
#[tauri::command]
pub async fn set_compact_mode(compact: bool, app: AppHandle) -> AppResult<Settings> {
    let state = app.state::<AppState>();
    if state.settings_snapshot().ui.compact == compact {
        return Ok(state.settings_snapshot());
    }
    save_bounds(&app);
    let saved = state.update_settings(|settings| settings.ui.compact = compact)?;
    apply(&app, &saved, true);
    log::info!("Vista del operador: {}", if compact { "compacta" } else { "completa" });
    let _ = app.emit(events::SETTINGS, &saved);
    Ok(saved)
}
