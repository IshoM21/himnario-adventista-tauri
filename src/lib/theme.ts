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
