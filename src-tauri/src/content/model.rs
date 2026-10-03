//! Modelo del documento `hymn.json` (schema v1) producido por
//! `sandbox/03-slide-detector`. Los campos que la aplicación no usa
//! (por ejemplo `provenance`) se ignoran al leer, sin rechazar el documento.

use serde::{Deserialize, Serialize};

pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Vocal,
    Instrumental,
}

impl TrackKind {
    pub fn other(self) -> Self {
        match self {
            Self::Vocal => Self::Instrumental,
            Self::Instrumental => Self::Vocal,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Vocal => "cantado",
            Self::Instrumental => "instrumental",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    /// Ruta relativa a la raíz de contenido, p. ej. `audio/001/cantado.m4a`.
    pub file: String,
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default)]
    pub container: Option<String>,
    pub duration_seconds: f64,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub channels: Option<u16>,
    /// `ready`, `missing` o `invalid` según el pipeline.
    #[serde(default = "default_track_status")]
    pub status: String,
}

fn default_track_status() -> String {
    "ready".into()
}

impl AudioTrack {
    pub fn is_ready(&self) -> bool {
        self.status == "ready" && self.duration_seconds > 0.0 && !self.file.is_empty()
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AudioSet {
    #[serde(default)]
    pub vocal: Option<AudioTrack>,
    #[serde(default)]
    pub instrumental: Option<AudioTrack>,
}

impl AudioSet {
    pub fn get(&self, kind: TrackKind) -> Option<&AudioTrack> {
        match kind {
            TrackKind::Vocal => self.vocal.as_ref(),
            TrackKind::Instrumental => self.instrumental.as_ref(),
        }
    }

    pub fn get_mut(&mut self, kind: TrackKind) -> Option<&mut AudioTrack> {
        match kind {
            TrackKind::Vocal => self.vocal.as_mut(),
            TrackKind::Instrumental => self.instrumental.as_mut(),
        }
    }

    pub fn available(&self, kind: TrackKind) -> bool {
        self.get(kind).is_some_and(AudioTrack::is_ready)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct BackgroundRef {
    pub id: String,
    #[serde(default = "default_overlay")]
    pub overlay: f64,
}

fn default_overlay() -> f64 {
    0.35
}

impl Default for BackgroundRef {
    fn default() -> Self {
        Self {
            id: "neutral-01".into(),
            overlay: default_overlay(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationRules {
    #[serde(default = "default_title")]
    pub on_audio_end: String,
    #[serde(default = "default_title")]
    pub on_lyrics_end: String,
    #[serde(default)]
    pub title_slide_index: usize,
}

fn default_title() -> String {
    "title".into()
}

impl Default for PresentationRules {
    fn default() -> Self {
        Self {
            on_audio_end: default_title(),
            on_lyrics_end: default_title(),
            title_slide_index: 0,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slide {
    pub index: usize,
    #[serde(default)]
    pub source_candidate_index: Option<usize>,
    pub start: f64,
    pub end: f64,
    /// `title`, `lyrics`, `chorus` o `refrain`.
    pub kind: String,
    #[serde(default)]
    pub text: Vec<String>,
    #[serde(default)]
    pub caption: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct QualityFlag {
    pub code: String,
    pub severity: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Quality {
    /// `draft`, `needs-review` o `reviewed`.
    pub status: String,
    #[serde(default)]
    pub flags: Vec<QualityFlag>,
}

impl Default for Quality {
    fn default() -> Self {
        Self {
            status: "draft".into(),
            flags: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hymn {
    pub schema_version: u32,
    pub id: String,
    pub number: u32,
    pub title: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub background: BackgroundRef,
    #[serde(default)]
    pub audio: AudioSet,
    #[serde(default)]
    pub presentation: PresentationRules,
    pub slides: Vec<Slide>,
    #[serde(default)]
    pub quality: Quality,
}

/// Entrada compacta del índice `catalog.json`: suficiente para listar y buscar
/// sin abrir los documentos completos.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub number: u32,
    pub title: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub tracks: CatalogTracks,
    #[serde(default)]
    pub first_line: Option<String>,
    /// Letra completa sin normalizar; la interfaz construye con ella su índice
    /// de búsqueda por contenido.
    #[serde(default)]
    pub lyrics: String,
    /// Sección y subsección (`content/sections.json`), si se conocen.
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub subsection: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct CatalogTracks {
    #[serde(default)]
    pub vocal: bool,
    #[serde(default)]
    pub instrumental: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFile {
    pub schema_version: u32,
    #[serde(default)]
    pub collection: Option<CollectionInfo>,
    #[serde(default)]
    pub generated_at: Option<String>,
    pub hymns: Vec<CatalogEntry>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct CollectionInfo {
    pub id: String,
    pub name: String,
}
