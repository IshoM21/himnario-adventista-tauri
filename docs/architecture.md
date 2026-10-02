# Arquitectura

```text
                         RUST (fuente única de verdad)
   content/ ──► ContentRepository ──► Session<RodioBackend> ──► publisher (hilo)
                (índice + caché)       estado real + audio          │ evento "playback-state"
                                                                    │ ≤4/s mientras suena,
                                                                    │ exacto en cada cambio
                                                                    │ de pantalla
                        ┌───────────────────────────────────────────┴──────────┐
                        ▼                                                      ▼
               Ventana OPERADOR (React)                          Ventana PROYECCIÓN (React)
               comandos ▲  buscador, transporte,                 solo <Stage/>: fondo + letra
                        │  vista previa (<Stage/> escalado)      sin controles, sin audio
```

## Principios

1. **Un solo motor de audio, en Rust.** No hay `<audio>` en el frontend.
2. **Rust decide** qué pantalla se ve: `display_slide(posición real del audio)`.
   Ambas ventanas reciben la misma instantánea, así que nunca divergen.
3. **Las ventanas solo dibujan y envían órdenes.** Un comando devuelve y difunde
   la instantánea nueva; no hay estado de reproducción paralelo en React.
4. **Seleccionar ≠ reproducir.** Si algo suena, la selección queda en espera.

## Rust (`src-tauri/src`)

| Módulo | Responsabilidad |
|---|---|
| `audio/` | Trait `AudioBackend` y `RodioBackend` (rodio 0.22 + symphonia: AAC/M4A y MP3 sin recodificar). El dispositivo cpal vive en su propio hilo (no es `Send` en todas las plataformas); se conserva solo el `Mixer`. Si la salida falla, se reabre y se reconstruye la pista en la misma posición. |
| `playback/session.rs` | Máquina de estados: `idle → stopped → playing ⇄ paused → ended`, pista activa, espera (cue), negro, letra oculta, volumen, avisos. Probada con un backend simulado. |
| `playback/slides.rs` | Funciones puras: pantalla en una posición, retorno a portada al terminar, tiempo al próximo cambio. |
| `playback/publisher.rs` | Hilo que detecta el fin del audio y emite el estado: cada 250 ms mientras suena, despertando justo en cada límite de pantalla (+4 ms). Detenido, emite solo cambios. Los comandos lo despiertan con `unpark`. |
| `content/` | Modelo `hymn.json` v1, `catalog.json`, validación mínima en tiempo de carga, rutas seguras, marca de pistas ausentes. |
| `presentation/` | Ventana de proyección (se crea oculta al inicio y nunca se destruye), presentar en un monitor, salir, recuperar, vigilancia de monitores cada 2 s. |
| `settings/` | JSON con valores por defecto por campo, saneamiento de rangos, escritura atómica y respaldo si está dañado. |
| `commands/` | Superficie IPC. Los de ventanas son `async` para no bloquear el hilo principal. |

### Estado compartido y bloqueo

`AppState` contiene `Mutex<Session>`, `Mutex<Settings>` y el estado de la
proyección. Las secciones críticas son cortas (sin E/S de red ni esperas). Un
bloqueo envenenado por un pánico se recupera (`state::lock`) en vez de dejar la
app inutilizable durante un culto.

### Sincronización y drift

Los tiempos de `hymn.json` se midieron sobre el video; las pistas se extrajeron
por *stream copy* del mismo contenedor, por lo que comparten el origen 0 s. La
posición se lee del reproductor (`Player::get_pos`), no de un reloj aparte, así
que no hay acumulación de drift tras pausas, seeks o cambios de pista.

- Cambiar de pista conserva posición y estado (mismo origen temporal).
- Si la pista termina antes que las pantallas, la proyección vuelve a la portada.
- Si la pista continúa tras la última pantalla, la portada permanece hasta el final.
- Navegación manual (← →) = seek al inicio de la pantalla: **nunca** hay un
  modo manual desincronizado. Sin audio (himno sin pistas), la posición es
  virtual y ← → recorren las pantallas.

## React (`src`)

- `stores/appStore.ts`: copia de solo lectura de lo que emite Rust, con
  `useSyncExternalStore` y selectores. La proyección solo se vuelve a dibujar si
  cambia himno, pantalla, modo o configuración; nunca por la posición.
- `features/presentation/stageModel.ts`: función pura `(estado, himno, ajustes)
  → vista`. La usan la proyección y la vista previa.
- `Stage.tsx`: único renderizador. La vista previa lo dibuja al tamaño lógico
  real de la proyección y lo escala con CSS, por lo que el ajuste de texto es
  idéntico.
- `fitText.ts` + `Stage.tsx`: **un solo tamaño de letra por himno**. Un medidor
  oculto contiene todas las láminas del himno (incluida la portada) y se busca
  el tamaño más grande con el que todas caben, entre el mínimo y el máximo
  configurados (fracciones de la altura). Si conservar cada renglón en una
  línea obligaría a bajar del 75 % del máximo, los renglones largos se dividen
  en dos y la letra se mantiene grande. Se calcula una vez por himno,
  configuración y tamaño de pantalla (no al cambiar de lámina) y se memoriza.
- **Área segura garantizada:** margen mínimo de 5 % por lado (title-safe HD),
  los márgenes de Configuración solo lo amplían. Tras dibujar, `useSafeAreaGuard`
  mide la lámina real (cada renglón con `Range`) contra el área; si sobresale,
  vuelve a medir el himno y, si aún no coincide, divide renglones y reduce la
  letra de todo el himno. Un `ResizeObserver` repite la comprobación si la
  lámina cambia de tamaño (fuente que carga tarde, escala de Windows, monitor).
  La versión de tipografías es global y las medidas tomadas mientras cargan
  fuentes no se memorizan.
- `Timeline.tsx`: interpola la posición entre eventos con `requestAnimationFrame`
  escribiendo el DOM directamente (sin renders por cuadro).
- Negro: capa siempre montada; activarla es un cambio de `hidden` (inmediato).

## IPC

- React → Rust: comandos tipados en `src/lib/ipc.ts` (≈35).
- Rust → React: eventos `playback-state`, `settings-changed`,
  `projection-status`, `monitors-changed`, `app-notice` (`src/lib/events.ts`).
- El documento del himno (~5–10 KB) se pide una vez por cambio de himno
  (`get_current_hymn`); los eventos de progreso pesan ~400 bytes.

## Seguridad

- Capacidades: `core:default` para ambas ventanas y `core:window:allow-start-dragging`
  solo para la proyección. Sin acceso a sistema de archivos, shell ni red desde el frontend.
- CSP estricta (`default-src 'self'`); fuentes e imágenes empaquetadas.
- Las rutas de audio de los documentos se validan (sin `..` ni rutas absolutas).

## Extensión futura

- **Otras colecciones:** `catalog.json` tiene `collection`; los ids son cadenas y
  nada limita la cantidad de himnos.
- **Listas, favoritos, historial:** nuevo módulo Rust + archivo JSON junto a
  `settings.json`; la sesión ya separa "al aire" y "en espera".
- **Control remoto:** los comandos de `commands/playback.rs` son la API natural.
- **Editor de tiempos/letras:** la mesa de revisión del pipeline ya produce el formato.
- **Actualizaciones de contenido:** basta reemplazar `content/` (el índice se
  regenera si falta).
- **Fondos animados / otros idiomas:** `backgrounds.ts` e `i18n/`.
