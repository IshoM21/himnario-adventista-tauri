# Compilación y distribución

## Preparar el contenido

```sh
npm run content:build      # ../migration-output → content/ (hard links)
npm run content:check      # sin videos, catálogo y audios coherentes
```

`content:check` se ejecuta automáticamente en `npm run tauri:build` y detiene
la compilación si encuentra un video (`.mkv`, `.mp4`…) dentro de `content/` o
`src-tauri/`, o si falta alguna pista. **Los MKV nunca se empaquetan.**

Los recursos solo se declaran en `src-tauri/tauri.bundle.conf.json`, que
`tauri:build` combina con la configuración base. Así `tauri dev` no copia 3 GB
a `target/`.

## Tamaño

| Parte | Tamaño |
|---|---|
| Ejecutable (release, macOS arm64) | ≈ 7 MB |
| Frontend (JS + CSS + fuentes + fondos) | ≈ 0.8 MB |
| Audio (1226 pistas, sin recodificar) | ≈ 3.3 GB |

Los audios son archivos normales en `content/audio`, no están dentro del binario.

## macOS (Apple Silicon)

```sh
npm run tauri:build                        # .app y .dmg
npm run tauri:build -- --bundles app       # solo .app (más rápido)
```

Salida: `src-tauri/target/release/bundle/{macos,dmg}/`. El binario queda con
firma ad-hoc; en otra Mac, Gatekeeper pedirá abrirlo con clic derecho → Abrir
hasta que se firme con un Developer ID y se notarice (`xcrun notarytool`).

Intel: `rustup target add x86_64-apple-darwin` y
`npm run tauri:build -- --target x86_64-apple-darwin` (o
`universal-apple-darwin`). No se probó en hardware Intel.

## Linux (Ubuntu, Mint, Debian, Fedora)

Dependencias de compilación (Debian/Ubuntu):

```sh
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev patchelf libasound2-dev build-essential
npm run tauri:build          # .deb, .rpm y .AppImage
```

Dependencias en tiempo de ejecución: `libwebkit2gtk-4.1-0` y `libasound2`
(`libasound2t64` en Ubuntu 24.04; con PipeWire conviene `pipewire-alsa`). El
`.deb` y el `.rpm` las declaran. Ubuntu 22.04+ / Debian 12+ / Fedora 38+ traen
WebKitGTK 4.1.

## Windows 10/11

**Limitación real:** los instaladores MSI (WiX) y NSIS no admiten datos de más
de ~2 GB, y el contenido pesa 3.3 GB. La distribución recomendada es la
**portátil** (ejecutable + carpeta `content` al lado, que la app busca primero):

```powershell
npm run tauri:build:app
npm run package:portable     # release\himnario-adventista-win32-x64\
```

Comprimir esa carpeta (7-Zip/zip) o copiarla a la computadora de la iglesia.
Requiere WebView2 (incluido en Windows 11; en Windows 10 suele estar instalado
con Edge, si no: instalador "Evergreen" de Microsoft).

### Compilación cruzada desde macOS (sin PC con Windows)

Herramientas (una vez):

```sh
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin     # descarga el CRT/SDK de Microsoft la primera vez
brew install llvm                     # clang-cl, lld-link, llvm-rc
```

Compilar y armar la carpeta portátil:

```sh
npm run tauri:build:windows           # → src-tauri/target/x86_64-pc-windows-msvc/release/himnario-adventista.exe
npm run package:portable:windows      # → release/himnario-adventista-windows-x64/
cd release && zip -0 -r himnario-adventista-windows-x64.zip himnario-adventista-windows-x64
```

El `.exe` solo importa DLLs del sistema (UCRT `api-ms-win-crt-*`, incluidas
desde Windows 10); no requiere el redistribuible de Visual C++ y WebView2Loader
va integrado. Compila desde macOS, pero **debe probarse en Windows real**.

Alternativa con instalador: generar el instalador **sin** contenido
(`npx tauri build --bundles nsis`, sin `tauri.bundle.conf.json`) y copiar
`content\` junto a `himnario-adventista.exe` en la carpeta de instalación.

## Distribución portátil en cualquier sistema

`npm run package:portable` funciona igual en Linux y macOS. La app busca el
contenido en este orden:

1. `HIMNARIO_CONTENT_DIR` (variable de entorno);
2. `content/` junto al ejecutable;
3. recursos del paquete (`.app`, `.deb`, AppImage…);
4. `content/` del repositorio (solo desarrollo).

## Integración continua

`.github/workflows/verify.yml` compila y prueba en Windows, Ubuntu 22.04 y
macOS en cada cambio (sin contenido, que no vive en git) y conserva el
ejecutable de cada sistema como artefacto.
