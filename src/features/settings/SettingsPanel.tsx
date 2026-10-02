import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "../../i18n";
import { ipc } from "../../lib/ipc";
import { getState, run, useAppStore } from "../../stores/appStore";
import type { AppearanceSettings, CatalogSummary, Hymn, PlaybackState, Settings } from "../../types/domain";
import { ScaledStage } from "../presentation/ScaledStage";
import { BackgroundSettings } from "./BackgroundSettings";
import { buildStageView } from "../presentation/stageModel";

const SAMPLE_HYMN: Hymn = {
  schemaVersion: 1,
  id: "sample",
  number: 1,
  title: "Cantad alegres al Señor",
  language: "es",
  background: { id: "neutral-01", overlay: 0 },
  audio: { vocal: null, instrumental: null },
  presentation: { onAudioEnd: "title", onLyricsEnd: "title", titleSlideIndex: 0 },
  slides: [
    {
      index: 0,
      sourceCandidateIndex: null,
      start: 0,
      end: 10,
      kind: "lyrics",
      text: ["Cantad alegres al Señor,", "mortales todos por doquier;", "servidle siempre con fervor,", "obedecedle con placer."],
      caption: "1",
    },
  ],
  quality: { status: "reviewed", flags: [] },
};

const SAMPLE_PLAYBACK: PlaybackState = {
  hymn: { id: "sample", number: 1, title: SAMPLE_HYMN.title },
  track: null,
  tracks: { vocal: false, instrumental: false },
  status: "stopped",
  position: 0,
  duration: 10,
  volume: 1,
  currentSlide: 0,
  nextSlide: null,
  presentation: "normal",
  black: false,
  lyricsHidden: false,
  cue: null,
  audioOutput: true,
  notice: null,
  selectedTrack: "vocal",
};

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">{children}</span>
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

