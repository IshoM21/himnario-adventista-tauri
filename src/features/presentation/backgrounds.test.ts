import { describe, expect, it } from "vitest";
import type { AppearanceSettings, Visuals } from "../../types/domain";
import { buildLibrary, locateHymn, resolveBackground } from "./backgrounds";

const visuals: Visuals = {
  sections: {
    schemaVersion: 1,
    sections: [
      {
        number: 1,
        id: "el-culto",
        name: "El culto",
        subsections: [
          { number: 1, id: "adoracion", name: "Adoración", from: 1, to: 21 },
          { number: 2, id: "inicio", name: "Inicio", from: 22, to: 34 },
        ],
      },
      {
        number: 3,
        id: "jesucristo",
        name: "Jesucristo",
        subsections: [{ number: 1, id: "nacimiento", name: "Nacimiento", from: 78, to: 92 }],
      },
    ],
  },
  backgrounds: [
    { id: "general--valle", name: "Valle", file: "", thumb: "", target: { level: "general", section: null, subsection: null }, textColor: "#fff", path: "g", thumbPath: "g" },
    { id: "culto--a", name: "A", file: "", thumb: "", target: { level: "section", section: "el-culto", subsection: null }, textColor: "#fff", path: "a", thumbPath: "a" },
    { id: "culto--b", name: "B", file: "", thumb: "", target: { level: "section", section: "el-culto", subsection: null }, textColor: "#fff", path: "b", thumbPath: "b" },
    { id: "nacimiento--estrella", name: "Estrella", file: "", thumb: "", target: { level: "subsection", section: "jesucristo", subsection: "nacimiento" }, textColor: "#fff", path: "n", thumbPath: "n" },
  ],
};
const library = buildLibrary(visuals, (path) => `asset://${path}`);

function appearance(patch: Partial<AppearanceSettings> = {}): AppearanceSettings {
  return {
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
    backgroundMode: "section",
    backgroundId: "general",
    sectionBackgrounds: {},
    subsectionBackgrounds: {},
    hymnBackgrounds: {},
    customColor: "#10202c",
    overlay: 0,
    ...patch,
  };
}

const hymn = (number: number) => ({ id: String(number).padStart(3, "0"), number });

describe("locateHymn", () => {
  it("encuentra sección y subsección por número", () => {
    expect(locateHymn(85, library.sections)?.subsection.id).toBe("nacimiento");
    expect(locateHymn(22, library.sections)?.section.id).toBe("el-culto");
    expect(locateHymn(500, library.sections)).toBeNull();
  });
});

describe("resolveBackground", () => {
  it("predeterminado: el fondo general importado para todos", () => {
    const a = appearance({ backgroundMode: "default" });
    expect(resolveBackground(a, hymn(85), library).id).toBe("general--valle");
    expect(resolveBackground(a, null, library).image).toBe("asset://g");
  });

  it("sección: reparte las imágenes del grupo entre himnos vecinos", () => {
    const a = appearance();
    expect(resolveBackground(a, hymn(1), library).id).toBe("culto--a");
    expect(resolveBackground(a, hymn(2), library).id).toBe("culto--b");
    expect(resolveBackground(a, hymn(3), library).id).toBe("culto--a");
  });

  it("sección sin imágenes usa el predeterminado", () => {
    expect(resolveBackground(appearance(), hymn(85), library).id).toBe("general--valle");
    expect(resolveBackground(appearance(), hymn(500), library).id).toBe("general--valle");
  });

  it("subsección con respaldo en la sección", () => {
    const a = appearance({ backgroundMode: "subsection" });
    expect(resolveBackground(a, hymn(85), library).id).toBe("nacimiento--estrella");
    expect(resolveBackground(a, hymn(22), library).id).toMatch(/^culto--/);
  });

  it("la elección manual gana a las imágenes del grupo", () => {
    const a = appearance({ backgroundMode: "subsection", subsectionBackgrounds: { nacimiento: "night-01" }, sectionBackgrounds: { "el-culto": "culto--b" } });
    expect(resolveBackground(a, hymn(85), library).id).toBe("night-01");
    expect(resolveBackground(a, hymn(1), library).id).toBe("culto--b");
  });

  it("personalizado: himno → subsección → sección → predeterminado", () => {
    const a = appearance({ backgroundMode: "custom", hymnBackgrounds: { "001": "dawn-01" } });
    expect(resolveBackground(a, hymn(1), library).id).toBe("dawn-01");
    expect(resolveBackground(a, hymn(85), library).id).toBe("nacimiento--estrella");
    expect(resolveBackground(a, hymn(2), library).id).toBe("culto--b");
  });

  it("sin fondos importados vuelve a los integrados", () => {
    expect(resolveBackground(appearance(), hymn(1)).id).toBe("night-01");
    expect(resolveBackground(appearance({ backgroundMode: "default", backgroundId: "dawn-01" }), hymn(1)).id).toBe("dawn-01");
    expect(resolveBackground(appearance({ backgroundId: "no-existe" }), hymn(1)).id).toBe("night-01");
  });
});
