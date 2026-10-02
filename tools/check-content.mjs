#!/usr/bin/env node

// Verificación rápida previa al empaquetado (se ejecuta en beforeBuildCommand):
//  1. ningún video (.mkv/.mp4/…) puede entrar al bundle;
//  2. catalog.json y hymns/*.json coinciden;
//  3. cada pista referenciada existe dentro de content/.
// Falla con código 1 ante cualquier problema, deteniendo `tauri build`.

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = resolve(process.argv[2] ?? join(appRoot, "content"));
const VIDEO = /\.(mkv|mp4|m4v|mov|avi|webm|ts)$/i;
const problems = [];

async function* walk(directory, skip = new Set()) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path, skip);
    else yield path;
  }
}

let totalBytes = 0;
let audioFiles = 0;
for await (const file of walk(contentRoot)) {
  if (VIDEO.test(file)) problems.push(`video dentro del contenido: ${relative(appRoot, file)}`);
  if (/\.(m4a|mp3)$/i.test(file)) {
    audioFiles += 1;
    totalBytes += (await stat(file)).size;
  }
}
for await (const file of walk(join(appRoot, "src-tauri"), new Set(["target", "gen", "node_modules"]))) {
  if (VIDEO.test(file)) problems.push(`video dentro de src-tauri: ${relative(appRoot, file)}`);
}

let catalog = null;
try {
  catalog = JSON.parse(await readFile(join(contentRoot, "catalog.json"), "utf8"));
} catch (error) {
  problems.push(`catalog.json no disponible: ${error.message}`);
}
if (catalog) {
  const ids = new Set();
  for (const entry of catalog.hymns ?? []) {
    if (ids.has(entry.id)) problems.push(`id duplicado en catálogo: ${entry.id}`);
    ids.add(entry.id);
    let document;
    try {
      document = JSON.parse(await readFile(join(contentRoot, "hymns", `${entry.id}.json`), "utf8"));
    } catch (error) {
      problems.push(`${entry.id}: documento ilegible (${error.message})`);
      continue;
    }
    for (const role of ["vocal", "instrumental"]) {
      if (!entry.tracks?.[role]) continue;
      const file = document.audio?.[role]?.file;
      try {
        await stat(join(contentRoot, file));
      } catch {
        problems.push(`${entry.id}: falta ${file}`);
      }
    }
  }
  if (!ids.size) problems.push("el catálogo está vacío");
  const reviewed = (catalog.hymns ?? []).filter((entry) => entry.status === "reviewed").length;
  console.log(`Contenido: ${ids.size} himnos (${reviewed} revisados) · ${audioFiles} pistas · ${(totalBytes / 1e9).toFixed(2)} GB`);
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error("El contenido no es apto para empaquetar. Ejecute npm run content:build.");
  process.exit(1);
}
console.log("✓ Sin videos en el paquete; catálogo y audios coherentes.");
