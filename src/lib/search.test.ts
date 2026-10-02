import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../types/domain";
import { buildIndex, normalize, search } from "./search";

function entry(number: number, title: string, lyrics = ""): CatalogEntry {
  return {
    id: String(number).padStart(3, "0"),
    number,
    title,
    status: "reviewed",
    tracks: { vocal: true, instrumental: true },
    firstLine: null,
    lyrics,
  };
}

const index = buildIndex([
  entry(1, "Cantad alegres al Señor", "Cantad alegres al Señor, mortales todos por doquier"),
  entry(24, "Oh, Jesús, mi Salvador"),
  entry(240, "Castillo fuerte es nuestro Dios"),
  entry(249, "Sublime gracia", "Sublime gracia del Señor, que a un infeliz salvó"),
  entry(384, "El jardín de oración", "Hay un lugar de paz y oración"),
  entry(1000, "Himno futuro"),
]);

const numbers = (query: string) => search(index, query).map((result) => result.entry.number);

describe("normalize", () => {
  it("ignora mayúsculas, tildes y signos", () => {
    expect(normalize("¡Oh, JESÚS!  mi Salvador")).toBe("oh jesus mi salvador");
    expect(normalize("Señor")).toBe("senor");
  });
});

describe("search", () => {
  it("encuentra por número con o sin ceros", () => {
    expect(numbers("1")[0]).toBe(1);
    expect(numbers("001")[0]).toBe(1);
    expect(numbers("249")).toEqual([249]);
  });

  it("muestra primero el número exacto y luego los que empiezan igual", () => {
    expect(numbers("24")).toEqual([24, 240, 249]);
  });

  it("no limita el catálogo a 613 himnos", () => {
    expect(numbers("1000")).toEqual([1000]);
  });

  it("encuentra por título sin importar tildes ni mayúsculas", () => {
    expect(numbers("cantad alegres")).toEqual([1]);
    expect(numbers("JARDIN oracion")).toEqual([384]);
    expect(numbers("jes salv")).toEqual([24]);
  });

  it("por defecto no busca en la letra", () => {
    expect(search(index, "infeliz salvo")).toEqual([]);
  });

  it("con la casilla activa encuentra por letra cuando el título no coincide", () => {
    const results = search(index, "infeliz salvo", 200, { lyrics: true });
    expect(results.map((result) => result.entry.number)).toEqual([249]);
    expect(results[0].source).toBe("lyrics");
    expect(results[0].snippet).toContain("infeliz");
  });

  it("prioriza el título sobre la letra", () => {
    const results = search(index, "sublime gracia", 200, { lyrics: true });
    expect(results[0].source).toBe("title");
  });

  it("consulta vacía devuelve el catálogo en orden", () => {
    expect(numbers("")).toEqual([1, 24, 240, 249, 384, 1000]);
  });

  it("sin coincidencias devuelve una lista vacía", () => {
    expect(search(index, "zzzz")).toEqual([]);
  });
});

describe("búsqueda en la letra", () => {
  const lyricsIndex = buildIndex([
    entry(10, "Primero", "Al mundo paz, nació Jesús\nnació ya nuestro Rey"),
    entry(20, "Segundo", "Dios es amor y paz\nen todo el mundo"),
    entry(30, "Tercero", "El mundo gira\nla paz viene\nal final"),
    entry(40, "Cuarto", "Cielo y tierra alaben"),
  ]);
  const lyricsNumbers = (query: string, options = { lyrics: true }) =>
    search(lyricsIndex, query, 200, options).map((result) => result.entry.number);

  it("frase exacta, luego mismo renglón, luego dispersas", () => {
    expect(lyricsNumbers("al mundo paz")).toEqual([10, 30]);
    expect(lyricsNumbers("paz mundo")).toEqual([10, 20, 30]);
  });

  it("coincide con palabras completas o su inicio, no dentro de otras", () => {
    // "el" no debe coincidir dentro de "cielo".
    expect(lyricsNumbers("el mundo")).toEqual([20, 30]);
  });

  it("ignora búsquedas demasiado generales", () => {
    expect(lyricsNumbers("paz")).toEqual([]);
    expect(lyricsNumbers("nació")).toEqual([10]);
  });

  it("limita los resultados por letra", () => {
    expect(search(lyricsIndex, "mundo paz", 200, { lyrics: true, lyricsLimit: 1 })).toHaveLength(1);
  });

  it("el fragmento muestra el renglón que coincide", () => {
    expect(search(lyricsIndex, "nuestro rey", 200, { lyrics: true })[0].snippet).toBe("nació ya nuestro Rey");
  });
});
