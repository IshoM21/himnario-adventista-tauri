# Pruebas

## Automáticas

```sh
npm run test:all
```

| Conjunto | Qué cubre |
|---|---|
| `cargo test` (32) | Cálculo de pantalla (límites exactos, retorno a portada, próximo cambio); sesión con backend simulado (seleccionar sin reproducir, play/pausa/seek, fin de pista, cambio de pista conservando posición, pista ausente, himno sin audio, archivo dañado, espera sin interrumpir, negro/letra sin tocar el audio, navegación manual sincronizada, reinicio/detener, volumen); carga de contenido (índice reconstruido, duplicados, JSON dañado, rutas peligrosas); configuración (valores por defecto, archivo parcial, archivo dañado con respaldo, saneamiento); emparejamiento de monitores. |
| `cargo test` con `content/` | Decodifica con el mismo motor de la app **las 1226 pistas reales**, compara su duración con el documento (±1 s) y hace seek a la mitad. |
| Vitest (30) | Búsqueda (número con/sin ceros, prefijos, tildes, letra, orden), modelo de proyección (normal/negro/solo fondo/idle, portada, mayúsculas), fondos, ajuste de texto, emparejamiento de monitores, validador de contenido (tiempos, huecos, rutas, MKV). |
| `HIMNARIO_SMOKE=1 npm run tauri:dev` | Extremo a extremo con audio real y ambas ventanas: seleccionar, play, 10 s, seek, cambio a instrumental, negro, solo fondo, siguiente pantalla, seleccionar otro himno mientras suena (espera), cambiar ahora, pausa prolongada, reanudar, detener. Resultado en el log (`SMOKE …`). |

## Plataformas probadas

| Plataforma | Resultado |
|---|---|
| macOS 27, Apple Silicon (desarrollo) | Pruebas automáticas, prueba de humo con audio real, `.app` y `.dmg` release con los 613 himnos (arranque < 1 s), distribución portátil, cierre ordenado con guardado de configuración. Pantalla completa en un proyector real: pendiente (lista manual). |
| Windows 10/11, Linux | Preparado y cubierto por CI (`verify.yml`); **pendiente de prueba en equipos reales** (audio, monitores, pantalla completa). |

## Lista de verificación manual

Marcar en cada sistema operativo y con el proyector real:

- [ ] Instalar/copiar y abrir: audio detenido, proyección limpia, ningún himno sonando.
- [ ] Buscar `001`, Enter: queda "Listo", no suena. Espacio: suena.
- [ ] Buscar por título sin tildes (`jardin oracion`) y por letra (`sublime gracia`).
- [ ] Play / Pausa varias veces.
- [ ] Seek varias veces con la barra, ±10 s y pantallas ← →: la letra siempre coincide.
- [ ] Cantado → Instrumental y regreso durante la reproducción (conserva posición).
- [ ] Himno con duraciones distintas (384): aviso visible; al terminar la pista vuelve a la portada.
- [ ] Pausa prolongada (5+ min) y reanudar: posición y letra correctas.
- [ ] Negro (B) durante la reproducción: inmediato; el audio sigue. Quitar: vuelve la pantalla correcta.
- [ ] Ocultar letra (L): queda el fondo; el audio sigue.
- [ ] Elegir otro himno mientras suena: aparece "Preparado"; el actual no se corta. "Cambiar ahora".
- [ ] Presentar en el proyector: pantalla completa, sin bordes ni puntero, sin controles.
- [ ] Cambiar de monitor de presentación.
- [ ] Desconectar el proyector presentando: la proyección vuelve a la pantalla principal, aviso visible, sin crash, audio continúa.
- [ ] Reconectar y volver a presentar.
- [ ] Cerrar la ventana de proyección (Alt+F4 / Cmd+W): la música sigue; "Mostrar ventana" la reabre al instante.
- [ ] "Recuperar ventana" desde cualquier estado.
- [ ] Cambiar resolución del proyector: la letra se reacomoda sin cortarse.
- [ ] Ajustes de texto y fondo: se ven en vivo en la vista previa y en la proyección.
- [ ] Reiniciar la app: volumen, pista predeterminada, monitor (presenta solo), fondo y tamaño/posición de ventana restaurados; ningún himno suena.
- [ ] Dañar `settings.json` a mano: la app abre con valores predeterminados y avisa.
- [ ] Renombrar un audio de un himno: el himno abre, la pista aparece deshabilitada.
- [ ] Desconectar los altavoces/USB durante la reproducción: aviso y recuperación automática.
- [ ] Sin Internet: todo lo anterior funciona.
