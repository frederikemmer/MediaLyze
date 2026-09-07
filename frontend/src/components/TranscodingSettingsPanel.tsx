import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FlaskConical, Search, X } from "lucide-react";

import { AsyncPanel } from "./AsyncPanel";
import { TranscodeProfilesRulesPanel } from "./TranscodeProfilesRulesPanel";
import { TooltipTrigger } from "./TooltipTrigger";
import {
  api,
  type AppSettings,
  type TranscodeCapabilities,
  type TranscodeCapabilityMatrix,
  type TranscodeDeviceMatrix,
  type TranscodeMatrixBenchmark,
  type TranscodeMatrixBenchmarkLevel,
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
  default_output_mode: "transcode_output",
  on_error: "continue",
  retry_count: 0,
  existing_output: "fail",
  remove_partial_output: true,
};

function cloneTranscodingSettings(settings: TranscodingSettings): TranscodingSettings {
  return { ...settings };
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

function formatBenchmarkSeconds(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value)} s`;
}

function formatBenchmarkPercent(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} %`;
}

function matrixTooltipStatusKey(cell: TranscodeMatrixCell): string {
  if (cell.status === "hardware") return "transcoding.matrixTooltipStatusHardware";
  if (cell.status === "software") return "transcoding.matrixTooltipStatusSoftware";
  if (cell.status === "not_tested") return "transcoding.matrixTooltipStatusNotTested";
  return "transcoding.matrixTooltipStatusUnsupported";
}

function matrixTooltipSessionLabel(
  concurrency: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return concurrency === 1
    ? t("transcoding.matrixTooltipSession", { number: concurrency })
    : t("transcoding.matrixTooltipSessions", { number: concurrency });
}

