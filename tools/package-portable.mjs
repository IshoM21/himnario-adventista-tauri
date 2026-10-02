#!/usr/bin/env node

// Arma una distribución portátil: ejecutable + content/ en la misma carpeta.
// Es la vía recomendada en Windows, donde los instaladores MSI (WiX) y NSIS
// no admiten datos de más de 2 GB, y sirve igual en Linux y macOS.
//
//   npm run tauri:build:app      (compila sin instalador)
//   npm run package:portable     (arma release/himnario-adventista-<os>-<arch>/)
//
// Compilación cruzada para Windows desde macOS/Linux (ver docs/building.md):
//   npm run tauri:build:windows
//   npm run package:portable -- --target x86_64-pc-windows-msvc

import { copyFile, link, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetFlag = process.argv.indexOf("--target");
const target = targetFlag >= 0 ? process.argv[targetFlag + 1] : null;
const windows = target ? target.includes("windows") : platform() === "win32";
const exeName = windows ? "himnario-adventista.exe" : "himnario-adventista";
const binary = target
  ? join(appRoot, "src-tauri", "target", target, "release", exeName)
  : join(appRoot, "src-tauri", "target", "release", exeName);
const label = target
  ? { "x86_64-pc-windows-msvc": "windows-x64", "aarch64-pc-windows-msvc": "windows-arm64" }[target] ?? target
  : `${platform()}-${arch()}`;
const content = join(appRoot, "content");
const out = join(appRoot, "release", `himnario-adventista-${label}`);

async function linkOrCopy(source, target) {
  try {
    await link(source, target);
  } catch {
    await copyFile(source, target);
  }
}

async function copyTree(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (!/\.(mkv|mp4|mov|avi|webm)$/i.test(entry.name)) await linkOrCopy(from, to);
  }
}

try {
  await stat(binary);
} catch {
  console.error(`No existe ${relative(appRoot, binary)}. Ejecute primero: npm run ${target ? "tauri:build:windows" : "tauri:build:app"}`);
  process.exit(1);
}
try {
  await stat(join(content, "catalog.json"));
} catch {
  console.error("No existe content/catalog.json. Ejecute primero: npm run content:build");
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await copyFile(binary, join(out, exeName));
await copyTree(content, join(out, "content"));
await writeFile(
  join(out, "LEEME.txt"),
  [
    "Himnario Adventista — distribución portátil",
    "",
    `1. Mantenga juntos ${exeName} y la carpeta «content».`,
    `2. Ejecute ${exeName}.`,
    "",
    "Windows: requiere Microsoft Edge WebView2 (incluido en Windows 11; en Windows 10",
    "se instala desde https://developer.microsoft.com/microsoft-edge/webview2/).",
    "Linux: requiere libwebkit2gtk-4.1 y libasound2 (ver docs/building.md).",
    "",
  ].join("\r\n"),
);
console.log(`Distribución portátil lista en ${relative(appRoot, out)}`);
