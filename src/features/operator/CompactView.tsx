// Vista compacta del operador: buscar, elegir pista y reproducir. Sin vista
// previa ni láminas; la proyección sigue funcionando igual.

import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { padNumber } from "../../lib/format";
import { shallowEqual, useAppStore } from "../../stores/appStore";
import { IconAction, PlayButton, PresentationButtons, TrackSwitch, VolumeControl } from "../player/TransportBar";
import { Timeline } from "../player/Timeline";
import { ProjectButton } from "../projection/ProjectionControls";
import type { SettingsSection } from "../settings/SettingsPanel";
import { Notices, ThemeToggle } from "./OperatorChrome";
import { CueBanner } from "./StagePanel";
import { playbackActions } from "./useShortcuts";

function NowPlaying() {
  const { hymn, status } = useAppStore(
    (s) => ({ hymn: s.playback?.hymn ?? null, status: s.playback?.status ?? "idle" }),
    shallowEqual,
  );
  if (!hymn) return <p className="compact__now compact__now--empty">{t("noHymnTitle")}</p>;
  return (
    <p className="compact__now">
      <span className={`compact__dot compact__dot--${status}`} aria-hidden="true" />
      <strong>{padNumber(hymn.number)}</strong>
      <span className="compact__now-title">{hymn.title}</span>
    </p>
  );
}

interface CompactViewProps {
  browser: ReactNode;
  cues: number[];
  onOpenSettings: (section?: SettingsSection) => void;
  onExpand: () => void;
}

export function CompactView({ browser, cues, onOpenSettings, onExpand }: CompactViewProps) {
  const hasHymn = useAppStore((s) => Boolean(s.playback?.hymn));
  return (
    <>
      <header className="compact__header">
        <span className="brand__mark brand__mark--small" aria-hidden="true">
          <Icon name="music" size={16} />
        </span>
        <strong className="compact__title">{t("appName")}</strong>
        <ThemeToggle />
        <button
          type="button"
          className="icon-button icon-button--ghost"
          title={t("settings")}
          aria-label={t("settings")}
          onClick={() => onOpenSettings()}
        >
          <Icon name="settings" />
        </button>
        <button
          type="button"
          className="icon-button icon-button--ghost"
          title={t("compactModeOff")}
          aria-label={t("compactModeOff")}
          onClick={onExpand}
        >
          <Icon name="expand" />
        </button>
      </header>

      <div className="compact__notices">
        <Notices />
        <CueBanner />
      </div>

      <div className="compact__tracks-row">
        <TrackSwitch className="compact__tracks" />
      </div>

      <div className="compact__browser">{browser}</div>

      <footer className="compact__player">
        <NowPlaying />
        <div className="compact__timeline">
          <Timeline cues={cues} />
        </div>
        <div className="compact__buttons">
          <IconAction icon="stop" label={`${t("stop")} (S)`} disabled={!hasHymn} onClick={playbackActions.stop} />
          <IconAction icon="back10" label={t("back10Title")} disabled={!hasHymn} onClick={() => playbackActions.skip(-10)} />
          <PlayButton />
          <IconAction icon="forward10" label={t("forward10Title")} disabled={!hasHymn} onClick={() => playbackActions.skip(10)} />
          <IconAction icon="next" label={t("nextSlide")} disabled={!hasHymn} onClick={playbackActions.nextSlide} />
        </div>
        <div className="compact__bottom">
          <VolumeControl />
        </div>
        <div className="compact__bottom compact__bottom--presentation">
          <PresentationButtons />
          <ProjectButton />
        </div>
      </footer>
    </>
  );
}
