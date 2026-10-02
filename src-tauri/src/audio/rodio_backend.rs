use super::AudioBackend;
use rodio::{mixer::Mixer, Decoder, DeviceSinkBuilder, Player};
use std::{
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::Duration,
};

type FileDecoder = Decoder<BufReader<File>>;

/// Salida de audio abierta. El `MixerDeviceSink` de rodio/cpal no es `Send`
/// en todas las plataformas, así que vive en un hilo propio durante toda su
/// vida; aquí solo se conserva su `Mixer` (que sí es `Send`) y un canal que,
/// al soltarse, cierra el dispositivo.
struct Output {
    mixer: Mixer,
    failed: Arc<AtomicBool>,
    _close: mpsc::Sender<()>,
}

impl Output {
    fn open() -> Result<Self, String> {
        let failed = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<Mixer, String>>();
        let (close_tx, close_rx) = mpsc::channel::<()>();
        let flag = failed.clone();
        thread::Builder::new()
            .name("audio-output".into())
            .spawn(move || {
                let callback = move |error: rodio::cpal::StreamError| {
                    log::error!("Error de la salida de audio: {error}");
                    flag.store(true, Ordering::SeqCst);
                };
                let opened = DeviceSinkBuilder::from_default_device()
                    .and_then(|builder| builder.with_error_callback(callback).open_sink_or_fallback())
                    .or_else(|_| DeviceSinkBuilder::open_default_sink());
                match opened {
                    Ok(mut sink) => {
                        sink.log_on_drop(false);
                        let _ = ready_tx.send(Ok(sink.mixer().clone()));
                        // Mantiene vivo el dispositivo hasta que se suelte `_close`.
                        let _ = close_rx.recv();
                        drop(sink);
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                    }
                }
            })
            .map_err(|error| format!("No se pudo iniciar el hilo de audio: {error}"))?;
        let mixer = ready_rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "La salida de audio no respondió".to_string())??;
        Ok(Self {
            mixer,
            failed,
            _close: close_tx,
        })
    }
}

pub struct RodioBackend {
    output: Option<Output>,
    player: Option<Player>,
    loaded_path: Option<PathBuf>,
    preloaded: Option<(PathBuf, FileDecoder)>,
    volume: f32,
}

impl RodioBackend {
    /// Abre la salida predeterminada. Si no hay dispositivo, el backend se
    /// crea igualmente (la app sigue siendo usable para proyectar) y cada
    /// operación de audio devuelve un error explicativo.
    pub fn new() -> Self {
        let output = match Output::open() {
            Ok(output) => {
                log::info!("Salida de audio abierta");
                Some(output)
            }
            Err(error) => {
                log::error!("No se pudo abrir la salida de audio: {error}");
                None
            }
        };
        Self {
            output,
            player: None,
            loaded_path: None,
            preloaded: None,
            volume: 1.0,
        }
    }

    fn open_decoder(path: &Path) -> Result<FileDecoder, String> {
        let file = File::open(path)
            .map_err(|error| format!("No se pudo abrir {}: {error}", path.display()))?;
        Decoder::try_from(file)
            .map_err(|error| format!("No se pudo decodificar {}: {error}", path.display()))
    }

    fn take_decoder(&mut self, path: &Path) -> Result<FileDecoder, String> {
        match self.preloaded.take() {
            Some((preloaded_path, decoder)) if preloaded_path == path => Ok(decoder),
            _ => Self::open_decoder(path),
        }
    }
}

impl Default for RodioBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioBackend for RodioBackend {
    fn output_available(&self) -> bool {
        self.output
            .as_ref()
            .is_some_and(|output| !output.failed.load(Ordering::SeqCst))
    }

    fn preload(&mut self, path: &Path) -> Result<(), String> {
        if self
            .preloaded
            .as_ref()
            .is_some_and(|(preloaded, _)| preloaded == path)
        {
            return Ok(());
        }
        let decoder = Self::open_decoder(path)?;
        self.preloaded = Some((path.to_path_buf(), decoder));
        Ok(())
    }

