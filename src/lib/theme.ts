// Tema de la ventana del operador. Se guarda en la configuración de Rust; una
// copia en localStorage evita que la ventana parpadee con el tema equivocado
// antes de recibir la configuración. La proyección nunca usa tema.

import type { Theme } from "../types/domain";

const KEY = "himnario.theme";

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Almacenamiento no disponible: solo se pierde la preferencia anticipada.
  }
}

/** Aplica el último tema conocido antes del primer render. */
export function applyStoredTheme() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";
}

const SWITCH_MS = 450;
let running: ViewTransition | null = null;

/**
 * Cambia el tema con un círculo que nace en `origin` (normalmente el botón
 * pulsado) y se expande hasta cubrir la ventana. Sin View Transitions (WebKitGTK
 * antiguo), con "reducir movimiento" o si ya hay un cambio en curso, el tema
 * cambia al instante.
 */
export function switchTheme(theme: Theme, origin?: { x: number; y: number }) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduced || !origin) {
    running?.skipTransition();
    applyTheme(theme);
    return;
  }
  running?.skipTransition();

  const { x, y } = origin;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  // Sin transiciones de color propias mientras se captura y anima: si no,
  // los colores se animarían dos veces dentro del círculo.
  root.dataset.themeSwitching = "";
  const transition = document.startViewTransition(() => applyTheme(theme));
  running = transition;
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: SWITCH_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => undefined);
  void transition.finished.finally(() => {
    if (running === transition) {
      running = null;
      delete root.dataset.themeSwitching;
    }
  });
}

/** Centro de un elemento, como origen de {@link switchTheme}. */
export function centerOf(element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
