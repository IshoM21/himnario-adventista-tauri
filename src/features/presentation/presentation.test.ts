import { describe, expect, it } from "vitest";
import type { AppearanceSettings, Hymn, PlaybackState } from "../../types/domain";
import { resolveBackground } from "./backgrounds";
import { fitFontSize } from "./fitText";
import { buildStageView } from "./stageModel";

const appearance: AppearanceSettings = {
  fontFamily: "sans",
  fontWeight: 650,
  maxFontSize: 0.085,
  minFontSize: 0.04,
  lineHeight: 1.18,
  textAlign: "center",
  textColor: "auto",
  marginX: 0.07,
  marginY: 0.08,
  shadow: true,
  outline: false,
  uppercase: false,
  showVerseNumber: true,
  versePosition: "above",
  showReference: true,
  showHymnNumber: true,
  backgroundMode: "default",
  backgroundId: "parchment-01",
  sectionBackgrounds: {},
  subsectionBackgrounds: {},
  hymnBackgrounds: {},
  customColor: "#10202c",
  overlay: 0,
};

const hymn: Hymn = {
  schemaVersion: 1,
  id: "001",
  number: 1,
  title: "Cantad alegres al Señor",
  language: "es",
  background: { id: "parchment-01", overlay: 0.35 },
  audio: { vocal: null, instrumental: null },
  presentation: { onAudioEnd: "title", onLyricsEnd: "title", titleSlideIndex: 0 },
  slides: [
    { index: 0, sourceCandidateIndex: 0, start: 0, end: 8.25, kind: "title", text: ["Cantad alegres", "al Señor"], caption: "Salmo 100:1–5" },
    { index: 1, sourceCandidateIndex: 3, start: 8.25, end: 52.25, kind: "lyrics", text: ["Cantad alegres al Señor,", "mortales todos por doquier;"], caption: "1" },
  ],
  quality: { status: "reviewed", flags: [] },
};

function playback(patch: Partial<PlaybackState> = {}): PlaybackState {
  return {
    hymn: { id: "001", number: 1, title: hymn.title },
    track: "vocal",
    tracks: { vocal: true, instrumental: true },
    status: "playing",
    position: 10,
    duration: 118.84,
    volume: 0.8,
    currentSlide: 1,
    nextSlide: null,
    presentation: "normal",
    black: false,
    lyricsHidden: false,
    cue: null,
    audioOutput: true,
    notice: null,
    selectedTrack: "vocal",
    ...patch,
  };
}

describe("buildStageView", () => {
  it("muestra fondo y letra en modo normal", () => {
    const view = buildStageView(playback(), hymn, appearance);
    expect(view.mode).toBe("normal");
    expect(view.slide?.lines).toEqual(["Cantad alegres al Señor,", "mortales todos por doquier;"]);
    expect(view.slide?.verse).toBe("1");
    expect(view.slide?.caption).toBeNull();
    expect(view.background.id).toBe("parchment-01");
  });

  it("negro y solo fondo no muestran letra", () => {
    expect(buildStageView(playback({ presentation: "black" }), hymn, appearance)).toMatchObject({ mode: "black", slide: null });
    expect(buildStageView(playback({ presentation: "backgroundOnly" }), hymn, appearance)).toMatchObject({
      mode: "backgroundOnly",
      slide: null,
    });
  });

  it("al iniciar sin himno la proyección queda limpia", () => {
    const view = buildStageView(playback({ hymn: null, currentSlide: null, status: "idle" }), null, appearance);
    expect(view.mode).toBe("idle");
    expect(view.slide).toBeNull();
  });

  it("incluye todas las láminas del himno para un tamaño de letra común", () => {
    const view = buildStageView(playback(), hymn, appearance);
    expect(view.group?.key).toBe("001");
    expect(view.group?.slides.map((slide) => slide.key)).toEqual(["001:0", "001:1"]);
    // Se conserva en negro para no recalcular al volver.
    expect(buildStageView(playback({ presentation: "black" }), hymn, appearance).group?.slides).toHaveLength(2);
  });

  it("estrofa y referencia se controlan por separado", () => {
    const noVerse = { ...appearance, showVerseNumber: false };
    expect(buildStageView(playback(), hymn, noVerse).slide?.verse).toBeNull();
    expect(buildStageView(playback({ currentSlide: 0 }), hymn, noVerse).slide?.caption).toBe("Salmo 100:1–5");
    const noReference = { ...appearance, showReference: false };
    expect(buildStageView(playback({ currentSlide: 0 }), hymn, noReference).slide?.caption).toBeNull();
    expect(buildStageView(playback(), hymn, noReference).slide?.verse).toBe("1");
  });

  it("no muestra la letra de un himno distinto al que está al aire", () => {
    const other = playback({ hymn: { id: "002", number: 2, title: "Otro" } });
    expect(buildStageView(other, hymn, appearance).slide).toBeNull();
  });

  it("portada con número y opciones de configuración", () => {
    const title = buildStageView(playback({ currentSlide: 0 }), hymn, appearance).slide;
    expect(title).toMatchObject({ kind: "title", number: 1, caption: "Salmo 100:1–5" });
    const plain = buildStageView(playback({ currentSlide: 0 }), hymn, {
      ...appearance,
      showHymnNumber: false,
      showVerseNumber: false,
      showReference: false,
      uppercase: true,
    }).slide;
    expect(plain).toMatchObject({ number: null, caption: null, lines: ["CANTAD ALEGRES", "AL SEÑOR"] });
  });
});

