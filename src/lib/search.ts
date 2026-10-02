// Búsqueda instantánea sobre el catálogo en memoria. Con unos cientos de
// himnos basta un recorrido lineal (< 3 ms); no hace falta un motor externo.
//
// Por defecto busca por número y título. La búsqueda en la letra es opcional
// (casilla «Buscar en la letra») porque las palabras comunes aparecen en
// cientos de himnos.

import type { CatalogEntry } from "../types/domain";

/** Minúsculas, sin tildes ni signos; "ñ" se conserva como "n". */
export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

interface IndexedLine {
  text: string;
  words: string[];
}

export interface IndexedHymn {
  entry: CatalogEntry;
  title: string;
  titleWords: string[];
  /** Letra completa normalizada (para frases exactas). */
  lyrics: string;
  lines: IndexedLine[];
}

export type MatchSource = "number" | "title" | "lyrics";

export interface SearchResult {
  entry: CatalogEntry;
  source: MatchSource;
  /** Fragmento de letra que coincide (solo si `source === "lyrics"`). */
  snippet?: string;
}

export interface SearchOptions {
  /** Incluir coincidencias en la letra (debajo de las de título). */
  lyrics?: boolean;
  /** Máximo de resultados por letra. */
  lyricsLimit?: number;
}

export function buildIndex(entries: CatalogEntry[]): IndexedHymn[] {
  return entries.map((entry) => {
    const title = normalize(entry.title);
    // `lyrics` trae un renglón por línea; los catálogos antiguos, todo junto.
    const lines = (entry.lyrics ?? "")
      .split("\n")
      .map((line) => normalize(line))
      .filter(Boolean)
      .map((text) => ({ text, words: text.split(" ") }));
    return {
      entry,
      title,
      titleWords: title.split(" ").filter(Boolean),
      lyrics: lines.map((line) => line.text).join(" "),
      lines,
    };
  });
}

/** Una palabra de la búsqueda coincide con el inicio de una palabra del texto. */
const matchesWords = (words: string[], tokens: string[]) =>
  tokens.every((token) => words.some((word) => word.startsWith(token)));

/**
 * La letra solo se consulta con búsquedas específicas: dos palabras o más,
 * o una de al menos 4 letras ("dios" solo, no; "sublime gracia", sí).
 */
export function isLyricsQuery(tokens: string[]): boolean {
  return tokens.length >= 2 || (tokens[0]?.length ?? 0) >= 4;
}

function snippetFor(entry: CatalogEntry, tokens: string[]): string | undefined {
  const lines = (entry.lyrics ?? "").split("\n").filter((line) => line.trim());
  // El renglón que contiene todas las palabras; si no, el de la primera.
  const target =
    lines.find((line) => matchesWords(normalize(line).split(" "), tokens)) ??
    lines.find((line) => normalize(line).split(" ").some((word) => word.startsWith(tokens[0])));
  return target?.trim();
}

/**
 * - Solo dígitos: número exacto primero ("1" y "001" → 001), luego los que
 *   empiezan con esos dígitos ("24" → 24, 240–249).
 * - Texto: todas las palabras deben coincidir con el inicio de palabras del
 *   título. Con `lyrics`, también en la letra, en este orden: frase exacta,
 *   todas las palabras en un mismo renglón y, al final, palabras dispersas.
 */
export function search(index: IndexedHymn[], rawQuery: string, limit = 200, options: SearchOptions = {}): SearchResult[] {
  const query = rawQuery.trim();
  if (!query) return index.slice(0, limit).map((item) => ({ entry: item.entry, source: "title" }));

  if (/^\d+$/.test(query)) {
    const value = Number.parseInt(query, 10);
    const digits = String(value);
    const exact = index.filter((item) => item.entry.number === value);
    const partial = index.filter(
      (item) => item.entry.number !== value && String(item.entry.number).startsWith(digits),
    );
    return [...exact, ...partial]
      .slice(0, limit)
      .map((item) => ({ entry: item.entry, source: "number" as const }));
  }

  const normalizedQuery = normalize(query);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  if (!tokens.length) return [];

  type Scored = { item: IndexedHymn; score: number };
  const titles: Scored[] = [];
  const lyrics: Scored[] = [];
  const searchLyrics = options.lyrics === true && isLyricsQuery(tokens);
  for (const item of index) {
    if (matchesWords(item.titleWords, tokens)) {
      let score = 100;
      if (item.title.startsWith(normalizedQuery)) score += 50;
      else if (item.title.includes(normalizedQuery)) score += 25;
      titles.push({ item, score });
      continue;
    }
    if (!searchLyrics || !item.lines.length) continue;
    if (` ${item.lyrics} `.includes(` ${normalizedQuery}`)) lyrics.push({ item, score: 60 });
    else if (item.lines.some((line) => matchesWords(line.words, tokens))) lyrics.push({ item, score: 40 });
    else if (matchesWords(item.lyrics.split(" "), tokens)) lyrics.push({ item, score: 10 });
  }
  const byScore = (left: Scored, right: Scored) => right.score - left.score || left.item.entry.number - right.item.entry.number;
  titles.sort(byScore);
  lyrics.sort(byScore);
  return [
    ...titles.map(({ item }) => ({ entry: item.entry, source: "title" as const })),
    ...lyrics.slice(0, options.lyricsLimit ?? 30).map(({ item }) => ({
      entry: item.entry,
      source: "lyrics" as const,
      snippet: snippetFor(item.entry, tokens),
    })),
  ].slice(0, limit);
}
