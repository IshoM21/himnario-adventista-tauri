//! Prueba de humo de extremo a extremo, solo en builds de desarrollo:
//! `HIMNARIO_SMOKE=1 npm run tauri:dev`. Ejecuta sobre el motor real (audio,
//! eventos y ambas ventanas) la secuencia típica de un culto y registra cada
//! paso en el log con el prefijo `SMOKE`. Nunca se compila en release.

use crate::content::TrackKind;
use crate::playback::publisher::publish;
use crate::playback::session::Status;
use crate::presentation::window;
use crate::state::AppState;
use std::{thread, time::Duration};
use tauri::{AppHandle, Manager};

fn step(app: &AppHandle, name: &str, action: impl FnOnce(&AppState) -> Result<(), String>) {
    let state = app.state::<AppState>();
    let result = action(&state);
    let snapshot = state.session().snapshot();
    publish(app, &snapshot);
    state.wake_ticker();
    log::info!(
        "SMOKE {name}: {} · hymn={:?} track={:?} status={:?} pos={:.2}/{:.2} slide={:?} next={:?} mode={:?} cue={:?}",
        if result.is_ok() { "OK" } else { "ERROR" },
        snapshot.hymn.as_ref().map(|hymn| &hymn.id),
        snapshot.track,
        snapshot.status,
        snapshot.position,
        snapshot.duration,
        snapshot.current_slide,
        snapshot.next_slide,
        snapshot.presentation,
        snapshot.cue.as_ref().map(|hymn| &hymn.id),
    );
    if let Err(error) = result {
        log::error!("SMOKE {name}: {error}");
    }
}

fn set_theme(app: &AppHandle, theme: crate::settings::Theme) {
    use tauri::Emitter;
    let state = app.state::<AppState>();
    match state.update_settings(|settings| settings.theme = theme) {
        Ok(saved) => {
            let _ = app.emit(crate::events::SETTINGS, &saved);
            log::info!("SMOKE tema: {theme:?}");
        }
        Err(error) => log::error!("SMOKE tema: {error}"),
    }
}

fn select(state: &AppState, id: &str) -> Result<(), String> {
    let hymn = state
        .content
        .as_ref()
        .ok_or("sin contenido")?
        .load(id)
        .map_err(|error| error.message)?;
    state
        .session()
        .select(hymn, TrackKind::Vocal)
        .map(|_| ())
        .map_err(|error| error.message)
}

fn wait(seconds: f64) {
    thread::sleep(Duration::from_secs_f64(seconds));
}

pub fn spawn(app: AppHandle) {
    if std::env::var("HIMNARIO_SMOKE").ok().as_deref() != Some("1") {
        return;
    }
    let _ = thread::Builder::new().name("smoke".into()).spawn(move || {
        wait(3.0);
        log::info!("SMOKE inicio");
        let map = |result: crate::error::AppResult<()>| result.map_err(|error| error.message);
        step(&app, "volumen", |s| {
            s.session().set_volume(0.15);
            Ok(())
        });
        step(&app, "mostrar-proyeccion", |_| window::show(&app).map(|_| ()).map_err(|e| e.message));
        let first = std::env::var("HIMNARIO_SMOKE_HYMN").unwrap_or_else(|_| "001".into());
        step(&app, "seleccionar-primero", |s| select(s, &first));
        wait(2.0);
        step(&app, "play", |s| map(s.session().play()));
        wait(10.0);
        step(&app, "tras-10s", |_| Ok(()));
        step(&app, "seek-25", |s| map(s.session().seek(25.0)));
        wait(2.0);
        set_theme(&app, crate::settings::Theme::Light);
        wait(2.0);
        step(&app, "pista-instrumental", |s| map(s.session().set_track(TrackKind::Instrumental)));
        wait(2.0);
        step(&app, "negro", |s| {
            s.session().set_black(true);
            Ok(())
        });
        wait(2.0);
        step(&app, "quitar-negro", |s| {
            s.session().set_black(false);
            Ok(())
        });
        step(&app, "ocultar-letra", |s| {
            s.session().set_lyrics_hidden(true);
            Ok(())
        });
        wait(2.0);
        step(&app, "mostrar-letra", |s| {
            s.session().set_lyrics_hidden(false);
            Ok(())
        });
        step(&app, "siguiente-pantalla", |s| map(s.session().next_slide()));
        wait(2.0);
        step(&app, "seleccionar-384-en-curso", |s| select(s, "384"));
        wait(3.0);
        step(&app, "cambiar-ahora", |s| map(s.session().take_cue(TrackKind::Vocal)));
        step(&app, "play-384", |s| map(s.session().play()));
        wait(4.0);
        step(&app, "pausa", |s| {
            s.session().pause();
            Ok(())
        });
        wait(3.0);
        step(&app, "pausa-prolongada", |s| {
            let status = s.session().snapshot().status;
            if status == Status::Paused { Ok(()) } else { Err(format!("estado {status:?}")) }
        });
        step(&app, "reanudar", |s| map(s.session().play()));
        wait(2.0);
        step(&app, "detener", |s| map(s.session().stop()));
        set_theme(&app, crate::settings::Theme::Dark);
        step(&app, "ocultar-proyeccion", |_| window::hide(&app).map(|_| ()).map_err(|e| e.message));
        log::info!("SMOKE fin");
    });
}
