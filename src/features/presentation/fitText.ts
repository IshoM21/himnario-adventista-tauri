// Ajuste del tamaño de letra al área disponible. Se ejecuta solo cuando
// cambia el texto, la configuración o el tamaño de la pantalla (no por
// cuadro): unas 8–16 mediciones por cambio de pantalla.

export interface FitResult {
  size: number;
  /** `true` si los renglones largos se dividen en dos líneas. */
  wrap: boolean;
}

/** Por debajo de esta fracción del máximo se prefiere dividir renglones largos. */
export const PREFER_WRAP_BELOW = 0.75;
/** Dividir renglones debe ganar al menos este margen de tamaño para valer la pena. */
const WRAP_GAIN = 1.15;

/**
 * Busca el tamaño más grande (entre `min` y `max`) para el que `fits`
 * devuelve `true`.
 *
 * Se prefiere conservar cada renglón en una línea. Si para eso la letra debe
 * bajar de `PREFER_WRAP_BELOW` × máximo (renglones muy largos), se divide
 * cada renglón largo en dos cuando eso permite una letra claramente mayor:
 * legibilidad antes que conservar el corte original. Si nada cabe ni al
 * mínimo, se baja hasta 70 % del mínimo para nunca cortar texto.
 */
export function fitFontSize(
  fits: (size: number, wrap: boolean) => boolean,
  min: number,
  max: number,
  precision = 0.5,
): FitResult {
  const low = Math.max(1, Math.min(min, max));
  const high = Math.max(low, max);
  const searchSize = (wrap: boolean, floor: number): number | null => {
    if (!fits(floor, wrap)) return null;
    if (fits(high, wrap)) return high;
    let lo = floor;
    let hi = high;
    while (hi - lo > precision) {
      const mid = (lo + hi) / 2;
      if (fits(mid, wrap)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const single = searchSize(false, low);
  if (single != null && single >= high * PREFER_WRAP_BELOW) return { size: single, wrap: false };
  const wrapped = searchSize(true, low);
  if (wrapped != null && (single == null || wrapped >= single * WRAP_GAIN)) return { size: wrapped, wrap: true };
  if (single != null) return { size: single, wrap: false };
  const emergency = searchSize(true, Math.max(1, low * 0.7));
  return { size: emergency ?? Math.max(1, low * 0.7), wrap: true };
}
