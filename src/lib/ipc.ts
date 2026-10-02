// Comandos React → Rust, tipados. Es el único módulo que llama a `invoke`.

import { invoke } from "@tauri-apps/api/core";
import type {
  AppError,
  Bootstrap,
  CatalogSummary,
  Hymn,
  MonitorList,
  PlaybackState,
  ProjectionStatus,
  SelectOutcome,
  Settings,
  TrackKind,
  Visuals,
} from "../types/domain";

export function errorMessage(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason && typeof reason === "object" && "message" in reason) {
    return String((reason as AppError).message);
  }
  return String(reason);
}

export const ipc = {
  bootstrap: () => invoke<Bootstrap>("get_bootstrap"),
  logFrontend: (level: "error" | "warn" | "info", message: string) =>
    invoke<void>("log_frontend", { level, message }),

  catalog: () => invoke<CatalogSummary>("get_catalog"),
  hymn: (id: string) => invoke<Hymn>("get_hymn", { id }),
  currentHymn: () => invoke<Hymn | null>("get_current_hymn"),

  playback: () => invoke<PlaybackState>("get_playback"),
  select: (id: string) =>
    invoke<{ outcome: SelectOutcome; snapshot: PlaybackState }>("select_hymn", { id }),
  takeCue: () => invoke<PlaybackState>("take_cue"),
  playNow: (id: string) => invoke<PlaybackState>("play_now", { id }),
  setCompactMode: (compact: boolean) => invoke<Settings>("set_compact_mode", { compact }),
  clearCue: () => invoke<PlaybackState>("clear_cue"),
  play: () => invoke<PlaybackState>("play"),
  pause: () => invoke<PlaybackState>("pause"),
  togglePlay: () => invoke<PlaybackState>("toggle_play"),
  stop: () => invoke<PlaybackState>("stop"),
  restart: () => invoke<PlaybackState>("restart"),
  seek: (seconds: number) => invoke<PlaybackState>("seek", { seconds }),
  skip: (delta: number) => invoke<PlaybackState>("skip", { delta }),
  setTrack: (track: TrackKind) => invoke<PlaybackState>("set_track", { track }),
  goToSlide: (index: number) => invoke<PlaybackState>("go_to_slide", { index }),
  nextSlide: () => invoke<PlaybackState>("next_slide"),
  previousSlide: () => invoke<PlaybackState>("previous_slide"),
  setBlack: (value: boolean) => invoke<PlaybackState>("set_black", { value }),
  setLyricsHidden: (value: boolean) => invoke<PlaybackState>("set_lyrics_hidden", { value }),
  setVolume: (volume: number, persist: boolean) =>
    invoke<PlaybackState>("set_volume", { volume, persist }),
  dismissNotice: () => invoke<PlaybackState>("dismiss_notice"),

  visuals: () => invoke<Visuals>("get_visuals"),
  monitors: () => invoke<MonitorList>("list_monitors"),
  projectionStatus: () => invoke<ProjectionStatus>("get_projection_status"),
  present: (monitorId: string) => invoke<ProjectionStatus>("present_projection", { monitorId }),
  exitPresentation: () => invoke<ProjectionStatus>("exit_presentation"),
  showProjection: () => invoke<ProjectionStatus>("show_projection"),
  hideProjection: () => invoke<ProjectionStatus>("hide_projection"),
  recoverProjection: () => invoke<ProjectionStatus>("recover_projection"),

  settings: () => invoke<Settings>("get_settings"),
  updateSettings: (settings: Settings) => invoke<Settings>("update_settings", { settings }),
  resetSettings: () => invoke<Settings>("reset_settings"),
};
