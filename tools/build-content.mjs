#!/usr/bin/env node

// Arma la carpeta `content/` que empaqueta la aplicación, a partir de los
// resultados del pipeline de migración (../migration-output):
//
//   content/
//   ├── catalog.json          índice compacto (búsqueda y listado)
//   ├── build-report.json     resumen y advertencias de esta construcción
//   ├── hymns/NNN.json        documento hymn.json v1, sin cambios de formato
//   └── audio/NNN/*.m4a|mp3   pistas extraídas por stream copy
//
// Prioridad por himno: revisión humana (hymns/NNN/hymn.json) sobre borrador
// automático (drafts/NNN/hymn.json). Los audios se enlazan con hard links
// cuando es posible, así no se duplican ~3 GB en el mismo disco.
//
// Aquí vive la validación completa del catálogo (es cara y no debe correr en
// cada arranque de la aplicación).

import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function help() {
  console.log(`Uso: npm run content:build -- [opciones]

Opciones:
  --migration <carpeta>   Resultados del pipeline (por defecto: ../migration-output)
  --out <carpeta>         Destino (por defecto: ./content)
  --hymns <lista>         Solo estos números (útil en desarrollo)
  --reviewed-only         Excluye borradores automáticos
  --copy                  Copia los audios en lugar de crear hard links
  --help                  Muestra esta ayuda`);
}

function parseArgs(argv) {
  const options = {
    migration: resolve(appRoot, "..", "migration-output"),
    out: resolve(appRoot, "content"),
    only: null,
    reviewedOnly: false,
    copy: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      index += 1;
      if (argv[index] == null) throw new Error(`Falta el valor de ${flag}`);
      return argv[index];
    };
    if (flag === "--help" || flag === "-h") return { ...options, help: true };
    else if (flag === "--migration") options.migration = resolve(value());
    else if (flag === "--out") options.out = resolve(value());
    else if (flag === "--hymns") options.only = new Set(value().split(",").map((item) => Number(item.trim())));
    else if (flag === "--reviewed-only") options.reviewedOnly = true;
    else if (flag === "--copy") options.copy = true;
    else throw new Error(`Opción desconocida: ${flag}`);
  }
  return options;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function optionalJson(filename) {
  try {
    return await readJson(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`${filename}: ${error.message}`);
  }
}

async function exists(filename) {
  try {
    await stat(filename);
    return true;
  } catch {
    return false;
  }
}

function isSafeRelative(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !/^[a-zA-Z]:/.test(value)
    && value.split(/[\\/]/).every((part) => part && part !== ".." && part !== ".");
}

const KINDS = new Set(["title", "lyrics", "chorus", "refrain"]);

/** Valida un documento. Devuelve errores (bloquean) y advertencias. */
export function validateDocument(document, { fileExists }) {
  const errors = [];
  const warnings = [];
  if (document?.schemaVersion !== 1) errors.push("schemaVersion debe ser 1");
  if (!/^\d{3,}$/.test(document?.id ?? "")) errors.push("id inválido");
  if (!Number.isSafeInteger(document?.number) || document.number < 1) errors.push("number inválido");
  if (!String(document?.title ?? "").trim()) errors.push("title vacío");
  const slides = Array.isArray(document?.slides) ? document.slides : [];
  if (slides.length === 0) errors.push("no contiene pantallas");
  slides.forEach((slide, index) => {
    if (!(Number.isFinite(slide.start) && Number.isFinite(slide.end))) errors.push(`pantalla ${index}: tiempos no numéricos`);
    else if (!(slide.start >= 0 && slide.end > slide.start)) errors.push(`pantalla ${index}: start < end no se cumple`);
    if (index > 0) {
      const previous = slides[index - 1];
      if (slide.start < previous.start) errors.push(`pantalla ${index}: fuera de orden`);
      else if (Math.abs(slide.start - previous.end) > 0.002) errors.push(`pantalla ${index}: hueco o traslape`);
    }
    if (!KINDS.has(slide.kind)) errors.push(`pantalla ${index}: tipo ${slide.kind} desconocido`);
    if (!Array.isArray(slide.text)) errors.push(`pantalla ${index}: text inválido`);
    else if (slide.text.length === 0 && slide.kind !== "title") warnings.push(`pantalla ${index} sin texto`);
  });
  if (slides.length && slides[0].start !== 0) errors.push("la primera pantalla no inicia en 0");
  const titleIndex = document?.presentation?.titleSlideIndex ?? 0;
  if (slides.length && (titleIndex < 0 || titleIndex >= slides.length)) errors.push("titleSlideIndex fuera de rango");
  const tracks = {};
  for (const role of ["vocal", "instrumental"]) {
    const track = document?.audio?.[role];
    if (!track) {
      warnings.push(`sin pista ${role}`);
      tracks[role] = false;
      continue;
    }
    if (!isSafeRelative(track.file)) {
      errors.push(`ruta de audio ${role} no permitida: ${track.file}`);
      tracks[role] = false;
      continue;
    }
    if (/\.mkv$/i.test(track.file)) errors.push(`la pista ${role} apunta a un MKV`);
    if (!(track.durationSeconds > 0)) errors.push(`duración ${role} inválida`);
    const present = fileExists(track.file);
    if (!present) warnings.push(`falta el archivo ${track.file}`);
    tracks[role] = track.status === "ready" && present;
  }
  if (!tracks.vocal && !tracks.instrumental) warnings.push("no tiene ninguna pista de audio utilizable");
  return { errors, warnings, tracks };
}

