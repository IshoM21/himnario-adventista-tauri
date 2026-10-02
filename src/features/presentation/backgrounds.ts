// Fondos reutilizables. Los ids coinciden con `background.id` de hymn.json
// (parchment-01, dawn-01, garden-01 provienen del POC). Todas las imágenes son
// obra propia generada con tools/generate-backgrounds.sh.

import dusk from "../../assets/backgrounds/image-dusk.webp";
import forest from "../../assets/backgrounds/image-forest.webp";
import sea from "../../assets/backgrounds/image-sea.webp";
import stone from "../../assets/backgrounds/image-stone.webp";
import sunrise from "../../assets/backgrounds/image-sunrise.webp";
import wine from "../../assets/backgrounds/image-wine.webp";
import type { AppearanceSettings, Hymn, ImageBackground, SectionDef, SubsectionDef, Visuals } from "../../types/domain";

export type BackgroundKind = "solid" | "gradient" | "image";

export interface BackgroundDef {
  id: string;
  name: string;
  kind: BackgroundKind;
  /** Valor CSS de `background` (sólidos y gradientes). */
  css?: string;
  image?: string;
  /** Color de letra recomendado sobre este fondo. */
  textColor: string;
  /** Si conviene sombra para legibilidad. */
  shadow: boolean;
}

export const CUSTOM_COLOR_ID = "custom-color";
/** Id genérico que el pipeline asigna cuando no se eligió fondo. */
export const NEUTRAL_ID = "neutral-01";

export const BACKGROUNDS: BackgroundDef[] = [
  {
    id: "night-01",
    name: "Noche",
    kind: "gradient",
    css: "radial-gradient(ellipse at 50% 35%, #1f3b5c 0%, #0f1f33 55%, #070d17 100%)",
    textColor: "#ffffff",
    shadow: true,
  },
  {
    id: "parchment-01",
    name: "Pergamino",
    kind: "gradient",
    css: [
      "linear-gradient(90deg, rgba(34,20,8,.45), transparent 45%, rgba(28,18,9,.2))",
      "radial-gradient(circle at 78% 24%, rgba(255,233,170,.52), transparent 25%)",
      "repeating-linear-gradient(115deg, rgba(72,42,17,.11) 0 1px, transparent 1px 18px)",
      "linear-gradient(135deg, #7c4b1f, #c99b51 44%, #75502c 100%)",
    ].join(", "),
    textColor: "#ffffff",
    shadow: true,
  },
  {
    id: "dawn-01",
    name: "Alba",
    kind: "gradient",
    css: [
      "radial-gradient(ellipse at 20% 78%, rgba(255,222,143,.6), transparent 34%)",
      "radial-gradient(circle at 30% 63%, #fff7bc 0 4%, #e8af51 11%, transparent 29%)",
      "linear-gradient(180deg, #0d2941 0%, #365b70 47%, #d49b4d 68%, #453927 100%)",
    ].join(", "),
    textColor: "#ffffff",
    shadow: true,
  },
  {
    id: "garden-01",
    name: "Jardín (claro)",
    kind: "gradient",
    css: [
      "radial-gradient(ellipse at 100% 110%, rgba(34,103,79,.28), transparent 38%)",
      "radial-gradient(ellipse at 78% 54%, rgba(38,88,67,.3), transparent 15%)",
      "linear-gradient(112deg, #f2f4ec 0 58%, #c3e5df 100%)",
    ].join(", "),
    textColor: "#14232a",
    shadow: false,
  },
  { id: "image-dusk", name: "Atardecer", kind: "image", image: dusk, textColor: "#ffffff", shadow: true },
  { id: "image-sunrise", name: "Amanecer", kind: "image", image: sunrise, textColor: "#ffffff", shadow: true },
  { id: "image-forest", name: "Bosque", kind: "image", image: forest, textColor: "#ffffff", shadow: true },
  { id: "image-sea", name: "Mar", kind: "image", image: sea, textColor: "#ffffff", shadow: true },
  { id: "image-wine", name: "Vino", kind: "image", image: wine, textColor: "#ffffff", shadow: true },
  { id: "image-stone", name: "Piedra", kind: "image", image: stone, textColor: "#ffffff", shadow: true },
  { id: "solid-black", name: "Negro sólido", kind: "solid", css: "#000000", textColor: "#ffffff", shadow: false },
  { id: "solid-navy", name: "Azul sólido", kind: "solid", css: "#0c2340", textColor: "#ffffff", shadow: false },
  { id: "solid-white", name: "Blanco sólido", kind: "solid", css: "#f7f5ef", textColor: "#111111", shadow: false },
];

const byId = new Map(BACKGROUNDS.map((background) => [background.id, background]));

