import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import ReactECharts from "echarts-for-react";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock3,
  Cpu,
  ExternalLink,
  HardDrive,
  History,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  Square,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { TooltipTrigger } from "../components/TooltipTrigger";
import { SlidingTogglePill } from "../components/SlidingTogglePill";
import { useAppData } from "../lib/app-data";
import {
  api,
  type TranscodeCapabilities,
  type TranscodeHardwareDevice,
  type TranscodeJob,
} from "../lib/api";
import { formatBytes, formatCodecLabel, formatContainerLabel, formatDate, formatDuration } from "../lib/format";
import { formatHdrType } from "../lib/hdr";
import {
  getTranscodingColumnWidths,
  saveTranscodingColumnWidths,
  type TranscodingColumnKey,
  type TranscodingColumnWidths,
} from "../lib/transcoding-column-widths";

const PROFILE_KEYS = ["compatibility", "storage", "modern"] as const;
type ProfileKey = typeof PROFILE_KEYS[number];
type JobStatus = TranscodeJob["status"];
type CenterTab = "active" | "history";
type StatusFilter = "all" | JobStatus;
type TargetFilter = "all" | ProfileKey;
type HardwareFilter = "all" | "hardware" | "cpu";

const TRANSCODING_COLUMNS = [
  { key: "file", labelKey: "transcoding.center.fileColumn", defaultWidth: "26%", minPx: 160, maxPx: 1400 },
  { key: "target", labelKey: "transcoding.center.targetColumn", defaultWidth: "17%", minPx: 110, maxPx: 960 },
  { key: "hardware", labelKey: "transcoding.center.hardwareColumn", defaultWidth: "18%", minPx: 120, maxPx: 960 },
  { key: "progress", labelKey: "transcoding.center.progressColumn", defaultWidth: "33%", minPx: 280, maxPx: 1400 },
  { key: "actions", labelKey: "transcoding.center.actionsColumn", defaultWidth: "6%", minPx: 100, maxPx: 400 },
] as const satisfies ReadonlyArray<{
  key: TranscodingColumnKey;
  labelKey: string;
  defaultWidth: string;
  minPx: number;
  maxPx: number;
}>;

function transcodingColumnWidth(
  column: typeof TRANSCODING_COLUMNS[number],
  overrideWidth: number | undefined,
): string {
  if (overrideWidth === undefined) {
    return column.defaultWidth;
  }
  return `${Math.min(Math.max(overrideWidth, column.minPx), column.maxPx)}px`;
}

function basename(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function previewComparisonPath(job: TranscodeJob): string | null {
  if (job.status !== "completed" || !job.source_file_id || !job.result_file_id || job.source_file_id === job.result_file_id) {
    return null;
  }
  return `/files/${job.source_file_id}/preview?compare=${job.result_file_id}`;
}

function parseSpeed(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSpeedLabel(value: string | null): string {
  if (!value?.trim()) return "—";
  const trimmed = value.trim();
  return /x$/i.test(trimmed) ? `${trimmed.slice(0, -1)}×` : trimmed;
}

function progressValue(job: TranscodeJob): number {
  return Math.max(0, Math.min(100, Number.isFinite(job.progress_percent) ? job.progress_percent : 0));
}

function elapsedSeconds(job: TranscodeJob): number | null {
  if (!job.started_at) return null;
  const start = new Date(job.started_at).getTime();
  const end = job.finished_at ? new Date(job.finished_at).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, (end - start) / 1000);
}

function isHardwareJob(job: TranscodeJob): boolean {
  if (job.device_id || job.hardware_backend) return true;
  const encodedVideo = job.plan.video_streams.find((stream) => stream.action === "encode");
  return Boolean(encodedVideo?.encoder && /_(nvenc|qsv|vaapi|amf|videotoolbox)$/i.test(encodedVideo.encoder));
}

function selectedVideoStream(job: TranscodeJob) {
  return job.plan.video_streams.find((candidate) => candidate.action !== "drop");
}

function codecFromEncoder(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("h264")) return "h264";
  if (normalized.startsWith("hevc") || normalized.startsWith("h265")) return "hevc";
  if (normalized.includes("av1")) return "av1";
  if (normalized.startsWith("mpeg2")) return "mpeg2video";
  if (normalized.startsWith("mpeg4")) return "mpeg4";
  if (normalized.startsWith("mjpeg")) return "mjpeg";
  if (normalized.startsWith("prores")) return "prores";
  return null;
}

function formatVideoCodec(value: string | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  return value ? formatCodecLabel(value, "video") : t("storageMap.unknown");
}

function formatDynamicRange(value: string | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!value?.trim()) return t("storageMap.unknown");
  const normalized = value.trim().toLowerCase();
  const translationKey = normalized === "dolby vision" ? "dolby_vision" : normalized;
  if (["preserve", "sdr", "hdr10", "hlg", "dolby_vision"].includes(translationKey)) {
    return t(`transcoding.dynamicRanges.${translationKey}`);
  }
  return formatHdrType(value) ?? t("storageMap.unknown");
}

