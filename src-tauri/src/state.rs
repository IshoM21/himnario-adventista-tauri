use crate::audio::RodioBackend;
use crate::content::visuals::Visuals;
use crate::content::ContentRepository;
use crate::error::AppResult;
use crate::playback::session::{PlaybackSnapshot, Session};
use crate::presentation::window::ProjectionState;
use crate::settings::{self, Settings};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
    thread::Thread,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub content_root: Option<String>,
    pub settings_file: String,
    pub log_dir: Option<String>,
}

pub struct AppState {
    pub content: Option<Arc<ContentRepository>>,
    pub content_error: Option<String>,
    pub visuals: Visuals,
    pub session: Mutex<Session<RodioBackend>>,
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub startup_warnings: Vec<String>,
    pub projection: Mutex<ProjectionState>,
    pub last_published: Mutex<Option<PlaybackSnapshot>>,
    pub ticker: Mutex<Option<Thread>>,
    pub paths: AppPaths,
}

/// Un pánico en otro hilo no debe dejar la aplicación inutilizable durante
/// un culto: se recupera el dato protegido en lugar de propagar el veneno.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| {
        log::error!("Se recuperó un bloqueo envenenado");
        poisoned.into_inner()
    })
}

impl AppState {
    pub fn session(&self) -> MutexGuard<'_, Session<RodioBackend>> {
        lock(&self.session)
    }

    pub fn settings_snapshot(&self) -> Settings {
        lock(&self.settings).clone()
    }

    /// Aplica un cambio, lo sanea y lo guarda. Devuelve la versión final.
    pub fn update_settings(&self, change: impl FnOnce(&mut Settings)) -> AppResult<Settings> {
        let mut current = lock(&self.settings);
        let mut next = current.clone();
        change(&mut next);
        let next = next.sanitized();
        if next != *current {
            settings::save(&self.settings_path, &next)?;
            *current = next.clone();
        }
        Ok(next)
    }

    pub fn wake_ticker(&self) {
        if let Some(thread) = lock(&self.ticker).as_ref() {
            thread.unpark();
        }
    }
}