function catalogEntry(document, tracks) {
  const lines = [];
  const seen = new Set();
  for (const slide of document.slides) {
    if (slide.kind === "title") continue;
    for (const line of slide.text) {
      const key = line.trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        lines.push(key);
      }
    }
  }
  return {
    id: document.id,
    number: document.number,
    title: document.title,
    status: document.quality?.status ?? "draft",
    tracks,
    firstLine: lines[0] ?? null,
    // Texto crudo, un renglón por línea: la interfaz lo normaliza al construir
    // su índice (y así distingue coincidencias dentro de un mismo renglón).
    lyrics: lines.join("\n"),
  };
}

/**
 * Asigna a cada himno su sección y subsección (la primera que contiene su
 * número). Devuelve los números sin sección y los que caen en más de una.
 */
export function assignSections(entries, sectionsData) {
  const ranges = (sectionsData?.sections ?? []).flatMap((section) =>
    section.subsections.map((subsection) => ({ section: section.id, subsection: subsection.id, from: subsection.from, to: subsection.to })),
  );
  const uncovered = [];
  const overlapping = [];
  for (const entry of entries) {
    const matches = ranges.filter((range) => entry.number >= range.from && entry.number <= range.to);
    if (!matches.length) {
      uncovered.push(entry.number);
      continue;
    }
    if (matches.length > 1) overlapping.push(entry.number);
    entry.section = matches[0].section;
    entry.subsection = matches[0].subsection;
  }
  return { uncovered, overlapping };
}

async function copyDirectory(source, target) {
  await mkdir(target, { recursive: true });
  let count = 0;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || !entry.isFile()) continue;
    await copyFile(join(source, entry.name), join(target, entry.name));
    count += 1;
  }
  return count;
}

async function linkOrCopy(source, target, copy) {
  await mkdir(dirname(target), { recursive: true });
  if (!copy) {
    try {
      await link(source, target);
      return "link";
    } catch (error) {
      if (!["EXDEV", "EPERM", "ENOTSUP", "EMLINK"].includes(error.code)) throw error;
    }
  }
  await copyFile(source, target);
  return "copy";
}