function videoTransformForJob(
  job: TranscodeJob,
  t: (key: string, options?: Record<string, unknown>) => string,
): { sourceCodec: string; targetCodec: string; sourceDynamicRange: string; targetDynamicRange: string } {
  const stream = selectedVideoStream(job);
  const sourceCodec = job.source_video_codec ?? null;
  const targetCodec = stream?.codec
    ?? codecFromEncoder(stream?.encoder)
    ?? (stream && stream.action !== "encode" ? sourceCodec : null);
  const sourceDynamicRange = job.source_dynamic_range ?? null;
  const targetDynamicRange = job.plan.dynamic_range === "preserve" ? sourceDynamicRange : job.plan.dynamic_range;
  return {
    sourceCodec: formatVideoCodec(sourceCodec, t),
    targetCodec: formatVideoCodec(targetCodec, t),
    sourceDynamicRange: formatDynamicRange(sourceDynamicRange, t),
    targetDynamicRange: formatDynamicRange(targetDynamicRange, t),
  };
}

function targetForJob(job: TranscodeJob, t: (key: string, options?: Record<string, unknown>) => string) {
  const stream = selectedVideoStream(job);
  const codecValue = stream?.codec ?? codecFromEncoder(stream?.encoder);
  const label = codecValue ? formatCodecLabel(codecValue, "video") : t("transcoding.center.copySource");
  const resolution = stream?.width && stream?.height ? `${stream.width}×${stream.height}` : null;
  const detail = [resolution, formatContainerLabel(job.plan.container), t(`transcoding.dynamicRanges.${job.plan.dynamic_range}`)]
    .filter(Boolean)
    .join(" · ");
  return { label, detail };
}

function workerForJob(job: TranscodeJob, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (job.assignment_mode === "local" || !job.assignment_mode) {
    return t("transcoding.federation.targetLocal");
  }
  if (job.target_member_name) return job.target_member_name;
  return job.target_member_id ?? t("transcoding.federation.targetAutomatic");
}

function phaseForJob(job: TranscodeJob, t: (key: string, options?: Record<string, unknown>) => string): string {
  const phase = job.processing_phase || (job.status === "running" ? "transcoding" : job.status);
  return t(`transcoding.federation.phases.${phase}`, { defaultValue: job.phase_detail || phase });
}

function transferForJob(job: TranscodeJob): string | null {
  if (job.source_transfer_total_bytes) {
    return `${formatBytes(job.source_transfer_bytes ?? 0)} / ${formatBytes(job.source_transfer_total_bytes)}`;
  }
  if (job.result_transfer_total_bytes) {
    return `${formatBytes(job.result_transfer_bytes ?? 0)} / ${formatBytes(job.result_transfer_total_bytes)}`;
  }
  return null;
}

function statusLabel(status: JobStatus, t: (key: string, options?: Record<string, unknown>) => string): string {
  return t(`transcoding.status.${status}`);
}

function JobStatusIcon({ status }: { status: JobStatus }) {
  if (status === "running") return <Play aria-hidden="true" />;
  if (status === "queued") return <Clock3 aria-hidden="true" />;
  if (status === "completed") return <CircleCheck aria-hidden="true" />;
  if (status === "failed") return <CircleX aria-hidden="true" />;
  return <CircleAlert aria-hidden="true" />;
}

function speedSeries(job: TranscodeJob, sampledSpeeds: number[]): number[] {
  const values = sampledSpeeds.length > 0 ? sampledSpeeds : [];
  const current = parseSpeed(job.speed);
  if (current !== null && (values.length === 0 || values.at(-1) !== current)) {
    return [...values, current];
  }
  return values.length > 0 ? values : [0];
}

function speedTooltipFormatter(params: unknown): string {
  const firstParam = Array.isArray(params) ? params[0] : params;
  if (!firstParam || typeof firstParam !== "object" || !("value" in firstParam)) return "—";

  const rawValue = (firstParam as { value?: unknown }).value;
  const value = Array.isArray(rawValue) ? rawValue.at(-1) : rawValue;
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return "—";

  return `${numericValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}×`;
}

type SpeedChartVariant = "combined" | "detail";

function SpeedChart({
  job,
  sampledSpeeds,
  variant = "detail",
  t,
}: {
  job: TranscodeJob;
  sampledSpeeds: number[];
  variant?: SpeedChartVariant;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const values = speedSeries(job, sampledSpeeds);
  const combined = variant === "combined";
  const option = {
    animation: false,
    grid: combined ? { left: 0, right: 0, top: 4, bottom: 4 } : { left: 34, right: 8, top: 8, bottom: 22 },
    xAxis: {
      type: "category",
      show: !combined,
      boundaryGap: false,
      data: values.map((_, index) => (index === values.length - 1 ? t("transcoding.center.now") : `-${values.length - index - 1}`)),
      axisLine: { lineStyle: { color: "rgba(127, 140, 141, 0.26)" } },
      axisLabel: { color: "#8c948f", fontSize: 10 },
    },
    yAxis: {
      type: "value",
      show: !combined,
      min: 0,
      splitNumber: 2,
      axisLabel: { color: "#8c948f", fontSize: 10, formatter: (value: number) => `${value}×` },
      splitLine: { lineStyle: { color: "rgba(127, 140, 141, 0.14)" } },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      renderMode: "html",
      padding: [4, 7],
      backgroundColor: "var(--panel-strong)",
      borderColor: "var(--nested-surface-border)",
      borderWidth: 1,
      textStyle: { color: "var(--ink)", fontSize: 11, fontFamily: "inherit" },
      extraCssText: "border-radius: 7px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.22);",
      formatter: speedTooltipFormatter,
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: 0.28,
        symbol: "none",
        lineStyle: { color: "#1b998b", width: combined ? 2.5 : 2 },
        areaStyle: { color: "rgba(27, 153, 139, 0.12)" },
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ width: "100%", height: combined ? 58 : "100%" }}
      opts={{ renderer: "svg" }}
    />
  );
}

