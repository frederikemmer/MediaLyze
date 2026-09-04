import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical, Save } from "lucide-react";

import { AsyncPanel } from "./AsyncPanel";
import { TooltipTrigger } from "./TooltipTrigger";
import {
  api,
  type AppSettings,
  type TranscodeCapabilities,
  type TranscodeCapabilityMatrix,
  type TranscodeHardwareDevice,
  type TranscodeMatrixCell,
  type TranscodingSettings,
} from "../lib/api";
import { formatCodecLabel } from "../lib/format";

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

type DeviceSelectionOption = {
  key: string;
  label: string;
  allDeviceIds: string[];
  availableDeviceIds: string[];
};

function deviceSelectionKey(device: TranscodeHardwareDevice): string {
  return device.render_node ? `render:${device.render_node}` : `device:${device.id}`;
}

function matrixCellLabel(cell: TranscodeMatrixCell, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (cell.status === "hardware") {
    const suffix = cell.max_parallel_jobs_is_lower_bound ? "+" : "";
    return t("transcoding.matrixHardwareCell", { count: `${cell.max_parallel_jobs ?? 1}${suffix}` });
  }
  if (cell.status === "software") return t("transcoding.matrixSoftwareCell");
  if (cell.status === "not_tested") return t("transcoding.matrixNotTestedCell");
  return t("transcoding.matrixUnsupportedCell");
}

function cellFor(
  cells: TranscodeMatrixCell[],
  decodeCodec: string,
  encodeCodec: string,
): TranscodeMatrixCell | undefined {
  return cells.find((cell) => cell.decode_codec === decodeCodec && cell.encode_codec === encodeCodec);
}

function deviceSelectionLabel(devices: TranscodeHardwareDevice[]): string {
  const first = devices[0];
  if (!first) return "";
  if (!first.render_node) return first.name.replace(/\s+\(automatic\)$/i, "");

  const nameParts = first.name.split(" · ");
  return nameParts.length > 1 ? nameParts.slice(0, -1).join(" · ") : first.name;
}

