import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AppearanceSettings } from "../../types/domain";
import { Stage } from "./Stage";
import type { StageView } from "./stageModel";

interface ScaledStageProps {
  view: StageView;
  appearance: AppearanceSettings;
  /** Resolución lógica real de la proyección. */
  width: number;
  height: number;
  label?: string;
  /**
   * `width`: ocupa el ancho del contenedor (alto según la proporción).
   * `contain`: cabe completo en el ancho Y el alto disponibles del contenedor.
   */
  fit?: "width" | "contain";
  /** Elementos superpuestos a la miniatura (p. ej. el indicador de láminas). */
  children?: ReactNode;
}

/** Miniatura fiel: mismo `Stage`, mismo tamaño virtual, escalado con CSS. */
export function ScaledStage({ view, appearance, width, height, label, fit = "width", children }: ScaledStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale =
    fit === "contain"
      ? Math.max(0, Math.min(box.width / width, box.height / height))
      : box.width > 0
        ? box.width / width
        : 0;

  const stage =
    scale > 0 ? (
      <div className="scaled-stage__inner" style={{ transform: `scale(${scale})` }}>
        <Stage view={view} appearance={appearance} width={width} height={height} />
      </div>
    ) : null;

  if (fit === "contain") {
    return (
      <div ref={containerRef} className="scaled-stage-frame">
        <div
          className="scaled-stage"
          style={{ width: width * scale, height: height * scale }}
          role="img"
          aria-label={label}
        >
          {stage}
          {scale > 0 ? children : null}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="scaled-stage"
      style={{ aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label={label}
    >
      {stage}
      {scale > 0 ? children : null}
    </div>
  );
}