/** Luminancia relativa aproximada de un color #rgb/#rrggbb. */
function isLight(hex: string): boolean {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.slice(0, 6);
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return false;
  const r = (number >> 16) & 255;
  const g = (number >> 8) & 255;
  const b = number & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

export function customColorBackground(color: string): BackgroundDef {
  const light = isLight(color);
  return {
    id: CUSTOM_COLOR_ID,
    name: "Color personalizado",
    kind: "solid",
    css: color,
    textColor: light ? "#111111" : "#ffffff",
    shadow: false,
  };
}

/** Fondo de imagen importado, con su destino (general, sección o subsección). */
export interface ImageBackgroundDef extends BackgroundDef {
  kind: "image";
  thumb: string;
  target: ImageBackground["target"];
}

/** Fondos importados + secciones del himnario (vacío si no hay contenido). */
export interface BackgroundLibrary {
  images: ImageBackgroundDef[];
  sections: SectionDef[];
}

export const EMPTY_LIBRARY: BackgroundLibrary = { images: [], sections: [] };

/** Id especial: el fondo general importado (o «Noche» si no hay). */
export const GENERAL_ID = "general";

export function buildLibrary(visuals: Visuals | null, toUrl: (path: string) => string): BackgroundLibrary {
  if (!visuals) return EMPTY_LIBRARY;
  return {
    sections: visuals.sections?.sections ?? [],
    images: visuals.backgrounds.map((image) => ({
      id: image.id,
      name: image.name,
      kind: "image",
      image: toUrl(image.path),
      thumb: toUrl(image.thumbPath),
      textColor: image.textColor,
      shadow: true,
      target: image.target,
    })),
  };
}

export function findBackground(
  id: string,
  appearance: AppearanceSettings,
  library: BackgroundLibrary = EMPTY_LIBRARY,
): BackgroundDef | undefined {
  if (id === CUSTOM_COLOR_ID) return customColorBackground(appearance.customColor);
  return library.images.find((image) => image.id === id) ?? byId.get(id);
}

/** Sección y subsección de un número de himno según `sections.json`. */
export function locateHymn(number: number, sections: SectionDef[]): { section: SectionDef; subsection: SubsectionDef } | null {
  for (const section of sections) {
    for (const subsection of section.subsections) {
      if (number >= subsection.from && number <= subsection.to) return { section, subsection };
    }
  }
  return null;
}

/** Varias imágenes para un grupo: se reparten por número (vecinos distintos). */
function pick<T>(list: T[], number: number): T | undefined {
  return list.length ? list[(Math.max(1, number) - 1) % list.length] : undefined;
}

/**
 * Fondo de un himno según el modo:
 *  - default:    el predeterminado para todos;
 *  - section:    sección → predeterminado;
 *  - subsection: subsección → sección → predeterminado;
 *  - custom:     himno → subsección → sección → predeterminado.
 * En cada nivel, una elección manual gana a las imágenes asignadas al grupo.
 */
export function resolveBackground(
  appearance: AppearanceSettings,
  hymn: Pick<Hymn, "id" | "number"> | null,
  library: BackgroundLibrary = EMPTY_LIBRARY,
): BackgroundDef {
  const number = hymn?.number ?? 1;
  const find = (id: string | undefined) => (id ? findBackground(id, appearance, library) : undefined);
  const imagesFor = (level: string, match: (target: ImageBackground["target"]) => boolean) =>
    library.images.filter((image) => image.target.level === level && match(image.target));

  const fallback = (): BackgroundDef => {
    if (appearance.backgroundId === GENERAL_ID || !find(appearance.backgroundId)) {
      return pick(imagesFor("general", () => true), number) ?? byId.get("night-01") ?? BACKGROUNDS[0];
    }
    return find(appearance.backgroundId) ?? BACKGROUNDS[0];
  };
  if (!hymn || appearance.backgroundMode === "default") return fallback();

  const location = locateHymn(hymn.number, library.sections);
  const bySection = (): BackgroundDef => {
    if (!location) return fallback();
    return (
      find(appearance.sectionBackgrounds?.[location.section.id]) ??
      pick(imagesFor("section", (target) => target.section === location.section.id), number) ??
      fallback()
    );
  };
  const bySubsection = (): BackgroundDef => {
    if (!location) return fallback();
    return (
      find(appearance.subsectionBackgrounds?.[location.subsection.id]) ??
      pick(imagesFor("subsection", (target) => target.subsection === location.subsection.id), number) ??
      bySection()
    );
  };

  switch (appearance.backgroundMode) {
    case "section":
      return bySection();
    case "subsection":
      return bySubsection();
    case "custom":
      return find(appearance.hymnBackgrounds?.[hymn.id]) ?? bySubsection();
    default:
      return fallback();
  }
}
