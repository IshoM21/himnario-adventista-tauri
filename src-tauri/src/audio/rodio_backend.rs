use super::devices::{self, Choice, OutputDevice, OutputPreference};
use super::{AudioBackend, OutputStatus};
use rodio::{mixer::Mixer, source::SineWave, Decoder, DeviceSinkBuilder, Player, Source};
use std::{
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};

type FileDecoder = Decoder<BufReader<File>>;

/// Mientras una salida no se puede abrir, los reintentos se registran como
/// máximo con esta frecuencia para no llenar el log durante horas.
const FAILURE_LOG_INTERVAL: Duration = Duration::from_secs(30);

/// Salida de audio abierta. El `MixerDeviceSink` de rodio/cpal no es `Send`
/// en todas las plataformas, así que vive en un hilo propio durante toda su
/// vida; aquí solo se conserva su `Mixer` (que sí es `Send`) y un canal que,
/// al soltarse, cierra el dispositivo.
struct Output {
    mixer: Mixer,
    device: OutputDevice,
    failed: Arc<AtomicBool>,
    _close: mpsc::Sender<()>,
}

enum OpenFailure {
    Missing,
    Ambiguous,
    Failed { device: OutputDevice, error: String },
    Thread(String),
}

/// Lo que se intentó al abrir: los dispositivos vistos (para el log) y el
/// resultado.
struct OpenReport {
    devices: Option<(Vec<OutputDevice>, Option<OutputDevice>)>,
    outcome: Result<(Output, bool), OpenFailure>,
}

type ThreadResult = (Vec<OutputDevice>, Option<OutputDevice>, Result<(Mixer, OutputDevice, bool), OpenFailure>);

impl Output {
    /// Abre exclusivamente la salida que indica `preference`. Si el
    /// dispositivo rechaza su formato predeterminado se prueban otros formatos
    /// del MISMO dispositivo (`open_sink_or_fallback`); jamás otro dispositivo.
    fn open(preference: &OutputPreference) -> OpenReport {
        let failed = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel::<ThreadResult>();
        let (close_tx, close_rx) = mpsc::channel::<()>();
        let flag = failed.clone();
        let preference = preference.clone();
        let spawned = thread::Builder::new().name("audio-output".into()).spawn(move || {
            let scan = devices::scan();
            let infos = scan.infos();
            let system_default = scan.system_default.clone();
            let (device, rebound) = match devices::choose(&preference, &infos, system_default.as_ref()) {
                Choice::Open { device, rebound } => (device, rebound),
                Choice::Missing => {
                    let _ = ready_tx.send((infos, system_default, Err(OpenFailure::Missing)));
                    return;
                }
                Choice::Ambiguous => {
                    let _ = ready_tx.send((infos, system_default, Err(OpenFailure::Ambiguous)));
                    return;
                }
            };
            let Some(handle) = scan.find(&device.id).cloned() else {
                let _ = ready_tx.send((infos, system_default, Err(OpenFailure::Missing)));
                return;
            };
            let name = device.to_string();
            let callback = move |error: rodio::cpal::StreamError| {
                log::error!("[AUDIO] Se perdió la salida {name}: {error}");
                flag.store(true, Ordering::SeqCst);
            };
            let opened = DeviceSinkBuilder::from_device(handle)
                .and_then(|builder| builder.with_error_callback(callback).open_sink_or_fallback());
            match opened {
                Ok(mut sink) => {
                    sink.log_on_drop(false);
                    let mixer = sink.mixer().clone();
                    let _ = ready_tx.send((infos, system_default, Ok((mixer, device, rebound))));
                    // Mantiene vivo el dispositivo hasta que se suelte `_close`.
                    let _ = close_rx.recv();
                    drop(sink);
                }
                Err(error) => {
                    let failure = OpenFailure::Failed { device, error: error.to_string() };
                    let _ = ready_tx.send((infos, system_default, Err(failure)));
                }
            }
        });
        if let Err(error) = spawned {
            return OpenReport {
                devices: None,
                outcome: Err(OpenFailure::Thread(format!("no se pudo iniciar el hilo de audio: {error}"))),
            };
        }
        match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok((infos, system_default, result)) => OpenReport {
                devices: Some((infos, system_default)),
                outcome: result.map(|(mixer, device, rebound)| {
                    (Output { mixer, device, failed, _close: close_tx }, rebound)
                }),
            },
            Err(_) => OpenReport {
                devices: None,
                outcome: Err(OpenFailure::Thread("la salida de audio no respondió en 3 s".into())),
            },
        }
    }

    fn healthy(&self) -> bool {
        !self.failed.load(Ordering::SeqCst)
    }
}

