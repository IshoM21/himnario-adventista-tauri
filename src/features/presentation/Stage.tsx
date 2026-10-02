import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { AppearanceSettings } from "../../types/domain";
import type { BackgroundDef } from "./backgrounds";
import { fitFontSize, type FitResult } from "./fitText";
import { isCornerPosition, type StageSlide, type StageView } from "./stageModel";

const FONT_STACKS: Record<AppearanceSettings["fontFamily"], string> = {
  sans: "'Source Sans 3 Variable', 'Segoe UI', 'Noto Sans', 'Helvetica Neue', Arial, sans-serif",
  serif: "'Literata Variable', Georgia, 'Noto Serif', 'Times New Roman', serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Ubuntu, sans-serif",
};

function backgroundStyle(background: BackgroundDef): CSSProperties {
  if (background.kind === "image" && background.image) {
    return { backgroundImage: `url("${background.image}")`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  return { background: background.css ?? "#000" };
}

function isLightColor(color: string): boolean {
  const value = color.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.slice(0, 6);
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return true;
  return 0.2126 * ((number >> 16) & 255) + 0.7152 * ((number >> 8) & 255) + 0.0722 * (number & 255) > 150;
}

/**
 * Versión GLOBAL de las tipografías: sube cada vez que termina de cargar una.
 * Forma parte de la clave del caché de medidas, que también es global; con una
 * versión por instancia, una vista recién creada podía reutilizar una medida
 * tomada antes de que cargara la fuente (tamaño distinto "a veces").
 */
let fontsEpoch = 0;
const fontsListeners = new Set<() => void>();
if (typeof document !== "undefined" && document.fonts) {
  const bump = () => {
    fontsEpoch += 1;
    fontsListeners.forEach((listener) => listener());
  };
  document.fonts.addEventListener("loadingdone", bump);
  void document.fonts.ready.then(bump);
}

function useFontsVersion(): number {
  const [version, setVersion] = useState(fontsEpoch);
  useEffect(() => {
    const update = () => setVersion(fontsEpoch);
    fontsListeners.add(update);
    update();
    return () => {
      fontsListeners.delete(update);
    };
  }, []);
  return version;
}

function fontsSettled(): boolean {
  return typeof document === "undefined" || !document.fonts || document.fonts.status === "loaded";
}

/**
 * Área segura: margen mínimo por lado (estándar "title-safe" de video HD).
 * Los márgenes de Configuración solo pueden ampliarlo, nunca reducirlo.
 */
export const SAFE_MARGIN = 0.05;

/** Tamaño del número de estrofa en esquina (fracción de la altura). */
const CORNER_LABEL_SIZE = 0.045;

function textStyle(appearance: AppearanceSettings, color: string): CSSProperties {
  const light = isLightColor(color);
  return {
    fontFamily: FONT_STACKS[appearance.fontFamily],
    fontWeight: appearance.fontWeight,
    lineHeight: appearance.lineHeight,
    textAlign: appearance.textAlign,
    color,
    textShadow: appearance.shadow && light ? "0 0.04em 0.14em rgba(0,0,0,.85), 0 0 0.5em rgba(0,0,0,.35)" : undefined,
    WebkitTextStroke: appearance.outline ? `0.022em ${light ? "rgba(0,0,0,.85)" : "rgba(255,255,255,.85)"}` : undefined,
    paintOrder: appearance.outline ? "stroke fill" : undefined,
  };
}

/** Marcado de una lámina. Lo usan la lámina visible y el medidor oculto. */
function SlideBody({ slide, versePosition }: { slide: StageSlide; versePosition: AppearanceSettings["versePosition"] }) {
  return (
    <>
      {slide.number != null ? <div className="stage__number">{slide.number}</div> : null}
      {slide.verse && versePosition === "above" ? <div className="stage__caption stage__caption--top">{slide.verse}</div> : null}
      <div className="stage__lines">
        {slide.lines.map((line, index) => (
          <span key={index} className="stage__line">
            {line}
          </span>
        ))}
      </div>
      {slide.verse && versePosition === "below" ? <div className="stage__caption">{slide.verse}</div> : null}
      {slide.kind === "title" && slide.caption ? <div className="stage__caption">{slide.caption}</div> : null}
    </>
  );
}

const fitCache = new Map<string, FitResult>();

/**
 * Tamaño común para todas las láminas del himno: el más grande con el que
 * TODAS caben en el área. Se mide una vez por himno/configuración/tamaño de
 * pantalla con un medidor oculto, no en cada cambio de lámina.
 */
function useGroupFit(
  measureRef: React.RefObject<HTMLDivElement | null>,
  cacheKey: string,
  boxWidth: number,
  boxHeight: number,
  min: number,
  max: number,
): FitResult | null {
  const [result, setResult] = useState<FitResult | null>(() => fitCache.get(cacheKey) ?? null);

  useLayoutEffect(() => {
    const cached = fitCache.get(cacheKey);
    if (cached) {
      setResult(cached);
      return;
    }
    const container = measureRef.current;
    if (!container || boxWidth <= 0 || boxHeight <= 0) return;
    const items = Array.from(container.children) as HTMLElement[];
    if (!items.length) {
      setResult(null);
      return;
    }
    const fits = (size: number, wrap: boolean) => {
      for (const item of items) {
        item.style.fontSize = `${size}px`;
        item.dataset.wrap = wrap ? "true" : "false";
      }
      // scrollWidth detecta una palabra más ancha que el área al dividir renglones.
      return items.every(
        (item) =>
          Math.max(item.offsetWidth, item.scrollWidth) <= boxWidth + 0.5 && item.offsetHeight <= boxHeight + 0.5,
      );
    };
    const fitted = fitFontSize(fits, min, max);
    if (fontsSettled()) {
      if (fitCache.size > 200) fitCache.clear();
      fitCache.set(cacheKey, fitted);
    }
    setResult(fitted);
  }, [cacheKey, boxWidth, boxHeight, min, max, measureRef]);

  return result;
}

/** Ancho real de cada renglón dibujado (no el de su caja de bloque). */
function renderedExtent(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  let width = rect.width;
  const range = document.createRange();
  element.querySelectorAll(".stage__line, .stage__caption, .stage__number").forEach((line) => {
    range.selectNodeContents(line);
    width = Math.max(width, range.getBoundingClientRect().width);
  });
  return { width, height: rect.height };
}

interface GuardArgs {
  areaRef: React.RefObject<HTMLDivElement | null>;
  visibleRef: React.RefObject<HTMLDivElement | null>;
  fit: FitResult | null;
  /** Himno + configuración + tamaño: la corrección vale para todo el himno. */
  groupKey: string;
  cacheKey: string;
  slideKey: string | null;
  onRemeasure: () => void;
}

interface GuardState {
  groupKey: string;
  scale: number;
  forceWrap: boolean;
  remeasured: boolean;
}

/**
 * Garantía del área segura: tras dibujar, compara la lámina REAL con el área.
 * Si sobresale (p. ej. la fuente cambió de ancho después de medir), primero
 * vuelve a medir todo el himno; si aun así no cabe, divide renglones y reduce
 * la letra lo necesario — para todo el himno, así el tamaño sigue uniforme.
 * Un ResizeObserver repite la comprobación cuando la lámina cambia de tamaño
 * (carga tardía de fuentes, escala de Windows, cambio de monitor).
 */
function useSafeAreaGuard({ areaRef, visibleRef, fit, groupKey, cacheKey, slideKey, onRemeasure }: GuardArgs) {
  const fresh: GuardState = { groupKey, scale: 1, forceWrap: false, remeasured: false };
  const [stored, setStored] = useState<GuardState>(fresh);
  const state = stored.groupKey === groupKey ? stored : fresh;
  const stateRef = useRef(state);
  stateRef.current = state;
  const remeasureRef = useRef(onRemeasure);
  remeasureRef.current = onRemeasure;

  useLayoutEffect(() => {
    const area = areaRef.current;
    const element = visibleRef.current;
    if (!area || !element || !fit) return;
    let frame = 0;
    const check = () => {
      const box = area.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const extent = renderedExtent(element);
      const overflow = Math.max(extent.width / box.width, extent.height / box.height);
      if (overflow <= 1.002) return;
      const now = stateRef.current;
      if (!now.remeasured) {
        // Primera vez: la medida pudo tomarse con otra fuente; medir de nuevo.
        fitCache.delete(cacheKey);
        setStored({ ...now, remeasured: true });
        remeasureRef.current();
        return;
      }
      // La medida sigue sin coincidir con lo dibujado: ajustar sobre lo real.
      const scale = Math.max(0.35, (now.scale / overflow) * 0.98);
      setStored({ ...now, scale, forceWrap: now.forceWrap || scale < 0.8 });
    };
    check();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    });
    observer.observe(element);
    observer.observe(area);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [areaRef, visibleRef, fit, cacheKey, slideKey, state.scale, state.forceWrap]);

  return state;
}

interface StageProps {
  view: StageView;
  appearance: AppearanceSettings;
  /** Tamaño lógico de la pantalla de proyección. */
  width: number;
  height: number;
}

/**
 * Único renderizador de fondo + letra. La proyección lo dibuja a tamaño
 * completo; la vista previa lo dibuja al mismo tamaño virtual y lo escala.
 */
export const Stage = memo(function Stage({ view, appearance, width, height }: StageProps) {
  const fontsVersion = useFontsVersion();
  const measureRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef<HTMLDivElement>(null);
  const [nonce, setNonce] = useState(0);
  const marginX = Math.max(appearance.marginX, SAFE_MARGIN) * width;
  const marginY = Math.max(appearance.marginY, SAFE_MARGIN) * height;
  // Número de estrofa en una esquina: se reserva su franja (arriba o abajo)
  // en todas las láminas, así el tamaño del himno no cambia entre ellas.
  const corner = appearance.showVerseNumber && isCornerPosition(appearance.versePosition) ? appearance.versePosition : null;
  const cornerSize = CORNER_LABEL_SIZE * height;
  const reserveTop = corner === "topLeft" || corner === "topRight" ? cornerSize * 1.5 : 0;
  const reserveBottom = corner === "bottomLeft" || corner === "bottomRight" ? cornerSize * 1.5 : 0;
  const boxWidth = Math.max(1, width - 2 * marginX);
  const boxHeight = Math.max(1, height - 2 * marginY - reserveTop - reserveBottom);
  const color = appearance.textColor === "auto" ? view.background.textColor : appearance.textColor;
  const style = textStyle(appearance, color);
  const slides = view.group?.slides ?? (view.slide ? [view.slide] : []);

  const groupKey = [
    view.group?.key ?? view.slide?.key ?? "none",
    slides.map((slide) => `${slide.number ?? ""}|${slide.caption ?? ""}|${slide.lines.join("\n")}`).join("¶"),
    appearance.fontFamily,
    appearance.fontWeight,
    appearance.lineHeight,
    appearance.maxFontSize,
    appearance.minFontSize,
    appearance.uppercase,
    appearance.showVerseNumber,
    appearance.versePosition,
    appearance.showReference,
    appearance.showHymnNumber,
    Math.round(boxWidth),
    Math.round(boxHeight),
    Math.round(height),
    fontsVersion,
  ].join("#");
  const cacheKey = `${groupKey}#${nonce}`;
  const fit = useGroupFit(
    measureRef,
    cacheKey,
    boxWidth,
    boxHeight,
    appearance.minFontSize * height,
    appearance.maxFontSize * height,
  );

  const safe = useSafeAreaGuard({
    areaRef,
    visibleRef,
    fit,
    groupKey,
    cacheKey,
    slideKey: view.slide?.key ?? null,
    onRemeasure: () => setNonce((n) => n + 1),
  });
  const fontSize = fit ? fit.size * safe.scale : 0;
  const wrap = fit ? fit.wrap || safe.forceWrap : false;

  const alignClass = `stage__text--${appearance.textAlign}`;
  return (
    <div className="stage" style={{ width, height }} data-mode={view.mode}>
      <div className="stage__background" style={backgroundStyle(view.background)} />
      {appearance.overlay > 0 ? <div className="stage__overlay" style={{ opacity: appearance.overlay }} /> : null}
      <div
        className="stage__area"
        ref={areaRef}
        style={{ inset: `${marginY + reserveTop}px ${marginX}px ${marginY + reserveBottom}px` }}
      >
        <div className="stage__measure" ref={measureRef} aria-hidden="true">
          {slides.map((slide) => (
            <div key={slide.key} className={`stage__text stage__text--${slide.kind} ${alignClass}`} style={style}>
              <SlideBody slide={slide} versePosition={appearance.versePosition} />
            </div>
          ))}
        </div>
        {view.slide && view.slide.lines.length && fit ? (
          <div
            key={view.slide.key}
            ref={visibleRef}
            className={`stage__text stage__text--${view.slide.kind} ${alignClass}`}
            style={{ ...style, fontSize: `${fontSize}px` }}
            data-wrap={wrap ? "true" : "false"}
          >
            <SlideBody slide={view.slide} versePosition={appearance.versePosition} />
          </div>
        ) : null}
      </div>
      {corner && view.slide?.verse && view.mode === "normal" ? (
        <div
          className={`stage__corner stage__corner--${corner}`}
          style={{
            ...style,
            fontSize: `${cornerSize}px`,
            top: corner.startsWith("top") ? marginY : undefined,
            bottom: corner.startsWith("bottom") ? marginY : undefined,
            left: corner.endsWith("Left") ? marginX : undefined,
            right: corner.endsWith("Right") ? marginX : undefined,
          }}
        >
          {view.slide.verse}
        </div>
      ) : null}
      {/* Siempre montado: activar el negro es solo cambiar su visibilidad. */}
      <div className="stage__black" hidden={view.mode !== "black"} />
    </div>
  );
});
