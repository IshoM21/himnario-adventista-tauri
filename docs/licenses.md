# Licencias de terceros

| Componente | Versión | Licencia | Uso |
|---|---|---|---|
| Tauri, tauri-plugin-log, wry, tao | 2.11 / 2.9 / 0.55 / 0.35 | MIT o Apache-2.0 | Integración de escritorio, WebView, ventanas, logs |
| rodio | 0.22 | MIT o Apache-2.0 | Reproducción de audio |
| cpal | 0.17 | Apache-2.0 | Salida de audio del sistema |
| symphonia (mp3, aac, isomp4) | 0.5 | **MPL-2.0** | Decodificación MP3 y AAC/M4A |
| serde, serde_json, log | 1 / 1 / 0.4 | MIT o Apache-2.0 | Datos y registro |
| React, React DOM | 19 | MIT | Interfaz |
| @tauri-apps/api | 2 | MIT o Apache-2.0 | IPC |
| Source Sans 3 (@fontsource-variable) | 5.3 | SIL OFL 1.1 | Tipografía sans empaquetada |
| Literata (@fontsource-variable) | 5.3 | SIL OFL 1.1 | Tipografía serif empaquetada |

- **MPL-2.0 (symphonia):** licencia *copyleft* a nivel de archivo. Se usa sin
  modificar; distribuir la app es compatible. Si se modificaran sus archivos,
  esas modificaciones deben publicarse bajo MPL-2.0.
- **OFL 1.1:** las fuentes pueden empaquetarse y redistribuirse con la
  aplicación; no pueden venderse por separado.
- **Fondos (`src/assets/backgrounds/*.webp`) y gradientes:** obra propia,
  generados con `tools/generate-backgrounds.sh`; sin licencias de terceros.
- **Letras y audio:** material del Himnario Adventista migrado desde la
  colección original de la iglesia. El catálogo `himnario-adventista-api` se
  usó solo como referencia durante la migración y no se incluye en la app.
  Verificar los derechos de distribución del contenido antes de publicarlo
  fuera de la organización.
