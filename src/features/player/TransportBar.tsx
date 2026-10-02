import { memo, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { t } from "../../i18n";
import { ipc } from "../../lib/ipc";
import { run, shallowEqual, useAppStore } from "../../stores/appStore";
import type { TrackKind } from "../../types/domain";
import { playbackActions } from "../operator/useShortcuts";
import type { SettingsSection } from "../settings/SettingsPanel";
import { Timeline } from "./Timeline";

/**
 * Cantado / Instrumental. La elección es "pegajosa": cambia la pista al aire
 * (conservando el tiempo) y la usan todos los himnos que se pongan después.
 * Sin himno cargado también se puede elegir; solo se deshabilita la pista que
 * le falte al himno al aire.
 */
export function TrackSwitch({ className = "transport__tracks" }: { className?: string }) {
  const state = useAppStore(
    (s) => {
      const hasHymn = Boolean(s.playback?.hymn);
      return {
        track: s.playback?.track ?? s.playback?.selectedTrack ?? "vocal",
        vocal: !hasHymn || (s.playback?.tracks.vocal ?? false),
        instrumental: !hasHymn || (s.playback?.tracks.instrumental ?? false),
      };
    },
    shallowEqual,
  );
  const option = (kind: TrackKind, label: string, available: boolean) => (
    <button
      type="button"
      role="radio"
      aria-checked={state.track === kind}
      className={`segmented__option${state.track === kind ? " is-active" : ""}`}
      disabled={!available}
      title={available ? `${label} (T)` : t("trackUnavailable")}
      onClick={() => void run(() => ipc.setTrack(kind))}
    >
      {label}
    </button>
  );
  return (
    <div className={`segmented segmented--pill ${className}`} role="radiogroup" aria-label="Audio">
      {option("vocal", t("vocal"), state.vocal)}
      {option("instrumental", t("instrumental"), state.instrumental)}
    </div>
  );
}

export function VolumeControl() {
  const volume = useAppStore((s) => s.playback?.volume ?? 0.8);
  const [local, setLocal] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Un envío por cuadro como máximo mientras se arrastra.
  const send = (value: number) => {
    pending.current = value;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current != null) void run(() => ipc.setVolume(pending.current as number, false));
    });
  };
  const commit = (value: number) => {
    setLocal(null);
    void run(() => ipc.setVolume(value, true));
  };
  const shown = local ?? volume;
  return (
    <label className="volume">
      <span className="volume__icon" aria-hidden="true">
        <Icon name={shown === 0 ? "mute" : "volume"} />
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        aria-label={t("volume")}
        style={{ ["--progress" as string]: `${shown * 100}%` }}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          setLocal(value);
          send(value);
        }}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => commit(Number(event.currentTarget.value))}
      />
      <span className="volume__value">{Math.round(shown * 100)}%</span>
    </label>
  );
}

export function PresentationButtons() {
  const { black, lyricsHidden } = useAppStore(
    (s) => ({ black: s.playback?.black ?? false, lyricsHidden: s.playback?.lyricsHidden ?? false }),
    shallowEqual,
  );
  return (
    <div className="presentation-buttons">
      <button
        type="button"
        className={`big-toggle big-toggle--lyrics${lyricsHidden ? " is-on" : ""}`}
        aria-pressed={lyricsHidden}
        title={t("lyricsTitle")}
        onClick={playbackActions.toggleLyrics}
      >
        <span className="big-toggle__label">{t("lyrics")}</span>
        <span className="big-toggle__state">{lyricsHidden ? t("modeBackgroundOnly") : "L"}</span>
      </button>
      <button
        type="button"
        className={`big-toggle big-toggle--black${black ? " is-on" : ""}`}
        aria-pressed={black}
        title={t("blackTitle")}
        onClick={playbackActions.toggleBlack}
      >
        <span className="big-toggle__label">{t("black")}</span>
        <span className="big-toggle__state">{black ? t("modeBlack") : "B"}</span>
      </button>
    </div>
  );
}

export function PlayButton() {
  const { status, canPlay } = useAppStore(
    (s) => ({
      status: s.playback?.status ?? "idle",
      canPlay: Boolean(s.playback?.hymn && s.playback.track),
    }),
    shallowEqual,
  );
  const playing = status === "playing";
  return (
    <button
      type="button"
      className={`play-button${playing ? " is-playing" : ""}`}
      disabled={!canPlay}
      aria-label={playing ? t("pause") : t("play")}
      title={`${playing ? t("pause") : t("play")} (Espacio)`}
      onClick={playbackActions.togglePlay}
    >
      {playing ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1.2" />
          <rect x="14" y="5" width="4" height="14" rx="1.2" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
        </svg>
      )}
    </button>
  );
}

export function IconAction({ icon, label, disabled, onClick }: { icon: IconName; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="icon-button icon-button--ghost" disabled={disabled} title={label} aria-label={label} onClick={onClick}>
      <Icon name={icon} size={20} />
    </button>
  );
}

interface TransportBarProps {
  cues: number[];
  onOpenSettings: (section?: SettingsSection) => void;
}

export const TransportBar = memo(function TransportBar({ cues, onOpenSettings }: TransportBarProps) {
  const hasHymn = useAppStore((s) => Boolean(s.playback?.hymn));
  return (
    <section className="transport" aria-label={t("play")}>
      <TrackSwitch />
      <Timeline cues={cues} />

      <div className="transport__side transport__side--left">
        <IconAction icon="restart" label={`${t("restart")} (Inicio)`} disabled={!hasHymn} onClick={playbackActions.restart} />
        <IconAction icon="stop" label={`${t("stop")} (S)`} disabled={!hasHymn} onClick={playbackActions.stop} />
      </div>
      <div className="transport__buttons">
        <IconAction icon="back10" label={t("back10Title")} disabled={!hasHymn} onClick={() => playbackActions.skip(-10)} />
        <IconAction icon="previous" label={t("previousSlide")} disabled={!hasHymn} onClick={playbackActions.previousSlide} />
        <PlayButton />
        <IconAction icon="next" label={t("nextSlide")} disabled={!hasHymn} onClick={playbackActions.nextSlide} />
        <IconAction icon="forward10" label={t("forward10Title")} disabled={!hasHymn} onClick={() => playbackActions.skip(10)} />
      </div>
      <div className="transport__side transport__side--right">
        <PresentationButtons />
      </div>

      <VolumeControl />
      <div className="transport__tools">
        <IconAction icon="monitor" label={t("sectionProjection")} onClick={() => onOpenSettings("projection")} />
        <IconAction icon="type" label={t("sectionText")} onClick={() => onOpenSettings("text")} />
        <IconAction icon="image" label={t("sectionBackground")} onClick={() => onOpenSettings("background")} />
        <IconAction icon="settings" label={t("settings")} onClick={() => onOpenSettings()} />
      </div>
    </section>
  );
});
