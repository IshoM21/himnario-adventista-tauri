#!/usr/bin/env node

// Importa y optimiza los fondos de proyección.
//
//   npm run backgrounds:import                # lee ../Fondos (recursivo)
//   npm run backgrounds:import -- --source <carpeta> [--force]
//
// Convención de nombres (el número manda; el nombre de sección es control):
//   00 - General - <nombre>.jpg                 fondo general (predeterminado)
//   03 - Jesucristo - <nombre>.jpg              fondo de la sección 3
//   03.01 - Nacimiento de Cristo - <nombre>.jpg fondo de la subsección 3.1
// Varios archivos para el mismo destino se reparten entre sus himnos.
//
// Salida en backgrounds/ (versionada, ligera):
//   <id>.webp        2560×1440, recorte 16:9 centrado, WebP q82 (~50–250 KB)
//   <id>.thumb.webp  480×270 para Configuración
//   manifest.json    destino de cada fondo y color de letra recomendado
// `npm run content:build` las copia a content/backgrounds/.
//
// Requiere ImageMagick 7 (`magick`) con soporte WebP. Solo se usa al importar;
// la aplicación no lo necesita.

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(appRoot, "backgrounds");
const WIDTH = 2560;
const HEIGHT = 1440;
const THUMB = "480x270";

export function slug(value) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const NAME = /^(\d{1,2})(?:\.(\d{1,2}))?\s*-\s*(.+?)\s*-\s*(.+)$/;

/**
 * Interpreta un nombre de archivo según la convención. Devuelve el destino o
 * un error legible; nunca adivina un destino ambiguo.
 */
export function parseBackgroundName(filename, sections) {
  const stem = basename(filename, extname(filename)).normalize("NFC").trim();
  const match = stem.match(NAME);
  if (!match) return { error: "no sigue «NN - Sección - Nombre» ni «NN.MM - Subsección - Nombre»" };
  const [, sectionText, subsectionText, groupName, label] = match;
  const sectionNumber = Number(sectionText);
  if (sectionNumber === 0) {
    return { target: { level: "general", section: null, subsection: null }, label, groupName };
  }
  const section = sections.find((item) => item.number === sectionNumber);
  if (!section) return { error: `no existe la sección ${sectionNumber}` };
  const warnings = [];
  if (subsectionText == null) {
    if (slug(groupName) !== slug(section.name)) {
      warnings.push(`el nombre «${groupName}» no coincide con la sección ${sectionNumber} («${section.name}»)`);
    }
    return { target: { level: "section", section: section.id, subsection: null }, label, groupName, warnings };
  }
  const subsection = section.subsections.find((item) => item.number === Number(subsectionText));
  if (!subsection) return { error: `la sección ${sectionNumber} no tiene subsección ${Number(subsectionText)}` };
  if (slug(groupName) !== slug(subsection.name)) {
    warnings.push(`el nombre «${groupName}» no coincide con la subsección ${sectionNumber}.${subsection.number} («${subsection.name}»)`);
  }
  return { target: { level: "subsection", section: section.id, subsection: subsection.id }, label, groupName, warnings };
}

export function backgroundId(target, label) {
  const scope = target.level === "general" ? "general" : target.subsection ?? target.section;
  return `${scope}--${slug(label)}`;
}

async function* images(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* images(path);
    else if (/\.(jpe?g|png|webp|tiff?)$/i.test(entry.name) && !entry.name.startsWith(".")) yield path;
  }
}

async function newer(source, target) {
  try {
    return (await stat(target)).mtimeMs >= (await stat(source)).mtimeMs;
  } catch {
    return false;
  }
}

/** Brillo medio (0–1) de la zona central, donde va la letra. */
async function centerBrightness(file) {
  const { stdout } = await run("magick", [file, "-gravity", "center", "-crop", "70%x60%+0+0", "+repage", "-colorspace", "Gray", "-format", "%[fx:mean]", "info:"]);
  return Number.parseFloat(stdout) || 0;
}

async function main() {
  const args = process.argv.slice(2);
  const sourceFlag = args.indexOf("--source");
  const source = resolve(sourceFlag >= 0 ? args[sourceFlag + 1] : join(appRoot, "..", "Fondos"));
  const force = args.includes("--force");
  const { sections } = JSON.parse(await readFile(join(appRoot, "data", "sections.json"), "utf8"));
  await mkdir(OUT, { recursive: true });

  const manifest = [];
  const problems = [];
  const ids = new Set();
  for await (const file of images(source)) {
    const parsed = parseBackgroundName(file, sections);
    const name = relative(source, file);
    if (parsed.error) {
      problems.push(`${name}: ${parsed.error}`);
      continue;
    }
    for (const warning of parsed.warnings ?? []) console.warn(`⚠ ${name}: ${warning}`);
    let id = backgroundId(parsed.target, parsed.label);
    for (let n = 2; ids.has(id); n += 1) id = `${backgroundId(parsed.target, parsed.label)}-${n}`;
    ids.add(id);
    const output = join(OUT, `${id}.webp`);
    const thumb = join(OUT, `${id}.thumb.webp`);
    if (force || !(await newer(file, output))) {
      // Nunca se agranda: hasta 2560 px de ancho, o el ancho original si es menor.
      const { stdout } = await run("magick", ["identify", "-format", "%w %h", `${file}[0]`]);
      const [sourceWidth, sourceHeight] = stdout.trim().split(/\s+/).map(Number);
      const width = Math.min(WIDTH, sourceWidth, Math.floor((sourceHeight * 16) / 9)) & ~1;
      const height = Math.round((width * 9) / 16) & ~1;
      await run("magick", [
        file, "-auto-orient", "-colorspace", "sRGB",
        // Recorte 16:9 centrado (sin deformar) y tamaño final.
        "-resize", `${width}x${height}^`, "-gravity", "center", "-extent", `${width}x${height}`,
        "-strip", "-quality", "82", "-define", "webp:method=6", output,
      ]);
      await run("magick", [output, "-resize", THUMB, "-strip", "-quality", "70", thumb]);
      console.log(`✓ ${name} → backgrounds/${id}.webp`);
    }
    const brightness = await centerBrightness(output);
    manifest.push({
      id,
      name: parsed.label,
      file: `${id}.webp`,
      thumb: `${id}.thumb.webp`,
      target: parsed.target,
      // Letra oscura solo si el centro es claro.
      textColor: brightness > 0.62 ? "#111111" : "#ffffff",
      source: name,
    });
  }

  // Elimina salidas huérfanas (imágenes que ya no están en la fuente).
  const keep = new Set(manifest.flatMap((item) => [item.file, item.thumb, "manifest.json"]));
  for (const entry of await readdir(OUT)) {
    if (!keep.has(entry)) await rm(join(OUT, entry));
  }

  manifest.sort((left, right) => left.id.localeCompare(right.id));
  await writeFile(join(OUT, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, backgrounds: manifest }, null, 2)}\n`);
  let bytes = 0;
  for (const item of manifest) bytes += (await stat(join(OUT, item.file))).size + (await stat(join(OUT, item.thumb))).size;
  const byLevel = manifest.reduce((counts, item) => ({ ...counts, [item.target.level]: (counts[item.target.level] ?? 0) + 1 }), {});
  console.log(`Fondos: ${manifest.length} (${JSON.stringify(byLevel)}) · ${(bytes / 1e6).toFixed(1)} MB en backgrounds/`);
  if (problems.length) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`No se pudieron importar los fondos: ${error.message}`);
    process.exitCode = 1;
  });
}
