# Himnario Adventista Desktop

Aplicación de escritorio para reproducir los himnos con audio **cantado** o
**instrumental** y proyectar la letra sincronizada en una segunda pantalla.
Funciona sin Internet en Windows, Linux y macOS.

No es un reproductor de videos: los 613 MKV originales solo fueron la fuente de
la migración. La aplicación usa **audio + letra + tiempos + metadatos** y dibuja
la proyección en tiempo real.

```text
Rust (Tauri 2)          audio (rodio), estado real, contenido, configuración, ventanas
React + TypeScript      ventana del operador y ventana de proyección (solo dibujan)
content/                catálogo, 613 documentos hymn.json y 1226 pistas de audio
```

## Uso durante un culto

1. Conectar el proyector y pulsar **Presentar** con el monitor elegido (la
   elección se recuerda; al iniciar se vuelve a presentar sola).
2. Escribir el número (`249`) y pulsar **Enter**. El himno queda **listo**, no suena.
3. Pulsar **Espacio** (o ▶) para reproducir.

| Tecla | Acción |
|---|---|
| Espacio | Reproducir / pausa |
| Ctrl/Cmd + ← / → | −10 s / +10 s |
| ← / → · RePág / AvPág | Pantalla anterior / siguiente (útil con presentadores inalámbricos) |
| B | Pantalla negra |
| L | Ocultar / mostrar letra (queda el fondo) |
| T | Cambiar Cantado / Instrumental |
| Inicio · S | Desde el inicio · Detener |
| 0–9, `/`, Ctrl/Cmd + K | Buscar |
| Esc | Salir del buscador o de pantalla completa |

El tema de la ventana del operador (oscuro o claro) se cambia con el botón
☀/☾ de la barra superior o en Configuración → Interfaz. No sigue al tema del
sistema y no afecta a la proyección.

Si se elige otro himno mientras uno suena, **no se interrumpe**: el nuevo queda
"Preparado" (con el audio precargado) hasta pulsar **Cambiar ahora**. Con
**doble clic** en la lista (o **Ctrl/Cmd + Enter** en el buscador) el himno
pasa al aire de inmediato: el actual se detiene y el nuevo queda listo para PLAY.

**Cantado / Instrumental** es una elección que se mantiene: cambiarla mientras
suena cambia la pista al aire conservando el tiempo, y todos los himnos que se
pongan después usan esa pista. "Pista al abrir la aplicación" (Configuración →
Audio) solo decide con cuál arranca.

El buscador encuentra por número y título. La casilla **Buscar en la letra**
amplía la búsqueda a la letra (se recuerda); si un título no aparece, la lista
ofrece buscar también en la letra.

### Vista compacta

El botón ⤡ junto al tema cambia a una ventana pequeña (sin vista previa ni
láminas) con buscador, selector de pista, reproductor, Letra/Negro y
Presentar. El ▶ de cada fila **reproduce ese himno al momento**, aunque otro
esté sonando; sobre el himno al aire reanuda si está en pausa y no hace nada si
ya suena. ⤢ vuelve a la vista completa. Cada vista recuerda su tamaño y
posición, y la aplicación abre en la última vista usada. En Configuración →
Interfaz se puede mantener la ventana compacta encima de las demás.

## Requisitos de desarrollo