    fn load(&mut self, path: &Path) -> Result<(), String> {
        // Validar y decodificar antes de soltar la pista actual: si el nuevo
        // archivo falla, lo que suena no se interrumpe.
        let decoder = self.take_decoder(path)?;
        let output = self
            .output
            .as_ref()
            .ok_or_else(|| "No hay una salida de audio disponible".to_string())?;
        let player = Player::connect_new(&output.mixer);
        player.pause();
        player.set_volume(self.volume);
        player.append(decoder);
        if let Some(previous) = self.player.replace(player) {
            previous.stop();
        }
        self.loaded_path = Some(path.to_path_buf());
        Ok(())
    }

    fn unload(&mut self) {
        if let Some(player) = self.player.take() {
            player.stop();
        }
        self.loaded_path = None;
    }

    fn play(&mut self) {
        if let Some(player) = &self.player {
            player.play();
        }
    }

    fn pause(&mut self) {
        if let Some(player) = &self.player {
            player.pause();
        }
    }

    fn seek(&mut self, seconds: f64) -> Result<(), String> {
        let player = self
            .player
            .as_ref()
            .ok_or_else(|| "No hay una pista cargada".to_string())?;
        if player.empty() {
            // La fuente terminó y el reproductor la descartó: se reconstruye
            // para poder volver a una posición anterior.
            let path = self
                .loaded_path
                .clone()
                .ok_or_else(|| "No hay una pista cargada".to_string())?;
            self.load(&path)?;
        }
        let player = self
            .player
            .as_ref()
            .ok_or_else(|| "No hay una pista cargada".to_string())?;
        player
            .try_seek(Duration::from_secs_f64(seconds.max(0.0)))
            .map_err(|error| format!("No se pudo mover la reproducción: {error}"))
    }

    fn position(&self) -> f64 {
        self.player
            .as_ref()
            .map(|player| player.get_pos().as_secs_f64())
            .unwrap_or(0.0)
    }

    fn finished(&self) -> bool {
        self.player.as_ref().is_some_and(Player::empty)
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume;
        if let Some(player) = &self.player {
            player.set_volume(volume);
        }
    }

    fn recover(&mut self, position: f64, playing: bool) -> bool {
        let needs_recovery = match &self.output {
            Some(output) => output.failed.load(Ordering::SeqCst),
            None => true,
        };
        if !needs_recovery {
            return false;
        }
        let Ok(output) = Output::open() else {
            return false;
        };
        log::warn!("Salida de audio reabierta tras un fallo");
        self.player = None;
        self.output = Some(output);
        if let Some(path) = self.loaded_path.clone() {
            if self.load(&path).is_ok() {
                let _ = self.seek(position);
                if playing {
                    self.play();
                }
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::Source;
    use std::path::Path;

    /// Verifica con el contenido real (si existe `content/`) que cada pista
    /// del catálogo se abre con el mismo decodificador de la app, informa
    /// duración coherente con el documento y admite seek.
    #[test]
    fn every_catalog_track_decodes_and_seeks() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("content");
        let Ok(repository) = crate::content::ContentRepository::open(root.clone()) else {
            eprintln!("content/ no disponible: prueba omitida");
            return;
        };
        let mut checked = 0;
        let mut failures = Vec::new();
        for entry in repository.summary().hymns {
            let hymn = match repository.load(&entry.id) {
                Ok(hymn) => hymn,
                Err(error) => {
                    failures.push(format!("{}: {}", entry.id, error.message));
                    continue;
                }
            };
            for kind in [crate::content::TrackKind::Vocal, crate::content::TrackKind::Instrumental] {
                let Some(track) = hymn.audio.get(kind).filter(|track| track.is_ready()) else {
                    continue;
                };
                let path = root.join(&track.file);
                match RodioBackend::open_decoder(&path) {
                    Ok(mut decoder) => {
                        if let Some(total) = decoder.total_duration() {
                            let difference = (total.as_secs_f64() - track.duration_seconds).abs();
                            if difference > 1.0 {
                                failures.push(format!("{}: duración {} vs {}", path.display(), total.as_secs_f64(), track.duration_seconds));
                            }
                        }
                        if let Err(error) = decoder.try_seek(Duration::from_secs_f64((track.duration_seconds / 2.0).max(0.0))) {
                            failures.push(format!("{}: seek {error}", path.display()));
                        }
                        checked += 1;
                    }
                    Err(error) => failures.push(error),
                }
            }
        }
        eprintln!("pistas verificadas: {checked}");
        assert!(failures.is_empty(), "{} fallas:\n{}", failures.len(), failures.join("\n"));
    }
}