function JobProgressCell({
  job,
  sampledSpeeds,
  t,
}: {
  job: TranscodeJob;
  sampledSpeeds: number[];
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const progress = progressValue(job);
  const statusText = statusLabel(job.status, t);
  const phaseText = phaseForJob(job, t);
  const transferText = transferForJob(job);

  if (job.status === "running") {
    return (
      <div className="transcoding-progress-summary is-running">
        <div className="transcoding-progress-metrics">
          <div className="transcoding-progress-metric">
            <strong>{Math.round(progress)}%</strong>
            <span>{t("transcoding.center.progressColumn")}</span>
          </div>
          <div className="transcoding-progress-metric">
            <strong>{job.eta_seconds === null ? "—" : formatDuration(job.eta_seconds)}</strong>
            <span>{t("transcoding.center.etaColumn")}</span>
          </div>
          <div className="transcoding-progress-metric is-accent">
            <strong>{formatSpeedLabel(job.speed)}</strong>
            <span>{t("transcoding.center.speedColumn")}</span>
          </div>
        </div>
        <div className="transcoding-progress-chart">
          <SpeedChart job={job} sampledSpeeds={sampledSpeeds} variant="combined" t={t} />
        </div>
        <span className="transcoding-progress-track" aria-label={t("transcoding.center.progressAria", { value: Math.round(progress) })}>
          <span style={{ width: `${progress}%` }} />
        </span>
        <span className="transcoding-progress-phase" title={job.phase_detail ?? phaseText}>{phaseText}</span>
        {transferText ? <span className="transcoding-progress-transfer">{transferText}</span> : null}
      </div>
    );
  }

  return (
    <div className={`transcoding-progress-static status-${job.status}`}>
      {job.status === "completed" ? <strong>{Math.round(progress)}%</strong> : null}
      <span>{job.status === "queued" ? phaseText || t("transcoding.center.waitingForSlot") : phaseText || statusText}</span>
      {transferText ? <small className="transcoding-progress-transfer">{transferText}</small> : null}
    </div>
  );
}

function hardwareStatusForJob(
  job: TranscodeJob,
  device: TranscodeHardwareDevice | undefined,
): "available" | "unavailable" | "unknown" | "cpu" {
  if (!isHardwareJob(job)) return "cpu";
  if (!device) return "unknown";
  return device.status === "available" ? "available" : "unavailable";
}

function hardwareLabelForJob(
  job: TranscodeJob,
  capabilities: TranscodeCapabilities | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; detail: string; status: "available" | "unavailable" | "unknown" | "cpu" } {
  if (!isHardwareJob(job)) {
    return { label: t("transcoding.cpu"), detail: t("transcoding.center.softwarePath"), status: "cpu" };
  }
  const device = capabilities?.devices?.find((candidate) => candidate.id === job.device_id);
  const label = device?.name ?? job.device_id ?? job.hardware_backend?.toUpperCase() ?? t("transcoding.hardware");
  const detail = [job.hardware_backend?.toUpperCase(), job.plan.video_streams.find((stream) => stream.action === "encode")?.encoder]
    .filter(Boolean)
    .join(" · ") || t("transcoding.center.hardwarePath");
  return { label, detail, status: hardwareStatusForJob(job, device) };
}

function JobRow({
  job,
  libraryName,
  capabilities,
  sampledSpeeds,
  expanded,
  canceling,
  retrying,
  onOpen,
  onCancel,
  onRetry,
  t,
}: {
  job: TranscodeJob;
  libraryName: string;
  capabilities: TranscodeCapabilities | null;
  sampledSpeeds: number[];
  expanded: boolean;
  canceling: boolean;
  retrying: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onRetry: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const target = targetForJob(job, t);
  const worker = workerForJob(job, t);
  const hardware = hardwareLabelForJob(job, capabilities, t);
  const videoTransform = videoTransformForJob(job, t);
  const canCancel = job.status === "queued" || job.status === "running";
  const completedPreviewPath = previewComparisonPath(job);
  const fileLabel = basename(job.source_path_snapshot);
  const statusText = statusLabel(job.status, t);
  const elapsed = elapsedSeconds(job);
  const eta = job.status === "running" && job.eta_seconds !== null ? formatDuration(job.eta_seconds) : "—";
  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen();
  };

  return (
    <>
      <tr
        className={`transcoding-job-row status-${job.status}${expanded ? " is-expanded" : ""}`}
        data-testid={`transcode-job-${job.id}`}
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onOpen}
        onKeyDown={handleRowKeyDown}
      >
        <td className="transcoding-file-cell">
          <span className={`transcoding-status-icon status-${job.status}`} title={statusText} aria-label={statusText}>
            <JobStatusIcon status={job.status} />
          </span>
          <span className="transcoding-file-copy">
            <strong className="transcoding-file-name" title={job.source_path_snapshot}>{fileLabel}</strong>
            <span className="transcoding-file-meta">{libraryName} · {t(`transcoding.profiles.${job.profile}`, { defaultValue: job.profile })}</span>
          </span>
        </td>
        <td className="transcoding-target-cell">
          <strong>{target.label}</strong>
          <span>{target.detail}</span>
          <small className="transcoding-target-worker" title={worker}>{worker}</small>
        </td>
        <td className="transcoding-hardware-cell">
          <span className="transcoding-hardware-main">
            <span className={`transcoding-hardware-dot status-${hardware.status}`} aria-hidden="true" />
            <strong title={hardware.label}>{hardware.label}</strong>
          </span>
          <span>{hardware.detail}</span>
        </td>
        <td className="transcoding-progress-cell">
          <JobProgressCell job={job} sampledSpeeds={sampledSpeeds} t={t} />
        </td>
        <td className="transcoding-actions-cell">
          {canCancel ? (
            <button
              type="button"
              className="secondary icon-only-button transcoding-job-action"
              aria-label={t("transcoding.center.cancelJob", { filename: fileLabel })}
              title={t("transcoding.center.cancelJob", { filename: fileLabel })}
              disabled={canceling}
              onClick={(event) => { event.stopPropagation(); onCancel(); }}
            >
              {canceling ? <LoaderCircle className="spin" aria-hidden="true" /> : <Square aria-hidden="true" />}
            </button>
          ) : job.status === "failed" ? (
            <button
              type="button"
              className="secondary icon-only-button transcoding-job-action"
              aria-label={t("transcoding.center.retryJob", { filename: fileLabel })}
              title={t("transcoding.center.retryJob", { filename: fileLabel })}
              disabled={retrying || !job.source_file_id}
              onClick={(event) => { event.stopPropagation(); onRetry(); }}
            >
              {retrying ? <LoaderCircle className="spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
            </button>
          ) : null}
          {job.source_file_id ? (
            <Link
              to={completedPreviewPath ?? `/files/${job.source_file_id}`}
              className="secondary icon-only-button transcoding-job-action"
              aria-label={completedPreviewPath ? t("transcoding.openPreviewComparison") : t("transcoding.openSource")}
              title={completedPreviewPath ? t("transcoding.openPreviewComparison") : t("transcoding.openSource")}
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink aria-hidden="true" />
            </Link>
          ) : null}
        </td>
      </tr>
      {expanded ? (
        <tr className={`transcoding-job-detail-row status-${job.status}`}>
          <td colSpan={TRANSCODING_COLUMNS.length}>
            <div className="transcoding-job-detail-grid">
              <div className="transcoding-job-detail-path">
                <div className="transcoding-job-paths">
                  <span title={job.source_path_snapshot}>{basename(job.source_path_snapshot)}</span>
                  <span aria-hidden="true">↓</span>
                  <span title={job.output_path_snapshot}>{basename(job.output_path_snapshot)}</span>
                </div>
                <dl className="transcoding-job-transform-list">
                  <div>
                    <dt>{t("streamDetails.codec")}</dt>
                    <dd>
                      <span>{videoTransform.sourceCodec}</span>
                      <span className="transcoding-transform-arrow" aria-hidden="true">→</span>
                      <span>{videoTransform.targetCodec}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("streamDetails.dynamicRange")}</dt>
                    <dd>
                      <span>{videoTransform.sourceDynamicRange}</span>
                      <span className="transcoding-transform-arrow" aria-hidden="true">→</span>
                      <span>{videoTransform.targetDynamicRange}</span>
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="transcoding-job-detail-time">
                <dl className="transcoding-job-detail-list">
                  <div><dt>{t("transcoding.center.startTime")}</dt><dd>{job.started_at ? formatDate(job.started_at) : "—"}</dd></div>
                  <div><dt>{t("transcoding.center.durationSoFar")}</dt><dd>{elapsed === null ? "—" : formatDuration(elapsed)}</dd></div>
                  <div><dt>{t("transcoding.center.eta")}</dt><dd>{eta}</dd></div>
                  <div><dt>{t("transcoding.federation.phase")}</dt><dd>{phaseForJob(job, t)}</dd></div>
                  <div><dt>{t("transcoding.federation.target")}</dt><dd>{worker}</dd></div>
                  {transferForJob(job) ? <div><dt>{job.result_transfer_total_bytes ? t("transcoding.federation.resultTransfer") : t("transcoding.federation.sourceTransfer")}</dt><dd>{transferForJob(job)}</dd></div> : null}
                </dl>
              </div>
              <div className="transcoding-job-detail-side">
                <span className={`transcoding-hardware-availability status-${hardware.status}`}>
                  <span className="transcoding-hardware-dot" aria-hidden="true" />
                  {hardware.status === "available" ? t("transcoding.center.available") : hardware.status === "cpu" ? t("transcoding.center.cpuPath") : t("transcoding.center.unavailable")}
                </span>
                <span className="transcoding-detail-muted">{hardware.detail}</span>
                {job.error ? <div className="transcoding-inline-error" role="alert">{job.error}</div> : null}
              </div>
            </div>
            <div className="transcoding-job-detail-footer">
              <details className="transcoding-job-command">
                <summary>{t("transcoding.center.log")}</summary>
                <code>{job.ffmpeg_command || t("transcoding.center.noLog")}</code>
              </details>
              {job.result_file_id ? (
                <div className="transcoding-detail-links">
                  <Link
                    to={completedPreviewPath ?? `/files/${job.result_file_id}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ExternalLink aria-hidden="true" />{completedPreviewPath ? t("transcoding.openPreviewComparison") : t("transcoding.center.openResult")}
                  </Link>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

type LoadItem = {
  key: string;
  label: string;
  shortLabel: string;
  detail: string;
  active: number;
  capacity: number | null;
  status: "available" | "unavailable" | "unknown" | "cpu";
  icon: typeof Cpu;
  device: TranscodeHardwareDevice | null;
};

function hardwareLoadTooltipStatus(
  status: LoadItem["status"],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (status === "available") return t("transcoding.matrixTooltipStatusHardware");
  if (status === "cpu") return t("transcoding.matrixTooltipStatusSoftware");
  if (status === "unavailable") return t("transcoding.matrixTooltipStatusUnsupported");
  return t("transcoding.matrixTooltipStatusNotTested");
}

function hardwareLoadTooltipStatusClass(status: LoadItem["status"]): string {
  if (status === "available") return "hardware";
  if (status === "cpu") return "software";
  if (status === "unavailable") return "unsupported";
  return "not_tested";
}

function hardwareCodecList(codecs: string[]): string {
  return codecs.length > 0 ? codecs.map((codec) => formatCodecLabel(codec, "video")).join(", ") : "—";
}

function HardwareSlotDots({ item }: { item: LoadItem }) {
  const visibleSlots = item.capacity === null ? 1 : Math.min(Math.max(item.capacity, 1), 5);
  return (
    <span className="transcoding-hardware-load-slots" aria-hidden="true">
      {Array.from({ length: visibleSlots }, (_, index) => (
        <span
          key={index}
          className={`transcoding-hardware-load-slot${item.capacity === null ? " is-automatic" : index < item.active ? " is-busy" : " is-free"}`}
        />
      ))}
      {item.capacity !== null && item.capacity > visibleSlots ? <span className="transcoding-hardware-load-slot-more">+</span> : null}
    </span>
  );
}

function HardwareLoadTooltip({
  item,
  t,
}: {
  item: LoadItem;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const device = item.device;
  const encoderNames = device?.encoder_names?.join(", ") ?? "";
  const encoderCodecs = device ? hardwareCodecList(device.encoder_codecs) : "—";
  const decoderCodecs = device ? hardwareCodecList(device.decoder_codecs) : "—";
  const slots = item.capacity === null ? `${item.active} · ${t("transcoding.auto")}` : `${item.active}/${item.capacity}`;
  const statusClass = hardwareLoadTooltipStatusClass(item.status);

  return (
    <div className="transcode-matrix-tooltip-content transcoding-hardware-load-tooltip">
      <div className="transcode-matrix-tooltip-heading">
        <strong>{item.label}</strong>
        <span className={`transcode-matrix-tooltip-status is-${statusClass}`}>
          {hardwareLoadTooltipStatus(item.status, t)}
        </span>
      </div>
      <div className="transcode-matrix-tooltip-summary">
        <div>
          <span>{t("transcoding.center.hardwareTooltipStatus")}</span>
          <strong>{hardwareLoadTooltipStatus(item.status, t)}</strong>
        </div>
        <div>
          <span>{t("transcoding.center.hardwareTooltipSlots")}</span>
          <strong>{slots}</strong>
        </div>
      </div>
      <div className="transcode-matrix-tooltip-row">
        <div className="transcode-matrix-tooltip-path">
          <span>{t("transcoding.center.hardwareTooltipBackend")}: {item.detail}</span>
          {device ? <span>{t("transcoding.center.hardwareTooltipDevice")}: {device.id}</span> : null}
          {device?.render_node ? <span>{t("transcoding.center.hardwareTooltipRenderNode")}: {device.render_node}</span> : null}
          {device?.driver_version ? <span>{t("transcoding.center.hardwareTooltipDriver")}: {device.driver_version}</span> : null}
        </div>
      </div>
      {device ? (
        <div className="transcode-matrix-tooltip-row">
          <div className="transcode-matrix-tooltip-path">
            <span>{t("transcoding.center.hardwareTooltipEncoderCodecs")}: {encoderNames ? `${encoderNames} · ${encoderCodecs}` : encoderCodecs}</span>
            <span>{t("transcoding.center.hardwareTooltipDecoderCodecs")}: {decoderCodecs}</span>
          </div>
        </div>
      ) : null}
      {device?.failure_reason ? (
        <div className="transcode-matrix-tooltip-row transcode-matrix-tooltip-detail">
          <span>{t("transcoding.center.hardwareTooltipFailure")}</span>
          <span>{device.failure_reason}</span>
        </div>
      ) : null}
    </div>
  );
}

function HardwareLoadStrip({
  activeJobs,
  capabilities,
  cpuCapacity,
  gpuCapacity,
  t,
}: {
  activeJobs: TranscodeJob[];
  capabilities: TranscodeCapabilities | null;
  cpuCapacity: number | null;
  gpuCapacity: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const runningJobs = activeJobs.filter((job) => job.status === "running");
  const hardwareJobs = runningJobs.filter(isHardwareJob);
  const deviceById = new Map((capabilities?.devices ?? []).map((device) => [device.id, device]));
  const deviceIds = new Set<string>();
  const items: LoadItem[] = [];

  for (const device of capabilities?.devices ?? []) {
    if (!device.encoder_codecs.length && !device.encoder_names?.length) continue;
    deviceIds.add(device.id);
    items.push({
      key: `device-${device.id}`,
      label: device.name,
      shortLabel: device.backend.toUpperCase(),
      detail: device.backend.toUpperCase(),
      active: hardwareJobs.filter((job) => job.device_id === device.id).length,
      capacity: gpuCapacity,
      status: device.status === "available" ? "available" : device.status === "not_detected" ? "unknown" : "unavailable",
      icon: HardDrive,
      device,
    });
  }

  for (const job of hardwareJobs) {
    if (job.device_id && deviceIds.has(job.device_id)) continue;
    const key = job.device_id ?? `backend-${job.hardware_backend ?? "hardware"}`;
    if (items.some((item) => item.key === `fallback-${key}`)) continue;
    const active = hardwareJobs.filter((candidate) => (candidate.device_id ?? `backend-${candidate.hardware_backend ?? "hardware"}`) === key).length;
    items.push({
      key: `fallback-${key}`,
      label: job.device_id ?? job.hardware_backend?.toUpperCase() ?? t("transcoding.hardware"),
      shortLabel: job.hardware_backend?.toUpperCase() ?? "HW",
      detail: t("transcoding.center.detectedRuntimePath"),
      active,
      capacity: gpuCapacity,
      status: job.device_id && deviceById.get(job.device_id)?.status === "unavailable" ? "unavailable" : "unknown",
      icon: HardDrive,
      device: job.device_id ? deviceById.get(job.device_id) ?? null : null,
    });
  }

  const cpuActive = runningJobs.filter((job) => !isHardwareJob(job)).length;
  items.push({
    key: "cpu",
    label: t("transcoding.cpu"),
    shortLabel: t("transcoding.cpu"),
    detail: cpuCapacity === null ? t("transcoding.auto") : t("transcoding.center.softwarePath"),
    active: cpuActive,
    capacity: cpuCapacity,
    status: "cpu",
    icon: Cpu,
    device: null,
  });

  return (
    <section className="transcoding-hardware-load is-compact" aria-label={t("transcoding.center.hardwareLoad")}>
      <div className="transcoding-hardware-load-items">
        {items.map((item) => {
          return (
            <TooltipTrigger
              key={item.key}
              className={`transcoding-hardware-load-trigger status-${item.status}`}
              ariaLabel={t("transcoding.center.hardwareTooltipAria", { hardware: item.label })}
              tooltipClassName="transcode-matrix-tooltip-portal"
              content={<HardwareLoadTooltip item={item} t={t} />}
              maxWidth={420}
              placement="auto"
            >
              <span className={`transcoding-hardware-load-icon status-${item.status}`} aria-hidden="true"><item.icon /></span>
              <span className="transcoding-hardware-load-short-label">{item.shortLabel}</span>
              <HardwareSlotDots item={item} />
            </TooltipTrigger>
          );
        })}
      </div>
    </section>
  );
}

export function TranscodingPage() {
  const { t } = useTranslation();
  const { appSettings, libraries } = useAppData();
  const [tab, setTab] = useState<CenterTab>("active");
  const [activeJobs, setActiveJobs] = useState<TranscodeJob[]>([]);
  const [historyJobs, setHistoryJobs] = useState<TranscodeJob[]>([]);
  const [capabilities, setCapabilities] = useState<TranscodeCapabilities | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [targetFilter, setTargetFilter] = useState<TargetFilter>("all");
  const [hardwareFilter, setHardwareFilter] = useState<HardwareFilter>("all");
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const [cancelingIds, setCancelingIds] = useState<Set<number>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [columnWidthOverrides, setColumnWidthOverrides] = useState<TranscodingColumnWidths>(() => getTranscodingColumnWidths());
  const [, setSpeedRevision] = useState(0);
  const speedHistoryRef = useRef<Map<number, number[]>>(new Map());
  const refreshInFlightRef = useRef(false);
  const expandedInitializedRef = useRef(false);
  const headerCellRefs = useRef<Partial<Record<TranscodingColumnKey, HTMLTableCellElement | null>>>({});
  const resizeStateRef = useRef<{
    columnKey: TranscodingColumnKey;
    startX: number;
    startWidth: number;
    minPx: number;
    maxPx: number;
  } | null>(null);

  const refreshJobs = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const [activeResult, historyResult] = await Promise.allSettled([
      api.activeTranscodeJobs(),
      api.transcodeJobs({ limit: 200 }),
    ]);
    const failures: string[] = [];
    if (activeResult.status === "fulfilled") setActiveJobs(activeResult.value.items);
    else failures.push(activeResult.reason instanceof Error ? activeResult.reason.message : String(activeResult.reason));
    if (historyResult.status === "fulfilled") setHistoryJobs(historyResult.value.items);
    else failures.push(historyResult.reason instanceof Error ? historyResult.reason.message : String(historyResult.reason));
    setError(failures.length > 0 ? failures.join(" · ") : null);
    refreshInFlightRef.current = false;
  }, []);

  useEffect(() => {
    void refreshJobs();
    const timer = window.setInterval(() => void refreshJobs(), 2500);
    const onFocus = () => void refreshJobs();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshJobs]);

  useEffect(() => {
    let disposed = false;
    api.transcodeCapabilities()
      .then((payload) => { if (!disposed) setCapabilities(payload); })
      .catch((reason: Error) => { if (!disposed) setCapabilitiesError(reason.message); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let changed = false;
    for (const job of activeJobs) {
      const value = parseSpeed(job.speed);
      if (value === null) continue;
      const current = speedHistoryRef.current.get(job.id) ?? [];
      speedHistoryRef.current.set(job.id, [...current, value].slice(-36));
      changed = true;
    }
    if (changed) setSpeedRevision((value) => value + 1);
  }, [activeJobs]);

  useEffect(() => {
    if (expandedInitializedRef.current || activeJobs.length === 0) return;
    setExpandedJobId(activeJobs.find((job) => job.status === "running")?.id ?? activeJobs[0].id);
    expandedInitializedRef.current = true;
  }, [activeJobs]);

  const libraryMap = useMemo(() => new Map(libraries.map((library) => [library.id, library.name])), [libraries]);
  const allJobs = useMemo(() => {
    const byId = new Map<number, TranscodeJob>();
    for (const job of historyJobs) byId.set(job.id, job);
    for (const job of activeJobs) byId.set(job.id, job);
    return [...byId.values()];
  }, [activeJobs, historyJobs]);
  const visibleJobs = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const source = tab === "active" ? activeJobs : allJobs.filter((job) => job.status !== "queued" && job.status !== "running");
    return source
      .filter((job) => statusFilter === "all" || job.status === statusFilter)
      .filter((job) => targetFilter === "all" || job.profile === targetFilter)
      .filter((job) => hardwareFilter === "all" || (hardwareFilter === "hardware" ? isHardwareJob(job) : !isHardwareJob(job)))
      .filter((job) => {
        if (!normalizedSearch) return true;
        return [basename(job.source_path_snapshot), job.source_path_snapshot, job.output_relative_path, job.profile, job.hardware_backend, job.device_id]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedSearch);
      })
      .sort((left, right) => {
        if (tab === "active") {
          const statusOrder = { running: 0, queued: 1, failed: 2, canceled: 3, completed: 4 } as Record<JobStatus, number>;
          const statusDifference = statusOrder[left.status] - statusOrder[right.status];
          if (statusDifference !== 0) return statusDifference;
        }
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      });
  }, [activeJobs, allJobs, hardwareFilter, search, statusFilter, tab, targetFilter]);

  const cpuParallelJobs = appSettings.transcoding?.cpu_parallel_jobs;
  const cpuCapacity = typeof cpuParallelJobs === "number" ? cpuParallelJobs : null;
  const gpuCapacity = appSettings.transcoding?.gpu_parallel_jobs_per_device ?? 1;
  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setTargetFilter("all");
    setHardwareFilter("all");
  }

  function beginColumnResize(columnKey: TranscodingColumnKey, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const column = TRANSCODING_COLUMNS.find((candidate) => candidate.key === columnKey);
    const headerCell = headerCellRefs.current[columnKey];
    if (!column || !headerCell) {
      return;
    }

    resizeStateRef.current = {
      columnKey,
      startX: event.clientX,
      startWidth: headerCell.getBoundingClientRect().width,
      minPx: column.minPx,
      maxPx: column.maxPx,
    };
    document.body.classList.add("is-column-resizing");
  }

  function resetColumnWidth(columnKey: TranscodingColumnKey) {
    setColumnWidthOverrides((current) => {
      if (!(columnKey in current)) {
        return current;
      }
      const next = { ...current };
      delete next[columnKey];
      return saveTranscodingColumnWidths(next);
    });
  }

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const nextWidth = Math.min(
        Math.max(resizeState.startWidth + (event.clientX - resizeState.startX), resizeState.minPx),
        resizeState.maxPx,
      );

      setColumnWidthOverrides((current) => {
        if (current[resizeState.columnKey] === nextWidth) {
          return current;
        }
        return saveTranscodingColumnWidths({
          ...current,
          [resizeState.columnKey]: nextWidth,
        });
      });
    }

    function handlePointerUp() {
      if (!resizeStateRef.current) {
        return;
      }
      resizeStateRef.current = null;
      document.body.classList.remove("is-column-resizing");
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.classList.remove("is-column-resizing");
    };
  }, []);

  async function cancelJob(job: TranscodeJob) {
    setCancelingIds((current) => new Set(current).add(job.id));
    setNotice(null);
    try {
      await api.cancelTranscodeJob(job.id);
      await refreshJobs();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCancelingIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }

  async function retryJob(job: TranscodeJob) {
    if (!job.source_file_id) return;
    setRetryingIds((current) => new Set(current).add(job.id));
    setNotice(null);
    try {
      await api.startFileTranscode(job.source_file_id, job.plan);
      setNotice(t("transcoding.center.retryStarted"));
      await refreshJobs();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRetryingIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }

  return (
    <main className="transcoding-page">
      <section className="panel transcoding-center-panel">
        <header className="transcoding-center-header">
          <div className="transcoding-center-heading">
            <div className="transcoding-center-title-block">
              <div className="transcoding-center-title-row">
                <Activity aria-hidden="true" className="transcoding-center-title-icon" />
                <h2>{t("transcoding.center.title")}</h2>
              </div>
            </div>
            <HardwareLoadStrip activeJobs={activeJobs} capabilities={capabilities} cpuCapacity={cpuCapacity} gpuCapacity={gpuCapacity} t={t} />
          </div>
          <div className="transcoding-center-tabs library-history-range-toggle" role="tablist" aria-label={t("transcoding.center.tabsAria")}>
            <SlidingTogglePill activeKey={tab} className="nav-active-pill library-history-range-pill" />
            <button type="button" role="tab" aria-pressed={tab === "active"} data-toggle-key="active" className={`library-history-range-button${tab === "active" ? " active" : ""}`} onClick={() => setTab("active")}>
              <span className="library-history-range-button-content"><span>{t("transcoding.center.activeTab")}</span><span className="transcoding-center-tab-count">{activeJobs.length}</span></span>
            </button>
            <button type="button" role="tab" aria-pressed={tab === "history"} data-toggle-key="history" className={`library-history-range-button${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
              <span className="library-history-range-button-content"><span>{t("transcoding.center.historyTab")}</span><span className="transcoding-center-tab-count">{historyJobs.filter((job) => job.status !== "queued" && job.status !== "running").length}</span></span>
            </button>
          </div>
        </header>

        <div className="transcoding-center-toolbar">
          <label className="transcoding-search-field">
            <span className="sr-only">{t("transcoding.center.searchFiles")}</span>
            <Search aria-hidden="true" />
            <input type="search" value={search} placeholder={t("transcoding.center.searchPlaceholder")} onChange={(event) => setSearch(event.target.value)} />
            {search ? <button type="button" className="transcoding-search-clear" aria-label={t("transcoding.center.clearSearch")} onClick={() => setSearch("")}><X aria-hidden="true" /></button> : null}
          </label>
          <label className="transcoding-filter-field"><span>{t("transcoding.center.statusFilter")}</span><select className="settings-choice-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="all">{t("common.all")}</option>{(["running", "queued", "completed", "failed", "canceled"] as JobStatus[]).map((status) => <option key={status} value={status}>{statusLabel(status, t)}</option>)}</select></label>
          <label className="transcoding-filter-field"><span>{t("transcoding.center.targetFilter")}</span><select className="settings-choice-input" value={targetFilter} onChange={(event) => setTargetFilter(event.target.value as TargetFilter)}><option value="all">{t("common.all")}</option>{PROFILE_KEYS.map((profile) => <option key={profile} value={profile}>{t(`transcoding.profiles.${profile}`)}</option>)}</select></label>
          <label className="transcoding-filter-field"><span>{t("transcoding.center.hardwareFilter")}</span><select className="settings-choice-input" value={hardwareFilter} onChange={(event) => setHardwareFilter(event.target.value as HardwareFilter)}><option value="all">{t("common.all")}</option><option value="hardware">{t("transcoding.hardware")}</option><option value="cpu">{t("transcoding.cpu")}</option></select></label>
          <TooltipTrigger
            ariaLabel={t("transcoding.center.resetFilters")}
            content={t("transcoding.center.resetFilters")}
            className="secondary icon-only-button transcoding-reset-button"
            pinOnClick={false}
            onClick={resetFilters}
          >
            <History aria-hidden="true" className="nav-icon" size={16} />
          </TooltipTrigger>
        </div>

        {error ? <div className="alert" role="alert">{error}</div> : null}
        {notice ? <div className="alert success" role="status">{notice}</div> : null}
        <div className="transcoding-table-scroll">
          <table className="transcoding-job-table">
            <colgroup>
              {TRANSCODING_COLUMNS.map((column) => (
                <col
                  key={column.key}
                  style={{ width: transcodingColumnWidth(column, columnWidthOverrides[column.key]) }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                {TRANSCODING_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    ref={(element) => {
                      headerCellRefs.current[column.key] = element;
                    }}
                    style={{ width: transcodingColumnWidth(column, columnWidthOverrides[column.key]) }}
                  >
                    {t(column.labelKey)}
                    <button
                      type="button"
                      className="column-resize-handle"
                      aria-label={t("libraryDetail.resizeColumnAria", { column: t(column.labelKey) })}
                      onPointerDown={(event) => beginColumnResize(column.key, event)}
                      onDoubleClick={() => resetColumnWidth(column.key)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  libraryName={libraryMap.get(job.library_id) ?? t("transcoding.center.libraryFallback", { id: job.library_id })}
                  capabilities={capabilities}
                  sampledSpeeds={speedHistoryRef.current.get(job.id) ?? []}
                  expanded={expandedJobId === job.id}
                  canceling={cancelingIds.has(job.id)}
                  retrying={retryingIds.has(job.id)}
                  onOpen={() => setExpandedJobId(job.id)}
                  onCancel={() => void cancelJob(job)}
                  onRetry={() => void retryJob(job)}
                  t={t}
                />
              ))}
              {visibleJobs.length === 0 ? <tr><td colSpan={TRANSCODING_COLUMNS.length}><div className="transcoding-empty-state"><HardDrive aria-hidden="true" /><strong>{tab === "active" ? t("transcoding.center.noActiveJobs") : t("transcoding.center.noHistory")}</strong><span>{t("transcoding.center.noJobsHint")}</span></div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {capabilitiesError ? <p className="field-hint transcoding-capabilities-note"><CircleAlert aria-hidden="true" />{t("transcoding.center.capabilitiesUnavailable")}: {capabilitiesError}</p> : null}
    </main>
  );
}
