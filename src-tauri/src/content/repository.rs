//! Acceso al contenido en disco: índice compacto al iniciar y documentos
//! completos bajo demanda (con caché), sin cargar los 613 JSON al arrancar.

use super::model::{CatalogEntry, CatalogFile, CatalogTracks, CollectionInfo, Hymn, TrackKind};
use super::validate::validate_hymn;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// Máximo de documentos completos retenidos en memoria. Cada uno pesa pocos KB;
/// el límite solo evita crecer sin control en sesiones muy largas.
const CACHE_LIMIT: usize = 64;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSummary {
    pub collection: CollectionInfo,
    pub content_root: String,
    pub total: usize,
    pub reviewed: usize,
    pub drafts: usize,
    pub hymns: Vec<CatalogEntry>,
    /// Advertencias no fatales detectadas al leer el índice.
    pub warnings: Vec<String>,
}

pub struct ContentRepository {
    root: PathBuf,
    collection: CollectionInfo,
    entries: Vec<CatalogEntry>,
    warnings: Vec<String>,
    cache: Mutex<HashMap<String, Arc<Hymn>>>,
}

impl ContentRepository {
    /// Abre la carpeta de contenido. Usa `catalog.json` si existe; si falta o
    /// está dañado, reconstruye el índice leyendo `hymns/*.json` (más lento,
    /// pero la aplicación sigue funcionando).
    pub fn open(root: PathBuf) -> AppResult<Self> {
        let hymns_dir = root.join("hymns");
        if !hymns_dir.is_dir() {
            return Err(AppError::content(format!(
                "No se encontró la carpeta de himnos en {}",
                hymns_dir.display()
            )));
        }
        let mut warnings = Vec::new();
        let catalog_path = root.join("catalog.json");
        let (collection, mut entries) = match read_catalog(&catalog_path) {
            Ok(catalog) => (catalog.collection.unwrap_or_else(default_collection), catalog.hymns),
            Err(error) => {
                log::warn!("Índice no disponible ({error}); se reconstruye desde hymns/");
                warnings.push(format!(
                    "No se pudo leer catalog.json ({error}); se reconstruyó el índice."
                ));
                (default_collection(), scan_hymns(&hymns_dir, &mut warnings))
            }
        };

        let mut seen = std::collections::HashSet::new();
        entries.retain(|entry| {
            if seen.insert(entry.id.clone()) {
                true
            } else {
                warnings.push(format!("Id de himno duplicado en el índice: {}", entry.id));
                false
            }
        });
        entries.sort_by(|left, right| left.number.cmp(&right.number).then(left.id.cmp(&right.id)));
        if entries.is_empty() {
            return Err(AppError::content(format!(
                "La carpeta de contenido {} no contiene himnos",
                root.display()
            )));
        }
        log::info!(
            "Contenido cargado: {} himnos desde {}",
            entries.len(),
            root.display()
        );
        Ok(Self {
            root,
            collection,
            entries,
            warnings,
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    #[cfg(test)]
    pub fn entries(&self) -> &[CatalogEntry] {
        &self.entries
    }

    pub fn summary(&self) -> CatalogSummary {
        let reviewed = self
            .entries
            .iter()
            .filter(|entry| entry.status == "reviewed")
            .count();
        CatalogSummary {
            collection: self.collection.clone(),
            content_root: self.root.display().to_string(),
            total: self.entries.len(),
            reviewed,
            drafts: self.entries.len() - reviewed,
            hymns: self.entries.clone(),
            warnings: self.warnings.clone(),
        }
    }

    pub fn contains(&self, id: &str) -> bool {
        self.entries.iter().any(|entry| entry.id == id)
    }

    /// Carga un documento completo. Verifica la existencia de cada pista y
    /// marca como `missing` las que no están en disco, para que la interfaz
    /// nunca permita elegir una pista inexistente.
    pub fn load(&self, id: &str) -> AppResult<Arc<Hymn>> {
        if let Some(hymn) = self.cache.lock().ok().and_then(|cache| cache.get(id).cloned()) {
            return Ok(hymn);
        }
        if !self.contains(id) {
            return Err(AppError::content(format!("El himno {id} no está en el catálogo")));
        }
        let path = self.hymn_path(id);
        let text = fs::read_to_string(&path).map_err(|error| {
            AppError::content(format!("No se pudo abrir {}: {error}", path.display()))
        })?;
        let mut hymn: Hymn = serde_json::from_str(&text).map_err(|error| {
            AppError::content(format!("El himno {id} tiene un formato inválido: {error}"))
        })?;
        validate_hymn(&hymn)
            .map_err(|error| AppError::content(format!("El himno {id} no es válido: {error}")))?;
        for kind in [TrackKind::Vocal, TrackKind::Instrumental] {
            let root = self.root.clone();
            if let Some(track) = hymn.audio.get_mut(kind) {
                if track.is_ready() && !root.join(&track.file).is_file() {
                    log::warn!("Himno {id}: falta la pista {} ({})", kind.label(), track.file);
                    track.status = "missing".into();
                }
            }
        }
        let hymn = Arc::new(hymn);
        if let Ok(mut cache) = self.cache.lock() {
            if cache.len() >= CACHE_LIMIT {
                cache.clear();
            }
            cache.insert(id.to_string(), hymn.clone());
        }
        Ok(hymn)
    }

    fn hymn_path(&self, id: &str) -> PathBuf {
        self.root.join("hymns").join(format!("{id}.json"))
    }
}

fn default_collection() -> CollectionInfo {
    CollectionInfo {
        id: "himnario-adventista".into(),
        name: "Himnario Adventista".into(),
    }
}

fn read_catalog(path: &Path) -> Result<CatalogFile, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let catalog: CatalogFile = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    if catalog.hymns.is_empty() {
        return Err("el índice está vacío".into());
    }
    Ok(catalog)
}

fn scan_hymns(dir: &Path, warnings: &mut Vec<String>) -> Vec<CatalogEntry> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for item in read.flatten() {
        let path = item.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let parsed = fs::read_to_string(&path)
            .map_err(|error| error.to_string())
            .and_then(|text| serde_json::from_str::<Hymn>(&text).map_err(|error| error.to_string()));
        match parsed {
            Ok(hymn) => entries.push(entry_from_hymn(&hymn)),
            Err(error) => warnings.push(format!("{}: {error}", path.display())),
        }
    }
    entries
}

pub fn entry_from_hymn(hymn: &Hymn) -> CatalogEntry {
    let first_line = hymn
        .slides
        .iter()
        .find(|slide| slide.kind != "title")
        .and_then(|slide| slide.text.first().cloned());
    CatalogEntry {
        id: hymn.id.clone(),
        number: hymn.number,
        title: hymn.title.clone(),
        status: hymn.quality.status.clone(),
        tracks: CatalogTracks {
            vocal: hymn.audio.available(TrackKind::Vocal),
            instrumental: hymn.audio.available(TrackKind::Instrumental),
        },
        first_line,
        lyrics: hymn
            .slides
            .iter()
            .filter(|slide| slide.kind != "title")
            .flat_map(|slide| slide.text.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        section: None,
        subsection: None,
    }
}

/// Busca la carpeta de contenido en orden de prioridad:
/// 1. variable `HIMNARIO_CONTENT_DIR` (diagnóstico y pruebas);
/// 2. `content/` junto al ejecutable (distribución portátil);
/// 3. recursos empaquetados por el instalador;
/// 4. `content/` del repositorio en desarrollo.
pub fn candidate_roots(resource_dir: Option<PathBuf>, exe_dir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(value) = std::env::var("HIMNARIO_CONTENT_DIR") {
        if !value.trim().is_empty() {
            roots.push(PathBuf::from(value));
        }
    }
    if let Some(dir) = exe_dir {
        roots.push(dir.join("content"));
    }
    if let Some(dir) = resource_dir {
        roots.push(dir.join("content"));
    }
    if cfg!(debug_assertions) {
        roots.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("content"));
    }
    roots
}

pub fn find_root(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|root| root.join("hymns").is_dir())
        .map(|root| normalize_root(root))
}

