//! Preferencias persistentes en un JSON local (`settings.json` en la carpeta
//! de configuración de la app). Escritura atómica, valores por defecto para
//! cualquier campo ausente y respaldo automático si el archivo está dañado.

use crate::content::TrackKind;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const SETTINGS_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DefaultTrack {
    #[default]
    Vocal,
    Instrumental,
    /// Recordar la última pista utilizada.
    Last,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioSettings {
    pub volume: f32,
    pub default_track: DefaultTrack,
    pub last_track: TrackKind,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            volume: 0.8,
            default_track: DefaultTrack::Vocal,
            last_track: TrackKind::Vocal,
        }
    }
}

impl AudioSettings {
    pub fn preferred_track(&self) -> TrackKind {
        match self.default_track {
            DefaultTrack::Vocal => TrackKind::Vocal,
            DefaultTrack::Instrumental => TrackKind::Instrumental,
            DefaultTrack::Last => self.last_track,
        }
    }
}

/// Monitor elegido para proyectar. Se identifica por nombre y geometría
/// porque las APIs de ventanas no ofrecen un identificador estable.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorRef {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectionSettings {
    pub monitor: Option<MonitorRef>,
    /// Presentar automáticamente al iniciar si el monitor guardado existe.
    pub present_on_start: bool,
    /// El operador ya respondió la sugerencia de usar un segundo monitor.
    pub monitor_prompt_answered: bool,
}

impl Default for ProjectionSettings {
    fn default() -> Self {
        Self {
            monitor: None,
            present_on_start: true,
            monitor_prompt_answered: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FontFamily {
    #[default]
    Sans,
    Serif,
    System,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    #[default]
    Center,
    Left,
}

/// Ubicación del número de estrofa: junto al texto (se ajusta con él) o en
/// una esquina del área segura.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VersePosition {
    #[default]
    Above,
    Below,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundMode {
    /// Un mismo fondo para todos los himnos (`background_id`).
    #[default]
    #[serde(alias = "fixed")]
    Default,
    /// El fondo de la sección de cada himno.
    #[serde(alias = "hymn")]
    Section,
    /// El de su subsección; si no tiene, el de su sección.
    Subsection,
    /// Himno por himno; los demás siguen subsección → sección → predeterminado.
    Custom,
}

/// Apariencia de la proyección. Los tamaños son fracciones de la altura de la
/// pantalla, por lo que se adaptan a cualquier resolución.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    pub font_family: FontFamily,
    pub font_weight: u16,
    /// Tamaño máximo de letra (fracción de la altura de la pantalla).
    pub max_font_size: f32,
    /// Tamaño mínimo antes de permitir dividir renglones.
    pub min_font_size: f32,
    pub line_height: f32,
    pub text_align: TextAlign,
    /// `auto` usa el color recomendado por el fondo.
    pub text_color: String,
    pub margin_x: f32,
    pub margin_y: f32,
    pub shadow: bool,
    pub outline: bool,
    pub uppercase: bool,
    /// Número de estrofa o "Coro" en las láminas de letra.
    pub show_verse_number: bool,
    /// Dónde se muestra el número de estrofa.
    pub verse_position: VersePosition,
    /// Referencia bíblica en la portada.
    pub show_reference: bool,
    /// Opción anterior que combinaba estrofa y referencia. Solo se lee para
    /// migrar archivos viejos; nunca se vuelve a escribir.
    #[serde(skip_serializing)]
    pub show_caption: Option<bool>,
    pub show_hymn_number: bool,
    pub background_mode: BackgroundMode,
    /// Fondo predeterminado. `general` = el fondo general importado.
    pub background_id: String,
    /// Fondos elegidos a mano por sección / subsección / himno. Lo que no
    /// aparece usa las imágenes asignadas a ese grupo o el nivel superior.
    pub section_backgrounds: BTreeMap<String, String>,
    pub subsection_backgrounds: BTreeMap<String, String>,
    pub hymn_backgrounds: BTreeMap<String, String>,
    pub custom_color: String,
    /// Oscurecimiento adicional del fondo (0 a 0.8).
    pub overlay: f32,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            font_family: FontFamily::Sans,
            font_weight: 650,
            max_font_size: 0.085,
            min_font_size: 0.04,
            line_height: 1.18,
            text_align: TextAlign::Center,
            text_color: "auto".into(),
            margin_x: 0.07,
            margin_y: 0.08,
            shadow: true,
            outline: false,
            uppercase: false,
            show_verse_number: true,
            verse_position: VersePosition::Above,
            show_reference: true,
            show_caption: None,
            show_hymn_number: true,
            background_mode: BackgroundMode::Section,
            background_id: "general".into(),
            section_backgrounds: BTreeMap::new(),
            subsection_backgrounds: BTreeMap::new(),
            hymn_backgrounds: BTreeMap::new(),
            custom_color: "#10202c".into(),
            overlay: 0.0,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OperatorSettings {
    pub window: Option<WindowBounds>,
    pub last_hymn_id: Option<String>,
    /// Himnos seleccionados recientemente, el más reciente primero.
    pub recent_hymn_ids: Vec<String>,
    /// Tamaño y posición de la vista compacta (la completa usa `window`).
    pub compact_window: Option<WindowBounds>,
}

pub const RECENT_LIMIT: usize = 30;

impl OperatorSettings {
    /// Registra una selección: sube el himno al inicio, sin duplicados.
    pub fn remember(&mut self, id: &str) {
        self.last_hymn_id = Some(id.to_string());
        self.recent_hymn_ids.retain(|existing| existing != id);
        self.recent_hymn_ids.insert(0, id.to_string());
        self.recent_hymn_ids.truncate(RECENT_LIMIT);
    }
}

/// Tema de la ventana del operador. Se elige a mano (no sigue al sistema);
/// la proyección no cambia con el tema.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

/// Preferencias de la ventana del operador.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UiSettings {
    /// Vista compacta (lista + reproductor). Se recuerda al cerrar.
    pub compact: bool,
    /// El buscador también busca en la letra.
    pub lyrics_search: bool,
    /// Mantener la ventana encima de las demás, solo en vista compacta.
    pub always_on_top_compact: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub language: String,
    pub theme: Theme,
    pub ui: UiSettings,
    pub audio: AudioSettings,
    pub projection: ProjectionSettings,
    pub appearance: AppearanceSettings,
    pub operator: OperatorSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_VERSION,
            language: "es".into(),
            theme: Theme::Dark,
            ui: UiSettings::default(),
            audio: AudioSettings::default(),
            projection: ProjectionSettings::default(),
            appearance: AppearanceSettings::default(),
            operator: OperatorSettings::default(),
        }
    }
}

