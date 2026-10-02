// Piezas comunes de la ventana del operador (vista completa y compacta).

import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { ipc } from "../../lib/ipc";
import { applyTheme } from "../../lib/theme";
import { dismissToast, run, useAppStore } from "../../stores/appStore";
import { MonitorPrompt } from "../projection/ProjectionControls";

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span>{toast.message}</span>
          <button type="button" aria-label={t("dismiss")} onClick={() => dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Notices() {
  const notice = useAppStore((s) => s.playback?.notice ?? null);
  const audioOutput = useAppStore((s) => s.playback?.audioOutput ?? true);
  const sameMonitor = useAppStore((s) => s.projection?.sharesOperatorMonitor && s.projection.presenting);
  const warnings = useAppStore((s) => s.warnings);
  const [hiddenWarnings, setHiddenWarnings] = useState(false);
  return (
    <>
      {!audioOutput ? <div className="banner banner--error">{t("noAudioOutput")}</div> : null}
      {notice ? (
        <div className="banner banner--warning">
          <span>{notice}</span>
          <button type="button" className="button" onClick={() => void run(() => ipc.dismissNotice())}>
            {t("dismiss")}
          </button>
        </div>
      ) : null}
      {sameMonitor ? <div className="banner banner--warning">{t("projectionSameMonitor")}</div> : null}
      {warnings.length && !hiddenWarnings ? (
        <div className="banner banner--warning">
          <span>{warnings.join(" · ")}</span>
          <button type="button" className="button" onClick={() => setHiddenWarnings(true)}>
            {t("dismiss")}
          </button>
        </div>
      ) : null}
      <MonitorPrompt />
    </>
  );
}

export function ThemeToggle() {
  const settings = useAppStore((s) => s.settings);
  const theme = settings?.theme ?? "dark";
  useEffect(() => applyTheme(theme), [theme]);
  if (!settings) return null;
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? t("themeToLight") : t("themeToDark");
  return (
    <button
      type="button"
      className="icon-button icon-button--ghost"
      aria-label={label}
      title={label}
      onClick={() => void run(() => ipc.updateSettings({ ...settings, theme: next }))}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

