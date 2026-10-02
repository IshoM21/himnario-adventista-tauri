import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { buildStageView } from "../features/presentation/stageModel";
import { Stage } from "../features/presentation/Stage";
import { playbackShortcuts, useGlobalShortcuts } from "../features/operator/useShortcuts";
import { ipc } from "../lib/ipc";
import { run, useAppStore } from "../stores/appStore";

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

/** Oculta el puntero tras 2 s sin movimiento, para que nunca se vea en el proyector. */
function useAutoHideCursor() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer = 0;
    const move = () => {
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), 2000);
    };
    window.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("mousemove", move);
      window.clearTimeout(timer);
    };
  }, []);
  return visible;
}

export function ProjectionWindow() {
  // Solo cambia cuando cambia lo proyectado: la posición del audio no
  // provoca renders en esta ventana.
  const playback = useAppStore(
    (state) => state.playback,
    (left, right) =>
      left?.hymn?.id === right?.hymn?.id &&
      left?.currentSlide === right?.currentSlide &&
      left?.presentation === right?.presentation,
  );
  const hymn = useAppStore((state) => state.hymn);
  const appearance = useAppStore((state) => state.settings?.appearance ?? null);
  const presenting = useAppStore((state) => state.projection?.presenting ?? false);
  const { width, height } = useWindowSize();
  const cursorVisible = useAutoHideCursor();

  useGlobalShortcuts({
    ...playbackShortcuts,
    onEscape: () => {
      if (presenting) void run(() => ipc.exitPresentation());
    },
  });

  const library = useAppStore((state) => state.library);
  const view = useMemo(
    () => (appearance ? buildStageView(playback, hymn, appearance, library) : null),
    [playback, hymn, appearance, library],
  );

  // En modo ventana (sin bordes) se puede arrastrar desde cualquier punto.
  const startDrag = (event: MouseEvent) => {
    if (!presenting && event.button === 0) void getCurrentWindow().startDragging().catch(() => undefined);
  };

  return (
    <main
      className={`projection-root ${cursorVisible ? "" : "projection-root--no-cursor"}`}
      onMouseDown={startDrag}
    >
      {view && appearance ? <Stage view={view} appearance={appearance} width={width} height={height} /> : null}
    </main>
  );
}