pub struct RodioBackend {
    preference: OutputPreference,
    output: Option<Output>,
    player: Option<Player>,
    loaded_path: Option<PathBuf>,
    preloaded: Option<(PathBuf, FileDecoder)>,
    volume: f32,
    /// Posición a conservar mientras no hay reproductor (salida perdida o
    /// cambiada a un dispositivo ausente): se retoma al reconectar.
    resume_position: f64,
    /// Dispositivo fijo reencontrado con otro identificador; la sesión lo
    /// recoge para actualizar la configuración guardada.
    rebind: Option<OutputDevice>,
    last_devices: Option<Vec<OutputDevice>>,
    failures: u32,
    last_failure_log: Option<Instant>,
    lost_logged: bool,
}

impl RodioBackend {
    /// Abre la salida configurada. Si no está disponible, el backend se crea
    /// igualmente (la app sigue siendo usable para proyectar), avisa y la
    /// sesión reintenta periódicamente.
    pub fn new(preference: OutputPreference) -> Self {
        let mut backend = Self {
            preference,
            output: None,
            player: None,
            loaded_path: None,
            preloaded: None,
            volume: 1.0,
            resume_position: 0.0,
            rebind: None,
            last_devices: None,
            failures: 0,
            last_failure_log: None,
            lost_logged: false,
        };
        log::info!("[AUDIO] Salida configurada en el Himnario: {}", backend.preference.describe());
        backend.output = backend.try_open("inicio", true);
        backend
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

    fn should_log_failure(&self) -> bool {
        self.failures == 0 || self.last_failure_log.is_none_or(|last| last.elapsed() >= FAILURE_LOG_INTERVAL)
    }

    /// Intenta abrir la salida deseada y registra todo el proceso.
    fn try_open(&mut self, reason: &str, verbose: bool) -> Option<Output> {
        let log_attempt = verbose || self.should_log_failure();
        if log_attempt && self.failures > 0 {
            log::info!("[AUDIO] Intento de recuperación n.º {} ({})", self.failures + 1, self.preference.describe());
        }
        let report = Output::open(&self.preference);
        if let Some((infos, system_default)) = &report.devices {
            let changed = self.last_devices.as_ref() != Some(infos);
            if verbose || changed {
                if changed && self.last_devices.is_some() {
                    log::info!("[AUDIO] Cambió la lista de salidas del sistema");
                }
                log::info!("[AUDIO] Salidas detectadas ({}):", infos.len());
                for device in infos {
                    log::info!("[AUDIO] - {device}");
                }
                match system_default {
                    Some(device) => log::info!("[AUDIO] Predeterminada del sistema: {device}"),
                    None => log::warn!("[AUDIO] El sistema no informa una salida predeterminada"),
                }
                log::info!("[AUDIO] Salida configurada: {}", self.preference.describe());
            }
            self.last_devices = Some(infos.clone());
        }
        match report.outcome {
            Ok((output, rebound)) => {
                log::info!("[AUDIO] Abriendo ({reason}): {}", output.device);
                log::info!("[AUDIO] Stream abierto correctamente");
                log::info!("[AUDIO] Salida activa: {}", output.device);
                if self.failures > 0 {
                    log::info!("[AUDIO] Recuperación exitosa tras {} intento(s)", self.failures);
                }
                if rebound {
                    if let OutputPreference::Device { id, name } = &self.preference {
                        log::warn!(
                            "[AUDIO] «{name}» cambió de identificador ({id} → {}); se actualiza la configuración",
                            output.device.id
                        );
                    }
                    self.preference = OutputPreference::Device {
                        id: output.device.id.clone(),
                        name: output.device.name.clone(),
                    };
                    self.rebind = Some(output.device.clone());
                }
                self.failures = 0;
                self.last_failure_log = None;
                self.lost_logged = false;
                Some(output)
            }
            Err(failure) => {
                if log_attempt {
                    let wanted = self.preference.display_name();
                    match &failure {
                        OpenFailure::Missing => {
                            log::warn!("[AUDIO] La salida «{wanted}» no está disponible; no se usará otra salida. Se reintentará.")
                        }
                        OpenFailure::Ambiguous => log::warn!(
                            "[AUDIO] Hay varios dispositivos llamados «{wanted}» y ninguno con el identificador guardado; elija uno en Configuración → Audio"
                        ),
                        OpenFailure::Failed { device, error } => {
                            log::info!("[AUDIO] Abriendo ({reason}): {device}");
                            log::error!("[AUDIO] Error al abrir {device}: {error}")
                        }
                        OpenFailure::Thread(error) => log::error!("[AUDIO] Error al abrir «{wanted}»: {error}"),
                    }
                    if self.failures > 0 {
                        log::warn!("[AUDIO] Sigue sin salida tras {} intento(s)", self.failures + 1);
                    }
                    self.last_failure_log = Some(Instant::now());
                }
                self.failures += 1;
                None
            }
        }
    }

    /// Cambia a una salida nueva y reconstruye la pista en `position`.
    fn switch_to(&mut self, output: Output, position: f64, playing: bool) {
        if let Some(player) = self.player.take() {
            player.stop();
        }
        // Al reemplazarla se cierra la salida anterior.
        self.output = Some(output);
        if let Some(path) = self.loaded_path.clone() {
            match self.load(&path) {
                Ok(()) => {
                    if position > 0.0 {
                        let _ = self.seek(position);
                    }
                    if playing {
                        self.play();
                    }
                }
                Err(error) => log::error!("[AUDIO] No se pudo reconstruir la pista tras cambiar de salida: {error}"),
            }
        }
    }

    /// Deja de usar la salida actual (silencio) conservando la posición.
    fn go_silent(&mut self, position: f64) {
        self.resume_position = position;
        if let Some(player) = self.player.take() {
            player.stop();
        }
        self.output = None;
    }
}

impl AudioBackend for RodioBackend {
    fn output_available(&self) -> bool {
        self.output.as_ref().is_some_and(Output::healthy)
    }

