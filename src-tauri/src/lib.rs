//! Himnario Adventista Desktop.
//!
//! Rust es la fuente única de verdad: audio (rodio), estado de reproducción,
//! contenido, configuración y ventanas. React solo dibuja y envía órdenes.

mod audio;
mod commands;
mod content;
mod error;
mod events;
mod playback;
mod presentation;
mod settings;
#[cfg(debug_assertions)]
mod smoke;
mod state;

use audio::RodioBackend;
use content::repository::{candidate_roots, find_root};
use content::ContentRepository;
use playback::session::Session;
use presentation::operator_window;
use presentation::window::{self as projection_window, OPERATOR, PROJECTION};
use state::{lock, AppPaths, AppState};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir {
                file_name: Some("himnario".into()),
            }),
        ])
        .level(level)
        // Dependencias ruidosas: solo advertencias.
        .level_for("symphonia_core", log::LevelFilter::Warn)
        .level_for("symphonia_bundle_mp3", log::LevelFilter::Error)
        .level_for("symphonia_format_isomp4", log::LevelFilter::Warn)
        .level_for("tao", log::LevelFilter::Warn)
        .level_for("wry", log::LevelFilter::Warn)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .max_file_size(2_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .build()
}

fn open_content(app: &tauri::App) -> (Option<Arc<ContentRepository>>, Option<String>) {
    let resource_dir = app.path().resource_dir().ok();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let candidates = candidate_roots(resource_dir, exe_dir);
    let Some(root) = find_root(&candidates) else {
        let searched = candidates
            .iter()
            .map(|path| format!("• {}", path.display()))
            .collect::<Vec<_>>()
            .join("\n");
        log::error!("No se encontró contenido. Rutas revisadas:\n{searched}");
        return (
            None,
            Some(format!("No se encontró la carpeta de contenido de los himnos. Rutas revisadas:\n{searched}")),
        );
    };
    match ContentRepository::open(root) {
        Ok(repository) => (Some(Arc::new(repository)), None),
        Err(error) => {
            log::error!("{error}");
            (None, Some(error.message))
        }
    }
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    log::info!(
        "Iniciando Himnario Adventista {} ({} {})",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let (content, content_error) = open_content(app);
    let settings_path = app
        .path()
        .app_config_dir()
        .map(|dir| dir.join("settings.json"))
        .unwrap_or_else(|_| PathBuf::from("settings.json"));
    let loaded = settings::load(&settings_path);
    let mut warnings = Vec::new();
    if let Some(warning) = loaded.warning {
        warnings.push(warning);
    }
    if let Some(content) = &content {
        warnings.extend(content.summary().warnings);
    }

    let content_root = content
        .as_ref()
        .map(|content| content.root().to_path_buf())
        .unwrap_or_default();
    let visuals = if content.is_some() {
        // Solo la carpeta de fondos queda accesible para las imágenes (lectura).
        let backgrounds = content_root.join("backgrounds");
        if backgrounds.is_dir() {
            if let Err(error) = app.asset_protocol_scope().allow_directory(&backgrounds, false) {
                log::warn!("No se pudo habilitar la carpeta de fondos: {error}");
            }
        }
        content::visuals::load(&content_root)
    } else {
        Default::default()
    };
    let backend = RodioBackend::new();
    let mut session = Session::new(backend, content_root.clone(), loaded.settings.audio.volume);
    // Pista inicial de la sesión; luego la elección del operador es "pegajosa".
    session.set_selected_track(loaded.settings.audio.preferred_track());
    let initial_settings = loaded.settings.clone();
    let paths = AppPaths {
        content_root: content.as_ref().map(|_| content_root.display().to_string()),
        settings_file: settings_path.display().to_string(),
        log_dir: app.path().app_log_dir().ok().map(|dir| dir.display().to_string()),
    };

    app.manage(AppState {
        content,
        content_error,
        visuals,
        session: Mutex::new(session),
        settings: Mutex::new(loaded.settings),
        settings_path,
        startup_warnings: warnings,
        projection: Mutex::new(Default::default()),
        last_published: Mutex::new(None),
        ticker: Mutex::new(None),
        paths,
    });

    let handle = app.handle().clone();
    // Abre en el último modo usado (completo o compacto), con su tamaño.
    operator_window::apply(&handle, &initial_settings, true);
    if let Some(operator) = handle.get_webview_window(OPERATOR) {
        let _ = operator.show();
        let _ = operator.set_focus();
    }
    playback::publisher::spawn_ticker(handle.clone());
    projection_window::spawn_monitor_watcher(handle.clone());
    #[cfg(debug_assertions)]
    smoke::spawn(handle.clone());
    // La presentación automática espera a que las ventanas terminen de crearse.
    let _ = thread::Builder::new().name("auto-present".into()).spawn(move || {
        thread::sleep(Duration::from_millis(600));
        projection_window::auto_present(&handle);
    });
    Ok(())
}

fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    let app = window.app_handle();
    match (window.label(), event) {
        // Cerrar la proyección solo la oculta: el audio sigue y puede
        // reabrirse al instante desde el operador.
        (PROJECTION, WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            if let Err(error) = projection_window::hide(app) {
                log::error!("No se pudo ocultar la proyección: {error}");
            }
            log::info!("Proyección cerrada por el usuario (oculta)");
        }
        (PROJECTION, WindowEvent::Resized(_)) | (PROJECTION, WindowEvent::ScaleFactorChanged { .. }) => {
            projection_window::emit_status(app);
        }
        (OPERATOR, WindowEvent::CloseRequested { .. }) => {
            operator_window::save_bounds(app);
            app.exit(0);
        }
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(log_plugin())
        .setup(setup)
        .on_window_event(on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::app::get_bootstrap,
            commands::app::log_frontend,
            commands::content::get_catalog,
            commands::content::get_hymn,
            commands::content::get_current_hymn,
            commands::content::get_visuals,
            commands::playback::get_playback,
            commands::playback::select_hymn,
            commands::playback::take_cue,
            commands::playback::play_now,
            commands::playback::clear_cue,
            commands::playback::play,
            commands::playback::pause,
            commands::playback::toggle_play,
            commands::playback::stop,
            commands::playback::restart,
            commands::playback::seek,
            commands::playback::skip,
            commands::playback::set_track,
            commands::playback::go_to_slide,
            commands::playback::next_slide,
            commands::playback::previous_slide,
            commands::playback::set_black,
            commands::playback::set_lyrics_hidden,
            commands::playback::set_volume,
            commands::playback::dismiss_notice,
            commands::projection::list_monitors,
            commands::projection::get_projection_status,
            commands::projection::present_projection,
            commands::projection::exit_presentation,
            commands::projection::show_projection,
            commands::projection::hide_projection,
            commands::projection::recover_projection,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::reset_settings,
            presentation::operator_window::set_compact_mode,
        ])
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(error) => {
            log::error!("No se pudo iniciar la aplicación: {error}");
            eprintln!("No se pudo iniciar Himnario Adventista: {error}");
            std::process::exit(1);
        }
    };

    app.run(|handle, event| {
        // En macOS, «Salir» (Cmd+Q) puede terminar sin `ExitRequested`; `Exit`
        // llega siempre. El cierre es idempotente.
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            shutdown_once(handle);
        }
    });
}

fn shutdown_once(handle: &AppHandle) {
    static DONE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if DONE.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    operator_window::save_bounds(handle);
    commands::playback::shutdown(handle);
    if let Some(state) = handle.try_state::<AppState>() {
        lock(&state.projection).presenting = false;
    }
    log::info!("Aplicación cerrada");
    log::logger().flush();
}
