# Formato de contenido

La aplicación consume **sin modificar** el documento `hymn.json` v1 producido
por `sandbox/03-slide-detector` (contrato: `schema/hymn.schema.json` del
pipeline). No se inventó un formato nuevo.

```text
content/
├── catalog.json          índice compacto (se carga al iniciar)
├── build-report.json     resumen de la construcción (origen, advertencias)
├── hymns/NNN.json        documento completo (se carga al seleccionar)
└── audio/NNN/
    ├── cantado.m4a       AAC-LC 44.1 kHz estéreo (stream copy del MKV)
    └── instrumental.mp3  MP3 48 kHz estéreo (stream copy del MKV)
```

El himno 479 usa `cantado.mp3`: se reconstruyó con pistas externas porque su
MKV contenía el himno 476 (ver `PILOT-20.md` del pipeline). La ruta real
siempre está en el documento.

## Hymn (`hymns/001.json`)

```jsonc
{
  "schemaVersion": 1,
  "id": "001",                        // cadena; clave del catálogo
  "number": 1,
  "title": "Cantad alegres al Señor",
  "language": "es",
  "background": { "id": "parchment-01", "overlay": 0.35 },
  "audio": {
    "vocal": {                        // AudioTrack; puede faltar
      "file": "audio/001/cantado.m4a",// relativa a content/, sin ".."
      "codec": "aac", "container": "m4a",
      "durationSeconds": 118.840363,  // duración real de la pista (ffprobe)
      "sampleRate": 44100, "channels": 2,
      "operation": "stream-copy",
      "status": "ready"               // ready | missing | invalid
    },
    "instrumental": { "file": "audio/001/instrumental.mp3", "durationSeconds": 119.064, "...": "..." }
  },
  "presentation": {
    "onAudioEnd": "title",            // al terminar el audio → portada
    "onLyricsEnd": "title",           // tras la última pantalla → portada
    "titleSlideIndex": 0
  },
  "slides": [                         // Slide[]: contiguas, desde 0 s
    {
      "index": 2,
      "sourceCandidateIndex": 3,      // cuadro de evidencia en la migración
      "start": 21.25, "end": 52.25,   // segundos, límite inferior inclusivo
      "kind": "lyrics",               // title | lyrics | chorus | refrain
      "text": ["Cantad alegres al Señor,", "mortales todos por doquier;"],
      "caption": "1"                  // estrofa, "Coro" o referencia bíblica
    }
  ],
  "quality": {
    "status": "reviewed",             // reviewed | draft | needs-review
    "flags": [{ "code": "TRACK_DURATION_DIFFERENCE", "severity": "info", "message": "…", "details": {} }]
  },
  "provenance": { "sourceFilename": "001 Cantad alegres al Señor.mkv", "...": "…" }
}
```

Reglas que aplica la app al cargar (baratas; la validación completa está en
`tools/build-content.mjs`):

- `schemaVersion` = 1; `id` y `title` no vacíos.
- Al menos una pantalla; `start ≥ 0`, `end > start`, orden creciente y
  continuidad (`slides[i].start == slides[i-1].end`, tolerancia 2 ms).
- `titleSlideIndex` dentro de rango.
- Rutas de audio relativas y seguras. Una pista `ready` cuyo archivo no existe
  se marca `missing` y la interfaz no permite elegirla.
- Campos desconocidos (como `provenance`) se ignoran.

`background.overlay` se conserva en el formato, pero el oscurecimiento
efectivo lo decide la configuración de la aplicación.

## Catálogo (`catalog.json`)

```jsonc
{
  "schemaVersion": 1,
  "collection": { "id": "himnario-adventista", "name": "Himnario Adventista" },
  "generatedAt": "2026-09-26T07:55:00.000Z",
  "hymns": [
    {
      "id": "001", "number": 1, "title": "Cantad alegres al Señor",
      "status": "reviewed",
      "tracks": { "vocal": true, "instrumental": true },
      "firstLine": "Cantad alegres al Señor,",
      "lyrics": "Cantad alegres al Señor, mortales todos por doquier; …"
    }
  ]
}
```

La interfaz normaliza `lyrics` (minúsculas, sin tildes) para buscar por letra.
Si `catalog.json` falta o está dañado, la app reconstruye el índice leyendo
`hymns/*.json` y lo avisa. La cantidad de himnos no está fija en ningún lugar.

## Settings (`settings.json` en la carpeta de configuración)

```jsonc
{
  "schemaVersion": 1,
  "language": "es",
  "theme": "dark",                   // dark | light (ventana del operador)
  "audio": { "volume": 0.8, "defaultTrack": "vocal", "lastTrack": "vocal" },   // defaultTrack: vocal | instrumental | last
  "projection": {
    "monitor": { "name": "EPSON", "x": 1920, "y": 0, "width": 1920, "height": 1080 },
    "presentOnStart": true,
    "monitorPromptAnswered": true
  },
  "appearance": {
    "fontFamily": "sans",            // sans (Source Sans 3) | serif (Literata) | system
    "fontWeight": 650,
    "maxFontSize": 0.085,            // fracción de la altura de la pantalla
    "minFontSize": 0.04,
    "lineHeight": 1.18,
    "textAlign": "center",           // center | left
    "textColor": "auto",             // auto o #rrggbb
    "marginX": 0.07, "marginY": 0.08,
    "shadow": true, "outline": false, "uppercase": false,
    "showCaption": true, "showHymnNumber": true,
    "backgroundMode": "hymn",        // hymn (el del documento) | fixed
    "backgroundId": "night-01",      // también "custom-color"
    "customColor": "#10202c",
    "overlay": 0
  },
  "operator": { "window": { "x": 100, "y": 80, "width": 1280, "height": 820, "maximized": false }, "lastHymnId": "001" }
}
```

Cualquier campo ausente toma su valor por defecto; valores fuera de rango se
corrigen al leer.

## Fondos

`src/features/presentation/backgrounds.ts`: gradientes del POC
(`parchment-01`, `dawn-01`, `garden-01`), `night-01`, seis imágenes WebP
propias (`image-*`, generadas con `npm run backgrounds:generate`) y colores
sólidos. `neutral-01` (el valor genérico del pipeline) usa el fondo
predeterminado de la configuración.

## Cómo se genera `content/`

```text
MKV ─01 analyzer─► source-analysis.json
    ─02 extractor─► audio/NNN/*.m4a|mp3        (stream copy)
    ─03 detector──► slide-candidates.json + frames
    ─03 mesa de revisión (humana)─► slides-reviewed.json + content-review.json ─► hymns/NNN/hymn.json
    ─03 generate:drafts (automático)─────────────────────────────────────────────► drafts/NNN/hymn.json
                                                                                          │
HimnarioFullClaude: npm run content:build  (humano > borrador) ──► content/ ◄────────────┘
```
