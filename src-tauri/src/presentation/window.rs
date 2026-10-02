//! Control de la ventana de proyección. La ventana existe desde el arranque
//! (oculta) y nunca se destruye: cerrar solo la oculta. Así "Negro" y
//! "Reabrir proyección" nunca dependen de reconstruir un WebView.

use super::monitors::{match_monitor, MonitorInfo};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::state::AppState;
use serde::Serialize;
use std::{thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const PROJECTION: &str = "projection";
pub const OPERATOR: &str = "operator";

#[derive(Clone, Debug, Default)]
pub struct ProjectionState {
    pub presenting: bool,
    pub monitor_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionStatus {
    pub visible: bool,
    pub presenting: bool,
    pub monitor: Option<MonitorInfo>,
    /// Tamaño lógico del área de proyección (para la vista previa).
    pub width: f64,
    pub height: f64,
    /// La proyección está en el mismo monitor que el operador.
    pub shares_operator_monitor: bool,
}

fn window(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::window(format!("No se encontró la ventana {label}")))
}

pub fn list_monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    let primary = app.primary_monitor().ok().flatten();
    let primary_key = primary
        .as_ref()
        .map(|monitor| (monitor.position().x, monitor.position().y));
    match app.available_monitors() {
        Ok(monitors) => monitors
            .iter()
            .map(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                MonitorInfo::new(
                    monitor.name(),
                    position.x,
                    position.y,
                    size.width,
                    size.height,
                    monitor.scale_factor(),
                    primary_key == Some((position.x, position.y)),
                )
            })
            .collect(),
        Err(error) => {
            log::error!("No se pudieron consultar los monitores: {error}");
            Vec::new()
        }
    }
}

fn monitor_of(window: &WebviewWindow, monitors: &[MonitorInfo]) -> Option<MonitorInfo> {
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let center_x = position.x + (size.width / 2) as i32;
    let center_y = position.y + (size.height / 2) as i32;
    monitors
        .iter()
        .find(|monitor| monitor.contains_point(center_x, center_y))
        .cloned()
}

pub fn status(app: &AppHandle) -> ProjectionStatus {
    let state = app.state::<AppState>();
    let projection_state = state.projection.lock().map(|value| value.clone()).unwrap_or_default();
    let monitors = list_monitors(app);
    let Ok(projection) = window(app, PROJECTION) else {
        return ProjectionStatus {
            visible: false,
            presenting: false,
            monitor: None,
            width: 1920.0,
            height: 1080.0,
            shares_operator_monitor: false,
        };
    };
    let visible = projection.is_visible().unwrap_or(false);
    let monitor = if projection_state.presenting {
        projection_state
            .monitor_id
            .as_ref()
            .and_then(|id| monitors.iter().find(|monitor| &monitor.id == id).cloned())
    } else {
        monitor_of(&projection, &monitors)
    };
    let (width, height) = match (&monitor, projection_state.presenting) {
        (Some(monitor), true) => (
            monitor.width as f64 / monitor.scale_factor.max(0.1),
            monitor.height as f64 / monitor.scale_factor.max(0.1),
        ),
        _ => {
            let scale = projection.scale_factor().unwrap_or(1.0).max(0.1);
            projection
                .inner_size()
                .map(|size| (size.width as f64 / scale, size.height as f64 / scale))
                .unwrap_or((1920.0, 1080.0))
        }
    };
    let operator_monitor = window(app, OPERATOR)
        .ok()
        .and_then(|operator| monitor_of(&operator, &monitors));
    ProjectionStatus {
        visible,
        presenting: projection_state.presenting,
        shares_operator_monitor: visible
            && monitor.is_some()
            && operator_monitor.as_ref().map(|m| &m.id) == monitor.as_ref().map(|m| &m.id),
        monitor,
        width: width.max(1.0),
        height: height.max(1.0),
    }
}

pub fn emit_status(app: &AppHandle) {
    let _ = app.emit(events::PROJECTION, status(app));
}

fn set_presenting(app: &AppHandle, presenting: bool, monitor_id: Option<String>) {
    let state = app.state::<AppState>();
    if let Ok(mut projection) = state.projection.lock() {
        projection.presenting = presenting;
        projection.monitor_id = monitor_id;
    };
}

fn leave_fullscreen(projection: &WebviewWindow) {
    // `set_simple_fullscreen` evita crear un Space nuevo en macOS; en el resto
    // de plataformas equivale a `set_fullscreen`.
    let _ = projection.set_simple_fullscreen(false);
    let _ = projection.set_fullscreen(false);
    let _ = projection.set_always_on_top(false);
}

/// Pantalla completa sin bordes en el monitor indicado.
pub fn present(app: &AppHandle, monitor_id: &str) -> AppResult<ProjectionStatus> {
    let monitors = list_monitors(app);
    let monitor = monitors
        .iter()
        .find(|monitor| monitor.id == monitor_id)
        .cloned()
        .ok_or_else(|| AppError::window("Ese monitor ya no está conectado"))?;
    let projection = window(app, PROJECTION)?;
    leave_fullscreen(&projection);
    let _ = projection.unminimize();
    projection.set_position(PhysicalPosition::new(monitor.x + 40, monitor.y + 40))?;
    projection.set_size(PhysicalSize::new(
        (monitor.width / 2).max(320),
        (monitor.height / 2).max(180),
    ))?;
    projection.show()?;
    // Algunos gestores de ventanas (Linux/Windows) aplican el movimiento de
    // forma asíncrona; se espera un instante para que la pantalla completa se
    // active en el monitor correcto y no en el anterior.
    thread::sleep(Duration::from_millis(120));
    projection.set_simple_fullscreen(true)?;
    set_presenting(app, true, Some(monitor.id.clone()));
    log::info!("Proyección en pantalla completa: {} ({}×{})", monitor.name, monitor.width, monitor.height);
    focus_operator(app);
    let current = status(app);
    let _ = app.emit(events::PROJECTION, current.clone());
    Ok(current)
}