function MatrixBenchmarkTooltip({
  benchmark,
  t,
  locale,
}: {
  benchmark: TranscodeMatrixBenchmark;
  t: (key: string, options?: Record<string, unknown>) => string;
  locale: string;
}) {
  return (
    <div className="transcode-matrix-tooltip-benchmark">
      <div className="transcode-matrix-tooltip-workload">
        {t("transcoding.matrixTooltipWorkload", {
          width: benchmark.width,
          height: benchmark.height,
          fps: benchmark.frame_rate,
          frames: benchmark.frames,
        })}
      </div>
      <div className="transcode-matrix-tooltip-workload">
        {t("transcoding.matrixTooltipCeiling", { number: benchmark.test_ceiling })}
      </div>
      <div className="transcode-matrix-tooltip-summary">
        <div>
          <span>{t("transcoding.matrixTooltipBaseline")}</span>
          <strong>{formatBenchmarkSeconds(benchmark.baseline_median_seconds, locale)}</strong>
        </div>
        <div>
          <span>{t("transcoding.matrixTooltipLimit")}</span>
          <strong>{formatBenchmarkSeconds(benchmark.slowdown_limit_seconds, locale)}</strong>
        </div>
      </div>
      <div className="transcode-matrix-tooltip-levels">
        {benchmark.levels.map((level: TranscodeMatrixBenchmarkLevel) => (
          <div
            className={`transcode-matrix-tooltip-level ${level.passed ? "is-passed" : "is-failed"}`}
            key={level.concurrency}
          >
            <div className="transcode-matrix-tooltip-level-head">
              <strong>{matrixTooltipSessionLabel(level.concurrency, t)}</strong>
              <span>{level.concurrency === 1 ? t("transcoding.matrixTooltipBaselineTag") : level.passed ? t("transcoding.matrixTooltipPassed") : t("transcoding.matrixTooltipFailed")}</span>
            </div>
            <div className="transcode-matrix-tooltip-runs">
              {level.runs.map((run) => (
                <span key={run.run}>
                  {run.success
                    ? t("transcoding.matrixTooltipRunDuration", {
                        number: run.run,
                        duration: formatBenchmarkSeconds(run.duration_seconds, locale),
                      })
                    : t("transcoding.matrixTooltipRunFailed", { number: run.run })}
                </span>
              ))}
            </div>
            <div className="transcode-matrix-tooltip-level-result">
              <span>{t("transcoding.matrixTooltipMedian", { value: formatBenchmarkSeconds(level.median_seconds, locale) })}</span>
              <span>{formatBenchmarkPercent(level.slowdown_percent, locale)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatrixCellTooltip({
  cell,
  decodeCodec,
  encodeCodec,
  t,
  locale,
}: {
  cell: TranscodeMatrixCell;
  decodeCodec: string;
  encodeCodec: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  locale: string;
}) {
  const direction = `${formatCodecLabel(decodeCodec, "video")} → ${formatCodecLabel(encodeCodec, "video")}`;
  const label = matrixCellLabel(cell, t);

  return (
    <div className="transcode-matrix-tooltip-content">
      <div className="transcode-matrix-tooltip-heading">
        <strong>{direction}</strong>
        <span className={`transcode-matrix-tooltip-status is-${cell.status}`}>
          {t(matrixTooltipStatusKey(cell))}
        </span>
      </div>
      <div className="transcode-matrix-tooltip-row transcode-matrix-tooltip-path">
        <span>{t("transcoding.matrixTooltipDecoder")}: {cell.decoder ?? "—"}</span>
        <span className="transcode-matrix-tooltip-path-arrow" aria-hidden="true">→</span>
        <span>{t("transcoding.matrixTooltipEncoder")}: {cell.encoder ?? "—"}</span>
      </div>
      {cell.parallel_benchmark ? <MatrixBenchmarkTooltip benchmark={cell.parallel_benchmark} t={t} locale={locale} /> : null}
      {cell.detail ? (
        <div className="transcode-matrix-tooltip-row transcode-matrix-tooltip-detail">
          <span>{t("transcoding.matrixTooltipDetails")}</span>
          <span>{cell.detail}</span>
        </div>
      ) : null}
    </div>
  );
}

function cellFor(
  cells: TranscodeMatrixCell[],
  decodeCodec: string,
  encodeCodec: string,
): TranscodeMatrixCell | undefined {
  return cells.find((cell) => cell.decode_codec === decodeCodec && cell.encode_codec === encodeCodec);
}

function matrixDeviceIdLabel(matrix: TranscodeDeviceMatrix): string {
  const raw = matrix.device_id.trim();
  if (raw.startsWith("device:")) return raw.slice("device:".length);
  if (raw.startsWith("render:")) {
    const node = raw.slice("render:".length).split(/[\\/]/).filter(Boolean).pop();
    return node || raw;
  }
  return raw;
}

export function TranscodingSettingsPanel({
  settings,
  appSettingsLoaded,
  onUpdated,
}: TranscodingSettingsPanelProps) {
  const { t, i18n } = useTranslation();
  const currentSettings = settings.transcoding ?? DEFAULT_TRANSCODING_SETTINGS;
  const [draft, setDraft] = useState<TranscodingSettings>(() => cloneTranscodingSettings(currentSettings));
  const [capabilities, setCapabilities] = useState<TranscodeCapabilities | null>(null);
  const [matrix, setMatrix] = useState<TranscodeCapabilityMatrix | null>(null);
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [testingMatrix, setTestingMatrix] = useState(false);
  const [matrixSearch, setMatrixSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(cloneTranscodingSettings(currentSettings));
    setPendingSave(false);
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
      })
      .catch((reason) => setError((reason as Error).message));
  }, [refreshCapabilities]);

  async function runMatrixTest() {
    setTestingMatrix(true);
    setError(null);
    try {
      const result = await api.testTranscodeCapabilityMatrix();
      setMatrix(result);
      await refreshCapabilities();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setTestingMatrix(false);
    }
  }

  function updateDraft<K extends keyof TranscodingSettings>(key: K, value: TranscodingSettings[K]) {
    setSaved(false);
    setPendingSave(true);
    setError(null);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const saveSettings = useCallback(async (settingsToSave: TranscodingSettings) => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await api.updateAppSettings({
        transcoding: { ...settingsToSave },
      });
      onUpdated(updated);
      setPendingSave(false);
      setSaved(true);
    } catch (reason) {
      setPendingSave(false);
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }, [onUpdated]);

  useEffect(() => {
    if (!appSettingsLoaded || !pendingSave) return;
    const timer = window.setTimeout(() => {
      void saveSettings(draft);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [appSettingsLoaded, draft, pendingSave, saveSettings]);

  const matrixFfmpegVersion = matrix?.ffmpeg_version ?? capabilities?.version ?? capabilities?.ffmpeg_path ?? "—";
  const matrixDevices = matrix?.matrices ?? [];
  const normalizedMatrixSearch = matrixSearch.trim().toLocaleLowerCase();
  const visibleMatrixDevices = normalizedMatrixSearch
    ? matrixDevices.filter((deviceMatrix) => (
        `${deviceMatrix.device_name} ${deviceMatrix.backend} ${deviceMatrix.device_id}`
          .toLocaleLowerCase()
          .includes(normalizedMatrixSearch)
      ))
    : matrixDevices;

  const acceleratorsTooltip = (
    <div className="transcode-matrix-meta">
      <strong>{t("transcoding.ffmpeg")}: {matrixFfmpegVersion}</strong>
      <p>{t("transcoding.matrixConcurrencyPerDirectionHint")}</p>
    </div>
  );

  const capabilityMatrix = (
    <section className="app-settings-section transcode-capability-section">
      <div className="compatibility-profile-panel transcode-automation-content transcode-capability-content">
        {testingMatrix ? <div className="notice">{t("transcoding.matrixTestNotice")}</div> : null}
        {matrix?.status === "failed" ? <div className="notice error">{matrix.error ?? t("transcoding.matrixFailed")}</div> : null}
        {!testingMatrix && matrix?.status === "not_run" ? <div className="notice">{t("transcoding.matrixNotRun")}</div> : null}
        {!testingMatrix && matrix?.status === "completed" && !matrixDevices.length ? <div className="notice">{t("transcoding.noHardware")}</div> : null}
        {matrixDevices.length ? (
          <div className="compatibility-profile-list transcode-capability-list">
            <div className="compatibility-profile-search transcode-capability-search">
              <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
              <input
                type="search"
                value={matrixSearch}
                aria-label={t("transcoding.matrixSearchLabel")}
                placeholder={t("transcoding.matrixSearchPlaceholder")}
                onChange={(event) => setMatrixSearch(event.target.value)}
              />
              {matrixSearch ? (
                <button
                  type="button"
                  className="compatibility-profile-search-clear"
                  aria-label={t("transcoding.matrixSearchClear")}
                  onClick={() => setMatrixSearch("")}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {visibleMatrixDevices.length ? visibleMatrixDevices.map((deviceMatrix, index) => (
              <details className="compatibility-profile-list-item transcode-device-matrix" key={deviceMatrix.device_id} open={index === 0}>
                <summary className="compatibility-profile-list-trigger">
                  <span className="transcode-automation-list-copy transcode-capability-device-copy"><strong>{deviceMatrix.device_name}</strong><small>{deviceMatrix.backend} · {matrixDeviceIdLabel(deviceMatrix)}</small></span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="transcode-matrix-scroll" tabIndex={0}>
                  <table className="transcode-matrix-table">
                    <thead>
                      <tr>
                        <th scope="col" className="transcode-matrix-corner">
                          <span className="transcode-matrix-axis-label transcode-matrix-axis-label-horizontal">{t("transcoding.matrixEncodeAxis")}</span>
                          <span className="transcode-matrix-axis-label transcode-matrix-axis-label-vertical">{t("transcoding.matrixDecodeAxis")}</span>
                        </th>
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
                            const title = `${formatCodecLabel(decodeCodec, "video")} → ${formatCodecLabel(encodeCodec, "video")}: ${label}`;
                            return (
                              <td className={`transcode-matrix-${cell.status}`} key={encodeCodec}>
                                <TooltipTrigger
                                  ariaLabel={title}
                                  className="transcode-matrix-cell-trigger"
                                  tooltipClassName="transcode-matrix-tooltip-portal"
                                  content={(
                                    <MatrixCellTooltip
                                      cell={cell}
                                      decodeCodec={decodeCodec}
                                      encodeCodec={encodeCodec}
                                      t={t}
                                      locale={i18n.language}
                                    />
                                  )}
                                  maxWidth={420}
                                  placement="auto"
                                >
                                  {label}
                                </TooltipTrigger>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )) : <p className="compatibility-profile-search-empty">{t("transcoding.matrixSearchEmpty")}</p>}
          </div>
        ) : null}
      </div>
    </section>
  );

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

        {draft.default_output_mode === "replace_original" ? (
          <div className="notice warning">
            <div>{t("transcoding.replacementWarning")}</div>
            <div className="field-hint">{t("common.replacementTestingNotice")}</div>
          </div>
        ) : null}

        {saving || saved ? (
          <div className="transcode-autosave-status" role="status" aria-live="polite">
            {saving ? t("transcoding.autoSaving") : t("transcoding.autoSaved")}
          </div>
        ) : null}

        <TranscodeProfilesRulesPanel capabilityMatrix={capabilityMatrix} acceleratorsTooltip={acceleratorsTooltip} />
      </div>
    </AsyncPanel>
  );
}
