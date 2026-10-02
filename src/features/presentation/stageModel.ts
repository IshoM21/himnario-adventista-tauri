// Traducción pura de (estado + himno + configuración) → lo que se proyecta.
// Operador y proyección usan exactamente esta función, así la vista previa
// nunca difiere de lo que ve la congregación.

import type { AppearanceSettings, Hymn, PlaybackState, PresentationMode } from "../../types/domain";
import { EMPTY_LIBRARY, resolveBackground, type BackgroundDef, type BackgroundLibrary } from "./backgrounds";

export interface StageSlide {
  /** Clave estable para reiniciar el ajuste de texto al cambiar de pantalla. */
  key: string;
  kind: "title" | "lyrics";
  lines: string[];
  /** Referencia bíblica (solo portada), debajo del título. */
  caption: string | null;
  /** Número de estrofa o "Coro" (solo láminas de letra). */
  verse: string | null;
  number: number | null;
}

/** El número de estrofa va en una esquina (fuera del bloque de texto). */
export function isCornerPosition(position: AppearanceSettings["versePosition"]): boolean {
  return position !== "above" && position !== "below";
}

export interface StageView {
  mode: PresentationMode | "idle";
  background: BackgroundDef;
  slide: StageSlide | null;
  /**
   * Todas las pantallas del himno al aire. El tamaño de letra se calcula una
   * sola vez para el grupo completo, así todas las láminas del himno se ven
   * con el mismo tamaño.
   */
  group: { key: string; slides: StageSlide[] } | null;
}

function buildGroup(hymn: Hymn, appearance: AppearanceSettings): StageView["group"] {
  const slides = hymn.slides
    .map((_, index) => buildSlide(hymn, index, appearance))
    .filter((slide): slide is StageSlide => slide != null && slide.lines.length > 0);
  return { key: hymn.id, slides };
}

export function buildSlide(hymn: Hymn, index: number, appearance: AppearanceSettings): StageSlide | null {
  const slide = hymn.slides[index];
  if (!slide) return null;
  const isTitle = slide.kind === "title";
  const transform = (line: string) => (appearance.uppercase ? line.toLocaleUpperCase("es") : line);
  const lines = slide.text.map(transform);
  return {
    key: `${hymn.id}:${index}`,
    kind: isTitle ? "title" : "lyrics",
    lines: lines.length ? lines : isTitle ? [transform(hymn.title)] : [],
    caption: isTitle && appearance.showReference ? slide.caption : null,
    verse: !isTitle && appearance.showVerseNumber ? slide.caption : null,
    number: isTitle && appearance.showHymnNumber ? hymn.number : null,
  };
}

export function buildStageView(
  playback: PlaybackState | null,
  hymn: Hymn | null,
  appearance: AppearanceSettings,
  library: BackgroundLibrary = EMPTY_LIBRARY,
): StageView {
  const currentHymn = hymn && playback?.hymn?.id === hymn.id ? hymn : null;
  const background = resolveBackground(appearance, currentHymn, library);
  // El grupo se conserva aunque no se muestre letra: al quitar el negro o
  // volver a mostrar la letra el tamaño ya está calculado.
  const group = currentHymn ? buildGroup(currentHymn, appearance) : null;
  if (playback?.presentation === "black") {
    return { mode: "black", background, slide: null, group };
  }
  if (!playback || !currentHymn || playback.currentSlide == null) {
    return { mode: "idle", background, slide: null, group };
  }
  if (playback.presentation === "backgroundOnly") {
    return { mode: "backgroundOnly", background, slide: null, group };
  }
  return { mode: "normal", background, slide: buildSlide(currentHymn, playback.currentSlide, appearance), group };
}
