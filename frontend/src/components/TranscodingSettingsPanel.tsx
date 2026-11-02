import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Cpu, FlaskConical, Gpu, Network } from "lucide-react";

import { AsyncPanel } from "./AsyncPanel";
import { PanelEmptyState } from "./PanelEmptyState";
import { TranscodePresetsRulesPanel } from "./TranscodePresetsRulesPanel";
import { TranscodeFederationPanel } from "./TranscodeFederationPanel";
import { TooltipTrigger } from "./TooltipTrigger";
import {
  api,
  type AppSettings,
  type TranscodeCapabilities,
  type TranscodeCapabilityMatrix,
  type TranscodeDeviceMatrix,
  type TranscodeFederation,
  type TranscodeMatrixBenchmark,
  type TranscodeMatrixBenchmarkLevel,
  type TranscodeMatrixCell,
  type TranscodeMatrixTestProgress,
  type TranscodingSettings,
} from "../lib/api";
import { formatCodecLabel } from "../lib/format";
import { releaseVisibility } from "../lib/release-visibility";
import {
  buildTranscodingMatrixEntryKey,
  buildTranscodingMatrixAnchorId,
  getTranscodingMatrixExpansionState,
  saveTranscodingMatrixExpansionState,
  type TranscodingMatrixExpansionState,
  type TranscodingMatrixFocus,
} from "../lib/transcoding-matrix-state";

