// Configuración → Audio: salida del Himnario, independiente de la
// predeterminada del sistema. Rust abre solo la salida elegida; aquí se lista,
// se elige, se prueba y se muestra por dónde suena.

import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n";
import { ipc } from "../../lib/ipc";
import { run, shallowEqual, useAppStore } from "../../stores/appStore";
import type { AudioDevices, OutputPreference } from "../../types/domain";

const SYSTEM = "system";

function toValue(preference: OutputPreference) {
  return preference.mode === "system" ? SYSTEM : `device:${preference.id}`;
}

interface AudioOutputSettingsProps {
  value: OutputPreference;
  onChange: (preference: OutputPreference) => void;
}

export function AudioOutputSettings({ value, onChange }: AudioOutputSettingsProps) {
  const [list, setList] = useState<AudioDevices | null>(null);
  const [loading, setLoading] = useState(false);
  const { device, missing, playing } = useAppStore(
    (s) => ({
      device: s.playback?.audioDevice ?? null,
      missing: s.playback?.audioMissing ?? null,
      playing: s.playback?.status === "playing",
    }),
    shallowEqual,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await run(() => ipc.audioDevices());
    if (result) setList(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const devices = list?.devices ?? [];
  const known = value.mode === "system" || devices.some((d) => d.id === value.id);
  const systemName = list?.systemDefault?.name;

  const choose = (selected: string) => {
    if (selected === SYSTEM) return onChange({ mode: "system" });
    const id = selected.slice("device:".length);
    const found = devices.find((d) => d.id === id);
    if (found) onChange({ mode: "device", id: found.id, name: found.name });
  };

  return (
    <div className="audio-output">
      <label className="field">
        <span className="field__label">{t("audioOutput")}</span>
        <span className="field__control">
          <select value={toValue(value)} onChange={(event) => choose(event.target.value)}>
            <option value={SYSTEM}>
              {systemName ? t("audioOutputSystemNamed", { name: systemName }) : t("audioOutputSystem")}
            </option>
            {devices.map((d) => (
              <option key={d.id} value={`device:${d.id}`}>
                {d.name}
              </option>
            ))}
            {!known && value.mode === "device" ? (
              <option value={toValue(value)}>{t("audioOutputDisconnected", { name: value.name })}</option>
            ) : null}
          </select>
        </span>
        <span className="field__hint">{loading && !list ? t("audioOutputLoading") : t("audioOutputHint")}</span>
      </label>

      <p className={`audio-output__status${missing ? " is-missing" : ""}`} role="status">
        {missing ? t("audioMissing", { device: missing }) : device ? t("audioPlayingThrough", { device }) : null}
      </p>

      <div className="audio-output__actions">
        <button
          type="button"
          className="button"
          disabled={playing || Boolean(missing)}
          title={playing ? t("audioOutputTestBusy") : t("audioOutputTestTitle")}
          onClick={() => void run(() => ipc.testAudioOutput())}
        >
          {t("audioOutputTest")}
        </button>
        <button type="button" className="button button--ghost" disabled={loading} onClick={() => void refresh()}>
          {t("audioOutputRefresh")}
        </button>
      </div>
    </div>
  );
}
