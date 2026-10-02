import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assignSections, validateDocument } from "./build-content.mjs";
import { parseBackgroundName } from "./import-backgrounds.mjs";

const sectionsData = JSON.parse(readFileSync(new URL("../data/sections.json", import.meta.url), "utf8"));

describe("secciones del himnario", () => {
  it("cubren del 1 al 613 sin huecos ni cruces", () => {
    const entries = Array.from({ length: 613 }, (_, index) => ({ number: index + 1 }));
    const { uncovered, overlapping } = assignSections(entries, sectionsData);
    expect(uncovered).toEqual([]);
    expect(overlapping).toEqual([]);
    expect(entries.find((entry) => entry.number === 85)).toMatchObject({ section: "jesucristo", subsection: "nacimiento-de-cristo" });
    expect(entries.find((entry) => entry.number === 244)).toMatchObject({ subsection: "consagracion" });
  });
});

describe("nombres de fondos", () => {
  const sections = sectionsData.sections;
  it("general, sección y subsección", () => {
    expect(parseBackgroundName("00 - General - Valle sereno.jpg", sections).target.level).toBe("general");
    expect(parseBackgroundName("03 - Jesucristo - Camino.jpg", sections).target).toMatchObject({ level: "section", section: "jesucristo" });
    expect(parseBackgroundName("03.01 - Nacimiento de Cristo - Estrella.png", sections).target).toMatchObject({
      level: "subsection",
      subsection: "nacimiento-de-cristo",
    });
  });
  it("avisa si el nombre no coincide y rechaza destinos inexistentes", () => {
    expect(parseBackgroundName("03 - Jesus - Camino.jpg", sections).warnings[0]).toMatch(/no coincide/);
    expect(parseBackgroundName("12 - Otra - X.jpg", sections).error).toMatch(/no existe/);
    expect(parseBackgroundName("03.20 - X - Y.jpg", sections).error).toMatch(/no tiene subsección/);
    expect(parseBackgroundName("fondo bonito.jpg", sections).error).toBeTruthy();
  });
});

const base = () => ({
  schemaVersion: 1,
  id: "001",
  number: 1,
  title: "Cantad alegres al Señor",
  audio: {
    vocal: { file: "audio/001/cantado.m4a", durationSeconds: 118.8, status: "ready" },
    instrumental: { file: "audio/001/instrumental.mp3", durationSeconds: 119.1, status: "ready" },
  },
  presentation: { titleSlideIndex: 0 },
  slides: [
    { index: 0, start: 0, end: 8.25, kind: "title", text: ["Cantad"], caption: null },
    { index: 1, start: 8.25, end: 119, kind: "lyrics", text: ["Cantad alegres al Señor,"], caption: "1" },
  ],
});
const allFiles = () => true;

describe("validateDocument", () => {
  it("acepta un documento válido", () => {
    const result = validateDocument(base(), { fileExists: allFiles });
    expect(result.errors).toEqual([]);
    expect(result.tracks).toEqual({ vocal: true, instrumental: true });
  });

  it("rechaza tiempos inválidos, desordenados o con huecos", () => {
    const inverted = base();
    inverted.slides[1].end = 5;
    expect(validateDocument(inverted, { fileExists: allFiles }).errors.join()).toMatch(/start < end/);
    const gap = base();
    gap.slides[1].start = 9;
    expect(validateDocument(gap, { fileExists: allFiles }).errors.join()).toMatch(/hueco/);
    const late = base();
    late.slides[0].start = 1;
    expect(validateDocument(late, { fileExists: allFiles }).errors.join()).toMatch(/inicia en 0/);
  });

  it("marca pistas faltantes sin bloquear el himno", () => {
    const result = validateDocument(base(), { fileExists: (file) => !file.includes("instrumental") });
    expect(result.errors).toEqual([]);
    expect(result.tracks).toEqual({ vocal: true, instrumental: false });
    expect(result.warnings.join()).toMatch(/falta el archivo/);
  });

  it("nunca acepta rutas fuera del contenido ni videos", () => {
    const escape = base();
    escape.audio.vocal.file = "../../source-videos/001.mkv";
    expect(validateDocument(escape, { fileExists: allFiles }).errors.join()).toMatch(/no permitida/);
    const video = base();
    video.audio.vocal.file = "audio/001/video.mkv";
    expect(validateDocument(video, { fileExists: allFiles }).errors.join()).toMatch(/MKV/);
  });
});
