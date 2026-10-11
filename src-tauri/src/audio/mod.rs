//! Motor de audio. La sesión de reproducción depende solo del trait
//! [`AudioBackend`]; la implementación real usa rodio (validado en el POC) y
//! las pruebas usan un backend simulado sin hardware de sonido.

pub mod devices;
mod rodio_backend;

pub use devices::{OutputDevice, OutputPreference};
pub use rodio_backend::RodioBackend;

use std::path::Path;

/// Qué salida suena ahora, o cuál falta.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OutputStatus {
    /// Nombre del dispositivo por el que se reproduce.
    pub active: Option<String>,
    /// Salida configurada que no está disponible (sin audio hasta que vuelva).
    pub missing: Option<String>,
}

pub trait AudioBackend: Send {
    /// Indica si existe una salida de audio utilizable.
    fn output_available(&self) -> bool;

    fn output_status(&self) -> OutputStatus;

    /// Abre y decodifica por adelantado una pista, sin reproducirla.
    /// Un `load` posterior de la misma ruta reutiliza este trabajo.
    fn preload(&mut self, path: &Path) -> Result<(), String>;

    /// Deja la pista lista en pausa en la posición 0, reemplazando la actual.
    fn load(&mut self, path: &Path) -> Result<(), String>;

    /// Libera la pista actual (silencio inmediato).
    fn unload(&mut self);

    fn play(&mut self);
    fn pause(&mut self);
    fn seek(&mut self, seconds: f64) -> Result<(), String>;

    /// Posición real reportada por el reproductor, en segundos.
    fn position(&self) -> f64;

    /// `true` cuando la fuente cargada ya no tiene más muestras.
    fn finished(&self) -> bool;

    fn set_volume(&mut self, volume: f32);

    /// Revisión periódica de la salida: si falló, reintenta abrir la MISMA
    /// salida configurada; en modo "predeterminada del sistema", además sigue
    /// los cambios del predeterminado. Al cambiar de salida reconstruye la
    /// pista en `position`. Devuelve `true` si cambió la salida.
    fn maintain(&mut self, position: f64, playing: bool) -> bool;

    /// Cambio manual desde Configuración. Si la nueva salida no abre, queda en
    /// silencio (nunca sigue por la anterior) y `maintain` la reintenta.
    fn set_output(&mut self, preference: OutputPreference, position: f64, playing: bool) -> bool;

    /// Dispositivo fijo reencontrado con otro identificador desde la última
    /// llamada (hay que actualizar la configuración guardada).
    fn take_rebind(&mut self) -> Option<OutputDevice>;

    /// Tono corto por la salida actual.
    fn test_tone(&mut self) -> Result<(), String>;
}

#[cfg(test)]
pub mod fake {
    use super::{AudioBackend, OutputDevice, OutputPreference, OutputStatus};
    use std::path::{Path, PathBuf};

    /// Backend simulado: el tiempo avanza solo cuando la prueba lo indica.
    #[derive(Default)]
    pub struct FakeBackend {
        pub loaded: Option<PathBuf>,
        pub preloaded: Option<PathBuf>,
        pub playing: bool,
        pub position: f64,
        pub length: f64,
        pub volume: f32,
        pub fail_loads: bool,
        pub loads: usize,
        pub output: Option<OutputPreference>,
        pub tones: usize,
    }

    impl FakeBackend {
        pub fn with_length(length: f64) -> Self {
            Self {
                length,
                volume: 1.0,
                ..Self::default()
            }
        }

        pub fn advance(&mut self, seconds: f64) {
            if self.playing && self.loaded.is_some() {
                self.position = (self.position + seconds).min(self.length);
            }
        }
    }

    impl AudioBackend for FakeBackend {
        fn output_available(&self) -> bool {
            true
        }
        fn preload(&mut self, path: &Path) -> Result<(), String> {
            self.preloaded = Some(path.to_path_buf());
            Ok(())
        }
        fn load(&mut self, path: &Path) -> Result<(), String> {
            if self.fail_loads {
                return Err("archivo dañado".into());
            }
            self.loads += 1;
            self.loaded = Some(path.to_path_buf());
            self.playing = false;
            self.position = 0.0;
            Ok(())
        }
        fn unload(&mut self) {
            self.loaded = None;
            self.playing = false;
            self.position = 0.0;
        }
        fn play(&mut self) {
            self.playing = true;
        }
        fn pause(&mut self) {
            self.playing = false;
        }
        fn seek(&mut self, seconds: f64) -> Result<(), String> {
            self.position = seconds.min(self.length);
            Ok(())
        }
        fn position(&self) -> f64 {
            self.position
        }
        fn finished(&self) -> bool {
            self.loaded.is_some() && self.position >= self.length
        }
        fn set_volume(&mut self, volume: f32) {
            self.volume = volume;
        }
        fn output_status(&self) -> OutputStatus {
            OutputStatus { active: Some("Simulada".into()), missing: None }
        }
        fn maintain(&mut self, _position: f64, _playing: bool) -> bool {
            false
        }
        fn set_output(&mut self, preference: OutputPreference, _position: f64, _playing: bool) -> bool {
            self.output = Some(preference);
            true
        }
        fn take_rebind(&mut self) -> Option<OutputDevice> {
            None
        }
        fn test_tone(&mut self) -> Result<(), String> {
            self.tones += 1;
            Ok(())
        }
    }
}
