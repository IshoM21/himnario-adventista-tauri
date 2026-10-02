import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HymnBrowser, type HymnBrowserHandle } from "../features/hymns/HymnBrowser";
import { CompactView } from "../features/operator/CompactView";
import { Notices, ThemeToggle, Toasts } from "../features/operator/OperatorChrome";
import { StagePanel } from "../features/operator/StagePanel";
import { playbackShortcuts, useGlobalShortcuts } from "../features/operator/useShortcuts";
import { TransportBar } from "../features/player/TransportBar";
import { SettingsPanel, type SettingsSection } from "../features/settings/SettingsPanel";
import { Icon } from "../components/Icon";
import { t } from "../i18n";
import { errorMessage, ipc } from "../lib/ipc";
import { getState, run, showToast, useAppStore } from "../stores/appStore";
import type { CatalogSummary } from "../types/domain";

function ContentMissing({ message }: { message: string }) {
  return (
    <main className="fatal">
      <h1>{t("contentMissingTitle")}</h1>
      <p>{t("contentMissingHint")}</p>
      <pre>{message}</pre>
    </main>
  );
}

const EMPTY_IDS: string[] = [];

export function OperatorWindow() {
  const contentError = useAppStore((s) => s.contentError);
  const onAirId = useAppStore((s) => s.playback?.hymn?.id ?? null);
  const cueId = useAppStore((s) => s.playback?.cue?.id ?? null);
  const hymn = useAppStore((s) => s.hymn);
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | "top" | null>(null);
  const settingsOpen = settingsSection !== null;
  const setSettingsOpen = (open: boolean) => setSettingsSection(open ? "top" : null);
  const openSettings = useCallback((section?: SettingsSection) => setSettingsSection(section ?? "top"), []);
  const recentIds = useAppStore((s) => s.settings?.operator.recentHymnIds ?? EMPTY_IDS);
  const browserRef = useRef<HymnBrowserHandle>(null);

  useEffect(() => {
    if (contentError) return;
    ipc
      .catalog()
      .then(setCatalog)
      .catch((reason) => showToast(errorMessage(reason), "error"));
  }, [contentError]);

  const select = useCallback((id: string) => {
    // Un doble clic dispara dos clics: no repetir el aviso del mismo himno.
    const alreadyCued = getState().playback?.cue?.id === id;
    void run(async () => {
      const result = await ipc.select(id);
      if (result.outcome === "cued" && !alreadyCued) {
        const cue = result.snapshot.cue;
        if (cue) showToast(`${t("cueTitle")}: ${cue.number} · ${cue.title}`);
      }
      return result;
    });
  }, []);

  /** Segundo nivel: el himno pasa al aire en el momento (el actual se detiene). */
  const takeNow = useCallback((id: string) => {
    void run(async () => {
      const result = await ipc.select(id);
      return result.outcome === "cued" ? ipc.takeCue() : result.snapshot;
    });
  }, []);

  useGlobalShortcuts({
    ...(settingsOpen ? {} : playbackShortcuts),
    onDigit: settingsOpen ? undefined : (digit) => browserRef.current?.focus(digit),
    onFocusSearch: settingsOpen ? undefined : () => browserRef.current?.focus(),
    onEscape: () => {
      if (settingsOpen) setSettingsOpen(false);
      else if (getState().projection?.presenting) void run(() => ipc.exitPresentation());
    },
  });

  const settings = useAppStore((st) => st.settings);
  const compact = settings?.ui.compact ?? false;
  const lyricsSearch = settings?.ui.lyricsSearch ?? false;
  const setLyricsSearch = useCallback((value: boolean) => {
    const current = getState().settings;
    if (!current) return;
    void run(() => ipc.updateSettings({ ...current, ui: { ...current.ui, lyricsSearch: value } }));
  }, []);
  const playNow = useCallback((id: string) => void run(() => ipc.playNow(id)), []);
  const setCompact = (value: boolean) => void run(() => ipc.setCompactMode(value));

  const cues = useMemo(() => (hymn && hymn.id === onAirId ? hymn.slides.slice(1).map((slide) => slide.start) : []), [hymn, onAirId]);

  if (contentError) return <ContentMissing message={contentError} />;

  const browser = catalog ? (
    <HymnBrowser
      ref={browserRef}
      entries={catalog.hymns}
      recentIds={recentIds}
      onAirId={onAirId}
      cueId={cueId}
      onSelect={select}
      onTakeNow={takeNow}
      lyricsSearch={lyricsSearch}
      onLyricsSearchChange={setLyricsSearch}
      onPlayNow={compact ? playNow : undefined}
      showTabs={!compact}
    />
  ) : (
    <p className="sidebar__loading">{t("loading")}</p>
  );
  const settingsDrawer = settingsSection ? (
    <SettingsPanel
      catalog={catalog}
      section={settingsSection === "top" ? undefined : settingsSection}
      onClose={() => setSettingsOpen(false)}
    />
  ) : null;

  if (compact) {
    return (
      <div className="compact">
        <CompactView browser={browser} cues={cues} onOpenSettings={openSettings} onExpand={() => setCompact(false)} />
        <Toasts />
        {settingsDrawer}
      </div>
    );
  }

  return (
    <div className="operator">
      <aside className="sidebar">
        <header className="brand">
          <span className="brand__mark" aria-hidden="true">
            <Icon name="music" size={20} />
          </span>
          <div className="brand__text">
            <strong>{t("appName")}</strong>
            {catalog ? (
              <span>{t("contentStats", { total: catalog.total, reviewed: catalog.reviewed, drafts: catalog.drafts })}</span>
            ) : null}
          </div>
          <ThemeToggle />
          <button
            type="button"
            className="icon-button icon-button--ghost"
            title={t("compactModeOn")}
            aria-label={t("compactModeOn")}
            onClick={() => setCompact(true)}
          >
            <Icon name="compact" />
          </button>
        </header>
        {browser}
      </aside>

      <main className="main">
        <div className="main__scroll">
          <Notices />
          <StagePanel catalog={catalog} />
        </div>
        <TransportBar cues={cues} onOpenSettings={openSettings} />
      </main>

      <Toasts />
      {settingsDrawer}
    </div>
  );
}