function Range({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format(value)}</output>
    </>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const percent = (value: number) => `${Math.round(value * 1000) / 10} %`;

export type SettingsSection = "interface" | "text" | "background" | "audio" | "projection";

interface SettingsPanelProps {
  catalog: CatalogSummary | null;
  /** Sección a la que se desplaza al abrir (accesos rápidos del reproductor). */
  section?: SettingsSection;
  onClose: () => void;
}

export function SettingsPanel({ catalog, section, onClose }: SettingsPanelProps) {
  const saved = useAppStore((s) => s.settings);
  const playback = useAppStore((s) => s.playback, (a, b) => a?.hymn?.id === b?.hymn?.id && a?.currentSlide === b?.currentSlide);
  const hymn = useAppStore((s) => s.hymn);
  const projection = useAppStore((s) => s.projection);
  const version = useAppStore((s) => s.version);
  const paths = useAppStore((s) => s.paths);
  const library = useAppStore((s) => s.library);
  const [draft, setDraft] = useState<Settings | null>(saved);
  const [confirmReset, setConfirmReset] = useState(false);
  const timer = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);


  const draftRef = useRef<Settings | null>(saved);

  // Solo se envían las partes que edita este panel, combinadas con la
  // configuración más reciente (p. ej. el monitor guardado al presentar
  // mientras el panel está abierto no se pierde).
  const persist = (edited: Settings) => {
    const latest = getState().settings ?? edited;
    const payload: Settings = {
      ...latest,
      appearance: edited.appearance,
      theme: edited.theme,
      ui: { ...latest.ui, alwaysOnTopCompact: edited.ui.alwaysOnTopCompact },
      audio: { ...latest.audio, defaultTrack: edited.audio.defaultTrack },
      projection: { ...latest.projection, presentOnStart: edited.projection.presentOnStart },
    };
    void run(() => ipc.updateSettings(payload));
  };

  const update = (change: (settings: Settings) => Settings) => {
    const current = draftRef.current;
    if (!current) return;
    const next = change(current);
    draftRef.current = next;
    setDraft(next);
    window.clearTimeout(timer.current);
    pending.current = true;
    timer.current = window.setTimeout(() => {
      pending.current = false;
      persist(next);
    }, 250);
  };

  // Al cerrar el panel se guarda de inmediato cualquier cambio pendiente.
  const pending = useRef(false);
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    panelRef.current?.focus();
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" });
    return () => {
      window.clearTimeout(timer.current);
      if (pending.current && draftRef.current) persistRef.current(draftRef.current);
    };
  }, []);
  const appearance = (patch: Partial<AppearanceSettings>) =>
    update((current) => ({ ...current, appearance: { ...current.appearance, ...patch } }));

  const previewView = useMemo(() => {
    if (!draft) return null;
    const useCurrent = hymn && playback?.hymn?.id === hymn.id && playback.currentSlide != null;
    return buildStageView(
      useCurrent ? { ...playback, presentation: "normal" } : SAMPLE_PLAYBACK,
      useCurrent ? hymn : SAMPLE_HYMN,
      draft.appearance,
      library,
    );
  }, [draft, hymn, playback, library]);

  if (!draft) return null;
  const a = draft.appearance;

  const reset = async () => {
    window.clearTimeout(timer.current);
    pending.current = false;
    const result = await run(() => ipc.resetSettings());
    if (result) {
      draftRef.current = result;
      setDraft(result);
    }
    setConfirmReset(false);
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings")}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="drawer__header">
          <h2>{t("settings")}</h2>
          <button type="button" className="button" onClick={onClose}>
            {t("close")}
          </button>
        </header>

        <div className="drawer__preview">
          {previewView ? (
            <ScaledStage view={previewView} appearance={a} width={projection?.width ?? 1920} height={projection?.height ?? 1080} />
          ) : null}
        </div>

        <div className="drawer__body">
          <section id="settings-interface">
            <h3>{t("sectionInterface")}</h3>
            <Field label={t("theme")} hint={t("themeHint")}>
              <div className="segmented segmented--compact" role="radiogroup" aria-label={t("theme")}>
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    role="radio"
                    aria-checked={draft.theme === theme}
                    className={`segmented__option${draft.theme === theme ? " is-active" : ""}`}
                    onClick={() => update((s) => ({ ...s, theme }))}
                  >
                    {theme === "dark" ? t("themeDark") : t("themeLight")}
                  </button>
                ))}
              </div>
            </Field>
            <Toggle
              checked={draft.ui.alwaysOnTopCompact}
              label={t("alwaysOnTopCompact")}
              onChange={(v) => update((s) => ({ ...s, ui: { ...s.ui, alwaysOnTopCompact: v } }))}
            />
            <p className="field__hint field__hint--block">{t("alwaysOnTopCompactHint")}</p>
          </section>

          <section id="settings-text">
            <h3>{t("sectionText")}</h3>
            <Field label={t("fontFamily")}>
              <select value={a.fontFamily} onChange={(e) => appearance({ fontFamily: e.target.value as AppearanceSettings["fontFamily"] })}>
                <option value="sans">{t("fontSans")}</option>
                <option value="serif">{t("fontSerif")}</option>
                <option value="system">{t("fontSystem")}</option>
              </select>
            </Field>
            <Field label={t("fontWeight")}>
              <Range value={a.fontWeight} min={300} max={900} step={50} format={String} onChange={(v) => appearance({ fontWeight: v })} />
            </Field>
            <Field label={t("maxFontSize")}>
              <Range
                value={a.maxFontSize}
                min={0.03}
                max={0.2}
                step={0.005}
                format={percent}
                onChange={(v) => appearance({ maxFontSize: v, minFontSize: Math.min(a.minFontSize, v) })}
              />
            </Field>
            <Field label={t("minFontSize")}>
              <Range
                value={a.minFontSize}
                min={0.015}
                max={0.2}
                step={0.005}
                format={percent}
                onChange={(v) => appearance({ minFontSize: Math.min(v, a.maxFontSize) })}
              />
            </Field>
            <Field label={t("lineHeight")}>
              <Range value={a.lineHeight} min={0.9} max={2} step={0.02} format={(v) => v.toFixed(2)} onChange={(v) => appearance({ lineHeight: v })} />
            </Field>
            <Field label={t("textAlign")}>
              <select value={a.textAlign} onChange={(e) => appearance({ textAlign: e.target.value as AppearanceSettings["textAlign"] })}>
                <option value="center">{t("alignCenter")}</option>
                <option value="left">{t("alignLeft")}</option>
              </select>
            </Field>
            <Field label={t("textColor")}>
              <Toggle
                checked={a.textColor === "auto"}
                label={t("textColorAuto")}
                onChange={(auto) => appearance({ textColor: auto ? "auto" : "#ffffff" })}
              />
              {a.textColor !== "auto" ? (
                <input type="color" value={a.textColor} onChange={(e) => appearance({ textColor: e.target.value })} />
              ) : null}
            </Field>
            <Field label={t("marginX")}>
              <Range value={a.marginX} min={0.05} max={0.3} step={0.005} format={percent} onChange={(v) => appearance({ marginX: v })} />
            </Field>
            <Field label={t("marginY")}>
              <Range value={a.marginY} min={0.05} max={0.3} step={0.005} format={percent} onChange={(v) => appearance({ marginY: v })} />
            </Field>
            <Field label={t("versePosition")}>
              <select
                value={a.versePosition}
                disabled={!a.showVerseNumber}
                onChange={(e) => appearance({ versePosition: e.target.value as AppearanceSettings["versePosition"] })}
              >
                <option value="above">{t("verseAbove")}</option>
                <option value="below">{t("verseBelow")}</option>
                <option value="topLeft">{t("verseTopLeft")}</option>
                <option value="topRight">{t("verseTopRight")}</option>
                <option value="bottomLeft">{t("verseBottomLeft")}</option>
                <option value="bottomRight">{t("verseBottomRight")}</option>
              </select>
            </Field>
            <div className="toggles">
              <Toggle checked={a.shadow} label={t("shadow")} onChange={(v) => appearance({ shadow: v })} />
              <Toggle checked={a.outline} label={t("outline")} onChange={(v) => appearance({ outline: v })} />
              <Toggle checked={a.uppercase} label={t("uppercase")} onChange={(v) => appearance({ uppercase: v })} />
              <Toggle checked={a.showVerseNumber} label={t("showVerseNumber")} onChange={(v) => appearance({ showVerseNumber: v })} />
              <Toggle checked={a.showReference} label={t("showReference")} onChange={(v) => appearance({ showReference: v })} />
              <Toggle checked={a.showHymnNumber} label={t("showHymnNumber")} onChange={(v) => appearance({ showHymnNumber: v })} />
            </div>
          </section>

          <section id="settings-background">
            <h3>{t("sectionBackground")}</h3>
            <BackgroundSettings appearance={a} library={library} catalog={catalog} onChange={appearance} />
            <Field label={t("overlay")}>
              <Range value={a.overlay} min={0} max={0.8} step={0.05} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => appearance({ overlay: v })} />
            </Field>
          </section>

          <section id="settings-audio">
            <h3>{t("sectionAudio")}</h3>
            <Field label={t("defaultTrack")}>
              <select
                value={draft.audio.defaultTrack}
                onChange={(e) => update((s) => ({ ...s, audio: { ...s.audio, defaultTrack: e.target.value as Settings["audio"]["defaultTrack"] } }))}
              >
                <option value="vocal">{t("defaultTrackVocal")}</option>
                <option value="instrumental">{t("defaultTrackInstrumental")}</option>
                <option value="last">{t("defaultTrackLast")}</option>
              </select>
            </Field>
          </section>

          <section id="settings-projection">
            <h3>{t("sectionProjection")}</h3>
            <p className="field__hint">
              {t("savedMonitor")}: {draft.projection.monitor?.name ?? t("noSavedMonitor")}
            </p>
            <Toggle
              checked={draft.projection.presentOnStart}
              label={t("presentOnStart")}
              onChange={(v) => update((s) => ({ ...s, projection: { ...s.projection, presentOnStart: v } }))}
            />
          </section>

          <section>
            <h3>{t("shortcuts")}</h3>
            <dl className="shortcuts">
              <dt>Espacio</dt><dd>{t("kbPlay")}</dd>
              <dt>Ctrl/Cmd + ← →</dt><dd>{t("kbSkip")}</dd>
              <dt>← → · RePág AvPág</dt><dd>{t("kbSlides")}</dd>
              <dt>B</dt><dd>{t("kbBlack")}</dd>
              <dt>L</dt><dd>{t("kbLyrics")}</dd>
              <dt>T</dt><dd>{t("kbTrack")}</dd>
              <dt>Inicio</dt><dd>{t("kbRestart")}</dd>
              <dt>S</dt><dd>{t("kbStop")}</dd>
              <dt>0–9 · / · Ctrl/Cmd + K</dt><dd>{t("kbSearch")}</dd>
              <dt>Esc</dt><dd>{t("kbEscape")}</dd>
            </dl>
          </section>

          <section>
            <h3>{t("sectionAbout")}</h3>
            <dl className="about">
              <dt>{t("version")}</dt>
              <dd>{version}</dd>
              {catalog ? (
                <>
                  <dt>{t("contentFolder")}</dt>
                  <dd>
                    {t("contentStats", { total: catalog.total, reviewed: catalog.reviewed, drafts: catalog.drafts })}
                    <code>{catalog.contentRoot}</code>
                  </dd>
                </>
              ) : null}
              <dt>{t("settingsFile")}</dt>
              <dd><code>{paths?.settingsFile}</code></dd>
              <dt>{t("logFolder")}</dt>
              <dd><code>{paths?.logDir ?? "—"}</code></dd>
            </dl>
            {confirmReset ? (
              <div className="confirm">
                <span>{t("resetConfirm")}</span>
                <button type="button" className="button button--danger" onClick={() => void reset()}>
                  {t("resetSettings")}
                </button>
                <button type="button" className="button" onClick={() => setConfirmReset(false)}>
                  {t("close")}
                </button>
              </div>
            ) : (
              <button type="button" className="button button--ghost" onClick={() => setConfirmReset(true)}>
                {t("resetSettings")}
              </button>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