fn clamp_f32(value: f32, min: f32, max: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

/// Ids de fondos, secciones e himnos: solo letras, números y guiones.
fn is_safe_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 96 && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn sanitize_map(map: &mut BTreeMap<String, String>, limit: usize) {
    map.retain(|key, value| is_safe_id(key) && is_safe_id(value));
    while map.len() > limit {
        let Some(last) = map.keys().next_back().cloned() else { break };
        map.remove(&last);
    }
}

fn is_css_color(value: &str) -> bool {
    let hex = value.strip_prefix('#').unwrap_or("");
    matches!(hex.len(), 3 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

impl Settings {
    /// Corrige valores fuera de rango para que un archivo editado a mano o de
    /// una versión anterior nunca deje la proyección ilegible.
    pub fn sanitized(mut self) -> Self {
        let defaults = AppearanceSettings::default();
        self.schema_version = SETTINGS_VERSION;
        // Migración: "mostrar número de estrofa y referencia" (una sola opción)
        // se separó en dos; un archivo viejo con la opción apagada apaga ambas.
        if let Some(show) = self.appearance.show_caption.take() {
            if !show {
                self.appearance.show_verse_number = false;
                self.appearance.show_reference = false;
            }
        }
        if self.language.trim().is_empty() {
            self.language = "es".into();
        }
        self.audio.volume = clamp_f32(self.audio.volume, 0.0, 1.0, 0.8);
        let a = &mut self.appearance;
        a.font_weight = a.font_weight.clamp(300, 900);
        a.max_font_size = clamp_f32(a.max_font_size, 0.03, 0.2, defaults.max_font_size);
        a.min_font_size = clamp_f32(a.min_font_size, 0.015, a.max_font_size, defaults.min_font_size);
        a.line_height = clamp_f32(a.line_height, 0.9, 2.0, defaults.line_height);
        // 5 %: área segura mínima (la interfaz la aplica igualmente al dibujar).
        a.margin_x = clamp_f32(a.margin_x, 0.05, 0.3, defaults.margin_x);
        a.margin_y = clamp_f32(a.margin_y, 0.05, 0.3, defaults.margin_y);
        a.overlay = clamp_f32(a.overlay, 0.0, 0.8, defaults.overlay);
        if a.text_color != "auto" && !is_css_color(&a.text_color) {
            a.text_color = "auto".into();
        }
        if !is_css_color(&a.custom_color) {
            a.custom_color = defaults.custom_color.clone();
        }
        if !is_safe_id(&a.background_id) {
            a.background_id = defaults.background_id;
        }
        sanitize_map(&mut a.section_backgrounds, 200);
        sanitize_map(&mut a.subsection_backgrounds, 400);
        sanitize_map(&mut a.hymn_backgrounds, 2000);
        self.operator.recent_hymn_ids.retain(|id| {
            !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        });
        self.operator.recent_hymn_ids.truncate(RECENT_LIMIT);
        if let Some(window) = &self.operator.window {
            if window.width < 400 || window.height < 300 || window.width > 20_000 || window.height > 20_000 {
                self.operator.window = None;
            }
        }
        if let Some(window) = &self.operator.compact_window {
            if window.width < 200 || window.height < 200 || window.width > 20_000 || window.height > 20_000 {
                self.operator.compact_window = None;
            }
        }
        self
    }
}

pub struct LoadedSettings {
    pub settings: Settings,
    /// Aviso para el operador si hubo que restablecer la configuración.
    pub warning: Option<String>,
}

pub fn load(path: &Path) -> LoadedSettings {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            log::info!("Primera ejecución: configuración predeterminada");
            return LoadedSettings { settings: Settings::default(), warning: None };
        }
        Err(error) => {
            log::error!("No se pudo leer {}: {error}", path.display());
            return LoadedSettings {
                settings: Settings::default(),
                warning: Some("No se pudo leer la configuración; se usan valores predeterminados.".into()),
            };
        }
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(settings) => LoadedSettings { settings: settings.sanitized(), warning: None },
        Err(error) => {
            let backup = backup_path(path);
            let moved = fs::rename(path, &backup).is_ok();
            log::error!(
                "Configuración dañada ({error}); respaldo {}: {}",
                if moved { "creado" } else { "no creado" },
                backup.display()
            );
            LoadedSettings {
                settings: Settings::default(),
                warning: Some(format!(
                    "La configuración estaba dañada y se restableció. Copia de seguridad: {}",
                    backup.display()
                )),
            }
        }
    }
}

fn backup_path(path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    path.with_file_name(format!("settings.corrupt-{stamp}.json"))
}

/// Escribe en un temporal y lo renombra: un corte de luz a mitad de la
/// escritura nunca deja un archivo a medias.
pub fn save(path: &Path, settings: &Settings) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| AppError::settings(format!("No se pudo crear {}: {error}", parent.display())))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|error| AppError::settings(error.to_string()))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, text)
        .map_err(|error| AppError::settings(format!("No se pudo guardar la configuración: {error}")))?;
    fs::rename(&temporary, path)
        .map_err(|error| AppError::settings(format!("No se pudo guardar la configuración: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("himnario-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("crear carpeta");
        dir.join("settings.json")
    }

    #[test]
    fn missing_file_uses_defaults_without_warning() {
        let path = temp_file("missing");
        let loaded = load(&path);
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.warning.is_none());
    }

    #[test]
    fn round_trip_and_partial_files_fill_defaults() {
        let path = temp_file("roundtrip");
        let mut settings = Settings::default();
        settings.audio.volume = 0.5;
        settings.audio.default_track = DefaultTrack::Last;
        settings.audio.last_track = TrackKind::Instrumental;
        save(&path, &settings).expect("guardar");
        assert_eq!(load(&path).settings, settings);
        assert_eq!(load(&path).settings.audio.preferred_track(), TrackKind::Instrumental);

        fs::write(&path, r#"{"audio":{"volume":0.3},"theme":"light"}"#).expect("escribir");
        let loaded = load(&path).settings;
        assert_eq!(loaded.audio.volume, 0.3);
        assert_eq!(loaded.theme, Theme::Light);
        assert_eq!(loaded.appearance, AppearanceSettings::default());
    }

    #[test]
    fn recent_hymns_move_to_front_without_duplicates() {
        let mut operator = OperatorSettings::default();
        for id in ["001", "002", "003", "001"] {
            operator.remember(id);
        }
        assert_eq!(operator.recent_hymn_ids, ["001", "003", "002"]);
        for number in 0..50 {
            operator.remember(&format!("{number:03}"));
        }
        assert_eq!(operator.recent_hymn_ids.len(), RECENT_LIMIT);
        assert_eq!(operator.last_hymn_id.as_deref(), Some("049"));
    }

    #[test]
    fn legacy_caption_option_migrates_to_both_new_options() {
        let path = temp_file("legacy-caption");
        fs::write(&path, r#"{"appearance":{"showCaption":false}}"#).expect("escribir");
        let loaded = load(&path).settings;
        assert!(!loaded.appearance.show_verse_number);
        assert!(!loaded.appearance.show_reference);
        assert_eq!(loaded.appearance.show_caption, None);
        save(&path, &loaded).expect("guardar");
        assert!(!fs::read_to_string(&path).unwrap().contains("showCaption"));

        fs::write(&path, r#"{"appearance":{"showCaption":true,"versePosition":"bottomRight"}}"#).expect("escribir");
        let loaded = load(&path).settings;
        assert!(loaded.appearance.show_verse_number && loaded.appearance.show_reference);
        assert_eq!(loaded.appearance.verse_position, VersePosition::BottomRight);
    }

    #[test]
    fn background_modes_migrate_and_maps_are_sanitized() {
        let path = temp_file("background-modes");
        fs::write(&path, r#"{"appearance":{"backgroundMode":"fixed"}}"#).expect("escribir");
        assert_eq!(load(&path).settings.appearance.background_mode, BackgroundMode::Default);
        fs::write(&path, r#"{"appearance":{"backgroundMode":"hymn"}}"#).expect("escribir");
        assert_eq!(load(&path).settings.appearance.background_mode, BackgroundMode::Section);
        fs::write(
            &path,
            r#"{"appearance":{"backgroundMode":"custom","hymnBackgrounds":{"001":"el-culto--silencio","../x":"a","002":"bad id"}}}"#,
        )
        .expect("escribir");
        let loaded = load(&path).settings.appearance;
        assert_eq!(loaded.background_mode, BackgroundMode::Custom);
        assert_eq!(loaded.hymn_backgrounds.len(), 1);
        assert_eq!(loaded.hymn_backgrounds.get("001").map(String::as_str), Some("el-culto--silencio"));
    }

    #[test]
    fn corrupt_file_is_backed_up_and_reset() {
        let path = temp_file("corrupt");
        fs::write(&path, "{ esto no es json").expect("escribir");
        let loaded = load(&path);
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.warning.is_some());
        assert!(!path.exists());
        let backups = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("settings.corrupt-"))
            .count();
        assert_eq!(backups, 1);
    }

    #[test]
    fn out_of_range_values_are_sanitized() {
        let mut settings = Settings::default();
        settings.audio.volume = 3.0;
        settings.appearance.max_font_size = 5.0;
        settings.appearance.min_font_size = 1.0;
        settings.appearance.text_color = "red; background: url(x)".into();
        settings.appearance.background_id = "../../etc".into();
        settings.appearance.overlay = f32::NAN;
        let clean = settings.sanitized();
        assert_eq!(clean.audio.volume, 1.0);
        assert_eq!(clean.appearance.max_font_size, 0.2);
        assert!(clean.appearance.min_font_size <= clean.appearance.max_font_size);
        assert_eq!(clean.appearance.text_color, "auto");
        assert_eq!(clean.appearance.background_id, "general");
        assert_eq!(clean.appearance.overlay, 0.0);
    }
}