async function writeJsonAtomic(filename, value, pretty = false) {
  await mkdir(dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
  await rename(temporary, filename);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return help();
  const migration = options.migration;
  const out = options.out;
  if (out === migration || out.startsWith(`${migration}${sep}`) || migration.startsWith(`${out}${sep}`)) {
    throw new Error("La carpeta de salida no puede coincidir con la de migración");
  }
  const analysis = await readJson(join(migration, "reports", "source-analysis.json"));
  const numbers = analysis.files
    .map((file) => file.number)
    .filter((number) => !options.only || options.only.has(number))
    .sort((left, right) => left - right);

  // Reconstrucción limpia: nada obsoleto queda en el paquete.
  const staging = `${out}.staging`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(join(staging, "hymns"), { recursive: true });

  const catalog = [];
  const report = { included: [], skipped: [], errors: [], warnings: [], linkModes: {} };
  const ids = new Set();
  for (const number of numbers) {
    const id = String(number).padStart(3, "0");
    const human = await optionalJson(join(migration, "hymns", id, "hymn.json"));
    const draft = options.reviewedOnly ? null : await optionalJson(join(migration, "drafts", id, "hymn.json"));
    const document = human ?? draft;
    if (!document) {
      report.skipped.push({ id, reason: "sin hymn.json revisado ni borrador" });
      continue;
    }
    const origin = human ? "human" : "draft";
    const presentFiles = new Set();
    for (const role of ["vocal", "instrumental"]) {
      const file = document.audio?.[role]?.file;
      if (isSafeRelative(file) && (await exists(join(migration, file)))) presentFiles.add(file);
    }
    const { errors, warnings, tracks } = validateDocument(document, { fileExists: (file) => presentFiles.has(file) });
    if (document.id !== id) errors.push(`el id ${document.id} no coincide con la carpeta ${id}`);
    if (ids.has(document.id)) errors.push("id duplicado");
    if (errors.length) {
      report.errors.push({ id, origin, errors });
      continue;
    }
    ids.add(document.id);
    for (const role of ["vocal", "instrumental"]) {
      const track = document.audio?.[role];
      if (!track || !tracks[role]) continue;
      const mode = await linkOrCopy(join(migration, track.file), join(staging, track.file), options.copy);
      report.linkModes[mode] = (report.linkModes[mode] ?? 0) + 1;
    }
    await writeJsonAtomic(join(staging, "hymns", `${id}.json`), document);
    catalog.push(catalogEntry(document, tracks));
    report.included.push({ id, origin, status: document.quality?.status ?? "draft", tracks });
    if (warnings.length) report.warnings.push({ id, warnings });
  }

  if (catalog.length === 0) throw new Error("No se incluyó ningún himno");

  // Secciones (para fondos y búsqueda) y fondos de imagen importados.
  const sectionsData = await optionalJson(join(appRoot, "data", "sections.json"));
  if (sectionsData) {
    const { uncovered, overlapping } = assignSections(catalog, sectionsData);
    if (uncovered.length) report.warnings.push({ id: "sections", warnings: [`himnos sin sección: ${uncovered.join(", ")}`] });
    if (overlapping.length) {
      report.warnings.push({ id: "sections", warnings: [`himnos en más de una sección (se usa la primera): ${overlapping.join(", ")}`] });
    }
    await writeJsonAtomic(join(staging, "sections.json"), sectionsData, true);
  }
  let backgroundFiles = 0;
  if (await exists(join(appRoot, "backgrounds", "manifest.json"))) {
    backgroundFiles = await copyDirectory(join(appRoot, "backgrounds"), join(staging, "backgrounds"));
  }

  const generatedAt = new Date().toISOString();
  await writeJsonAtomic(join(staging, "catalog.json"), {
    schemaVersion: 1,
    collection: { id: "himnario-adventista", name: "Himnario Adventista" },
    generatedAt,
    hymns: catalog,
  });
  const byStatus = report.included.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const summary = {
    generatedAt,
    migration: relative(appRoot, migration) || ".",
    total: catalog.length,
    byStatus,
    human: report.included.filter((item) => item.origin === "human").length,
    drafts: report.included.filter((item) => item.origin === "draft").length,
    skipped: report.skipped.length,
    errors: report.errors.length,
    missingVocal: report.included.filter((item) => !item.tracks.vocal).map((item) => item.id),
    missingInstrumental: report.included.filter((item) => !item.tracks.instrumental).map((item) => item.id),
    linkModes: report.linkModes,
    sections: sectionsData ? sectionsData.sections.length : 0,
    backgroundFiles,
  };
  await writeJsonAtomic(join(staging, "build-report.json"), { summary, ...report }, true);

  await rm(out, { recursive: true, force: true });
  await rename(staging, out);

  console.log(`Contenido: ${summary.total} himnos (${summary.human} revisión humana, ${summary.drafts} borradores)`);
  console.log(`Estados: ${JSON.stringify(byStatus)} · audio: ${JSON.stringify(report.linkModes)}`);
  if (summary.skipped) console.log(`Omitidos sin documento: ${summary.skipped}`);
  if (summary.missingVocal.length) console.log(`Sin pista cantada: ${summary.missingVocal.join(", ")}`);
  if (summary.missingInstrumental.length) console.log(`Sin pista instrumental: ${summary.missingInstrumental.join(", ")}`);
  if (report.errors.length) {
    for (const item of report.errors) console.error(`ERROR ${item.id} (${item.origin}): ${item.errors.join("; ")}`);
    process.exitCode = 1;
  }
  console.log(`Reporte: ${relative(appRoot, join(out, "build-report.json"))}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`No se pudo construir el contenido: ${error.message}`);
    process.exitCode = 1;
  });
}