- Node.js 22 o posterior y npm.
- Rust estable (1.82+).
- Dependencias de Tauri 2 del sistema ([guía](https://v2.tauri.app/start/prerequisites/)):
  - Linux: `libwebkit2gtk-4.1-dev librsvg2-dev patchelf libasound2-dev`.
  - Windows: Microsoft C++ Build Tools y WebView2.
  - macOS: Xcode Command Line Tools.
- Para regenerar contenido: los resultados del pipeline en `../migration-output`.

La aplicación **no** necesita FFmpeg, ffprobe, OCR ni los MKV.

## Instalación y modo desarrollo

```sh
npm install
npm run content:build      # arma content/ desde ../migration-output (hard links, ~1 s)
npm run tauri:dev
```

`content/` no se versiona (≈3.3 GB). En desarrollo la app lo lee directamente
del repositorio; también acepta `HIMNARIO_CONTENT_DIR=/ruta/a/content`.

Para una prueba de humo automática sobre el motor real (reproduce 30 s a
volumen bajo y deja el resultado en el log con el prefijo `SMOKE`):

```sh
HIMNARIO_SMOKE=1 npm run tauri:dev
```

## Estructura

```text
src/                        React (UI)
├── windows/                OperatorWindow, ProjectionWindow
├── features/
│   ├── hymns/              buscador y lista
│   ├── player/             transporte, línea de tiempo, volumen
│   ├── presentation/       Stage (render único), fondos, ajuste de texto
│   ├── projection/         monitores, presentar, recuperar
│   ├── settings/           panel de configuración
│   └── operator/           panel central, atajos
├── stores/appStore.ts      reflejo del estado emitido por Rust
├── lib/                    ipc tipado, búsqueda, formato
├── i18n/                   textos (es)
└── types/domain.ts         tipos compartidos (espejo de Rust)
src-tauri/src/              Rust
├── audio/                  motor rodio (trait AudioBackend)
├── playback/               sesión (fuente de verdad), cálculo de pantalla, difusión
├── content/                modelo hymn.json v1, catálogo, validación
├── presentation/           ventana de proyección y monitores
├── settings/               preferencias persistentes
└── commands/               comandos IPC
tools/                      construcción/validación de contenido, fondos, portátil
docs/                       arquitectura, formato, compilación, pruebas, licencias
```

## Compilar

```sh
npm run tauri:build                 # macOS (.app/.dmg) y Linux (.deb/.rpm/.AppImage) con contenido
npm run tauri:build:app             # solo el ejecutable, sin instalador
npm run package:portable            # ejecutable + content/ en release/ (recomendado en Windows)
```

Detalles por sistema, limitaciones de tamaño de los instaladores de Windows y
firma: [docs/building.md](docs/building.md).

## Pruebas

```sh
npm run test:all      # tipos + Vitest + cargo test
```

Incluye una prueba que decodifica y hace seek en las 1226 pistas reales cuando
existe `content/`. Lista de verificación manual (doble monitor, desconexión,
etc.): [docs/testing.md](docs/testing.md).

## Doble monitor

1. Conectar el segundo monitor/proyector. La app lo detecta en ~2 s.
2. Elegirlo en la barra superior y pulsar **Presentar**.
3. **Salir de pantalla completa** deja la proyección como ventana (se puede
   arrastrar desde cualquier punto). **Recuperar ventana** la trae siempre a la
   pantalla principal.
4. Si el monitor se desconecta, la proyección vuelve sola a la pantalla
   principal en modo ventana; el audio no se detiene.

Con un solo monitor se puede probar con **Mostrar ventana** (modo ventana).

## Contenido y calidad

- 5 himnos provienen de la revisión humana del pipeline (001, 021, 041, 479 y
  384, este último aún como borrador del pipeline).
- 608 son **borradores automáticos**: tiempos del detector de escenas y letra
  del catálogo alineada con OCR. Se muestran con la etiqueta **Borrador**.
- La revisión continúa en la mesa del pipeline (`sandbox/03-slide-detector`,
  `npm run review`). Tras aprobar himnos: `npm run content:build`.

Formato: [docs/content-format.md](docs/content-format.md).

## Solución de problemas

| Síntoma | Qué hacer |
|---|---|
| "No se encontró el contenido" | Falta `content/` junto al ejecutable o en los recursos. En desarrollo: `npm run content:build`. |
| "No hay salida de audio" | Revisar altavoces/dispositivo predeterminado; la app reintenta cada 3 s sola. |
| La proyección no aparece | **Recuperar ventana**. Luego elegir el monitor y **Presentar**. |
| La letra no coincide con el Instrumental | Algunas pistas instrumentales tienen otro arreglo (aviso "Duraciones diferentes" en el himno). |
| Configuración rara | Configuración → Información → Restablecer. Si el archivo se daña, la app lo respalda y usa valores predeterminados. |
| Linux sin sonido | Instalar `libasound2`; con PipeWire, el paquete `pipewire-alsa`. |

Logs (rotan a 2 MB, se conservan 5):

- Windows: `%LOCALAPPDATA%\org.himnario.desktop\logs\himnario.log`
- macOS: `~/Library/Logs/org.himnario.desktop/himnario.log`
- Linux: `~/.local/share/org.himnario.desktop/logs/himnario.log`

La ruta exacta aparece en Configuración → Información.