describe("resolveBackground", () => {
  it("el predeterminado elegido o, si no existe, uno integrado", () => {
    expect(resolveBackground(appearance, hymn).id).toBe("parchment-01");
    expect(resolveBackground({ ...appearance, backgroundId: "no-existe" }, hymn).id).toBe("night-01");
  });

  it("color personalizado elige texto legible", () => {
    const light = resolveBackground(
      { ...appearance, backgroundMode: "default", backgroundId: "custom-color", customColor: "#fafafa" },
      null,
    );
    expect(light.textColor).toBe("#111111");
  });
});

describe("fitFontSize", () => {
  // Simula un texto cuyo ancho crece linealmente con el tamaño.
  const widthFits = (limit: number) => (size: number, wrap: boolean) => (wrap ? size * 0.5 : size) <= limit;

  it("usa el máximo si cabe", () => {
    expect(fitFontSize(widthFits(1000), 40, 90)).toEqual({ size: 90, wrap: false });
  });

  it("encuentra el tamaño intermedio más grande", () => {
    // Dividir renglones no ayuda (limita la altura, no el ancho).
    const result = fitFontSize((size) => size <= 60, 40, 90);
    expect(result.wrap).toBe(false);
    expect(result.size).toBeGreaterThan(59);
    expect(result.size).toBeLessThanOrEqual(60);
  });

  it("divide renglones solo cuando ni el mínimo alcanza", () => {
    const result = fitFontSize(widthFits(30), 40, 90);
    expect(result.wrap).toBe(true);
    expect(result.size * 0.5).toBeLessThanOrEqual(30);
  });

  it("divide renglones largos si así la letra queda claramente más grande", () => {
    // Sin dividir cabe hasta 50 (< 75 % de 90); dividiendo, hasta 90.
    const result = fitFontSize((size, wrap) => (wrap ? true : size <= 50), 40, 90);
    expect(result).toEqual({ size: 90, wrap: true });
  });

  it("no divide renglones si la letra ya es grande", () => {
    const result = fitFontSize((size, wrap) => (wrap ? true : size <= 80), 40, 90);
    expect(result.wrap).toBe(false);
    expect(result.size).toBeGreaterThan(79);
  });

  it("no divide si la ganancia es pequeña", () => {
    const result = fitFontSize((size, wrap) => (wrap ? size <= 55 : size <= 50), 40, 90);
    expect(result.wrap).toBe(false);
  });

  it("nunca devuelve un tamaño que no cabe mientras sea posible", () => {
    const result = fitFontSize((size) => size <= 20, 40, 90);
    expect(result.size).toBeLessThanOrEqual(28);
  });
});
