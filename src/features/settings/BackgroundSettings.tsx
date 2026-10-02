import { useMemo, useState, type ReactNode } from "react";
import { t, type MessageKey } from "../../i18n";
import { padNumber } from "../../lib/format";
import type { AppearanceSettings, BackgroundMode, CatalogSummary, SectionDef } from "../../types/domain";
import {
  BACKGROUNDS,
  CUSTOM_COLOR_ID,
  GENERAL_ID,
  customColorBackground,
  resolveBackground,
  type BackgroundDef,
  type BackgroundLibrary,
  type ImageBackgroundDef,
} from "../presentation/backgrounds";

function thumbStyle(background: BackgroundDef) {
  const image = (background as ImageBackgroundDef).thumb ?? background.image;
  return image && background.kind === "image"
    ? { backgroundImage: `url("${image}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: background.css };
}

function Thumb({ background }: { background: BackgroundDef }) {
  return <span className="bg-thumb" style={thumbStyle(background)} title={background.name} aria-hidden="true" />;
}

function Swatch({ background, active, onClick }: { background: BackgroundDef; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`swatch${active ? " is-active" : ""}`} onClick={onClick} aria-pressed={active} title={background.name}>
      <span className="swatch__sample" style={thumbStyle(background)}>
        <span style={{ color: background.textColor }}>Aa</span>
      </span>
      <span className="swatch__name">{background.name}</span>
    </button>
  );
}

/** Selector de un fondo concreto, o «automático» (vacío) para seguir la regla. */
function BackgroundSelect({
  value,
  autoLabel,
  library,
  onChange,
}: {
  value: string | undefined;
  autoLabel: string;
  library: BackgroundLibrary;
  onChange: (id: string | null) => void;
}) {
  return (
    <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{autoLabel}</option>
      {library.images.length ? (
        <optgroup label={t("bgImported")}>
          {library.images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label={t("bgBuiltIn")}>
        {BACKGROUNDS.map((background) => (
          <option key={background.id} value={background.id}>
            {background.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function withEntry(map: Record<string, string> | undefined, key: string, value: string | null) {
  const next = { ...(map ?? {}) };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

function GroupRow({ name, range, preview, children }: { name: string; range: string; preview: BackgroundDef; children: ReactNode }) {
  return (
    <div className="bg-row">
      <Thumb background={preview} />
      <span className="bg-row__name">
        {name}
        <small>{range}</small>
      </span>
      {children}
    </div>
  );
}

interface Props {
  appearance: AppearanceSettings;
  library: BackgroundLibrary;
  catalog: CatalogSummary | null;
  onChange: (patch: Partial<AppearanceSettings>) => void;
}

const MODES: BackgroundMode[] = ["default", "section", "subsection", "custom"];
const MODE_LABEL: Record<BackgroundMode, MessageKey> = {
  default: "bgMode_default",
  section: "bgMode_section",
  subsection: "bgMode_subsection",
  custom: "bgMode_custom",
};
const MODE_HINT: Record<BackgroundMode, MessageKey> = {
  default: "bgModeHint_default",
  section: "bgModeHint_section",
  subsection: "bgModeHint_subsection",
  custom: "bgModeHint_custom",
};

export function BackgroundSettings({ appearance: a, library, catalog, onChange }: Props) {
  const [hymnQuery, setHymnQuery] = useState("");
  const [hymnChoice, setHymnChoice] = useState<string>("");
  const sections: SectionDef[] = library.sections;

  const countFor = (level: string, id: string) =>
    library.images.filter((image) => image.target.level === level && (image.target.section === id || image.target.subsection === id)).length;
  const resolveFor = (number: number, id = padNumber(number)) => resolveBackground(a, { id, number }, library);

  const defaults = useMemo(() => {
    const general = library.images.filter((image) => image.target.level === "general");
    return [...general, ...library.images.filter((image) => image.target.level !== "general"), ...BACKGROUNDS, customColorBackground(a.customColor)];
  }, [library, a.customColor]);
  const defaultActive = (id: string) =>
    a.backgroundId === id || (a.backgroundId === GENERAL_ID && id === library.images.find((image) => image.target.level === "general")?.id);

  const matchedHymn = useMemo(() => {
    const value = Number.parseInt(hymnQuery, 10);
    return Number.isFinite(value) ? catalog?.hymns.find((entry) => entry.number === value) ?? null : null;
  }, [hymnQuery, catalog]);
  const customEntries = Object.entries(a.hymnBackgrounds ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const findName = (id: string) => library.images.find((image) => image.id === id)?.name ?? BACKGROUNDS.find((background) => background.id === id)?.name ?? id;

  return (
    <>
      <label className="field">
        <span className="field__label">{t("backgroundMode")}</span>
        <span className="field__control">
          <select value={a.backgroundMode} onChange={(event) => onChange({ backgroundMode: event.target.value as BackgroundMode })}>
            {MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(MODE_LABEL[mode])}
              </option>
            ))}
          </select>
        </span>
        <span className="field__hint">{t(MODE_HINT[a.backgroundMode] ?? "bgModeHint_default")}</span>
      </label>

      <p className="bg-subheading">{t("bgDefault")}</p>
      <div className="swatches">
        {defaults.map((background) => (
          <Swatch
            key={background.id}
            background={background}
            active={defaultActive(background.id)}
            onClick={() => onChange({ backgroundId: background.id })}
          />
        ))}
      </div>
      {a.backgroundId === CUSTOM_COLOR_ID ? (
        <label className="field">
          <span className="field__label">{t("customColor")}</span>
          <span className="field__control">
            <input type="color" value={a.customColor} onChange={(event) => onChange({ customColor: event.target.value })} />
          </span>
        </label>
      ) : null}

      {a.backgroundMode === "section" && sections.length ? (
        <div className="bg-groups">
          <p className="bg-subheading">{t("bgBySection")}</p>
          {sections.map((section) => {
            const first = section.subsections[0]?.from ?? 1;
            const last = section.subsections.at(-1)?.to ?? first;
            const images = countFor("section", section.id);
            return (
              <GroupRow key={section.id} name={`${section.number}. ${section.name}`} range={`${first}–${last}`} preview={resolveFor(first)}>
                <BackgroundSelect
                  value={a.sectionBackgrounds?.[section.id]}
                  autoLabel={images ? t("bgAutoImages", { count: images }) : t("bgAutoDefault")}
                  library={library}
                  onChange={(id) => onChange({ sectionBackgrounds: withEntry(a.sectionBackgrounds, section.id, id) })}
                />
              </GroupRow>
            );
          })}
        </div>
      ) : null}

      {a.backgroundMode === "subsection" && sections.length ? (
        <div className="bg-groups">
          <p className="bg-subheading">{t("bgBySubsection")}</p>
          {sections.map((section) => (
            <details key={section.id} className="bg-section">
              <summary>
                {section.number}. {section.name}
                <small>{t("bgSubsectionCount", { count: section.subsections.length })}</small>
              </summary>
              {section.subsections.map((subsection) => {
                const images = countFor("subsection", subsection.id);
                const range = subsection.from === subsection.to ? `${subsection.from}` : `${subsection.from}–${subsection.to}`;
                return (
                  <GroupRow key={subsection.id} name={subsection.name} range={range} preview={resolveFor(subsection.from)}>
                    <BackgroundSelect
                      value={a.subsectionBackgrounds?.[subsection.id]}
                      autoLabel={images ? t("bgAutoImages", { count: images }) : t("bgAutoSection")}
                      library={library}
                      onChange={(id) => onChange({ subsectionBackgrounds: withEntry(a.subsectionBackgrounds, subsection.id, id) })}
                    />
                  </GroupRow>
                );
              })}
            </details>
          ))}
        </div>
      ) : null}

      {a.backgroundMode === "custom" ? (
        <div className="bg-groups">
          <p className="bg-subheading">{t("bgByHymn")}</p>
          <div className="bg-assign">
            <input
              type="text"
              inputMode="numeric"
              placeholder={t("bgHymnNumber")}
              value={hymnQuery}
              onChange={(event) => setHymnQuery(event.target.value.replace(/[^0-9]/g, ""))}
            />
            <span className="bg-assign__title">{matchedHymn ? matchedHymn.title : hymnQuery ? t("bgHymnNotFound") : ""}</span>
            <BackgroundSelect value={hymnChoice || undefined} autoLabel={t("bgChoose")} library={library} onChange={(id) => setHymnChoice(id ?? "")} />
            <button
              type="button"
              className="button button--primary"
              disabled={!matchedHymn || !hymnChoice}
              onClick={() => {
                if (!matchedHymn || !hymnChoice) return;
                onChange({ hymnBackgrounds: withEntry(a.hymnBackgrounds, matchedHymn.id, hymnChoice) });
                setHymnQuery("");
                setHymnChoice("");
              }}
            >
              {t("bgAssign")}
            </button>
          </div>
          {customEntries.length ? (
            customEntries.map(([id, backgroundId]) => {
              const entry = catalog?.hymns.find((hymn) => hymn.id === id);
              return (
                <GroupRow key={id} name={`${id} · ${entry?.title ?? ""}`} range={findName(backgroundId)} preview={resolveFor(entry?.number ?? 1, id)}>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => onChange({ hymnBackgrounds: withEntry(a.hymnBackgrounds, id, null) })}
                  >
                    {t("bgRemove")}
                  </button>
                </GroupRow>
              );
            })
          ) : (
            <p className="field__hint">{t("bgNoCustom")}</p>
          )}
        </div>
      ) : null}
    </>
  );
}
