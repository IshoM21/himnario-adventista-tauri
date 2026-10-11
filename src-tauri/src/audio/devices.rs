//! Dispositivos de salida de audio: listado, identificación estable y la
//! decisión (pura y probada) de cuál abrir según la preferencia guardada.
//!
//! Regla central: el Himnario abre solo el dispositivo elegido (o el
//! predeterminado real del sistema). Nunca recorre otras salidas físicas
//! buscando "alguna que funcione", como hace `rodio::open_default_sink()`.

use rodio::cpal::{
    self,
    traits::{DeviceTrait, HostTrait},
};
use serde::{Deserialize, Serialize};

/// Salida elegida en Configuración → Audio.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum OutputPreference {
    /// Sigue al dispositivo predeterminado del sistema.
    #[default]
    System,
    /// Dispositivo fijo solo para el Himnario (modo compartido). `id` es el
    /// identificador del sistema; `name` permite reencontrarlo si Windows le
    /// asigna otro identificador (p. ej. al cambiar de puerto USB).
    Device { id: String, name: String },
}

impl OutputPreference {
    pub fn describe(&self) -> String {
        match self {
            Self::System => "predeterminada del sistema".into(),
            Self::Device { name, id } => format!("«{name}» ({id})"),
        }
    }

    /// Nombre que ve el operador cuando la salida no está disponible.
    pub fn display_name(&self) -> String {
        match self {
            Self::System => "predeterminada del sistema".into(),
            Self::Device { name, .. } => name.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
}

impl std::fmt::Display for OutputDevice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "«{}» ({})", self.name, self.id)
    }
}

/// Resultado de decidir qué abrir.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Choice {
    Open {
        device: OutputDevice,
        /// El dispositivo fijo se encontró por nombre con otro identificador:
        /// hay que actualizar el guardado.
        rebound: bool,
    },
    /// La salida deseada no está disponible. Nunca se sustituye por otra.
    Missing,
    /// El nombre coincide con varios dispositivos y el identificador ya no
    /// existe: no se adivina cuál es.
    Ambiguous,
}

/// Decide qué dispositivo abrir. Función pura: no toca el hardware.
pub fn choose(preference: &OutputPreference, devices: &[OutputDevice], system_default: Option<&OutputDevice>) -> Choice {
    match preference {
        OutputPreference::System => match system_default {
            Some(device) => Choice::Open { device: device.clone(), rebound: false },
            None => Choice::Missing,
        },
        OutputPreference::Device { id, name } => {
            if let Some(device) = devices.iter().find(|device| &device.id == id) {
                return Choice::Open { device: device.clone(), rebound: false };
            }
            let mut same_name = devices.iter().filter(|device| &device.name == name);
            match (same_name.next(), same_name.next()) {
                (Some(device), None) => Choice::Open { device: device.clone(), rebound: true },
                (Some(_), Some(_)) => Choice::Ambiguous,
                _ => Choice::Missing,
            }
        }
    }
}

/// Dispositivos de salida detectados y el predeterminado del sistema.
pub struct Scan {
    pub devices: Vec<(OutputDevice, cpal::Device)>,
    pub system_default: Option<OutputDevice>,
}

impl Scan {
    pub fn infos(&self) -> Vec<OutputDevice> {
        self.devices.iter().map(|(info, _)| info.clone()).collect()
    }

    pub fn find(&self, id: &str) -> Option<&cpal::Device> {
        self.devices.iter().find(|(info, _)| info.id == id).map(|(_, device)| device)
    }
}

