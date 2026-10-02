// Estado de cada ventana: una copia de solo lectura de lo que Rust emite.
// No hay lógica de reproducción aquí; solo se reflejan eventos y se piden
// datos a Rust. Cada ventana inicializa su propia instancia.

import { convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useRef, useSyncExternalStore } from "react";
import { buildLibrary, EMPTY_LIBRARY, type BackgroundLibrary } from "../features/presentation/backgrounds";
import { setLanguage } from "../i18n";
import { EVENTS } from "../lib/events";
import { errorMessage, ipc } from "../lib/ipc";
import type {
  AppPaths,
  Hymn,
  MonitorInfo,
  PlaybackState,
  ProjectionStatus,
  Settings,
} from "../types/domain";

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

export interface AppState {
  ready: boolean;
  fatalError: string | null;
  version: string;
  platform: string;
  playback: PlaybackState | null;
  /** `performance.now()` al recibir `playback` (para interpolar el progreso). */
  playbackAt: number;
  hymn: Hymn | null;
  settings: Settings | null;
  projection: ProjectionStatus | null;
  monitors: MonitorInfo[];
  suggestedMonitor: MonitorInfo | null;
  contentError: string | null;
  warnings: string[];
  paths: AppPaths | null;
  toasts: Toast[];
  /** Fondos importados y secciones del himnario. */
  library: BackgroundLibrary;
}

const initialState: AppState = {
  ready: false,
  fatalError: null,
  version: "",
  platform: "",
  playback: null,
  playbackAt: 0,
  hymn: null,
  settings: null,
  projection: null,
  monitors: [],
  suggestedMonitor: null,
  contentError: null,
  warnings: [],
  paths: null,
  toasts: [],
  library: EMPTY_LIBRARY,
};

type Listener = () => void;
let state: AppState = initialState;
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Suscripción con selector: el componente solo se vuelve a dibujar cuando
 * cambia el valor seleccionado (comparado con `isEqual`).
 */
export function useAppStore<T>(selector: (state: AppState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ state: AppState; value: T } | null>(null);
  const getSnapshot = () => {
    const current = getState();
    if (cache.current && cache.current.state === current) return cache.current.value;
    const value = selector(current);
    if (cache.current && isEqual(cache.current.value, value)) {
      cache.current = { state: current, value: cache.current.value };
      return cache.current.value;
    }
    cache.current = { state: current, value };
    return value;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function shallowEqual<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || !left || !right) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) =>
    Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

let toastId = 0;
export function showToast(message: string, tone: Toast["tone"] = "info") {
  const id = ++toastId;
  setState({ toasts: [...state.toasts.slice(-3), { id, message, tone }] });
  window.setTimeout(() => dismissToast(id), tone === "error" ? 7000 : 4000);
}

export function dismissToast(id: number) {
  setState({ toasts: state.toasts.filter((toast) => toast.id !== id) });
}

/** Ejecuta un comando y muestra su error al operador sin romper la UI. */
export async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (reason) {
    const message = errorMessage(reason);
    showToast(message, "error");
    void ipc.logFrontend("warn", message).catch(() => undefined);
    return undefined;
  }
}

let hymnRequest = 0;
async function syncHymn(playback: PlaybackState) {
  const wanted = playback.hymn?.id ?? null;
  if ((state.hymn?.id ?? null) === wanted) return;
  const request = ++hymnRequest;
  if (!wanted) {
    setState({ hymn: null });
    return;
  }
  try {
    const hymn = await ipc.currentHymn();
    if (request === hymnRequest) setState({ hymn });
  } catch (reason) {
    void ipc.logFrontend("error", `No se pudo obtener el himno: ${errorMessage(reason)}`).catch(() => undefined);
  }
}

export function applyPlayback(playback: PlaybackState) {
  setState({ playback, playbackAt: performance.now() });
  void syncHymn(playback);
}

let initialized: Promise<void> | null = null;

const view = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") ?? "operator" : "test";