type TranscodingSettingsPanelProps = {
  settings: AppSettings;
  appSettingsLoaded: boolean;
  onUpdated: (settings: AppSettings) => void;
  searchFocus?: string | null;
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

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
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

function matrixDeviceKind(matrix: TranscodeDeviceMatrix): "cpu" | "gpu" {
  if (matrix.device_class === "integrated") return "cpu";
  if (matrix.device_class === "dedicated") return "gpu";

  const normalized = `${matrix.device_name} ${matrix.backend}`.toLowerCase();
  return /\b(cpu|apu|igpu|integrated)\b/.test(normalized) || normalized.includes("radeon(tm) graphics")
    ? "cpu"
    : "gpu";
}

function matrixTestDeviceCount(
  capabilities: TranscodeCapabilities | null,
  matrix: TranscodeCapabilityMatrix | null,
): number {
  if (capabilities?.devices) {
    const deviceGroups = new Set(
      capabilities.devices
        .filter((device) => device.status === "available")
        .map((device) => device.render_node ? `render:${device.render_node}` : `device:${device.id}`),
    );
    return Math.max(deviceGroups.size, 1);
  }
  return Math.max(matrix?.matrices.length ?? 0, 1);
}

export function TranscodingSettingsPanel({
  settings,
  appSettingsLoaded,
  onUpdated,
  searchFocus = null,
}: TranscodingSettingsPanelProps) {
  const { t, i18n } = useTranslation();
  const currentSettings = settings.transcoding ?? DEFAULT_TRANSCODING_SETTINGS;
  const [draft, setDraft] = useState<TranscodingSettings>(() => cloneTranscodingSettings(currentSettings));
  const [capabilities, setCapabilities] = useState<TranscodeCapabilities | null>(null);
  const [matrix, setMatrix] = useState<TranscodeCapabilityMatrix | null>(null);
  const [federation, setFederation] = useState<TranscodeFederation | null>(null);
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [testingMatrix, setTestingMatrix] = useState(false);
  const [matrixTestProgress, setMatrixTestProgress] = useState({ completed: 0, total: 1 });
  const [testingNetwork, setTestingNetwork] = useState(false);
  const [automationRulesCollapsed, setAutomationRulesCollapsed] = useState(true);
  const [acceleratorsCollapsed, setAcceleratorsCollapsed] = useState(true);
  const [matrixExpansionState, setMatrixExpansionState] = useState<TranscodingMatrixExpansionState>(
    getTranscodingMatrixExpansionState,
  );
  const [matrixFocus, setMatrixFocus] = useState<TranscodingMatrixFocus | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networkTestMessage, setNetworkTestMessage] = useState<string | null>(null);
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
    setMatrixTestProgress({ completed: 0, total: 1 });
    setNetworkTestMessage(null);
    setError(null);
    const testErrors: string[] = [];

    let currentFederation = releaseVisibility.federation ? federation : null;
    if (releaseVisibility.federation && !currentFederation) {
      try {
        currentFederation = await api.transcodeFederation();
        setFederation(currentFederation);
      } catch (reason) {
        testErrors.push(errorMessage(reason));
      }
    }
    const connectedMembers = currentFederation?.settings.enabled
      ? currentFederation.members.filter((member) => (
          member.status === "active"
          && member.connection_status === "connected"
        ))
      : [];
    const localTestUnits = matrixTestDeviceCount(capabilities, matrix);
    const connectedMemberTasks = connectedMembers.map((member) => ({
      member,
      units: matrixTestDeviceCount(member.capabilities, member.capability_matrix),
    }));
    const totalTargets = localTestUnits + connectedMemberTasks.reduce((total, task) => total + task.units, 0);
    let completedTargets = 0;
    setMatrixTestProgress({ completed: completedTargets, total: totalTargets });

    const trackTargetProgress = async <T,>(
      units: number,
      readProgress: () => Promise<TranscodeMatrixTestProgress>,
      runTest: () => Promise<T>,
    ): Promise<T> => {
      let tracking = true;
      let progressRequestActive = false;
      let interval: number | null = null;
      const stopTracking = () => {
        tracking = false;
        if (interval !== null) window.clearInterval(interval);
      };
      const pollProgress = async () => {
        if (!tracking || progressRequestActive) return;
        progressRequestActive = true;
        try {
          const progress = await readProgress();
          if (tracking && progress.running && progress.total > 0) {
            const fraction = Math.max(0, Math.min(progress.completed / progress.total, 1));
            setMatrixTestProgress({
              completed: Math.min(totalTargets, completedTargets + units * fraction),
              total: totalTargets,
            });
          }
        } catch {
          stopTracking();
        } finally {
          progressRequestActive = false;
        }
      };

      interval = window.setInterval(() => void pollProgress(), 350);
      try {
        return await runTest();
      } finally {
        stopTracking();
        completedTargets = Math.min(totalTargets, completedTargets + units);
        setMatrixTestProgress({ completed: completedTargets, total: totalTargets });
      }
    };

    try {
      const result = await trackTargetProgress(
        localTestUnits,
        () => api.transcodeCapabilityMatrixTestProgress(),
        () => api.testTranscodeCapabilityMatrix(),
      );
      setMatrix(result);
      await refreshCapabilities();
    } catch (reason) {
      testErrors.push(errorMessage(reason));
    }

    for (const { member, units } of connectedMemberTasks) {
      try {
        setFederation(await trackTargetProgress(
          units,
          () => api.transcodeFederationMemberCapabilityMatrixTestProgress(member.installation_id),
          () => api.testTranscodeFederationMemberCapabilityMatrix(member.installation_id),
        ));
      } catch (reason) {
        testErrors.push(`${member.display_name}: ${errorMessage(reason)}`);
      }
    }

    if (testErrors.length) setError(testErrors.join(" · "));
    setTestingMatrix(false);
    setMatrixTestProgress({ completed: totalTargets, total: totalTargets });
  }

  async function runNetworkTest() {
    setTestingNetwork(true);
    setNetworkTestMessage(null);
    setError(null);
    try {
      const result = await api.testTranscodeFederationNetwork();
      setFederation(result);
      setNetworkTestMessage(t("transcoding.federationNetworkTestComplete"));
    } catch (reason) {
      setError(errorMessage(reason));
      try {
        setFederation(await api.transcodeFederation());
      } catch {
        // Preserve the last federation snapshot when refreshing after a
        // failed diagnostic also crosses a transient connection failure.
      }
    } finally {
      setTestingNetwork(false);
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

  useEffect(() => {
    saveTranscodingMatrixExpansionState(matrixExpansionState);
  }, [matrixExpansionState]);

  const matrixFfmpegVersion = matrix?.ffmpeg_version ?? capabilities?.version ?? capabilities?.ffmpeg_path ?? "—";
  const matrixDevices = matrix?.matrices ?? [];
  const matrixEntries = [
    ...matrixDevices.map((deviceMatrix) => ({ deviceMatrix, memberName: null as string | null, memberInstallationId: null as string | null })),
    ...(releaseVisibility.federation ? federation?.members ?? [] : []).flatMap((member) => (
      member.capability_matrix?.status === "completed"
        ? member.capability_matrix.matrices.map((deviceMatrix) => ({
            deviceMatrix,
            memberName: member.display_name,
            memberInstallationId: member.installation_id,
          }))
        : []
    )),
  ];
  const visibleMatrixEntryKeys = matrixEntries.map(({ deviceMatrix, memberInstallationId }) => (
    buildTranscodingMatrixEntryKey(memberInstallationId, deviceMatrix.device_id)
  ));
  const hasStoredVisibleMatrixState = visibleMatrixEntryKeys.some((key) => (
    Object.prototype.hasOwnProperty.call(matrixExpansionState, key)
  ));
  const matrixEntrySignature = visibleMatrixEntryKeys.join("|");
  const matrixFocusEntryKey = matrixFocus
    ? buildTranscodingMatrixEntryKey(matrixFocus.memberInstallationId, matrixFocus.deviceId)
    : null;
  const canTestFederationNetwork = releaseVisibility.federation && Boolean(
    federation?.settings.enabled
      && federation.members.some((member) => (
        member.status === "active"
        && member.connection_status === "connected"
      )),
  );

  useEffect(() => {
    if (!matrixFocus) return undefined;
    const anchorId = buildTranscodingMatrixAnchorId(
      matrixFocus.memberInstallationId,
      matrixFocus.deviceId,
    );
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(anchorId);
      if (!target) return;
      target.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      target.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [matrixEntrySignature, matrixFocus]);

  const acceleratorsTooltip = (
    <div className="transcode-matrix-meta">
      <strong>{t("transcoding.ffmpeg")}: {matrixFfmpegVersion}</strong>
      <p>{t("transcoding.matrixConcurrencyPerDirectionHint")}</p>
    </div>
  );

  const capabilityMatrix = (tabControls: ReactNode) => (
    <section className="transcode-automation-tab-content transcode-capability-section transcode-capability-content">
      <div className="compatibility-profile-list transcode-capability-list">
          {tabControls}
          {testingMatrix && releaseVisibility.federation ? <div className="notice">{t("transcoding.matrixTestNotice")}</div> : null}
          {matrix?.status === "failed" ? <div className="notice error">{matrix.error ?? t("transcoding.matrixFailed")}</div> : null}
          {!testingMatrix && matrix?.status === "not_run" && !matrixEntries.length ? <PanelEmptyState message={t("transcoding.matrixNotRun")} /> : null}
          {!testingMatrix && matrix?.status === "completed" && !matrixEntries.length ? <div className="notice">{t("transcoding.noHardware")}</div> : null}
          {matrixEntries.length ? (
            <>
              {matrixEntries.map(({ deviceMatrix, memberName, memberInstallationId }, index) => {
                const matrixEntryKey = buildTranscodingMatrixEntryKey(memberInstallationId, deviceMatrix.device_id);
                const hasStoredMatrixState = Object.prototype.hasOwnProperty.call(matrixExpansionState, matrixEntryKey);
                const matrixEntryOpen = matrixEntryKey === matrixFocusEntryKey
                  ? true
                  : hasStoredMatrixState
                  ? matrixExpansionState[matrixEntryKey]
                  : !hasStoredVisibleMatrixState && index === 0;
                const deviceKind = matrixDeviceKind(deviceMatrix);
                return (
                  <details
                    className="compatibility-profile-list-item transcode-device-matrix"
                    id={buildTranscodingMatrixAnchorId(memberInstallationId, deviceMatrix.device_id)}
                    key={matrixEntryKey}
                    open={matrixEntryOpen}
                    onToggle={(event) => {
                      const nextState = event.currentTarget.open;
                      setMatrixExpansionState((current) => ({ ...current, [matrixEntryKey]: nextState }));
                    }}
                  >
                    <summary className="compatibility-profile-list-trigger">
                      <span className="transcode-automation-list-copy transcode-capability-device-copy">
                        <span className="transcode-capability-device-name">
                          {deviceKind === "cpu" ? (
                            <Cpu aria-hidden="true" className="transcode-capability-device-icon transcode-capability-device-icon-cpu" size={16} />
                          ) : (
                            <Gpu aria-hidden="true" className="transcode-capability-device-icon transcode-capability-device-icon-gpu" size={16} />
                          )}
                          <strong>{deviceMatrix.device_name}</strong>
                          <span className={`badge transcode-federation-member-pill${memberInstallationId === null ? " transcode-federation-local-pill" : ""}`}>
                            {memberName ?? "local"}
                          </span>
                        </span>
                        <small>{deviceMatrix.backend}</small>
                      </span>
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
                );
              })}
            </>
          ) : null}
      </div>
    </section>
  );

  const matrixTestAction = (
    <button
      type="button"
      className="secondary small settings-panel-header-action transcode-matrix-test-button"
      onClick={() => void runMatrixTest()}
      disabled={loadingCapabilities || testingMatrix || testingNetwork}
      aria-busy={testingMatrix}
    >
      <FlaskConical className={testingMatrix ? "spin" : undefined} aria-hidden="true" size={16} />
      {testingMatrix
        ? t("transcoding.matrixTestingProgress", {
            progress: Math.round((matrixTestProgress.completed / Math.max(matrixTestProgress.total, 1)) * 100),
          })
        : t("transcoding.matrixStartTest")}
      {testingMatrix ? (
        <span
          className="transcode-matrix-test-progress"
          role="progressbar"
          aria-label={t("transcoding.matrixTestProgressAria")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((matrixTestProgress.completed / Math.max(matrixTestProgress.total, 1)) * 100)}
          style={{ "--matrix-test-progress": `${(matrixTestProgress.completed / Math.max(matrixTestProgress.total, 1)) * 100}%` } as React.CSSProperties}
        >
          <span />
        </span>
      ) : null}
    </button>
  );

  return (
    <AsyncPanel
      title={t("transcoding.settingsTitle")}
      titleAddon={
        <TooltipTrigger
          ariaLabel={t("transcoding.settingsDescriptionAria")}
          content={t("transcoding.settingsDescription")}
          className="settings-heading-tooltip"
          preserveLineBreaks
        >
          ?
        </TooltipTrigger>
      }
      headerAddon={canTestFederationNetwork ? (
        <button
          type="button"
          className="secondary small settings-panel-header-action"
          onClick={() => void runNetworkTest()}
          disabled={testingMatrix || testingNetwork}
        >
          <Network className={testingNetwork ? "spin" : undefined} aria-hidden="true" size={16} />
          {testingNetwork
            ? t("transcoding.federationNetworkTesting")
            : t("transcoding.federationNetworkTestStart")}
        </button>
      ) : undefined}
    >
      <div className="settings-sidebar-stack">
        {error ? <div className="notice error">{error}</div> : null}
        {testingNetwork ? <div className="notice" role="status">{t("transcoding.federationNetworkTestNotice")}</div> : null}
        {networkTestMessage ? <div className="notice" role="status">{networkTestMessage}</div> : null}
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
              className="settings-choice-input"
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
              className="settings-choice-input"
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
              className="settings-choice-input"
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
              className="settings-choice-input"
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
            <label htmlFor="transcoding-error-policy">{t("transcoding.onError")}</label>
            <select
              id="transcoding-error-policy"
              className="settings-choice-input"
              value={draft.on_error}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("on_error", event.target.value as TranscodingSettings["on_error"])}
            >
              <option value="continue">{t("transcoding.continue")}</option>
              <option value="stop_queue">{t("transcoding.stopQueue")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="transcoding-existing-output">{t("transcoding.existingOutput")}</label>
            <select
              id="transcoding-existing-output"
              className="settings-choice-input"
              value={draft.existing_output}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("existing_output", event.target.value as TranscodingSettings["existing_output"])}
            >
              <option value="fail">{t("transcoding.fail")}</option>
              <option value="skip">{t("transcoding.skip")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="transcoding-remove-partial">{t("common.partialOutput")}</label>
            <select
              id="transcoding-remove-partial"
              className="settings-choice-input"
              value={draft.remove_partial_output ? "yes" : "no"}
              disabled={!appSettingsLoaded || saving}
              onChange={(event) => updateDraft("remove_partial_output", event.target.value === "yes")}
            >
              <option value="yes">{t("transcoding.actions.drop")}</option>
              <option value="no">{t("transcoding.actions.keep")}</option>
            </select>
          </div>
        </div>

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

        <TranscodePresetsRulesPanel
          capabilityMatrix={capabilityMatrix}
          acceleratorsTooltip={acceleratorsTooltip}
          standaloneTab="accelerators"
          standaloneCollapsed={acceleratorsCollapsed}
          onStandaloneToggle={() => setAcceleratorsCollapsed((current) => !current)}
          standaloneHeaderAction={matrixTestAction}
          federation={releaseVisibility.federation ? federation : null}
          onFederationData={setFederation}
          onAcceleratorMatrixFocus={setMatrixFocus}
          searchFocus={searchFocus}
        />
        {releaseVisibility.automationRules ? <TranscodePresetsRulesPanel
          capabilityMatrix={() => null}
          acceleratorsTooltip={null}
          standaloneTab="rules"
          standaloneCollapsed={automationRulesCollapsed}
          onStandaloneToggle={() => setAutomationRulesCollapsed((current) => !current)}
          searchFocus={searchFocus}
        /> : null}
        {releaseVisibility.federation ? <TranscodeFederationPanel onData={setFederation} /> : null}
      </div>
    </AsyncPanel>
  );
}
