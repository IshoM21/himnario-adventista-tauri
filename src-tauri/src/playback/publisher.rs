//! Difusión del estado a las dos ventanas.
//!
//! Se separa la precisión del motor de la frecuencia visual: mientras suena,
//! se emite como máximo cada 250 ms (la barra de progreso se interpola en
//! React), pero el hilo despierta exactamente en cada cambio de pantalla para
//! que la letra cambie a tiempo. Detenido, solo se emite cuando algo cambia.

use super::session::{PlaybackSnapshot, Status};
use crate::events;
use crate::state::{lock, AppState};
use std::{
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const IDLE_INTERVAL: Duration = Duration::from_millis(500);
/// Pequeño margen tras un límite de pantalla para leer la posición ya pasada.
const BOUNDARY_MARGIN: Duration = Duration::from_millis(4);
const OUTPUT_RETRY_INTERVAL: Duration = Duration::from_secs(3);

pub fn publish(app: &AppHandle, snapshot: &PlaybackSnapshot) {
    if let Err(error) = app.emit(events::PLAYBACK, snapshot) {
        log::warn!("No se pudo emitir el estado: {error}");
    }
    let state = app.state::<AppState>();
    *lock(&state.last_published) = Some(snapshot.clone());
}

pub fn spawn_ticker(app: AppHandle) {
    let handle = app.clone();
    let spawned = thread::Builder::new()
        .name("playback-ticker".into())
        .spawn(move || run(handle));
    match spawned {
        Ok(join) => {
            *lock(&app.state::<AppState>().ticker) = Some(join.thread().clone());
        }
        Err(error) => log::error!("No se pudo iniciar el actualizador: {error}"),
    }
}

fn run(app: AppHandle) {
    let mut last_output_retry = Instant::now();
    loop {
        let state = app.state::<AppState>();
        let (snapshot, until_change) = {
            let mut session = state.session();
            let until_change = session.tick();
            if !session.output_available() && last_output_retry.elapsed() >= OUTPUT_RETRY_INTERVAL {
                last_output_retry = Instant::now();
                session.try_recover_output();
            }
            (session.snapshot(), until_change)
        };
        let changed = lock(&state.last_published)
            .as_ref()
            .is_none_or(|last| !last.same_discrete_state(&snapshot));
        let playing = snapshot.status == Status::Playing;
        if playing || changed {
            publish(&app, &snapshot);
        }
        let wait = if playing {
            until_change
                .map(|seconds| Duration::from_secs_f64(seconds.max(0.0)) + BOUNDARY_MARGIN)
                .map_or(PROGRESS_INTERVAL, |until| until.min(PROGRESS_INTERVAL))
        } else {
            IDLE_INTERVAL
        };
        // Las órdenes del operador despiertan el hilo con `unpark`.
        thread::park_timeout(wait);
    }
}
