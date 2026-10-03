//! Secciones del himnario y fondos de imagen importados, desde `content/`.
//! Ambos son opcionales: sin ellos la aplicación usa sus fondos integrados.

use super::validate::is_safe_relative_path;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTarget {
    /// `general`, `section` o `subsection`.
    pub level: String,
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub subsection: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBackground {
    pub id: String,
    pub name: String,
    pub file: String,
    pub thumb: String,
    pub target: BackgroundTarget,
    #[serde(default = "white")]
    pub text_color: String,
    /// Rutas absolutas para el protocolo de archivos (las rellena la app).
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub thumb_path: String,
}

fn white() -> String {
    "#ffffff".into()
}

#[derive(Deserialize)]
struct Manifest {
    backgrounds: Vec<ImageBackground>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Visuals {
    /// Contenido de `sections.json` tal cual (lo interpreta la interfaz).
    pub sections: Value,
    pub backgrounds: Vec<ImageBackground>,
}

pub fn load(root: &Path) -> Visuals {
    let sections = fs::read_to_string(root.join("sections.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or(Value::Null);
    let dir = root.join("backgrounds");
    let backgrounds = fs::read_to_string(dir.join("manifest.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Manifest>(&text).map_err(|error| log::warn!("manifest de fondos inválido: {error}")).ok())
        .map(|manifest| manifest.backgrounds)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|mut background| {
            if !is_safe_relative_path(&background.file) || !is_safe_relative_path(&background.thumb) {
                return None;
            }
            let file = dir.join(&background.file);
            if !file.is_file() {
                log::warn!("Falta el fondo {}", background.file);
                return None;
            }
            background.path = file.display().to_string();
            background.thumb_path = dir.join(&background.thumb).display().to_string();
            Some(background)
        })
        .collect::<Vec<_>>();
    log::info!("Fondos de imagen: {}", backgrounds.len());
    Visuals { sections, backgrounds }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_manifest_and_skips_missing_or_unsafe_files() {
        let root = std::env::temp_dir().join(format!("himnario-visuals-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("backgrounds")).unwrap();
        fs::write(root.join("backgrounds/a.webp"), "x").unwrap();
        fs::write(
            root.join("backgrounds/manifest.json"),
            r#"{"backgrounds":[
              {"id":"a","name":"A","file":"a.webp","thumb":"a.thumb.webp","target":{"level":"general"}},
              {"id":"b","name":"B","file":"b.webp","thumb":"b.thumb.webp","target":{"level":"section","section":"x"}},
              {"id":"c","name":"C","file":"../c.webp","thumb":"c.webp","target":{"level":"general"}}]}"#,
        )
        .unwrap();
        let visuals = load(&root);
        assert_eq!(visuals.backgrounds.len(), 1);
        assert!(visuals.backgrounds[0].path.ends_with("a.webp"));
        assert!(visuals.sections.is_null());
        let _ = fs::remove_dir_all(root);
    }
}