/** Deja constancia de cada paso del arranque en el log de Rust. */
function trace(step: string) {
  void ipc.logFrontend("info", `[${view}] arranque: ${step}`).catch(() => undefined);
}

/** Rechaza si la promesa no termina a tiempo, indicando qué paso se atoró. */
function withTimeout<T>(promise: Promise<T>, step: string, ms = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`El paso «${step}» no respondió en ${ms / 1000} s.`)),
      ms,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        window.clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

/** Monitores y estado de la proyección: no bloquean la apertura de la app. */
async function loadWindowInfo() {
  try {
    const [list, projection] = await Promise.all([
      withTimeout(ipc.monitors(), "monitores"),
      withTimeout(ipc.projectionStatus(), "estado de proyección"),
    ]);
    const current = getState();
    setState({
      monitors: current.monitors.length ? current.monitors : list.monitors,
      suggestedMonitor: list.suggested,
      projection: current.projection ?? projection,
    });
    trace(`monitores listos (${list.monitors.length})`);
  } catch (reason) {
    const message = errorMessage(reason);
    void ipc.logFrontend("error", `[${view}] ${message}`).catch(() => undefined);
    if (view === "operator") showToast(`No se pudo consultar los monitores: ${message}`, "error");
  }
}

/** Fondos importados y secciones: tampoco bloquean la apertura. */
async function loadVisuals() {
  try {
    const visuals = await withTimeout(ipc.visuals(), "fondos");
    setState({ library: buildLibrary(visuals, (path) => convertFileSrc(path)) });
    trace(`fondos listos (${visuals.backgrounds.length})`);
  } catch (reason) {
    void ipc.logFrontend("warn", `[${view}] fondos no disponibles: ${errorMessage(reason)}`).catch(() => undefined);
  }
}

/** Carga el estado inicial y se suscribe a los eventos de Rust (una vez). */
export function initStore(): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    const unlisteners: UnlistenFn[] = [];
    try {
      trace("interfaz cargada");
      const subscriptions = await withTimeout(
        Promise.all([
          listen<PlaybackState>(EVENTS.playback, (event) => applyPlayback(event.payload)),
          listen<Settings>(EVENTS.settings, (event) => {
            setLanguage(event.payload.language);
            setState({ settings: event.payload });
          }),
          listen<ProjectionStatus>(EVENTS.projection, (event) => setState({ projection: event.payload })),
          listen<MonitorInfo[]>(EVENTS.monitors, (event) => setState({ monitors: event.payload })),
          listen<string>(EVENTS.notice, (event) => showToast(event.payload, "error")),
        ]),
        "suscripción a eventos",
      );
      unlisteners.push(...subscriptions);
      trace("eventos suscritos");
      const boot = await withTimeout(ipc.bootstrap(), "estado inicial");
      trace("estado inicial recibido");
      // Un evento recibido mientras se esperaba el arranque es más reciente.
      const current = getState();
      const settings = current.settings ?? boot.settings;
      setLanguage(settings.language);
      setState({
        ready: true,
        version: boot.version,
        platform: boot.platform,
        playback: current.playback ?? boot.snapshot,
        playbackAt: current.playback ? current.playbackAt : performance.now(),
        hymn: current.hymn ?? boot.hymn,
        settings,
        contentError: boot.contentError,
        warnings: boot.warnings,
        paths: boot.paths,
      });
      void loadWindowInfo();
      void loadVisuals();
    } catch (reason) {
      unlisteners.forEach((unlisten) => unlisten());
      const message = errorMessage(reason);
      void ipc.logFrontend("error", `[${view}] arranque fallido: ${message}`).catch(() => undefined);
      setState({ ready: true, fatalError: message });
    }
  })();
  return initialized;
}

// Registro de errores no capturados en el mismo log que el motor Rust.
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    void ipc.logFrontend("error", `${event.message} @ ${event.filename}:${event.lineno}`).catch(() => undefined);
  });
  window.addEventListener("unhandledrejection", (event) => {
    void ipc.logFrontend("error", `Promesa rechazada: ${errorMessage(event.reason)}`).catch(() => undefined);
  });
}