pub fn describe_device(device: &cpal::Device) -> Option<OutputDevice> {
    let description = device.description().ok();
    if description
        .as_ref()
        .and_then(|description| description.driver())
        .is_some_and(|driver| driver == "null")
    {
        return None;
    }
    let name = description
        .as_ref()
        .map(|description| description.name().trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Dispositivo sin nombre".into());
    // Sin identificador del sistema (plataformas que no lo ofrecen) se usa
    // el nombre: sigue siendo estable mientras el dispositivo no cambie.
    let id = device.id().map(|id| id.to_string()).unwrap_or_else(|_| format!("nombre:{name}"));
    Some(OutputDevice { id, name })
}

/// En Linux, ALSA lista muchas entradas técnicas (canales, mezcladores
/// internos) que no son salidas que un operador deba elegir.
#[cfg(target_os = "linux")]
fn is_technical(device: &OutputDevice) -> bool {
    const PREFIXES: [&str; 10] = [
        "sysdefault", "front", "surround", "iec958", "dmix", "dsnoop", "hw", "plughw", "null", "lavrate",
    ];
    let raw = device.id.split_once(':').map_or(device.id.as_str(), |(_, rest)| rest);
    PREFIXES.iter().any(|prefix| raw.starts_with(prefix))
}

#[cfg(not(target_os = "linux"))]
fn is_technical(_device: &OutputDevice) -> bool {
    false
}

pub fn scan() -> Scan {
    let host = cpal::default_host();
    let mut devices: Vec<(OutputDevice, cpal::Device)> = Vec::new();
    match host.output_devices() {
        Ok(list) => {
            for device in list {
                let Some(info) = describe_device(&device) else { continue };
                if is_technical(&info) || devices.iter().any(|(known, _)| known.id == info.id) {
                    continue;
                }
                devices.push((info, device));
            }
        }
        Err(error) => log::error!("[AUDIO] No se pudo obtener la lista de salidas: {error}"),
    }
    let system_default = default_device();
    Scan { devices, system_default }
}

/// Predeterminado actual del sistema. Es una consulta barata: se usa para
/// detectar cuándo cambia.
pub fn default_device() -> Option<OutputDevice> {
    cpal::default_host()
        .default_output_device()
        .and_then(|device| describe_device(&device))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(id: &str, name: &str) -> OutputDevice {
        OutputDevice { id: id.into(), name: name.into() }
    }

    fn fixed(id: &str, name: &str) -> OutputPreference {
        OutputPreference::Device { id: id.into(), name: name.into() }
    }

    fn listed() -> Vec<OutputDevice> {
        vec![
            device("wasapi:{realtek}", "Speakers (Realtek)"),
            device("wasapi:{epson}", "EPSON PJ"),
            device("wasapi:{usb}", "USB Audio CODEC"),
        ]
    }

    #[test]
    fn system_mode_uses_the_real_default() {
        let devices = listed();
        let choice = choose(&OutputPreference::System, &devices, Some(&devices[1]));
        assert_eq!(choice, Choice::Open { device: devices[1].clone(), rebound: false });
        assert_eq!(choose(&OutputPreference::System, &devices, None), Choice::Missing);
    }

    #[test]
    fn fixed_device_ignores_the_system_default() {
        let devices = listed();
        let choice = choose(&fixed("wasapi:{usb}", "USB Audio CODEC"), &devices, Some(&devices[1]));
        assert_eq!(choice, Choice::Open { device: devices[2].clone(), rebound: false });
    }

    #[test]
    fn missing_fixed_device_never_falls_back() {
        let devices = vec![device("wasapi:{realtek}", "Speakers (Realtek)"), device("wasapi:{epson}", "EPSON PJ")];
        let choice = choose(&fixed("wasapi:{usb}", "USB Audio CODEC"), &devices, Some(&devices[0]));
        assert_eq!(choice, Choice::Missing);
    }

    #[test]
    fn fixed_device_is_found_by_name_when_its_id_changes() {
        let devices = vec![device("wasapi:{realtek}", "Speakers (Realtek)"), device("wasapi:{usb-port2}", "USB Audio CODEC")];
        let choice = choose(&fixed("wasapi:{usb}", "USB Audio CODEC"), &devices, Some(&devices[0]));
        assert_eq!(choice, Choice::Open { device: devices[1].clone(), rebound: true });
    }

    #[test]
    fn ambiguous_names_are_not_guessed() {
        let devices = vec![device("wasapi:{a}", "USB Audio CODEC"), device("wasapi:{b}", "USB Audio CODEC")];
        let choice = choose(&fixed("wasapi:{old}", "USB Audio CODEC"), &devices, Some(&devices[0]));
        assert_eq!(choice, Choice::Ambiguous);
        // Con el identificador exacto sí se elige sin dudas.
        let exact = choose(&fixed("wasapi:{b}", "USB Audio CODEC"), &devices, None);
        assert_eq!(exact, Choice::Open { device: devices[1].clone(), rebound: false });
    }

    #[test]
    fn preference_round_trips_through_json() {
        let json = serde_json::to_string(&fixed("wasapi:{usb}", "USB Audio CODEC")).unwrap();
        assert_eq!(json, r#"{"mode":"device","id":"wasapi:{usb}","name":"USB Audio CODEC"}"#);
        let system: OutputPreference = serde_json::from_str(r#"{"mode":"system"}"#).unwrap();
        assert_eq!(system, OutputPreference::System);
    }
}
