import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { ipc } from "../../lib/ipc";
import { run, useAppStore } from "../../stores/appStore";
import type { MonitorInfo, MonitorRef } from "../../types/domain";

/** Misma lógica que `match_monitor` en Rust (nombre+posición, nombre único, geometría). */
export function matchMonitor(saved: MonitorRef | null | undefined, monitors: MonitorInfo[]): MonitorInfo | undefined {
  if (!saved) return undefined;
  const exact = monitors.find((m) => m.name === saved.name && m.x === saved.x && m.y === saved.y);
  if (exact) return exact;
  const named = monitors.filter((m) => m.name === saved.name);
  if (named.length === 1) return named[0];
  return monitors.find((m) => m.x === saved.x && m.y === saved.y && m.width === saved.width && m.height === saved.height);
}

/**
 * Botón principal de proyección.
 *  - Sin proyectar: «Proyectar» pone la proyección en pantalla completa en el
 *    monitor elegido (igual que antes).
 *  - Proyectando: «Cerrar proyección» sale de pantalla completa y oculta la
 *    ventana en un solo paso. El audio no se detiene.
 * La flecha abre el menú: elegir monitor, modo ventana y recuperación.
 */
export function ProjectButton() {
  const projection = useAppStore((s) => s.projection);
  const monitors = useAppStore((s) => s.monitors);
  const saved = useAppStore((s) => s.settings?.projection.monitor ?? null);
  const suggested = useAppStore((s) => s.suggestedMonitor);
  const [selected, setSelected] = useState<string>("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Preselección: el monitor guardado, si no el sugerido, si no el primero.
  useEffect(() => {
    if (monitors.some((m) => m.id === selected)) return;
    const preferred =
      matchMonitor(saved, monitors) ?? monitors.find((m) => m.id === suggested?.id) ?? monitors.find((m) => !m.primary) ?? monitors[0];
    setSelected(preferred?.id ?? "");
  }, [monitors, saved, suggested, selected]);

  // Cierre del menú al hacer clic fuera o con Escape (sin afectar al resto).
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const presenting = projection?.presenting ?? false;
  const visible = projection?.visible ?? false;
  const statusText = !visible
    ? t("projectionHidden")
    : presenting
      ? t("projectionPresenting", { monitor: projection?.monitor?.name ?? "?" })
      : t("projectionWindowed");

  const act = (action: () => Promise<unknown>) => {
    setOpen(false);
    void run(action);
  };

  const chooseMonitor = (id: string) => {
    setSelected(id);
    // Proyectando, elegir otro monitor mueve la proyección de inmediato.
    if (presenting) act(() => ipc.present(id));
  };

  return (
    <div className="project" ref={rootRef}>
      <div className={`project__split${presenting ? " is-live" : ""}`}>
        {presenting ? (
          <button type="button" className="project__main" onClick={() => act(() => ipc.hideProjection())}>
            <i className="project__live-dot" aria-hidden="true" />
            {t("projectionClose")}
          </button>
        ) : (
          <button
            type="button"
            className="project__main"
            disabled={!selected}
            onClick={() => act(() => ipc.present(selected))}
          >
            <Icon name="monitor" />
            {t("projectionPresent")}
          </button>
        )}
        <button
          type="button"
          className="project__toggle"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("projectionOptions")}
          title={t("projectionOptions")}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="chevronDown" size={16} />
        </button>
      </div>
      <span className={`project__status${presenting ? " is-live" : visible ? " is-windowed" : ""}`}>{statusText}</span>

      {open ? (
        <div className="menu" role="menu">
          <p className="menu__heading">{t("projectionMonitor")}</p>
          {monitors.length ? (
            monitors.map((monitor, index) => (
              <button
                key={monitor.id}
                type="button"
                role="menuitemradio"
                aria-checked={monitor.id === selected}
                className={`menu__item${monitor.id === selected ? " is-selected" : ""}`}
                onClick={() => chooseMonitor(monitor.id)}
              >
                <span className="menu__check">{monitor.id === selected ? <Icon name="check" size={16} /> : null}</span>
                <span className="menu__label">
                  {index + 1}. {monitor.name}
                  <small>
                    {monitor.width}×{monitor.height}
                    {monitor.primary ? ` · ${t("monitorPrimary")}` : ""}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="menu__empty">{t("noMonitors")}</p>
          )}
          <hr className="menu__divider" />
          {presenting ? (
            <button type="button" role="menuitem" className="menu__item" onClick={() => act(() => ipc.exitPresentation())}>
              <span className="menu__check"><Icon name="window" size={16} /></span>
              <span className="menu__label">{t("projectionExit")}</span>
            </button>
          ) : visible ? (
            <button type="button" role="menuitem" className="menu__item" onClick={() => act(() => ipc.hideProjection())}>
              <span className="menu__check"><Icon name="close" size={16} /></span>
              <span className="menu__label">{t("projectionHide")}</span>
            </button>
          ) : (
            <button type="button" role="menuitem" className="menu__item" onClick={() => act(() => ipc.showProjection())}>
              <span className="menu__check"><Icon name="window" size={16} /></span>
              <span className="menu__label">{t("projectionShow")}</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            title={t("projectionRecoverTitle")}
            onClick={() => act(() => ipc.recoverProjection())}
          >
            <span className="menu__check"><Icon name="lifebuoy" size={16} /></span>
            <span className="menu__label">
              {t("projectionRecover")}
              <small>{t("projectionRecoverTitle")}</small>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Sugerencia no bloqueante en la primera ejecución con dos pantallas. */
export function MonitorPrompt() {
  const settings = useAppStore((s) => s.settings);
  const suggested = useAppStore((s) => s.suggestedMonitor);
  const monitors = useAppStore((s) => s.monitors);
  const presenting = useAppStore((s) => s.projection?.presenting ?? false);
  if (!settings || settings.projection.monitorPromptAnswered || settings.projection.monitor || presenting) return null;
  const candidate = monitors.find((m) => m.id === suggested?.id) ?? (monitors.length > 1 ? monitors.find((m) => !m.primary) : undefined);
  if (!candidate) return null;
  const dismiss = () =>
    void run(() =>
      ipc.updateSettings({ ...settings, projection: { ...settings.projection, monitorPromptAnswered: true } }),
    );
  return (
    <div className="banner banner--info" role="status">
      <div>
        <strong>{t("monitorPromptTitle")}</strong>
        <span>{t("monitorPromptBody", { monitor: candidate.name })}</span>
      </div>
      <div className="banner__actions">
        <button type="button" className="button button--primary" onClick={() => void run(() => ipc.present(candidate.id))}>
          {t("monitorPromptYes")}
        </button>
        <button type="button" className="button" onClick={dismiss}>
          {t("monitorPromptNo")}
        </button>
      </div>
    </div>
  );
}
