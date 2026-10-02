use crate::audio::RodioBackend;
use crate::content::{Hymn, TrackKind};
use crate::error::{AppError, AppResult};
use crate::playback::publisher::publish;
use crate::playback::session::{PlaybackSnapshot, SelectOutcome, Session};
use crate::state::AppState;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

/// Ejecuta una orden sobre la sesión, difunde el nuevo estado a ambas
/// ventanas y lo devuelve a quien la invocó.
fn apply<F>(app: &AppHandle, state: &AppState, action: F) -> AppResult<PlaybackSnapshot>
where
    F: FnOnce(&mut Session<RodioBackend>) -> AppResult<()>,
{
    let snapshot = {
        let mut session = state.session();
        action(&mut session)?;
        session.snapshot()
    };
    publish(app, &snapshot);
    state.wake_ticker();
    Ok(snapshot)
}

fn load_hymn(state: &AppState, id: &str) -> AppResult<Arc<Hymn>> {
    state
        .content
        .as_ref()
        .ok_or_else(|| AppError::content("El contenido no está disponible"))?
        .load(id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectResult {
    pub outcome: SelectOutcome,
    pub snapshot: PlaybackSnapshot,
}

#[tauri::command]
pub fn get_playback(state: State<'_, AppState>) -> PlaybackSnapshot {
    state.session().snapshot()
}

#[tauri::command]
pub fn select_hymn(id: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<SelectResult> {
    let hymn = load_hymn(&state, &id)?;
    let mut outcome = SelectOutcome::Loaded;
    let snapshot = apply(&app, &state, |session| {
        let track = session.selected_track();
        outcome = session.select(hymn, track)?;
        Ok(())
    })?;
    // Recientes: se difunde para que la pestaña se actualice al instante.
    if let Ok(saved) = state.update_settings(|settings| settings.operator.remember(&id)) {
        let _ = app.emit(crate::events::SETTINGS, &saved);
    }
    Ok(SelectResult { outcome, snapshot })
}

/// ▶ inmediato: el himno pasa al aire y suena aunque otro esté sonando.
#[tauri::command]
pub fn play_now(id: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    let hymn = load_hymn(&state, &id)?;
    let snapshot = apply(&app, &state, |session| session.play_now(hymn))?;
    if let Ok(saved) = state.update_settings(|settings| settings.operator.remember(&id)) {
        let _ = app.emit(crate::events::SETTINGS, &saved);
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn take_cue(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| {
        let track = session.selected_track();
        session.take_cue(track)
    })
}

#[tauri::command]
pub fn clear_cue(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| {
        session.clear_cue();
        Ok(())
    })
}

#[tauri::command]
pub fn play(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| session.play())
}

#[tauri::command]
pub fn pause(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| {
        session.pause();
        Ok(())
    })
}

#[tauri::command]
pub fn toggle_play(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| session.toggle())
}

#[tauri::command]
pub fn stop(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| session.stop())
}

#[tauri::command]
pub fn restart(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| session.restart())
}

#[tauri::command]
pub fn seek(seconds: f64, app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| session.seek(seconds))
}

#[tauri::command]
pub fn skip(delta: f64, app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| session.skip(delta))
}

#[tauri::command]
pub fn set_track(track: TrackKind, app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    let snapshot = apply(&app, &state, |session| session.set_track(track))?;
    let _ = state.update_settings(|settings| settings.audio.last_track = track);
    Ok(snapshot)
}

#[tauri::command]
pub fn go_to_slide(index: usize, app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| session.go_to_slide(index))
}

#[tauri::command]
pub fn next_slide(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| session.next_slide())
}

#[tauri::command]
pub fn previous_slide(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| session.previous_slide())
}

#[tauri::command]
pub fn set_black(value: bool, app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| {
        session.set_black(value);
        Ok(())
    })
}

#[tauri::command]
pub fn set_lyrics_hidden(value: bool, app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| {
        session.set_lyrics_hidden(value);
        Ok(())
    })
}

/// `persist` se envía al soltar el control, para no escribir el archivo de
/// configuración en cada paso del deslizador.
#[tauri::command]
pub fn set_volume(volume: f32, persist: bool, app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    let mut applied = volume;
    let snapshot = apply(&app, &state, |session| {
        applied = session.set_volume(volume);
        Ok(())
    })?;
    if persist {
        let _ = state.update_settings(|settings| settings.audio.volume = applied);
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn dismiss_notice(app: AppHandle, state: State<'_, AppState>) -> AppResult<PlaybackSnapshot> {
    apply(&app, &state, |session| {
        session.dismiss_notice();
        Ok(())
    })
}

/// Detiene el audio al cerrar la aplicación.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let _ = state.session().stop();
    }
}
