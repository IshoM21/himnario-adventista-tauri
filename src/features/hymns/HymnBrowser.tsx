import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { padNumber } from "../../lib/format";
import { buildIndex, search, type SearchResult } from "../../lib/search";
import type { CatalogEntry } from "../../types/domain";

export interface HymnBrowserHandle {
  focus: (initial?: string) => void;
}

type Tab = "all" | "recent";

interface HymnBrowserProps {
  entries: CatalogEntry[];
  /** Ids seleccionados recientemente, el más reciente primero. */
  recentIds: string[];
  onAirId: string | null;
  cueId: string | null;
  onSelect: (id: string) => void;
  /** Doble clic / Ctrl+Enter: lo pone al aire de inmediato aunque otro suene. */
  onTakeNow: (id: string) => void;
  /** Casilla «Buscar en la letra» (se recuerda en la configuración). */
  lyricsSearch: boolean;
  onLyricsSearchChange: (value: boolean) => void;
  /** Vista compacta: cada fila tiene ▶ para reproducir en el momento. */
  onPlayNow?: (id: string) => void;
  /** Ocultar las pestañas Todos/Recientes (vista compacta). */
  showTabs?: boolean;
}

interface RowProps {
  result: SearchResult;
  position: number;
  active: boolean;
  onAir: boolean;
  cued: boolean;
  onSelect: (id: string) => void;
  onTakeNow: (id: string) => void;
  onPlayNow?: (id: string) => void;
  onHover: (position: number) => void;
}

const HymnRow = memo(function HymnRow({ result, position, active, onAir, cued, onSelect, onTakeNow, onPlayNow, onHover }: RowProps) {
  const { entry } = result;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <li
      ref={ref}
      role="option"
      aria-selected={active}
      className={`hymn-row${onPlayNow ? " hymn-row--playable" : ""}${active ? " is-active" : ""}${onAir ? " is-on-air" : ""}${cued ? " is-cued" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(entry.id)}
      onDoubleClick={() => onTakeNow(entry.id)}
      onMouseMove={() => !active && onHover(position)}
    >
      {onPlayNow ? (
        <button
          type="button"
          className="hymn-row__play"
          aria-label={`${t("play")} ${padNumber(entry.number)}`}
          title={t("playNow")}
          onClick={(event) => {
            event.stopPropagation();
            onPlayNow(entry.id);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
          </svg>
        </button>
      ) : null}
      <span className="hymn-row__number">{padNumber(entry.number)}</span>
      <span className="hymn-row__body">
        <span className="hymn-row__title">{entry.title}</span>
        {result.source === "lyrics" && result.snippet ? (
          <span className="hymn-row__snippet">
            {t("searchMatchLyrics")}: {result.snippet}
          </span>
        ) : null}
      </span>
      <span className="hymn-row__badges">
        {onAir ? <span className="badge badge--live">{t("onAirBadge")}</span> : null}
        {cued ? <span className="badge badge--accent">{t("cuedBadge")}</span> : null}
        {entry.status !== "reviewed" ? (
          <span className="badge badge--draft" title={t("draftTitle")}>
            {entry.status === "needs-review" ? t("needsReviewBadge") : t("draftBadge")}
          </span>
        ) : null}
        {!entry.tracks.vocal ? <span className="badge badge--muted">{t("noVocal")}</span> : null}
        {!entry.tracks.instrumental ? <span className="badge badge--muted">{t("noInstrumental")}</span> : null}
      </span>
    </li>
  );
});

/**
 * Buscador + resultados. ↑/↓ recorren la lista, Enter selecciona (prepara,
 * nunca reproduce) y el foco sale del campo para que Espacio sea PLAY.
 */
export const HymnBrowser = forwardRef<HymnBrowserHandle, HymnBrowserProps>(function HymnBrowser(
  { entries, recentIds, onAirId, cueId, onSelect, onTakeNow, lyricsSearch, onLyricsSearchChange, onPlayNow, showTabs = true },
  handle,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<Tab>("all");
  const index = useMemo(() => buildIndex(entries), [entries]);
  const recentIndex = useMemo(() => {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return buildIndex(recentIds.map((id) => byId.get(id)).filter((entry): entry is CatalogEntry => Boolean(entry)));
  }, [entries, recentIds]);
  // Escribir siempre busca en todo el himnario; la pestaña solo filtra la lista
  // cuando el buscador está vacío.
  const browsing = query.trim() === "";
  const source = browsing && tab === "recent" ? recentIndex : index;
  const results = useMemo(
    () => search(source, query, entries.length, { lyrics: lyricsSearch }),
    [source, query, entries.length, lyricsSearch],
  );
  // Sin resultados por título y con la letra apagada: ofrecer buscar en ella.
  const offerLyrics = !lyricsSearch && !browsing && results.length === 0 && !/^\d+$/.test(query.trim());

  useImperativeHandle(handle, () => ({
    focus: (initial?: string) => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      if (initial != null) {
        setQuery(initial);
        setActive(0);
      } else {
        input.select();
      }
    },
  }));

  useEffect(() => setActive(0), [query, tab]);

  const choose = useCallback(
    (id: string) => {
      onSelect(id);
      inputRef.current?.blur();
    },
    [onSelect],
  );
  const takeNow = useCallback(
    (id: string) => {
      onTakeNow(id);
      inputRef.current?.blur();
    },
    [onTakeNow],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(results.length - 1, value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(0, value - 1));
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setActive((value) => Math.min(results.length - 1, value + 10));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      setActive((value) => Math.max(0, value - 10));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[active];
      if (result) (event.ctrlKey || event.metaKey ? takeNow : choose)(result.entry.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (query) setQuery("");
      else inputRef.current?.blur();
    }
  };

  return (
    <section className="browser" aria-label={t("searchPlaceholder")}>
      <div className="browser__search">
        <span className="browser__field">
          <Icon name="search" size={17} />
          <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          aria-controls="hymn-results"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(event) => event.target.select()}
          />
        </span>
        <label className="browser__lyrics-toggle">
          <input type="checkbox" checked={lyricsSearch} onChange={(event) => onLyricsSearchChange(event.target.checked)} />
          <span>{t("lyricsSearch")}</span>
        </label>
        {showTabs ? (
        <div className="tabs" role="tablist" aria-label={t("searchPlaceholder")}>
          {(["all", "recent"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`tabs__tab${tab === value ? " is-active" : ""}`}
              onClick={() => setTab(value)}
            >
              {value === "all" ? t("tabAll") : t("tabRecent")}
              {value === "recent" && recentIds.length ? <span className="tabs__count">{recentIds.length}</span> : null}
            </button>
          ))}
        </div>
        ) : null}
        <span className="browser__hint">
          {query ? t("hymnsCount", { count: results.length }) : t("searchHint")}
        </span>
      </div>
      <ul id="hymn-results" className="browser__list" role="listbox">
        {results.map((result, position) => (
          <HymnRow
            key={result.entry.id}
            result={result}
            position={position}
            active={position === active}
            onAir={result.entry.id === onAirId}
            cued={result.entry.id === cueId}
            onSelect={choose}
            onTakeNow={takeNow}
            onPlayNow={onPlayNow}
            onHover={setActive}
          />
        ))}
        {results.length === 0 ? (
          <li className="browser__empty">
            {browsing && tab === "recent" ? t("recentEmpty") : t("searchNoResults", { query })}
            {offerLyrics ? (
              <button type="button" className="button browser__offer" onClick={() => onLyricsSearchChange(true)}>
                {t("searchInLyricsOffer")}
              </button>
            ) : null}
          </li>
        ) : null}
      </ul>
    </section>
  );
});
