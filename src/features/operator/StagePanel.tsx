import { memo, useMemo } from "react";
import { t } from "../../i18n";
import { formatTime, padNumber } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { run, shallowEqual, useAppStore } from "../../stores/appStore";
import type { CatalogSummary, Hymn, PlaybackState } from "../../types/domain";
import { ScaledStage } from "../presentation/ScaledStage";
import { buildStageView } from "../presentation/stageModel";
import { ProjectButton } from "../projection/ProjectionControls";

const STATUS_LABEL: Record<PlaybackState["status"], Parameters<typeof t>[0]> = {
  idle: "statusIdle",
  stopped: "statusStopped",
  playing: "statusPlaying",
  paused: "statusPaused",
  ended: "statusEnded",
};

function SlideText({ hymn, index, empty }: { hymn: Hymn; index: number | null; empty: string }) {
  const slide = index != null ? hymn.slides[index] : undefined;
  if (!slide) return <p className="slide-text slide-text--muted">{empty}</p>;
  return (
    <div className="slide-text">
      {slide.kind === "title" ? <span className="slide-text__tag">{t("titleSlide")}</span> : null}
      {slide.kind !== "title" && slide.caption ? <span className="slide-text__tag">{slide.caption}</span> : null}
      {slide.text.length ? slide.text.map((line, i) => <span key={i}>{line}</span>) : <span className="slide-text--muted">{t("emptySlide")}</span>}
    </div>
  );
}

/** Indicador de láminas sobre la vista previa: cada punto salta a esa lámina. */
const SlideDots = memo(function SlideDots({ hymn, current }: { hymn: Hymn; current: number | null }) {
  return (
    <nav className="slide-dots" aria-label={t("slidesHeading")}>
      {hymn.slides.map((slide, index) => {
        const label = `${index + 1} · ${slide.kind === "title" ? t("titleSlide") : slide.caption ?? ""} · ${formatTime(slide.start)} — ${slide.text[0] ?? t("emptySlide")}`;
        return (
          <button
            key={index}
            type="button"
            className={`slide-dots__dot${index === current ? " is-current" : ""}${slide.kind === "title" ? " is-title" : ""}`}
            aria-label={label}
            aria-current={index === current}
            title={label}
            onClick={() => void run(() => ipc.goToSlide(index))}
          />
        );
      })}
    </nav>
  );
});

function QualityNotes({ hymn }: { hymn: Hymn }) {
  const notes = hymn.quality.flags.filter((flag) =>
    ["AUTO_DRAFT", "TEXT_NOT_REVIEWED", "EMPTY_SLIDE_TEXT", "TRACK_DURATION_DIFFERENCE"].includes(flag.code) ||
    flag.severity === "error",
  );
  if (!notes.length) return null;
  return (
    <details className="quality-notes">
      <summary>{t("qualityWarnings")} ({notes.length})</summary>
      <ul>
        {notes.map((flag, index) => (
          <li key={index} data-severity={flag.severity}>
            {flag.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function CueBanner() {
  const cue = useAppStore((s) => s.playback?.cue ?? null);
  if (!cue) return null;
  return (
    <div className="banner banner--cue" role="status">
      <div>
        <strong>
          {t("cueTitle")}: {padNumber(cue.number)} · {cue.title}
        </strong>
        <span>{t("cueHint")}</span>
      </div>
      <div className="banner__actions">
        <button type="button" className="button button--primary" onClick={() => void run(() => ipc.takeCue())}>
          {t("cueTake")}
        </button>
        <button type="button" className="button" onClick={() => void run(() => ipc.clearCue())}>
          {t("cueDiscard")}
        </button>
      </div>
    </div>
  );
}

export function StagePanel({ catalog }: { catalog: CatalogSummary | null }) {
  const playback = useAppStore(
    (s) => s.playback,
    (left, right) =>
      left?.hymn?.id === right?.hymn?.id &&
      left?.currentSlide === right?.currentSlide &&
      left?.nextSlide === right?.nextSlide &&
      left?.presentation === right?.presentation &&
      left?.status === right?.status &&
      left?.track === right?.track,
  );
  const hymn = useAppStore((s) => s.hymn);
  const appearance = useAppStore((s) => s.settings?.appearance ?? null);
  const size = useAppStore(
    (s) => ({ width: s.projection?.width ?? 1920, height: s.projection?.height ?? 1080 }),
    shallowEqual,
  );
  const library = useAppStore((s) => s.library);
  const view = useMemo(
    () => (appearance ? buildStageView(playback, hymn, appearance, library) : null),
    [playback, hymn, appearance, library],
  );
  const onAir = hymn && playback?.hymn?.id === hymn.id ? hymn : null;
  const position = useMemo(
    () => (onAir && catalog ? catalog.hymns.findIndex((entry) => entry.id === onAir.id) + 1 : 0),
    [onAir, catalog],
  );
  const collection = catalog?.collection.name ?? t("appName");

  return (
    <section className="stage-panel">
      <header className="now-playing">
        <div className="now-playing__title">
          {onAir ? (
            <>
              <h1>
                <span className="now-playing__number">{padNumber(onAir.number)}</span>
                {onAir.title}
              </h1>
              <div className="now-playing__meta">
                <span>
                  {collection}
                  {position > 0 && catalog ? ` · ${t("positionOf", { position, total: catalog.total })}` : ""}
                </span>
                <span className={`status-pill status-pill--${playback?.status}`}>
                  <i aria-hidden="true" />
                  {t(STATUS_LABEL[playback?.status ?? "idle"])}
                </span>
                {onAir.quality.status !== "reviewed" ? (
                  <span className="badge badge--draft" title={t("draftTitle")}>
                    {t("draftBadge")}
                  </span>
                ) : null}
                <QualityNotes hymn={onAir} />
              </div>
            </>
          ) : (
            <>
              <h1>{t("noHymnTitle")}</h1>
              <div className="now-playing__meta">
                <span>{t("noHymnHint")}</span>
              </div>
            </>
          )}
        </div>
        <ProjectButton />
      </header>

      <CueBanner />

      <div className="preview">
        {view && appearance ? (
          <ScaledStage view={view} appearance={appearance} width={size.width} height={size.height} label={t("preview")} fit="contain">
            {onAir ? <SlideDots hymn={onAir} current={playback?.currentSlide ?? null} /> : null}
          </ScaledStage>
        ) : null}
      </div>

      <div className="cue-texts">
        <div className="cue-texts__block cue-texts__block--current">
          <h2>{t("current")}</h2>
          {onAir ? <SlideText hymn={onAir} index={playback?.currentSlide ?? null} empty="—" /> : <p className="slide-text--muted">—</p>}
        </div>
        <div className="cue-texts__block">
          <h2>{t("next")}</h2>
          {onAir ? <SlideText hymn={onAir} index={playback?.nextSlide ?? null} empty={t("endOfHymn")} /> : <p className="slide-text--muted">—</p>}
        </div>
      </div>
    </section>
  );
}
