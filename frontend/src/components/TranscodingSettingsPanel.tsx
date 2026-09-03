import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Save } from "lucide-react";

import { AsyncPanel } from "./AsyncPanel";
import { api, type AppSettings, type TranscodeCapabilities, type TranscodeHardwareDevice, type TranscodingSettings } from "../lib/api";

type TranscodingSettingsPanelProps = {
  settings: AppSettings;
  appSettingsLoaded: boolean;
  onUpdated: (settings: AppSettings) => void;
};

const DEFAULT_TRANSCODING_SETTINGS: TranscodingSettings = {
  execution_mode: "hardware_required",
  cpu_budget_percent: 90,
  cpu_parallel_jobs: "auto",
  gpu_parallel_jobs_per_device: 1,
  selected_devices: "auto",
  default_output_mode: "transcode_output",
  on_error: "continue",
  retry_count: 0,
  existing_output: "fail",
  remove_partial_output: true,
};

function cloneTranscodingSettings(settings: TranscodingSettings): TranscodingSettings {
  return {
    ...settings,
    selected_devices: Array.isArray(settings.selected_devices)
      ? [...settings.selected_devices]
      : settings.selected_devices,
  };
}

function deviceStatusLabel(
  device: TranscodeHardwareDevice,
  t: (key: string) => string,
): string {
  if (device.status === "available") return t("transcoding.deviceAvailable");
  if (device.status === "unavailable") return t("transcoding.deviceUnavailable");
  return t("transcoding.deviceNotDetected");
}

