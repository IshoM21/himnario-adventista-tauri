//! Comprobaciones mínimas y baratas que se ejecutan al cargar un himno.
//! La validación exhaustiva del catálogo completo vive en
//! `tools/build-content.mjs` (tiempo de construcción), no en cada arranque.

use super::model::{Hymn, Slide, SUPPORTED_SCHEMA_VERSION};
use std::path::{Component, Path};

/// Tolerancia de continuidad entre pantallas (segundos). El pipeline redondea
/// a milisegundos, así que cualquier diferencia mayor indica un documento dañado.
const CONTINUITY_TOLERANCE: f64 = 0.002;

pub fn validate_hymn(hymn: &Hymn) -> Result<(), String> {
    if hymn.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(format!(
            "versión de formato {} no soportada (se esperaba {SUPPORTED_SCHEMA_VERSION})",
            hymn.schema_version
        ));
    }
    if hymn.id.trim().is_empty() {
        return Err("el himno no tiene id".into());
    }
    if hymn.title.trim().is_empty() {
        return Err("el himno no tiene título".into());
    }
    validate_slides(&hymn.slides)?;
    if hymn.presentation.title_slide_index >= hymn.slides.len() {
        return Err("titleSlideIndex apunta fuera de las pantallas".into());
    }
    for track in [&hymn.audio.vocal, &hymn.audio.instrumental]
        .into_iter()
        .flatten()
    {
        if !is_safe_relative_path(&track.file) {
            return Err(format!("ruta de audio no permitida: {}", track.file));
        }
    }
    Ok(())
}

pub fn validate_slides(slides: &[Slide]) -> Result<(), String> {
    if slides.is_empty() {
        return Err("no contiene pantallas".into());
    }
    for (position, slide) in slides.iter().enumerate() {
        if !slide.start.is_finite() || !slide.end.is_finite() {
            return Err(format!("la pantalla {position} tiene tiempos inválidos"));
        }
        if slide.start < 0.0 || slide.end <= slide.start {
            return Err(format!(
                "la pantalla {position} tiene un intervalo inválido ({} – {})",
                slide.start, slide.end
            ));
        }
        if position > 0 {
            let previous = &slides[position - 1];
            if slide.start < previous.start {
                return Err(format!("la pantalla {position} no está en orden"));
            }
            if (slide.start - previous.end).abs() > CONTINUITY_TOLERANCE {
                return Err(format!(
                    "hay un hueco o traslape entre las pantallas {} y {position}",
                    position - 1
                ));
            }
        }
    }
    Ok(())
}

/// Solo rutas relativas simples, sin `..` ni prefijos absolutos: el documento
/// nunca debe poder apuntar fuera de la carpeta de contenido.
pub fn is_safe_relative_path(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let path = Path::new(value);
    path.components()
        .all(|component| matches!(component, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slide(start: f64, end: f64) -> Slide {
        Slide {
            index: 0,
            source_candidate_index: None,
            start,
            end,
            kind: "lyrics".into(),
            text: vec!["x".into()],
            caption: None,
        }
    }

    #[test]
    fn accepts_contiguous_slides() {
        assert!(validate_slides(&[slide(0.0, 8.25), slide(8.25, 20.0)]).is_ok());
    }

    #[test]
    fn rejects_empty_inverted_and_gaps() {
        assert!(validate_slides(&[]).is_err());
        assert!(validate_slides(&[slide(5.0, 5.0)]).is_err());
        assert!(validate_slides(&[slide(0.0, 4.0), slide(3.0, 2.0)]).is_err());
        assert!(validate_slides(&[slide(0.0, 4.0), slide(4.5, 9.0)]).is_err());
        assert!(validate_slides(&[slide(0.0, f64::NAN)]).is_err());
    }

    #[test]
    fn rejects_paths_escaping_the_content_root() {
        assert!(is_safe_relative_path("audio/001/cantado.m4a"));
        assert!(!is_safe_relative_path("../secret.m4a"));
        assert!(!is_safe_relative_path("/etc/passwd"));
        assert!(!is_safe_relative_path("audio/../../x"));
        assert!(!is_safe_relative_path(""));
    }
}
