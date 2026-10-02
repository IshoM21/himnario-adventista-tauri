// Tipos compartidos. Reflejan exactamente las estructuras serializadas por
// Rust (src-tauri/src/**); cualquier cambio debe hacerse en ambos lados.

export type TrackKind = "vocal" | "instrumental";
export type SlideKind = "title" | "lyrics" | "chorus" | "refrain";
export type QualityStatus = "draft" | "needs-review" | "reviewed";

/** Pista de audio de un himno (`hymn.json` → `audio.vocal|instrumental`). */
export interface AudioTrack {
  file: string;
  codec: string | null;
  container: string | null;
  durationSeconds: number;
  sampleRate: number | null;
  channels: number | null;
  status: "ready" | "missing" | "invalid" | string;
}

/** Una pantalla de letra con su intervalo en segundos. */
export interface Slide {
  index: number;
  sourceCandidateIndex: number | null;
  start: number;
  end: number;
  kind: SlideKind | string;
  text: string[];
  caption: string | null;
}

export interface QualityFlag {
  code: string;
  severity: "info" | "warning" | "error" | string;
  message: string;
}

/** Documento completo `hymn.json` (schema v1 del pipeline de migración). */
export interface Hymn {
  schemaVersion: number;
  id: string;
  number: number;
  title: string;
  language: string | null;
  background: { id: string; overlay: number };
  audio: { vocal: AudioTrack | null; instrumental: AudioTrack | null };
  presentation: { onAudioEnd: string; onLyricsEnd: string; titleSlideIndex: number };
  slides: Slide[];
  quality: { status: QualityStatus | string; flags: QualityFlag[] };
}

/** Entrada compacta del índice `catalog.json`. */
export interface CatalogEntry {
  id: string;
  number: number;
  title: string;
  status: QualityStatus | string;
  tracks: { vocal: boolean; instrumental: boolean };
  firstLine: string | null;
  lyrics: string;
  section?: string | null;
  subsection?: string | null;
}

/** `content/sections.json`: secciones del himnario y rangos de himnos. */
export interface SubsectionDef {
  number: number;
  id: string;
  name: string;
  from: number;
  to: number;
}

export interface SectionDef {
  number: number;
  id: string;
  name: string;
  subsections: SubsectionDef[];
}

export interface SectionsData {
  schemaVersion: number;
  sections: SectionDef[];
}

/** Fondo de imagen importado (`content/backgrounds/manifest.json`). */
export interface ImageBackground {
  id: string;
  name: string;
  file: string;
  thumb: string;
  target: { level: "general" | "section" | "subsection" | string; section: string | null; subsection: string | null };
  textColor: string;
  /** Rutas absolutas para `convertFileSrc`. */
  path: string;
  thumbPath: string;
}

export interface Visuals {
  sections: SectionsData | null;
  backgrounds: ImageBackground[];
}

export interface CatalogSummary {
  collection: { id: string; name: string };
  contentRoot: string;
  total: number;
  reviewed: number;
  drafts: number;
  hymns: CatalogEntry[];
  warnings: string[];
}

export type PlaybackStatus = "idle" | "stopped" | "playing" | "paused" | "ended";
export type PresentationMode = "normal" | "black" | "backgroundOnly";

export interface HymnRef {
  id: string;
  number: number;
  title: string;
}

/** Estado real emitido por Rust (evento `playback-state`). */
export interface PlaybackState {
  hymn: HymnRef | null;
  track: TrackKind | null;
  tracks: { vocal: boolean; instrumental: boolean };
  status: PlaybackStatus;
  position: number;
  duration: number;
  volume: number;
  currentSlide: number | null;
  nextSlide: number | null;
  presentation: PresentationMode;
  black: boolean;
  lyricsHidden: boolean;
  cue: HymnRef | null;
  audioOutput: boolean;
  notice: string | null;
  /** Pista elegida (pegajosa) para los himnos que se pongan al aire. */
  selectedTrack: TrackKind;
}

export type SelectOutcome = "loaded" | "cued";

export interface MonitorInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}

export interface MonitorList {
  monitors: MonitorInfo[];
  suggested: MonitorInfo | null;
}

export interface ProjectionStatus {
  visible: boolean;
  presenting: boolean;
  monitor: MonitorInfo | null;
  width: number;
  height: number;
  sharesOperatorMonitor: boolean;
}

export type DefaultTrack = "vocal" | "instrumental" | "last";
export type FontFamily = "sans" | "serif" | "system";
export type TextAlign = "center" | "left";
/** Predeterminado | por sección | por subsección | himno por himno. */
export type BackgroundMode = "default" | "section" | "subsection" | "custom";
export type VersePosition = "above" | "below" | "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export interface MonitorRef {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppearanceSettings {
  fontFamily: FontFamily;
  fontWeight: number;
  maxFontSize: number;
  minFontSize: number;
  lineHeight: number;
  textAlign: TextAlign;
  textColor: string;
  marginX: number;
  marginY: number;
  shadow: boolean;
  outline: boolean;
  uppercase: boolean;
  showVerseNumber: boolean;
  versePosition: VersePosition;
  showReference: boolean;
  showHymnNumber: boolean;
  backgroundMode: BackgroundMode;
  /** Fondo predeterminado; `general` = el fondo general importado. */
  backgroundId: string;
  /** Elecciones manuales; lo que falta usa las imágenes del grupo o el nivel superior. */
  sectionBackgrounds: Record<string, string>;
  subsectionBackgrounds: Record<string, string>;
  hymnBackgrounds: Record<string, string>;
  customColor: string;
  overlay: number;
}

export type Theme = "dark" | "light";

export interface Settings {
  schemaVersion: number;
  language: string;
  theme: Theme;
  ui: { compact: boolean; lyricsSearch: boolean; alwaysOnTopCompact: boolean };
  audio: { volume: number; defaultTrack: DefaultTrack; lastTrack: TrackKind };
  projection: { monitor: MonitorRef | null; presentOnStart: boolean; monitorPromptAnswered: boolean };
  appearance: AppearanceSettings;
  operator: {
    window: { x: number; y: number; width: number; height: number; maximized: boolean } | null;
    lastHymnId: string | null;
    recentHymnIds: string[];
    compactWindow: { x: number; y: number; width: number; height: number; maximized: boolean } | null;
  };
}

export interface AppPaths {
  contentRoot: string | null;
  settingsFile: string;
  logDir: string | null;
}

export interface Bootstrap {
  version: string;
  platform: string;
  snapshot: PlaybackState;
  hymn: Hymn | null;
  settings: Settings;
  contentError: string | null;
  warnings: string[];
  paths: AppPaths;
}

/** Error serializado por Rust (`AppError`). */
export interface AppError {
  code: string;
  message: string;
}