export function TranscodingSettingsPanel({
  settings,
  appSettingsLoaded,
  onUpdated,
}: TranscodingSettingsPanelProps) {
  const { t } = useTranslation();
  const currentSettings = settings.transcoding ?? DEFAULT_TRANSCODING_SETTINGS;
  const [draft, setDraft] = useState<TranscodingSettings>(() => cloneTranscodingSettings(currentSettings));
  const [capabilities, setCapabilities] = useState<TranscodeCapabilities | null>(null);
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(cloneTranscodingSettings(currentSettings));
  }, [currentSettings]);

  const refreshCapabilities = useCallback(async (force = false) => {
    setLoadingCapabilities(true);
    try {
      setCapabilities(await api.transcodeCapabilities(force));
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoadingCapabilities(false);
    }
  }, []);

  useEffect(() => {
    void refreshCapabilities();
  }, [refreshCapabilities]);

  function updateDraft<K extends keyof TranscodingSettings>(key: K, value: TranscodingSettings[K]) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleDevice(deviceId: string, checked: boolean) {
    const current = Array.isArray(draft.selected_devices) ? draft.selected_devices : [];
    const next = checked
      ? [...new Set([...current, deviceId])]
      : current.filter((candidate) => candidate !== deviceId);
    updateDraft("selected_devices", next);
  }

  async function saveSettings() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await api.updateAppSettings({
        transcoding: {
          ...draft,
          selected_devices: Array.isArray(draft.selected_devices)
            ? [...draft.selected_devices]
            : draft.selected_devices,
        },
      });
      onUpdated(updated);
      setSaved(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const selectableDevices = (capabilities?.devices ?? []).filter((device) => device.status === "available");
  const hardwareEncoders = capabilities?.encoders.filter((encoder) => encoder.hardware) ?? [];
  const selectedDevices = Array.isArray(draft.selected_devices) ? draft.selected_devices : [];

  return (
    <AsyncPanel
      title={t("transcoding.settingsTitle")}
      subtitle={t("transcoding.settingsDescription")}
      headerAddon={
        <button
          type="button"
          className="secondary small"
          onClick={() => void refreshCapabilities(true)}
          disabled={loadingCapabilities}
        >
          <RefreshCw className={loadingCapabilities ? "spin" : undefined} aria-hidden="true" />
          {t("transcoding.refreshProbe")}
        </button>
      }
    >
      <div className="settings-sidebar-stack">
        {error ? <div className="notice error">{error}</div> : null}
        <div className="app-settings-performance-grid">
          <div className="field">
            <label htmlFor="transcoding-execution-mode">{t("transcoding.executionMode")}</label>
            <select
              id="transcoding-execution-mode"
              value={draft.execution_mode}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("execution_mode", event.target.value as TranscodingSettings["execution_mode"])}
            >
              <option value="hardware_required">{t("transcoding.hardwareRequired")}</option>
              <option value="cpu_only">{t("transcoding.cpuOnly")}</option>
            </select>
            <span className="field-hint">{t("transcoding.hardwareRequiredHint")}</span>
          </div>
          <div className="field">
            <label htmlFor="transcoding-output-mode">{t("transcoding.defaultOutputMode")}</label>
            <select
              id="transcoding-output-mode"
              value={draft.default_output_mode}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("default_output_mode", event.target.value as TranscodingSettings["default_output_mode"])}
            >
              <option value="transcode_output">{t("transcoding.transcodeOutput")}</option>
              <option value="same_directory">{t("transcoding.sameDirectory")}</option>
              <option value="replace_original">{t("transcoding.replaceOriginal")}</option>
            </select>
            <span className="field-hint">{t("transcoding.outputModeHint")}</span>
          </div>
          <div className="field">
            <label htmlFor="transcoding-cpu-budget">{t("transcoding.cpuBudget")}</label>
            <input
              id="transcoding-cpu-budget"
              type="number"
              min={1}
              max={100}
              value={draft.cpu_budget_percent}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("cpu_budget_percent", Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
            />
            <span className="field-hint">{t("transcoding.cpuBudgetHint")}</span>
          </div>
          <div className="field">
            <label htmlFor="transcoding-cpu-jobs">{t("transcoding.cpuParallelJobs")}</label>
            <select
              id="transcoding-cpu-jobs"
              value={draft.cpu_parallel_jobs}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => {
                const value = event.target.value;
                updateDraft("cpu_parallel_jobs", value === "auto" ? "auto" : Number(value));
              }}
            >
              <option value="auto">{t("transcoding.auto")}</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="transcoding-gpu-jobs">{t("transcoding.gpuParallelJobs")}</label>
            <input
              id="transcoding-gpu-jobs"
              type="number"
              min={1}
              max={8}
              value={draft.gpu_parallel_jobs_per_device}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("gpu_parallel_jobs_per_device", Math.max(1, Math.min(8, Number(event.target.value) || 1)))}
            />
          </div>
          <div className="field">
            <label htmlFor="transcoding-error-policy">{t("transcoding.onError")}</label>
            <select
              id="transcoding-error-policy"
              value={draft.on_error}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("on_error", event.target.value as TranscodingSettings["on_error"])}
            >
              <option value="continue">{t("transcoding.continue")}</option>
              <option value="stop_queue">{t("transcoding.stopQueue")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="transcoding-retry-count">{t("transcoding.retryCount")}</label>
            <input
              id="transcoding-retry-count"
              type="number"
              min={0}
              max={5}
              value={draft.retry_count}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("retry_count", Math.max(0, Math.min(5, Number(event.target.value) || 0)))}
            />
          </div>
          <div className="field">
            <label htmlFor="transcoding-existing-output">{t("transcoding.existingOutput")}</label>
            <select
              id="transcoding-existing-output"
              value={draft.existing_output}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("existing_output", event.target.value as TranscodingSettings["existing_output"])}
            >
              <option value="fail">{t("transcoding.fail")}</option>
              <option value="skip">{t("transcoding.skip")}</option>
            </select>
          </div>
        </div>

        <label className="transcode-filename-option">
          <input
            type="checkbox"
            checked={draft.remove_partial_output}
            disabled={!appSettingsLoaded || saving}
            onChange={(event) => updateDraft("remove_partial_output", event.target.checked)}
          />
          <span>{t("transcoding.removePartial")}</span>
        </label>

        <section className="app-settings-section">
          <p className="app-settings-section-title">{t("transcoding.selectedDevices")}</p>
          <label className="transcode-filename-option">
            <input
              type="radio"
              name="transcoding-device-selection"
              checked={draft.selected_devices === "auto"}
              disabled={!appSettingsLoaded || saving}
              onChange={() => updateDraft("selected_devices", "auto")}
            />
            <span>{t("transcoding.allDetected")}</span>
          </label>
          <label className="transcode-filename-option">
            <input
              type="radio"
              name="transcoding-device-selection"
              checked={Array.isArray(draft.selected_devices)}
              disabled={!appSettingsLoaded || saving}
              onChange={() => updateDraft(
                "selected_devices",
                selectedDevices.length ? selectedDevices : selectableDevices.map((device) => device.id),
              )}
            />
            <span>{t("common.selectSpecificDevices")}</span>
          </label>
          {selectableDevices.length ? (
            <div className="settings-choice-list">
              {selectableDevices.map((device) => (
                <label className="transcode-filename-option" key={device.id}>
                  <input
                    type="checkbox"
                    checked={selectedDevices.includes(device.id)}
                    disabled={!appSettingsLoaded || saving || draft.selected_devices === "auto"}
                    onChange={(event) => toggleDevice(device.id, event.target.checked)}
                  />
                  <span>{device.name} ({device.id})</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="field-hint">{t("transcoding.noHardware")}</p>
          )}
        </section>

        <section className="transcode-capability-diagnostics">
          <div className="field-label-row">
            <h3>{t("transcoding.hardwareDiagnostics")}</h3>
            {capabilities?.last_tested_at ? <span className="field-hint">{capabilities.last_tested_at}</span> : null}
          </div>
          {loadingCapabilities ? <p className="field-hint">{t("panel.loading")}</p> : null}
          {capabilities && !loadingCapabilities ? (
            <>
              <p className="field-hint">
                {t("transcoding.ffmpeg")}: {capabilities.version ?? capabilities.ffmpeg_path}
              </p>
              {!capabilities.ffmpeg_available ? <div className="notice error">{capabilities.error ?? t("transcoding.ffmpegUnavailable")}</div> : null}
              {!capabilities.devices?.length ? <div className="notice">{t("transcoding.noHardware")}</div> : null}
              <div className="transcode-capability-list">
                {(capabilities.devices ?? []).map((device) => (
                  <div className="transcode-capability-item" key={device.id}>
                    <div>
                      <strong>{device.name}</strong>
                      <span>{device.backend} · {device.id} · {deviceStatusLabel(device, t)}</span>
                    </div>
                    {device.failure_reason ? <p className="notice compact error">{device.failure_reason}</p> : null}
                  </div>
                ))}
              </div>
              {hardwareEncoders.length ? (
                <div className="transcode-capability-list">
                  {hardwareEncoders.map((encoder) => (
                    <div className="transcode-capability-item" key={encoder.name}>
                      <span>{encoder.name}</span>
                      <span className={`badge ${encoder.available ? "transcode-status-completed" : "transcode-status-failed"}`}>
                        {encoder.available ? t("transcoding.deviceAvailable") : t("transcoding.deviceUnavailable")}
                      </span>
                      {!encoder.available && encoder.test_error ? <p className="notice compact error">{encoder.test_error}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        {draft.default_output_mode === "replace_original" ? (
          <div className="notice warning">
            <div>{t("transcoding.replacementWarning")}</div>
            <div className="field-hint">{t("common.replacementTestingNotice")}</div>
          </div>
        ) : null}

        <div className="transcode-actions">
          <button type="button" className="transcode-action-button" onClick={() => void saveSettings()} disabled={!appSettingsLoaded || saving}>
            <Save aria-hidden="true" />
            {saving ? t("transcoding.saving") : t("transcoding.save")}
          </button>
          {saved ? <span className="field-hint" role="status">{t("transcoding.saved")}</span> : null}
        </div>
      </div>
    </AsyncPanel>
  );
}