function buildDeviceSelectionOptions(devices: TranscodeHardwareDevice[]): DeviceSelectionOption[] {
  const groups = new Map<string, TranscodeHardwareDevice[]>();
  for (const device of devices) {
    const key = deviceSelectionKey(device);
    const group = groups.get(key) ?? [];
    group.push(device);
    groups.set(key, group);
  }

  return Array.from(groups, ([key, group]) => ({
    key,
    label: deviceSelectionLabel(group),
    allDeviceIds: group.map((device) => device.id),
    availableDeviceIds: group
      .filter((device) => device.status === "available")
      .map((device) => device.id),
  }));
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
  const [matrix, setMatrix] = useState<TranscodeCapabilityMatrix | null>(null);
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [testingMatrix, setTestingMatrix] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);
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
    void api.transcodeCapabilityMatrix()
      .then((result) => {
        setMatrix(result);
        setMatrixOpen(result.status === "completed" && result.matrices.length > 0);
      })
      .catch((reason) => setError((reason as Error).message));
  }, [refreshCapabilities]);

  async function runMatrixTest() {
    setTestingMatrix(true);
    setMatrixOpen(true);
    setError(null);
    try {
      const result = await api.testTranscodeCapabilityMatrix();
      setMatrix(result);
      setMatrixOpen(true);
      await refreshCapabilities();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setTestingMatrix(false);
    }
  }

  function updateDraft<K extends keyof TranscodingSettings>(key: K, value: TranscodingSettings[K]) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
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

  const deviceSelectionOptions = buildDeviceSelectionOptions(capabilities?.devices ?? []);
  const selectedDevices = Array.isArray(draft.selected_devices) ? draft.selected_devices : [];
  const selectedDeviceOption =
    draft.selected_devices === "auto" || selectedDevices.length === 0
      ? "auto"
      : deviceSelectionOptions.find((option) =>
          option.allDeviceIds.some((deviceId) => selectedDevices.includes(deviceId)),
        )?.key ?? "configured-unavailable";
  const hasConfiguredUnavailableDevice = selectedDeviceOption === "configured-unavailable";

  return (
    <AsyncPanel
      title={t("transcoding.settingsTitle")}
      titleAddon={
        <TooltipTrigger
          ariaLabel={t("transcoding.settingsDescriptionAria")}
          content={t("transcoding.settingsDescription")}
          preserveLineBreaks
        >
          ?
        </TooltipTrigger>
      }
      headerAddon={
        <button
          type="button"
          className="secondary small settings-panel-header-action"
          onClick={() => void runMatrixTest()}
          disabled={loadingCapabilities || testingMatrix}
        >
          <FlaskConical className={testingMatrix ? "spin" : undefined} aria-hidden="true" size={16} />
          {testingMatrix ? t("transcoding.matrixTesting") : t("transcoding.matrixStartTest")}
        </button>
      }
    >
      <div className="settings-sidebar-stack">
        {error ? <div className="notice error">{error}</div> : null}
        <div className="app-settings-performance-grid">
          <div className="field">
            <div className="field-label-row">
              <label htmlFor="transcoding-execution-mode">{t("transcoding.executionMode")}</label>
              <TooltipTrigger
                ariaLabel={t("transcoding.hardwareRequiredHintAria")}
                content={t("transcoding.hardwareRequiredHint")}
                preserveLineBreaks
              >
                ?
              </TooltipTrigger>
            </div>
            <select
              id="transcoding-execution-mode"
              value={draft.execution_mode}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("execution_mode", event.target.value as TranscodingSettings["execution_mode"])}
            >
              <option value="hardware_required">{t("transcoding.hardwareRequired")}</option>
              <option value="cpu_only">{t("transcoding.cpuOnly")}</option>
            </select>
          </div>
          <div className="field">
            <div className="field-label-row">
              <label htmlFor="transcoding-output-mode">{t("transcoding.defaultOutputMode")}</label>
              <TooltipTrigger
                ariaLabel={t("transcoding.outputModeHintAria")}
                content={t("transcoding.outputModeHint")}
                preserveLineBreaks
              >
                ?
              </TooltipTrigger>
            </div>
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
          </div>
          <div className="field">
            <div className="field-label-row">
              <label htmlFor="transcoding-cpu-budget">{t("transcoding.cpuBudget")}</label>
              <TooltipTrigger
                ariaLabel={t("transcoding.cpuBudgetHintAria")}
                content={t("transcoding.cpuBudgetHint")}
                preserveLineBreaks
              >
                ?
              </TooltipTrigger>
            </div>
            <input
              id="transcoding-cpu-budget"
              type="number"
              min={1}
              max={100}
              value={draft.cpu_budget_percent}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("cpu_budget_percent", Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
            />
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
          <p className="app-settings-section-title">{t("transcoding.selectedDevice")}</p>
          <div className="field">
            <label htmlFor="transcoding-selected-device">{t("transcoding.selectedDevice")}</label>
            <select
              id="transcoding-selected-device"
              value={selectedDeviceOption}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => {
                const option = deviceSelectionOptions.find((candidate) => candidate.key === event.target.value);
                updateDraft(
                  "selected_devices",
                  event.target.value === "auto" ? "auto" : option?.availableDeviceIds ?? [],
                );
              }}
            >
              <option value="auto">{t("transcoding.allDetected")}</option>
              {hasConfiguredUnavailableDevice ? (
                <option value="configured-unavailable" disabled>
                  {t("transcoding.configuredDeviceUnavailable")}
                </option>
              ) : null}
              {deviceSelectionOptions.map((option) => (
                <option disabled={!option.availableDeviceIds.length} key={option.key} value={option.key}>
                  {option.label}{!option.availableDeviceIds.length ? ` — ${t("transcoding.deviceUnavailable")}` : ""}
                </option>
              ))}
            </select>
          </div>
          {!deviceSelectionOptions.some((option) => option.availableDeviceIds.length) ? (
            <p className="field-hint">{t("transcoding.noHardware")}</p>
          ) : null}
        </section>

        <details
          className="transcode-capability-matrix"
          open={matrixOpen}
          onToggle={(event) => setMatrixOpen(event.currentTarget.open)}
        >
          <summary>
            <span>
              <strong>{t("transcoding.matrixTitle")}</strong>
              <small>{t("transcoding.matrixAxisSummary")}</small>
            </span>
            {matrix?.tested_at ? <span className="field-hint">{new Date(matrix.tested_at).toLocaleString()}</span> : null}
          </summary>
          <div className="transcode-capability-matrix-body">
            <div className="transcode-matrix-meta">
              <span>{t("transcoding.ffmpeg")}: {matrix?.ffmpeg_version ?? capabilities?.version ?? capabilities?.ffmpeg_path}</span>
              <span>{t("transcoding.matrixConcurrencyPerDirectionHint")}</span>
            </div>
            {testingMatrix ? <div className="notice">{t("transcoding.matrixTestNotice")}</div> : null}
            {matrix?.status === "failed" ? <div className="notice error">{matrix.error ?? t("transcoding.matrixFailed")}</div> : null}
            {!testingMatrix && matrix?.status === "not_run" ? <div className="notice">{t("transcoding.matrixNotRun")}</div> : null}
            {!testingMatrix && matrix?.status === "completed" && !matrix.matrices.length ? <div className="notice">{t("transcoding.noHardware")}</div> : null}
            {matrix?.matrices.map((deviceMatrix, index) => (
              <details className="transcode-device-matrix" key={deviceMatrix.device_id} open={index === 0}>
                <summary>
                  <span><strong>{deviceMatrix.device_name}</strong><small>{deviceMatrix.backend} · {deviceMatrix.device_id}</small></span>
                </summary>
                <div className="transcode-matrix-scroll" tabIndex={0}>
                  <table className="transcode-matrix-table">
                    <thead>
                      <tr>
                        <th scope="col" className="transcode-matrix-corner">{t("transcoding.matrixDecodeAxis")} ↓<br />{t("transcoding.matrixEncodeAxis")} →</th>
                        {deviceMatrix.encode_codecs.map((codec) => <th scope="col" key={codec}>{formatCodecLabel(codec, "video")}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {deviceMatrix.decode_codecs.map((decodeCodec) => (
                        <tr key={decodeCodec}>
                          <th scope="row">{formatCodecLabel(decodeCodec, "video")}</th>
                          {deviceMatrix.encode_codecs.map((encodeCodec) => {
                            const cell = cellFor(deviceMatrix.cells, decodeCodec, encodeCodec);
                            if (!cell) return <td key={encodeCodec}>—</td>;
                            const label = matrixCellLabel(cell, t);
                            const title = `${formatCodecLabel(decodeCodec, "video")} → ${formatCodecLabel(encodeCodec, "video")}: ${label}${cell.detail ? ` · ${cell.detail}` : ""}`;
                            return <td className={`transcode-matrix-${cell.status}`} key={encodeCodec} title={title} aria-label={title}>{label}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="transcode-matrix-legend" aria-label={t("transcoding.matrixLegend")}>
                  <span className="transcode-matrix-hardware">{t("transcoding.matrixHardwareLegend")}</span>
                  <span className="transcode-matrix-software">{t("transcoding.matrixSoftwareLegend")}</span>
                  <span className="transcode-matrix-unsupported">{t("transcoding.matrixUnsupportedLegend")}</span>
                  <span className="transcode-matrix-not_tested">{t("transcoding.matrixNotTestedLegend")}</span>
                </div>
              </details>
            ))}
          </div>
        </details>

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