/// Sale de pantalla completa dejando la ventana visible.
pub fn exit_presentation(app: &AppHandle) -> AppResult<ProjectionStatus> {
    let projection = window(app, PROJECTION)?;
    leave_fullscreen(&projection);
    set_presenting(app, false, None);
    log::info!("Proyección en modo ventana");
    let current = status(app);
    let _ = app.emit(events::PROJECTION, current.clone());
    Ok(current)
}

pub fn show(app: &AppHandle) -> AppResult<ProjectionStatus> {
    let projection = window(app, PROJECTION)?;
    let _ = projection.unminimize();
    projection.show()?;
    focus_operator(app);
    let current = status(app);
    let _ = app.emit(events::PROJECTION, current.clone());
    Ok(current)
}

pub fn hide(app: &AppHandle) -> AppResult<ProjectionStatus> {
    let projection = window(app, PROJECTION)?;
    leave_fullscreen(&projection);
    set_presenting(app, false, None);
    projection.hide()?;
    let current = status(app);
    let _ = app.emit(events::PROJECTION, current.clone());
    Ok(current)
}

/// Recuperación garantizada: sale de pantalla completa, lleva la proyección
/// como ventana al monitor principal (o al del operador) y la muestra.
pub fn recover(app: &AppHandle) -> AppResult<ProjectionStatus> {
    let projection = window(app, PROJECTION)?;
    leave_fullscreen(&projection);
    set_presenting(app, false, None);
    let monitors = list_monitors(app);
    let target = monitors
        .iter()
        .find(|monitor| monitor.primary)
        .or_else(|| monitors.first())
        .cloned();
    let _ = projection.unminimize();
    if let Some(monitor) = target {
        let width = (monitor.width / 2).max(320);
        let height = (width as f64 * 9.0 / 16.0) as u32;
        let _ = projection.set_size(PhysicalSize::new(width, height));
        let _ = projection.set_position(PhysicalPosition::new(
            monitor.x + (monitor.width.saturating_sub(width) / 2) as i32,
            monitor.y + (monitor.height.saturating_sub(height) / 2) as i32,
        ));
    }
    projection.show()?;
    log::warn!("Ventana de proyección recuperada al monitor principal");
    let current = status(app);
    let _ = app.emit(events::PROJECTION, current.clone());
    Ok(current)
}

fn focus_operator(app: &AppHandle) {
    if let Ok(operator) = window(app, OPERATOR) {
        let _ = operator.set_focus();
    }
}

/// Vigila conexiones y desconexiones de monitores. Si desaparece el monitor
/// donde se proyectaba, recupera la ventana para que nunca quede inaccesible.
pub fn spawn_monitor_watcher(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("monitor-watcher".into())
        .spawn(move || {
            let mut previous = list_monitors(&app);
            loop {
                thread::sleep(Duration::from_secs(2));
                let current = list_monitors(&app);
                if current == previous {
                    continue;
                }
                log::info!(
                    "Cambio de monitores: {} → {} conectados",
                    previous.len(),
                    current.len()
                );
                let _ = app.emit(events::MONITORS, current.clone());
                let presenting = app
                    .state::<AppState>()
                    .projection
                    .lock()
                    .map(|state| state.clone())
                    .unwrap_or_default();
                if presenting.presenting {
                    let still_there = presenting
                        .monitor_id
                        .as_ref()
                        .is_some_and(|id| current.iter().any(|monitor| &monitor.id == id));
                    if !still_there {
                        log::warn!("Se desconectó el monitor de proyección");
                        let _ = recover(&app);
                        let _ = app.emit(
                            events::NOTICE,
                            "Se desconectó el monitor de proyección. La ventana se trajo a la pantalla principal.",
                        );
                    }
                }
                emit_status(&app);
                previous = current;
            }
        });
    if let Err(error) = spawned {
        log::error!("No se pudo iniciar la vigilancia de monitores: {error}");
    }
}

/// Presentación automática al iniciar en el monitor guardado, solo si está
/// conectado y hay más de una pantalla (nunca tapa al operador).
pub fn auto_present(app: &AppHandle) {
    let settings = app.state::<AppState>().settings_snapshot();
    if !settings.projection.present_on_start {
        return;
    }
    let Some(saved) = settings.projection.monitor.as_ref() else {
        return;
    };
    let monitors = list_monitors(app);
    if monitors.len() < 2 {
        log::info!("Presentación automática omitida: solo hay una pantalla");
        return;
    }
    match match_monitor(saved, &monitors) {
        Some(monitor) => {
            if let Err(error) = present(app, &monitor.id) {
                log::error!("No se pudo presentar automáticamente: {error}");
            }
        }
        None => log::info!("El monitor guardado ({}) no está conectado", saved.name),
    }
}
