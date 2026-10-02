//! Cálculo de la pantalla visible a partir de la posición real del audio.
//! Mismo modelo validado en el POC: los tiempos del pipeline provienen del
//! video, cuyo audio se extrajo por stream copy, así que comparten origen (0 s)
//! y no requieren conversión ni corrección de drift.

use crate::content::model::Slide;

/// Índice de la pantalla cuyo intervalo contiene `position` (límite inferior
/// inclusivo). Antes de la primera pantalla devuelve 0.
pub fn slide_at(slides: &[Slide], position: f64) -> usize {
    slides
        .iter()
        .rposition(|slide| position >= slide.start)
        .unwrap_or(0)
}

/// Pantalla que debe proyectarse. Al terminar el audio o la última pantalla
/// de letra, la presentación vuelve a la portada (`title_slide_index`), según
/// `presentation.onAudioEnd/onLyricsEnd = "title"` del documento.
pub fn display_slide(slides: &[Slide], title_index: usize, position: f64, ended: bool) -> usize {
    let title_index = title_index.min(slides.len().saturating_sub(1));
    if ended {
        return title_index;
    }
    match slides.last() {
        Some(last) if position >= last.end => title_index,
        _ => slide_at(slides, position),
    }
}

/// Segundos hasta el próximo cambio de pantalla, si lo hay. El actualizador
/// lo usa para despertar justo a tiempo en lugar de sondear rápido.
pub fn seconds_to_next_change(slides: &[Slide], position: f64) -> Option<f64> {
    slides
        .iter()
        .map(|slide| slide.start)
        .chain(slides.last().map(|slide| slide.end))
        .find(|boundary| *boundary > position)
        .map(|boundary| boundary - position)
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
            text: vec![],
            caption: None,
        }
    }

    fn sample() -> Vec<Slide> {
        // Himno 001 real: portada, portada, 3 estrofas, portada final.
        vec![
            slide(0.0, 8.25),
            slide(8.25, 21.25),
            slide(21.25, 52.25),
            slide(52.25, 83.5),
            slide(83.5, 116.0),
            slide(116.0, 119.064),
        ]
    }

    #[test]
    fn selects_slide_at_exact_boundaries() {
        let slides = sample();
        assert_eq!(slide_at(&slides, 0.0), 0);
        assert_eq!(slide_at(&slides, 8.249), 0);
        assert_eq!(slide_at(&slides, 8.25), 1);
        assert_eq!(slide_at(&slides, 21.25), 2);
        assert_eq!(slide_at(&slides, 52.0), 2);
        assert_eq!(slide_at(&slides, 117.0), 5);
    }

    #[test]
    fn spec_example_position_20_10() {
        let slides = vec![slide(0.0, 8.25), slide(8.25, 19.74), slide(19.74, 31.1)];
        assert_eq!(slide_at(&slides, 20.10), 2);
    }

    #[test]
    fn returns_to_title_after_timeline_or_audio_end() {
        let slides = sample();
        assert_eq!(display_slide(&slides, 0, 60.0, false), 3);
        assert_eq!(display_slide(&slides, 0, 119.064, false), 0);
        assert_eq!(display_slide(&slides, 0, 200.0, false), 0);
        assert_eq!(display_slide(&slides, 0, 60.0, true), 0);
        // Índice de portada fuera de rango no provoca pánico.
        assert_eq!(display_slide(&slides, 99, 60.0, true), 5);
    }

    #[test]
    fn computes_time_to_next_change() {
        let slides = sample();
        assert_eq!(seconds_to_next_change(&slides, 0.0), Some(8.25));
        assert!((seconds_to_next_change(&slides, 50.0).unwrap_or_default() - 2.25).abs() < 1e-9);
        assert!(seconds_to_next_change(&slides, 118.0).is_some());
        assert_eq!(seconds_to_next_change(&slides, 119.064), None);
    }
}
