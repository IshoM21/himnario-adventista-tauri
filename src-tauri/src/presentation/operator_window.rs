//! Ventana del operador: vista completa o compacta, cada una con su tamaño y
//! posición recordados, y «siempre visible» solo en modo compacto.

use super::window::OPERATOR;
use crate::error::AppResult;
use crate::events;
use crate::settings::{Settings, WindowBounds};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

// Tamaños del contenido (sin barra de título), en píxeles lógicos. 1280×680
// cabe completo en una laptop de 1366×768 con la barra de tareas de Windows
// 10 (40 px) o 11 (48 px) y la barra de título (~32 px).
const FULL_MIN: (f64, f64) = (1024.0, 640.0);
const FULL_DEFAULT: (f64, f64) = (1280.0, 680.0);
const COMPACT_MIN: (f64, f64) = (360.0, 520.0);
const COMPACT_DEFAULT: (f64, f64) = (430.0, 680.0);
/// Separación mínima con los bordes del área útil al centrar.
const EDGE: u32 = 8;

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
    // Posición exterior y tamaño del CONTENIDO: es lo que `set_size` restaura
    // (guardar el tamaño exterior hacía crecer la ventana en cada arranque).
    let (position, size) = (window.outer_position().ok()?, window.inner_size().ok()?);
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

/// Marco de la ventana (barra de título y bordes), en píxeles físicos.
fn frame_size(window: &WebviewWindow, scale: f64) -> (u32, u32) {
    let measured = match (window.outer_size(), window.inner_size()) {
        (Ok(outer), Ok(inner)) => (
            outer.width.saturating_sub(inner.width).min(200),
            outer.height.saturating_sub(inner.height).min(200),
        ),
        _ => (0, 0),
    };
    // En Windows, si la ventana aún oculta no informa su marco, se asume el
    // estándar (bordes + barra de título) para no quedar cortada.
    if cfg!(windows) && measured.1 == 0 {
        return ((16.0 * scale).round() as u32, (40.0 * scale).round() as u32);
    }
    measured
}

fn monitor_at(app: &AppHandle, x: i32, y: i32) -> Option<Monitor> {
    app.available_monitors().ok()?.into_iter().find(|monitor| {
        let (position, size) = (monitor.position(), monitor.size());
        x >= position.x && y >= position.y && x < position.x + size.width as i32 && y < position.y + size.height as i32
    })
}

/// Espacio útil del monitor (sin barra de tareas) para el CONTENIDO de la
/// ventana, en píxeles físicos.
fn available(monitor: &Monitor, frame: (u32, u32)) -> (u32, u32) {
    let area = monitor.work_area();
    (
        area.size.width.saturating_sub(frame.0 + 2 * EDGE),
        area.size.height.saturating_sub(frame.1 + 2 * EDGE),
    )
}

/// Coloca el contenido `size` dentro del área útil: si `position` (exterior)
/// es `None` o la ventana quedaría fuera, se centra.
fn place(window: &WebviewWindow, monitor: &Monitor, size: PhysicalSize<u32>, position: Option<PhysicalPosition<i32>>, frame: (u32, u32)) {
    let area = monitor.work_area();
    let outer = (size.width + frame.0, size.height + frame.1);
    let (left, top) = (area.position.x, area.position.y);
    let right = left + area.size.width as i32 - outer.0 as i32;
    let bottom = top + area.size.height as i32 - outer.1 as i32;
    let centered = PhysicalPosition::new(
        left + (area.size.width.saturating_sub(outer.0) / 2) as i32,
        top + (area.size.height.saturating_sub(outer.1) / 2) as i32,
    );
    let position = match position {
        Some(saved) => PhysicalPosition::new(saved.x.clamp(left, right.max(left)), saved.y.clamp(top, bottom.max(top))),
        None => centered,
    };
    let _ = window.set_size(size);
    let _ = window.set_position(position);
}

/// Aplica tamaño mínimo, «siempre visible» y (opcionalmente) el tamaño y la
/// posición guardados del modo. Siempre se ajusta al área útil del monitor
/// (sin la barra de tareas): la ventana nunca queda cortada ni inaccesible.
/// Si ni el tamaño mínimo cabe (p. ej. 1366×768 con escala 125 %), se
/// maximiza la vista completa.
pub fn apply(app: &AppHandle, settings: &Settings, restore_bounds: bool) {
    let Some(window) = operator(app) else {
        return;
    };
    let compact = settings.ui.compact;
    let (min, default) = if compact { (COMPACT_MIN, COMPACT_DEFAULT) } else { (FULL_MIN, FULL_DEFAULT) };
    let _ = window.set_always_on_top(compact && settings.ui.always_on_top_compact);

    let saved = slot(settings, compact);
    let saved_monitor = saved.and_then(|bounds| {
        monitor_at(app, bounds.x + (bounds.width / 2) as i32, bounds.y + (bounds.height / 2) as i32)
    });
    let monitor = saved_monitor
        .clone()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        let _ = window.set_min_size(Some(LogicalSize::new(min.0, min.1)));
        if restore_bounds {
            let _ = window.set_size(LogicalSize::new(default.0, default.1));
            let _ = window.center();
        }
        return;
    };

    let scale = monitor.scale_factor();
    let frame = frame_size(&window, scale);
    let (room_w, room_h) = available(&monitor, frame);
    let min_fits = min.0 * scale <= room_w as f64 && min.1 * scale <= room_h as f64;
    // El mínimo nunca debe ser mayor que la pantalla.
    let effective_min = (min.0.min(room_w as f64 / scale), min.1.min(room_h as f64 / scale));
    let _ = window.set_min_size(Some(LogicalSize::new(effective_min.0, effective_min.1)));
    if !restore_bounds {
        return;
    }
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }

    let fit = |width: u32, height: u32| PhysicalSize::new(width.min(room_w).max(1), height.min(room_h).max(1));
    match saved.filter(|_| saved_monitor.is_some()) {
        Some(bounds) => {
            let size = fit(bounds.width, bounds.height);
            if size.width != bounds.width || size.height != bounds.height {
                log::info!(
                    "Ventana del operador ajustada al área útil: {}×{} → {}×{}",
                    bounds.width, bounds.height, size.width, size.height
                );
            }
            place(&window, &monitor, size, Some(PhysicalPosition::new(bounds.x, bounds.y)), frame);
            if bounds.maximized && !compact {
                let _ = window.maximize();
            }
        }
        None => {
            let size = fit((default.0 * scale).round() as u32, (default.1 * scale).round() as u32);
            place(&window, &monitor, size, None, frame);
            log::info!(
                "Ventana del operador: tamaño inicial {}×{} (área útil {}×{}, escala {scale})",
                size.width, size.height, monitor.work_area().size.width, monitor.work_area().size.height
            );
        }
    }
    if !min_fits && !compact {
        log::info!("Pantalla más chica que el tamaño mínimo: la vista completa se abre maximizada");
        let _ = window.maximize();
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
