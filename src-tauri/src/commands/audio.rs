use crate::audio::{devices, OutputDevice};
use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevices {
    pub devices: Vec<OutputDevice>,
    pub system_default: Option<OutputDevice>,
}

/// Salidas para Configuración → Audio. Asíncrono: enumerar dispositivos no
/// debe bloquear el hilo de la interfaz.
#[tauri::command]
pub async fn list_audio_devices() -> AudioDevices {
    let scan = devices::scan();
    log::info!(
        "[AUDIO] Lista de salidas consultada desde Configuración: {} dispositivo(s)",
        scan.devices.len()
    );
    AudioDevices { devices: scan.infos(), system_default: scan.system_default }
}

/// "Probar salida": tono corto por la salida actual, solo al pulsar el botón.
#[tauri::command]
pub fn test_audio_output(state: State<'_, AppState>) -> AppResult<()> {
    state.session().test_output()
}