    fn output_status(&self) -> OutputStatus {
        match self.output.as_ref().filter(|output| output.healthy()) {
            Some(output) => OutputStatus { active: Some(output.device.name.clone()), missing: None },
            None => OutputStatus { active: None, missing: Some(self.preference.display_name()) },
        }
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
        let output = self.output.as_ref().ok_or_else(|| {
            format!("La salida de audio «{}» no está disponible", self.preference.display_name())
        })?;
        let player = Player::connect_new(&output.mixer);
        player.pause();
        player.set_volume(self.volume);
        player.append(decoder);
        if let Some(previous) = self.player.replace(player) {
            previous.stop();
        }
        self.loaded_path = Some(path.to_path_buf());
        self.resume_position = 0.0;
        Ok(())
    }

    fn unload(&mut self) {
        if let Some(player) = self.player.take() {
            player.stop();
        }
        self.loaded_path = None;
        self.resume_position = 0.0;
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
        if self.player.is_none() && self.loaded_path.is_some() && self.output.is_none() {
            // Sin salida: se recuerda para retomar ahí al reconectar.
            self.resume_position = seconds.max(0.0);
            return Ok(());
        }
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
            .unwrap_or(self.resume_position)
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

    fn maintain(&mut self, position: f64, playing: bool) -> bool {
        let healthy = self.output_available();
        if !healthy {
            if self.output.is_some() && !self.lost_logged {
                log::warn!("[AUDIO] Pérdida del dispositivo; se intentará recuperar en la misma salida configurada");
                self.lost_logged = true;
            }
            let Some(output) = self.try_open("recuperación", false) else {
                return false;
            };
            self.switch_to(output, position, playing);
            return true;
        }
        if self.preference != OutputPreference::System {
            return false;
        }
        // Modo "predeterminada del sistema": seguir al predeterminado real.
        let Some(current) = devices::default_device() else {
            return false;
        };
        let active = self.output.as_ref().map(|output| output.device.clone());
        if active.as_ref().is_some_and(|active| active.id == current.id) {
            return false;
        }
        if self.failures == 0 {
            log::info!(
                "[AUDIO] Cambió la salida predeterminada del sistema: {} → {current}",
                active.map_or_else(|| "ninguna".into(), |device| device.to_string())
            );
        }
        match self.try_open("cambio de predeterminada", false) {
            Some(output) => {
                self.switch_to(output, position, playing);
                true
            }
            None => {
                if self.failures == 1 {
                    log::warn!("[AUDIO] Se mantiene la salida actual mientras la nueva predeterminada no abra");
                }
                false
            }
        }
    }

    fn set_output(&mut self, preference: OutputPreference, position: f64, playing: bool) -> bool {
        log::info!(
            "[AUDIO] Cambio manual desde Configuración: {} → {}",
            self.preference.describe(),
            preference.describe()
        );
        self.preference = preference;
        self.failures = 0;
        self.last_failure_log = None;
        match self.try_open("cambio manual", true) {
            Some(output) => {
                self.switch_to(output, position, playing);
                true
            }
            None => {
                // Nunca seguir sonando por una salida que el operador ya no eligió.
                log::warn!("[AUDIO] Sin salida hasta que «{}» esté disponible", self.preference.display_name());
                self.go_silent(position);
                false
            }
        }
    }

    fn take_rebind(&mut self) -> Option<OutputDevice> {
        self.rebind.take()
    }

    fn test_tone(&mut self) -> Result<(), String> {
        let output = self
            .output
            .as_ref()
            .filter(|output| output.healthy())
            .ok_or_else(|| format!("La salida «{}» no está disponible", self.preference.display_name()))?;
        let level = 0.25 * self.volume.max(0.3);
        let tone = |frequency: f32, millis: u64| {
            let mut source = SineWave::new(frequency).take_duration(Duration::from_millis(millis));
            source.set_filter_fadeout();
            source.fade_in(Duration::from_millis(15)).amplify(level)
        };
        output.mixer.add(tone(660.0, 260));
        output.mixer.add(tone(880.0, 420).delay(Duration::from_millis(280)));
        log::info!("[AUDIO] Prueba de salida en {}", output.device);
        Ok(())
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
