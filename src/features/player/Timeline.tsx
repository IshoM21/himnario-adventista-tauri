import { memo, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { clamp, formatTime } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { getState, run, shallowEqual, useAppStore } from "../../stores/appStore";

/**
 * Barra de progreso. Rust emite la posición real ~4 veces por segundo; entre
 * eventos se interpola aquí con requestAnimationFrame modificando el DOM
 * directamente (sin renders de React por cuadro).
 */
export const Timeline = memo(function Timeline({ cues }: { cues: number[] }) {
  const info = useAppStore(
    (state) => ({
      status: state.playback?.status ?? "idle",
      duration: state.playback?.duration ?? 0,
      hasHymn: Boolean(state.playback?.hymn),
    }),
    shallowEqual,
  );
  const rangeRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const [dragValue, setDragValue] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;
    const paint = () => {
      const { playback, playbackAt } = getState();
      if (playback && !dragging.current) {
        const elapsed = playback.status === "playing" ? (performance.now() - playbackAt) / 1000 : 0;
        const position = clamp(playback.position + elapsed, 0, playback.duration || 0);
        const ratio = playback.duration > 0 ? position / playback.duration : 0;
        if (rangeRef.current) {
          rangeRef.current.value = String(position);
          rangeRef.current.style.setProperty("--progress", `${(ratio * 100).toFixed(3)}%`);
        }
        if (timeRef.current) timeRef.current.textContent = formatTime(position);
      }
      if (getState().playback?.status === "playing") frame = requestAnimationFrame(paint);
    };
    paint();
    // Cuando no suena, basta con repintar ante cada cambio del estado.
    return () => cancelAnimationFrame(frame);
  }, [info]);

  // Sin reproducción, repinta ante cada evento (seek en pausa, etc.). Mientras
  // suena, el valor es constante y no provoca renders: lo cubre el bucle rAF.
  const position = useAppStore((state) =>
    state.playback?.status === "playing" ? -1 : (state.playback?.position ?? 0),
  );
  useEffect(() => {
    if (position >= 0 && !dragging.current && rangeRef.current && timeRef.current) {
      const ratio = info.duration > 0 ? position / info.duration : 0;
      rangeRef.current.value = String(position);
      rangeRef.current.style.setProperty("--progress", `${(ratio * 100).toFixed(3)}%`);
      timeRef.current.textContent = formatTime(position);
    }
  }, [position, info]);

  const commit = (value: number) => {
    dragging.current = false;
    setDragValue(null);
    void run(() => ipc.seek(value));
  };

  return (
    // `display: contents`: el reloj y la barra se colocan en la cuadrícula del
    // reproductor (el reloj arriba a la derecha, la barra a todo el ancho).
    <div className="timeline">
      <span className="timeline__clock">
        <span className="timeline__time" ref={timeRef}>
          {formatTime(dragValue ?? 0)}
        </span>
        <span className="timeline__total"> / {formatTime(info.duration)}</span>
      </span>
      <div className="timeline__track">
        <input
          ref={rangeRef}
          className="timeline__range"
          type="range"
          min={0}
          max={Math.max(info.duration, 0.1)}
          step={0.05}
          disabled={!info.hasHymn}
          aria-label={t("seekLabel")}
          onPointerDown={() => (dragging.current = true)}
          onInput={(event) => {
            dragging.current = true;
            const value = Number(event.currentTarget.value);
            setDragValue(value);
            if (timeRef.current) timeRef.current.textContent = formatTime(value);
            const ratio = info.duration > 0 ? value / info.duration : 0;
            event.currentTarget.style.setProperty("--progress", `${ratio * 100}%`);
          }}
          onPointerUp={(event) => commit(Number(event.currentTarget.value))}
          onBlur={(event) => {
            if (dragging.current) commit(Number(event.currentTarget.value));
          }}
          onKeyUp={(event) => {
            if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
              commit(Number(event.currentTarget.value));
            }
          }}
        />
        <div className="timeline__cues" aria-hidden="true">
          {info.duration > 0
            ? cues.map((cue, index) => (
                <i key={index} style={{ left: `${clamp((cue / info.duration) * 100, 0, 100)}%` }} />
              ))
            : null}
        </div>
      </div>
    </div>
  );
});