/// Ruta absoluta sin `..` (el protocolo de archivos de Tauri rechaza rutas
/// con saltos de directorio). En Windows se quita el prefijo `\\?\` que agrega
/// `canonicalize`, salvo en rutas de red.
fn normalize_root(root: &Path) -> PathBuf {
    let Ok(canonical) = fs::canonicalize(root) else {
        return root.to_path_buf();
    };
    if cfg!(windows) {
        let text = canonical.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            if !rest.starts_with("UNC\\") {
                return PathBuf::from(rest);
            }
        }
    }
    canonical
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "himnario-test-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("hymns")).expect("crear carpeta temporal");
        dir
    }

    fn hymn_json(id: &str, number: u32) -> String {
        format!(
            r#"{{
  "schemaVersion": 1, "id": "{id}", "number": {number}, "title": "Himno {number}",
  "language": "es", "background": {{"id": "neutral-01", "overlay": 0.3}},
  "audio": {{
    "vocal": {{"file": "audio/{id}/cantado.m4a", "durationSeconds": 20.0, "status": "ready"}},
    "instrumental": {{"file": "audio/{id}/instrumental.mp3", "durationSeconds": 21.0, "status": "ready"}}
  }},
  "presentation": {{"onAudioEnd": "title", "onLyricsEnd": "title", "titleSlideIndex": 0}},
  "slides": [
    {{"index": 0, "sourceCandidateIndex": 0, "start": 0, "end": 5, "kind": "title", "text": ["Himno"], "caption": null}},
    {{"index": 1, "sourceCandidateIndex": 1, "start": 5, "end": 20, "kind": "lyrics", "text": ["Primera línea"], "caption": "1"}}
  ],
  "quality": {{"status": "reviewed", "flags": []}},
  "provenance": {{"sourceFilename": "x.mkv"}}
}}"#
        )
    }

    fn write(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("crear carpeta");
        }
        let mut file = fs::File::create(path).expect("crear archivo");
        file.write_all(text.as_bytes()).expect("escribir archivo");
    }

    #[test]
    fn rebuilds_index_when_catalog_is_missing_and_marks_missing_tracks() {
        let root = temp_dir("scan");
        write(&root.join("hymns/002.json"), &hymn_json("002", 2));
        write(&root.join("hymns/001.json"), &hymn_json("001", 1));
        write(&root.join("audio/001/cantado.m4a"), "stub");

        let repository = ContentRepository::open(root.clone()).expect("abrir contenido");
        let ids: Vec<_> = repository.entries().iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, ["001", "002"]);
        assert_eq!(repository.summary().warnings.len(), 1);

        let hymn = repository.load("001").expect("cargar himno");
        assert!(hymn.audio.available(TrackKind::Vocal));
        assert!(!hymn.audio.available(TrackKind::Instrumental));
        assert_eq!(hymn.slides[1].text, ["Primera línea"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn uses_catalog_and_rejects_unknown_or_broken_documents() {
        let root = temp_dir("catalog");
        write(
            &root.join("catalog.json"),
            r#"{"schemaVersion":1,"hymns":[
                {"id":"001","number":1,"title":"Uno","status":"reviewed"},
                {"id":"001","number":1,"title":"Duplicado","status":"reviewed"},
                {"id":"003","number":3,"title":"Roto","status":"draft"}]}"#,
        );
        write(&root.join("hymns/001.json"), &hymn_json("001", 1));
        write(&root.join("hymns/003.json"), "{ no es json");

        let repository = ContentRepository::open(root.clone()).expect("abrir contenido");
        assert_eq!(repository.entries().len(), 2);
        assert!(repository.summary().warnings[0].contains("duplicado"));
        assert!(repository.load("001").is_ok());
        assert_eq!(repository.load("003").unwrap_err().code, "CONTENT");
        assert_eq!(repository.load("999").unwrap_err().code, "CONTENT");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fails_clearly_without_hymn_folder() {
        let root = std::env::temp_dir().join("himnario-test-no-content-folder");
        let _ = fs::remove_dir_all(&root);
        assert!(ContentRepository::open(root).is_err());
    }
}
