//! Estado real de reproducción y presentación: la única fuente de verdad.
//! Las ventanas de React solo envían órdenes y reciben instantáneas.

use super::slides::{display_slide, seconds_to_next_change};
use crate::audio::AudioBackend;
use crate::content::{Hymn, TrackKind};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::{path::PathBuf, sync::Arc};

/// Margen para que un salto a una pantalla caiga dentro de ella aun con
/// redondeos del decodificador.
const SLIDE_SEEK_EPSILON: f64 = 0.01;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Ningún himno cargado (estado al iniciar la aplicación).
    Idle,
    /// Himno cargado y listo en 0 s.
    Stopped,
    Playing,
    Paused,
    Ended,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PresentationMode {
    Normal,
    Black,
    BackgroundOnly,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TrackAvailability {
    pub vocal: bool,
    pub instrumental: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HymnRef {
    pub id: String,
    pub number: u32,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    pub hymn: Option<HymnRef>,
    pub track: Option<TrackKind>,
    pub tracks: TrackAvailability,
    pub status: Status,
    pub position: f64,
    pub duration: f64,
    pub volume: f32,
    pub current_slide: Option<usize>,
    pub next_slide: Option<usize>,
    pub presentation: PresentationMode,
    pub black: bool,
    pub lyrics_hidden: bool,
    pub cue: Option<HymnRef>,
    pub audio_output: bool,
    /// Mensaje del último problema no fatal (p. ej. una pista dañada).
    pub notice: Option<String>,
    /// Pista elegida para los himnos que se pongan al aire.
    pub selected_track: TrackKind,
}

impl PlaybackSnapshot {
    /// Igualdad ignorando la posición: sirve para decidir si un cambio merece
    /// emitirse aunque el audio esté detenido.
    pub fn same_discrete_state(&self, other: &Self) -> bool {
        self.hymn == other.hymn
            && self.track == other.track
            && self.tracks == other.tracks
            && self.status == other.status
            && self.volume == other.volume
            && self.current_slide == other.current_slide
            && self.presentation == other.presentation
            && self.cue == other.cue
            && self.audio_output == other.audio_output
            && self.notice == other.notice
            && self.selected_track == other.selected_track
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SelectOutcome {
    /// El himno quedó al aire, listo para PLAY.
    Loaded,
    /// Había un himno en curso: el nuevo quedó preparado en espera.
    Cued,
}

struct OnAir {
    hymn: Arc<Hymn>,
    track: Option<TrackKind>,
    duration: f64,
    /// Posición usada cuando el himno no tiene audio utilizable (se navega
    /// solo con pantallas, p. ej. canto a capela).
    manual_position: f64,
}

pub struct Session<B: AudioBackend> {
    backend: B,
    content_root: PathBuf,
    on_air: Option<OnAir>,
    cue: Option<Arc<Hymn>>,
    status: Status,
    volume: f32,
    black: bool,
    lyrics_hidden: bool,
    notice: Option<String>,
    /// Pista elegida por el operador (Cantado/Instrumental). Es "pegajosa":
    /// la usan todos los himnos que se pongan al aire hasta que se cambie.
    selected_track: TrackKind,
}

impl<B: AudioBackend> Session<B> {
    pub fn new(backend: B, content_root: PathBuf, volume: f32) -> Self {
        let mut session = Self {
            backend,
            content_root,
            on_air: None,
            cue: None,
            status: Status::Idle,
            volume: volume.clamp(0.0, 1.0),
            black: false,
            lyrics_hidden: false,
            notice: None,
            selected_track: TrackKind::Vocal,
        };
        session.backend.set_volume(session.volume);
        session
    }

    pub fn selected_track(&self) -> TrackKind {
        self.selected_track
    }

    /// Pista con la que empieza la sesión (según la configuración).
    pub fn set_selected_track(&mut self, kind: TrackKind) {
        self.selected_track = kind;
    }

    /// ▶ inmediato (modo compacto): pone el himno al aire y lo reproduce
    /// aunque otro esté sonando. Sobre el himno que ya está al aire: si suena
    /// no hace nada, si está en pausa lo reanuda y si terminó o está detenido
    /// empieza desde el inicio.
    pub fn play_now(&mut self, hymn: Arc<Hymn>) -> AppResult<()> {
        if self.current_hymn().is_some_and(|current| current.id == hymn.id) {
            return match self.status {
                Status::Playing => Ok(()),
                Status::Paused => self.play(),
                _ => {
                    self.stop()?;
                    self.play()
                }
            };
        }
        self.cue = None;
        let track = self.selected_track;
        self.load_on_air(hymn, track)?;
        self.play()
    }

    pub fn current_hymn(&self) -> Option<Arc<Hymn>> {
        self.on_air.as_ref().map(|on_air| on_air.hymn.clone())
    }

    /// Un himno está "en curso" si suena o quedó en pausa a mitad: cambiarlo
    /// sin confirmación interrumpiría el culto.
    pub fn in_progress(&self) -> bool {
        match self.status {
            Status::Playing => true,
            Status::Paused => self.position() > 0.5,
            _ => false,
        }
    }

    /// Selección desde el buscador. Nunca reproduce: prepara el himno al aire
    /// o, si hay otro en curso, lo deja en espera con el audio precargado.
    pub fn select(&mut self, hymn: Arc<Hymn>, preferred: TrackKind) -> AppResult<SelectOutcome> {
        if self.in_progress() {
            if self.current_hymn().is_some_and(|current| current.id == hymn.id) {
                return Ok(SelectOutcome::Loaded);
            }
            if let Some(track) = choose_track(&hymn, preferred) {
                if let Some(audio) = hymn.audio.get(track) {
                    let path = self.content_root.join(&audio.file);
                    if let Err(error) = self.backend.preload(&path) {
                        log::warn!("No se pudo precargar {}: {error}", path.display());
                    }
                }
            }
            log::info!("Himno {} preparado en espera", hymn.id);
            self.cue = Some(hymn);
            return Ok(SelectOutcome::Cued);
        }
        self.cue = None;
        self.load_on_air(hymn, preferred)?;
        Ok(SelectOutcome::Loaded)
    }

    /// Pasa el himno en espera al aire (detiene el actual).
    pub fn take_cue(&mut self, preferred: TrackKind) -> AppResult<()> {
        let hymn = self
            .cue
            .take()
            .ok_or_else(|| AppError::state("No hay un himno en espera"))?;
        self.load_on_air(hymn, preferred)
    }

    pub fn clear_cue(&mut self) {
        self.cue = None;
    }

    fn load_on_air(&mut self, hymn: Arc<Hymn>, preferred: TrackKind) -> AppResult<()> {
        self.notice = None;
        let timeline_end = hymn.slides.last().map(|slide| slide.end).unwrap_or(0.0);
        let mut loaded: Option<(TrackKind, f64)> = None;
        let mut failures = Vec::new();
        for kind in track_preference(&hymn, preferred) {
            let Some(audio) = hymn.audio.get(kind) else {
                continue;
            };
            let path = self.content_root.join(&audio.file);
            match self.backend.load(&path) {
                Ok(()) => {
                    loaded = Some((kind, audio.duration_seconds));
                    break;
                }
                Err(error) => {
                    log::error!("Himno {}: {error}", hymn.id);
                    failures.push(format!("{}: {error}", kind.label()));
                }
            }
        }
        if loaded.is_none() {
            self.backend.unload();
        }
        if let Some((kind, _)) = loaded {
            if kind != preferred && hymn.audio.available(preferred) {
                self.notice = Some(format!(
                    "No se pudo abrir la pista {}; se usa {}.",
                    preferred.label(),
                    kind.label()
                ));
            }
        } else if !failures.is_empty() {
            self.notice = Some(format!(
                "No se pudo abrir el audio ({}). Puede avanzar la letra manualmente.",
                failures.join("; ")
            ));
        } else {
            self.notice = Some("Este himno no tiene audio disponible. Puede avanzar la letra manualmente.".into());
        }
        log::info!(
            "Himno {} al aire ({})",
            hymn.id,
            loaded.map(|(kind, _)| kind.label()).unwrap_or("sin audio")
        );
        self.on_air = Some(OnAir {
            track: loaded.map(|(kind, _)| kind),
            duration: loaded.map(|(_, duration)| duration).unwrap_or(timeline_end),
            hymn,
            manual_position: 0.0,
        });
        self.status = Status::Stopped;
        Ok(())
    }

    pub fn play(&mut self) -> AppResult<()> {
        let on_air = self
            .on_air
            .as_ref()
            .ok_or_else(|| AppError::state("Seleccione un himno antes de reproducir"))?;
        if on_air.track.is_none() {
            return Err(AppError::audio("Este himno no tiene audio disponible"));
        }
        if !self.backend.output_available() {
            return Err(AppError::audio("No hay una salida de audio disponible"));
        }
        if self.status == Status::Ended {
            self.backend.seek(0.0).map_err(AppError::audio)?;
        }
        self.backend.play();
        self.status = Status::Playing;
        Ok(())
    }

    pub fn pause(&mut self) {
        if self.status == Status::Playing {
            self.backend.pause();
            self.status = Status::Paused;
        }
    }

    pub fn toggle(&mut self) -> AppResult<()> {
        if self.status == Status::Playing {
            self.pause();
            Ok(())
        } else {
            self.play()
        }
    }

    pub fn stop(&mut self) -> AppResult<()> {
        let Some(on_air) = self.on_air.as_mut() else {
            return Ok(());
        };
        on_air.manual_position = 0.0;
        if on_air.track.is_some() {
            self.backend.pause();
            self.backend.seek(0.0).map_err(AppError::audio)?;
        }
        self.status = Status::Stopped;
        Ok(())
    }

    /// Vuelve a 0 s conservando si estaba sonando.
    pub fn restart(&mut self) -> AppResult<()> {
        let was_playing = self.status == Status::Playing;
        self.stop()?;
        if was_playing {
            self.play()?;
        }
        Ok(())
    }

    pub fn seek(&mut self, seconds: f64) -> AppResult<()> {
        let on_air = self
            .on_air
            .as_mut()
            .ok_or_else(|| AppError::state("No hay un himno cargado"))?;
        if !seconds.is_finite() {
            return Err(AppError::state("Posición inválida"));
        }
        // Nunca exactamente al final: se dejaría el reproductor sin fuente.
        let limit = (on_air.duration - 0.05).max(0.0);
        let target = seconds.clamp(0.0, limit);
        if on_air.track.is_none() {
            on_air.manual_position = target;
        } else {
            self.backend.seek(target).map_err(AppError::audio)?;
        }
        self.status = match self.status {
            Status::Playing => Status::Playing,
            _ if target > 0.0 => Status::Paused,
            _ => Status::Stopped,
        };
        if self.status == Status::Paused && self.on_air.as_ref().is_some_and(|on| on.track.is_some()) {
            self.backend.pause();
        }
        Ok(())
    }

    pub fn skip(&mut self, delta: f64) -> AppResult<()> {
        let position = self.position();
        self.seek(position + delta)
    }

    /// Cambia entre Cantado e Instrumental conservando la posición y el
    /// estado (ambas pistas vienen del mismo video y comparten el origen).
    pub fn set_track(&mut self, kind: TrackKind) -> AppResult<()> {
        // Sin himno al aire solo cambia la elección para los siguientes.
        let Some(on_air) = self.on_air.as_ref() else {
            self.selected_track = kind;
            return Ok(());
        };
        if on_air.track == Some(kind) {
            self.selected_track = kind;
            return Ok(());
        }
        let audio = on_air
            .hymn
            .audio
            .get(kind)
            .filter(|audio| audio.is_ready())
            .ok_or_else(|| AppError::audio(format!("Este himno no tiene pista {}", kind.label())))?;
        let path = self.content_root.join(&audio.file);
        let duration = audio.duration_seconds;
        let position = self.position();
        let was_playing = self.status == Status::Playing;
        let was_ended = self.status == Status::Ended;

        self.backend.load(&path).map_err(AppError::audio)?;
        if let Some(on_air) = self.on_air.as_mut() {
            on_air.track = Some(kind);
            on_air.duration = duration;
        }
        self.notice = None;
        self.selected_track = kind;
        log::info!("Pista cambiada a {}", kind.label());
        if was_ended || position >= duration - 0.05 {
            self.status = Status::Stopped;
            return Ok(());
        }
        if position > 0.0 {
            self.backend.seek(position).map_err(AppError::audio)?;
        }
        if was_playing {
            self.backend.play();
            self.status = Status::Playing;
        } else if position > 0.0 {
            self.status = Status::Paused;
        } else {
            self.status = Status::Stopped;
        }
        Ok(())
    }

    /// Navegación manual de pantallas. Se implementa como salto del audio al
    /// inicio de la pantalla: letra y audio nunca quedan desincronizados.
    pub fn go_to_slide(&mut self, index: usize) -> AppResult<()> {
        let hymn = self
            .current_hymn()
            .ok_or_else(|| AppError::state("No hay un himno cargado"))?;
        let slide = hymn
            .slides
            .get(index)
            .ok_or_else(|| AppError::state("Esa pantalla no existe"))?;
        let target = if index == 0 { 0.0 } else { slide.start + SLIDE_SEEK_EPSILON };
        if target >= self.on_air.as_ref().map(|on| on.duration).unwrap_or(0.0) {
            return Err(AppError::audio(
                "La pista elegida termina antes de esa pantalla",
            ));
        }
        self.seek(target)
    }

    pub fn next_slide(&mut self) -> AppResult<()> {
        let snapshot = self.snapshot();
        let index = snapshot
            .next_slide
            .ok_or_else(|| AppError::state("Ya está en la última pantalla"))?;
        self.go_to_slide(index)
    }

    pub fn previous_slide(&mut self) -> AppResult<()> {
        let hymn = self
            .current_hymn()
            .ok_or_else(|| AppError::state("No hay un himno cargado"))?;
        let position = self.position();
        let ended_timeline = self.status == Status::Ended
            || hymn.slides.last().is_some_and(|last| position >= last.end);
        let current = super::slides::slide_at(&hymn.slides, position);
        let target = if ended_timeline {
            hymn.slides.len().saturating_sub(1)
        } else {
            current.saturating_sub(1)
        };
        self.go_to_slide(target)
    }

    pub fn set_black(&mut self, value: bool) {
        self.black = value;
    }

    pub fn set_lyrics_hidden(&mut self, value: bool) {
        self.lyrics_hidden = value;
    }

    pub fn set_volume(&mut self, volume: f32) -> f32 {
        self.volume = if volume.is_finite() { volume.clamp(0.0, 1.0) } else { self.volume };
        self.backend.set_volume(self.volume);
        self.volume
    }

    pub fn dismiss_notice(&mut self) {
        self.notice = None;
    }

    pub fn position(&self) -> f64 {
        let Some(on_air) = &self.on_air else {
            return 0.0;
        };
        if on_air.track.is_none() {
            return on_air.manual_position;
        }
        match self.status {
            Status::Idle | Status::Stopped => 0.0,
            Status::Ended => on_air.duration,
            _ => self.backend.position().min(on_air.duration),
        }
    }

    /// Avance periódico: detecta el fin real del audio y recupera la salida
    /// si falló. Devuelve el tiempo sugerido hasta el siguiente cambio.
    pub fn tick(&mut self) -> Option<f64> {
        if self.status == Status::Playing && self.backend.finished() {
            log::info!("Fin de la pista");
            self.status = Status::Ended;
        }
        if self.status != Status::Playing {
            return None;
        }
        let hymn = self.current_hymn()?;
        seconds_to_next_change(&hymn.slides, self.position())
    }

    pub fn try_recover_output(&mut self) -> bool {
        let position = self.position();
        let playing = self.status == Status::Playing;
        let recovered = self.backend.recover(position, playing);
        if recovered {
            self.backend.set_volume(self.volume);
            if self.status == Status::Ended {
                self.status = Status::Stopped;
            }
        }
        recovered
    }

    pub fn output_available(&self) -> bool {
        self.backend.output_available()
    }

    pub fn snapshot(&self) -> PlaybackSnapshot {
        let position = self.position();
        let (hymn, track, tracks, duration, current_slide, next_slide) = match &self.on_air {
            Some(on_air) => {
                let slides = &on_air.hymn.slides;
                let current = display_slide(
                    slides,
                    on_air.hymn.presentation.title_slide_index,
                    position,
                    self.status == Status::Ended,
                );
                let at_end = self.status == Status::Ended
                    || slides.last().is_some_and(|last| position >= last.end);
                let next = (!at_end && current + 1 < slides.len()).then_some(current + 1);
                (
                    Some(hymn_ref(&on_air.hymn)),
                    on_air.track,
                    TrackAvailability {
                        vocal: on_air.hymn.audio.available(TrackKind::Vocal),
                        instrumental: on_air.hymn.audio.available(TrackKind::Instrumental),
                    },
                    on_air.duration,
                    Some(current),
                    next,
                )
            }
            None => (
                None,
                None,
                TrackAvailability { vocal: false, instrumental: false },
                0.0,
                None,
                None,
            ),
        };
        let presentation = if self.black {
            PresentationMode::Black
        } else if self.lyrics_hidden {
            PresentationMode::BackgroundOnly
        } else {
            PresentationMode::Normal
        };
        PlaybackSnapshot {
            hymn,
            track,
            tracks,
            status: self.status,
            position,
            duration,
            volume: self.volume,
            current_slide,
            next_slide,
            presentation,
            black: self.black,
            lyrics_hidden: self.lyrics_hidden,
            cue: self.cue.as_deref().map(hymn_ref),
            audio_output: self.backend.output_available(),
            notice: self.notice.clone(),
            selected_track: self.selected_track,
        }
    }

    #[cfg(test)]
    pub fn backend_mut(&mut self) -> &mut B {
        &mut self.backend
    }
}

fn hymn_ref(hymn: &Hymn) -> HymnRef {
    HymnRef {
        id: hymn.id.clone(),
        number: hymn.number,
        title: hymn.title.clone(),
    }
}

/// Pista preferida si existe; si no, la otra; `None` si no hay ninguna.
pub fn choose_track(hymn: &Hymn, preferred: TrackKind) -> Option<TrackKind> {
    track_preference(hymn, preferred).into_iter().next()
}

fn track_preference(hymn: &Hymn, preferred: TrackKind) -> Vec<TrackKind> {
    [preferred, preferred.other()]
        .into_iter()
        .filter(|kind| hymn.audio.available(*kind))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::fake::FakeBackend;
    use crate::content::model::{AudioSet, AudioTrack, PresentationRules, Quality, Slide};

    fn track(file: &str, duration: f64) -> AudioTrack {
        AudioTrack {
            file: file.into(),
            codec: None,
            container: None,
            duration_seconds: duration,
            sample_rate: None,
            channels: None,
            status: "ready".into(),
        }
    }

    fn hymn(id: &str, vocal: Option<f64>, instrumental: Option<f64>) -> Arc<Hymn> {
        let slide = |index: usize, start: f64, end: f64, kind: &str| Slide {
            index,
            source_candidate_index: Some(index),
            start,
            end,
            kind: kind.into(),
            text: vec![format!("línea {index}")],
            caption: None,
        };
        Arc::new(Hymn {
            schema_version: 1,
            id: id.into(),
            number: id.parse().unwrap_or(0),
            title: format!("Himno {id}"),
            language: Some("es".into()),
            background: Default::default(),
            audio: AudioSet {
                vocal: vocal.map(|duration| track(&format!("audio/{id}/cantado.m4a"), duration)),
                instrumental: instrumental
                    .map(|duration| track(&format!("audio/{id}/instrumental.mp3"), duration)),
            },
            presentation: PresentationRules::default(),
            slides: vec![
                slide(0, 0.0, 8.25, "title"),
                slide(1, 8.25, 21.25, "lyrics"),
                slide(2, 21.25, 52.25, "lyrics"),
                slide(3, 52.25, 119.0, "lyrics"),
            ],
            quality: Quality::default(),
        })
    }

    fn session() -> Session<FakeBackend> {
        Session::new(FakeBackend::with_length(119.0), PathBuf::from("/content"), 0.8)
    }

    #[test]
    fn starts_idle_and_refuses_to_play_without_hymn() {
        let mut session = session();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.status, Status::Idle);
        assert_eq!(snapshot.current_slide, None);
        assert_eq!(session.play().unwrap_err().code, "STATE");
    }

    #[test]
    fn selecting_prepares_without_playing() {
        let mut session = session();
        let outcome = session.select(hymn("001", Some(118.84), Some(119.064)), TrackKind::Vocal);
        assert_eq!(outcome, Ok(SelectOutcome::Loaded));
        let snapshot = session.snapshot();
        assert_eq!(snapshot.status, Status::Stopped);
        assert_eq!(snapshot.track, Some(TrackKind::Vocal));
        assert_eq!(snapshot.duration, 118.84);
        assert_eq!(snapshot.current_slide, Some(0));
        assert_eq!(snapshot.next_slide, Some(1));
        assert!(!session.backend_mut().playing);
    }

    #[test]
    fn play_pause_seek_and_slide_follow_audio_position() {
        let mut session = session();
        session.select(hymn("001", Some(118.84), Some(119.064)), TrackKind::Vocal).unwrap();
        session.play().unwrap();
        session.backend_mut().advance(20.10);
        assert_eq!(session.snapshot().current_slide, Some(1));
        session.pause();
        assert_eq!(session.snapshot().status, Status::Paused);
        session.seek(30.0).unwrap();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.status, Status::Paused);
        assert_eq!(snapshot.current_slide, Some(2));
        session.skip(-100.0).unwrap();
        assert_eq!(session.snapshot().position, 0.0);
        session.seek(10_000.0).unwrap();
        assert!(session.snapshot().position < 118.84);
    }

    #[test]
    fn end_of_audio_returns_to_title_and_play_restarts() {
        let mut session = session();
        session.select(hymn("021", Some(60.0), Some(60.0)), TrackKind::Vocal).unwrap();
        session.backend_mut().length = 60.0;
        session.play().unwrap();
        session.backend_mut().advance(61.0);
        session.tick();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.status, Status::Ended);
        assert_eq!(snapshot.current_slide, Some(0));
        assert_eq!(snapshot.next_slide, None);
        session.play().unwrap();
        assert_eq!(session.snapshot().status, Status::Playing);
        assert_eq!(session.snapshot().position, 0.0);
    }

    #[test]
    fn switching_track_keeps_position_and_state() {
        let mut session = session();
        session.select(hymn("001", Some(118.84), Some(119.064)), TrackKind::Vocal).unwrap();
        session.play().unwrap();
        session.backend_mut().advance(30.0);
        session.set_track(TrackKind::Instrumental).unwrap();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.track, Some(TrackKind::Instrumental));
        assert_eq!(snapshot.status, Status::Playing);
        assert_eq!(snapshot.duration, 119.064);
        assert!((snapshot.position - 30.0).abs() < 1e-9);
        assert_eq!(snapshot.current_slide, Some(2));
    }

    #[test]
    fn missing_track_cannot_be_selected_and_falls_back() {
        let mut session = session();
        session.select(hymn("100", None, Some(90.0)), TrackKind::Vocal).unwrap();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.track, Some(TrackKind::Instrumental));
        assert!(!snapshot.tracks.vocal);
        assert_eq!(session.set_track(TrackKind::Vocal).unwrap_err().code, "AUDIO");
    }

    #[test]
    fn hymn_without_audio_allows_manual_navigation_only() {
        let mut session = session();
        session.select(hymn("200", None, None), TrackKind::Vocal).unwrap();
        assert!(session.snapshot().notice.is_some());
        assert_eq!(session.play().unwrap_err().code, "AUDIO");
        session.next_slide().unwrap();
        assert_eq!(session.snapshot().current_slide, Some(1));
        session.next_slide().unwrap();
        assert_eq!(session.snapshot().current_slide, Some(2));
        session.previous_slide().unwrap();
        assert_eq!(session.snapshot().current_slide, Some(1));
    }

    #[test]
    fn broken_file_does_not_crash_and_reports_notice() {
        let mut session = session();
        session.backend_mut().fail_loads = true;
        session.select(hymn("300", Some(60.0), Some(60.0)), TrackKind::Vocal).unwrap();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.track, None);
        assert!(snapshot.notice.unwrap_or_default().contains("No se pudo abrir"));
    }

    #[test]
    fn selecting_while_playing_cues_instead_of_interrupting() {
        let mut session = session();
        session.select(hymn("001", Some(118.84), Some(119.064)), TrackKind::Vocal).unwrap();
        session.play().unwrap();
        session.backend_mut().advance(10.0);
        let outcome = session.select(hymn("249", Some(100.0), Some(100.0)), TrackKind::Vocal);
        assert_eq!(outcome, Ok(SelectOutcome::Cued));
        let snapshot = session.snapshot();
        assert_eq!(snapshot.hymn.map(|hymn| hymn.id), Some("001".into()));
        assert_eq!(snapshot.cue.map(|hymn| hymn.id), Some("249".into()));
        assert_eq!(snapshot.status, Status::Playing);
        assert!(session.backend_mut().preloaded.is_some());

        session.take_cue(TrackKind::Vocal).unwrap();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.hymn.map(|hymn| hymn.id), Some("249".into()));
        assert_eq!(snapshot.status, Status::Stopped);
        assert_eq!(snapshot.cue, None);
    }

    #[test]
    fn presentation_modes_do_not_touch_audio() {
        let mut session = session();
        session.select(hymn("001", Some(118.84), Some(119.064)), TrackKind::Vocal).unwrap();
        session.play().unwrap();
        session.set_lyrics_hidden(true);
        assert_eq!(session.snapshot().presentation, PresentationMode::BackgroundOnly);
        session.set_black(true);
        assert_eq!(session.snapshot().presentation, PresentationMode::Black);
        session.set_black(false);
        session.set_lyrics_hidden(false);
        assert_eq!(session.snapshot().presentation, PresentationMode::Normal);
        assert_eq!(session.snapshot().status, Status::Playing);
    }

    #[test]
    fn manual_slide_navigation_moves_audio_and_stays_in_sync() {
        let mut session = session();
        session.select(hymn("001", Some(118.84), Some(119.064)), TrackKind::Vocal).unwrap();
        session.play().unwrap();
        session.next_slide().unwrap();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.current_slide, Some(1));
        assert!(snapshot.position >= 8.25);
        session.go_to_slide(3).unwrap();
        assert_eq!(session.snapshot().current_slide, Some(3));
        session.previous_slide().unwrap();
        assert_eq!(session.snapshot().current_slide, Some(2));
        assert_eq!(session.snapshot().status, Status::Playing);
    }

    #[test]
    fn restart_and_stop_semantics() {
        let mut session = session();
        session.select(hymn("001", Some(118.84), Some(119.064)), TrackKind::Vocal).unwrap();
        session.play().unwrap();
        session.backend_mut().advance(40.0);
        session.restart().unwrap();
        assert_eq!(session.snapshot().status, Status::Playing);
        assert_eq!(session.snapshot().position, 0.0);
        session.backend_mut().advance(5.0);
        session.stop().unwrap();
        assert_eq!(session.snapshot().status, Status::Stopped);
        assert_eq!(session.snapshot().position, 0.0);
        assert!(!session.backend_mut().playing);
    }

    #[test]
    fn selected_track_is_sticky_across_hymns() {
        let mut session = session();
        session.set_track(TrackKind::Instrumental).unwrap();
        assert_eq!(session.snapshot().selected_track, TrackKind::Instrumental);
        let track = session.selected_track();
        session.select(hymn("001", Some(118.84), Some(119.064)), track).unwrap();
        assert_eq!(session.snapshot().track, Some(TrackKind::Instrumental));
        session.set_track(TrackKind::Vocal).unwrap();
        session.play().unwrap();
        session.backend_mut().advance(5.0);
        session.play_now(hymn("249", Some(100.0), Some(100.0))).unwrap();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.hymn.map(|h| h.id), Some("249".into()));
        assert_eq!(snapshot.track, Some(TrackKind::Vocal));
        assert_eq!(snapshot.status, Status::Playing);
    }

    #[test]
    fn play_now_on_the_same_hymn_never_restarts_while_playing() {
        let mut session = session();
        let first = hymn("001", Some(118.84), Some(119.064));
        session.play_now(first.clone()).unwrap();
        session.backend_mut().advance(30.0);
        session.play_now(first.clone()).unwrap();
        assert!((session.snapshot().position - 30.0).abs() < 1e-9);
        session.pause();
        session.play_now(first.clone()).unwrap();
        assert_eq!(session.snapshot().status, Status::Playing);
        assert!((session.snapshot().position - 30.0).abs() < 1e-9);
        session.stop().unwrap();
        session.play_now(first).unwrap();
        assert_eq!(session.snapshot().status, Status::Playing);
        assert_eq!(session.snapshot().position, 0.0);
    }

    #[test]
    fn volume_is_clamped() {
        let mut session = session();
        assert_eq!(session.set_volume(1.7), 1.0);
        assert_eq!(session.set_volume(-1.0), 0.0);
        assert_eq!(session.set_volume(f32::NAN), 0.0);
    }
}
