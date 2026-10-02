import { useEffect, useRef } from "react";
import { ipc } from "../../lib/ipc";
import { getState, run } from "../../stores/appStore";

export interface ShortcutHandlers {
  onTogglePlay?: () => void;
  onSkip?: (delta: number) => void;
  onPreviousSlide?: () => void;
  onNextSlide?: () => void;
  onBlack?: () => void;
  onLyrics?: () => void;
  onTrack?: () => void;
  onRestart?: () => void;
  onStop?: () => void;
  onDigit?: (digit: string) => void;
  onFocusSearch?: () => void;
  onEscape?: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  // Deslizadores y casillas no capturan letras: los atajos siguen activos.
  return !["range", "checkbox", "radio", "button"].includes(type);
}

/**
 * Atajos de teclado de ventana. Nunca actúan mientras se escribe en un campo
 * de texto (salvo Escape), para no interferir con el buscador.
 */
export function useGlobalShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const h = ref.current;
      if (event.key === "Escape") {
        h.onEscape?.();
        return;
      }
      if (event.isComposing || isTyping(event.target)) return;
      // Un deslizador con foco usa sus propias flechas.
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === "range" &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)
      ) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (event.altKey) return;

      if (mod && (event.key === "k" || event.key === "f")) {
        if (h.onFocusSearch) {
          event.preventDefault();
          h.onFocusSearch();
        }
        return;
      }
      if (mod && event.key === "ArrowLeft" && h.onSkip) {
        event.preventDefault();
        h.onSkip(-10);
        return;
      }
      if (mod && event.key === "ArrowRight" && h.onSkip) {
        event.preventDefault();
        h.onSkip(10);
        return;
      }
      if (mod) return;

      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handler = (() => {
        switch (key) {
          case " ":
            return h.onTogglePlay;
          case "ArrowLeft":
          case "PageUp":
            return h.onPreviousSlide;
          case "ArrowRight":
          case "PageDown":
            return h.onNextSlide;
          case "b":
            return h.onBlack;
          case "l":
            return h.onLyrics;
          case "t":
            return h.onTrack;
          case "Home":
            return h.onRestart;
          case "s":
            return h.onStop;
          case "/":
            return h.onFocusSearch;
          default:
            return undefined;
        }
      })();
      if (handler) {
        event.preventDefault();
        handler();
        return;
      }
      if (/^[0-9]$/.test(event.key) && h.onDigit) {
        event.preventDefault();
        h.onDigit(event.key);
      }
    };
    // Espacio sobre un botón con foco lo activaría al soltar la tecla, además
    // del atajo: se cancela esa activación nativa.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " && event.target instanceof HTMLButtonElement) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}

/** Órdenes de reproducción y presentación compartidas por ambas ventanas. */
export const playbackActions = {
  togglePlay: () => void run(() => ipc.togglePlay()),
  skip: (delta: number) => void run(() => ipc.skip(delta)),
  previousSlide: () => void run(() => ipc.previousSlide()),
  nextSlide: () => void run(() => ipc.nextSlide()),
  toggleBlack: () => void run(() => ipc.setBlack(!(getState().playback?.black ?? false))),
  toggleLyrics: () => void run(() => ipc.setLyricsHidden(!(getState().playback?.lyricsHidden ?? false))),
  toggleTrack: () => {
    const playback = getState().playback;
    if (!playback) return;
    const current = playback.track ?? playback.selectedTrack;
    const next = current === "vocal" ? "instrumental" : "vocal";
    if (playback.hymn && !playback.tracks[next]) return;
    void run(() => ipc.setTrack(next));
  },
  restart: () => void run(() => ipc.restart()),
  stop: () => void run(() => ipc.stop()),
};

export const playbackShortcuts: ShortcutHandlers = {
  onTogglePlay: playbackActions.togglePlay,
  onSkip: playbackActions.skip,
  onPreviousSlide: playbackActions.previousSlide,
  onNextSlide: playbackActions.nextSlide,
  onBlack: playbackActions.toggleBlack,
  onLyrics: playbackActions.toggleLyrics,
  onTrack: playbackActions.toggleTrack,
  onRestart: playbackActions.restart,
  onStop: playbackActions.stop,
};
