import ReactECharts from "echarts-for-react";

import type { TranscodeJob } from "../lib/api";
import { formatBytes, formatDuration } from "../lib/format";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function parseTranscodeSpeed(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatTranscodeSpeedLabel(value: string | null): string {
  if (!value?.trim()) return "—";
  const trimmed = value.trim();
  return /x$/i.test(trimmed) ? `${trimmed.slice(0, -1)}×` : trimmed;
}

export function transcodeProgressValue(job: TranscodeJob): number {
  return Math.max(0, Math.min(100, Number.isFinite(job.progress_percent) ? job.progress_percent : 0));
}

export function phaseForTranscodeJob(job: TranscodeJob, t: Translate): string {
  const phase = job.processing_phase || (job.status === "running" ? "transcoding" : job.status);
  return t(`transcoding.federation.phases.${phase}`, { defaultValue: job.phase_detail || phase });
}

export function transferForTranscodeJob(job: TranscodeJob): string | null {
  if (job.source_transfer_total_bytes) {
    return `${formatBytes(job.source_transfer_bytes ?? 0)} / ${formatBytes(job.source_transfer_total_bytes)}`;
  }
  if (job.result_transfer_total_bytes) {
    return `${formatBytes(job.result_transfer_bytes ?? 0)} / ${formatBytes(job.result_transfer_total_bytes)}`;
  }
  return null;
}

function speedSeries(job: TranscodeJob, sampledSpeeds: number[]): number[] {
  const values = sampledSpeeds.length > 0 ? sampledSpeeds : [];
  const current = parseTranscodeSpeed(job.speed);
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

function SpeedChart({ job, sampledSpeeds, t }: { job: TranscodeJob; sampledSpeeds: number[]; t: Translate }) {
  const values = speedSeries(job, sampledSpeeds);
  const option = {
    animation: false,
    grid: { left: 0, right: 0, top: 4, bottom: 4 },
    xAxis: {
      type: "category",
      show: false,
      boundaryGap: false,
      data: values.map((_, index) => (index === values.length - 1 ? t("transcoding.center.now") : `-${values.length - index - 1}`)),
      axisLine: { lineStyle: { color: "rgba(127, 140, 141, 0.26)" } },
      axisLabel: { color: "#8c948f", fontSize: 10 },
    },
    yAxis: {
      type: "value",
      show: false,
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
        lineStyle: { color: "#1b998b", width: 2.5 },
        areaStyle: { color: "rgba(27, 153, 139, 0.12)" },
      },
    ],
  };

  return <ReactECharts option={option} style={{ width: "100%", height: 58 }} opts={{ renderer: "svg" }} />;
}

export function TranscodeProgressSummary({
  job,
  sampledSpeeds = [],
  t,
  compact = false,
}: {
  job: TranscodeJob;
  sampledSpeeds?: number[];
  t: Translate;
  compact?: boolean;
}) {
  const progress = transcodeProgressValue(job);
  const phaseText = phaseForTranscodeJob(job, t);
  const transferText = transferForTranscodeJob(job);

  if (job.status === "running" || compact) {
    return (
      <div className={`transcoding-progress-summary is-running${compact ? " is-compact" : ""}`}>
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
            <strong>{formatTranscodeSpeedLabel(job.speed)}</strong>
            <span>{t("transcoding.center.speedColumn")}</span>
          </div>
        </div>
        <div className="transcoding-progress-chart">
          <SpeedChart job={job} sampledSpeeds={sampledSpeeds} t={t} />
        </div>
        <span className="transcoding-progress-track" aria-label={t("transcoding.center.progressAria", { value: Math.round(progress) })}>
          <span style={{ width: `${progress}%` }} />
        </span>
        <div className="transcoding-progress-meta">
          <span className="transcoding-progress-phase" title={job.phase_detail ?? phaseText}>{phaseText}</span>
          {transferText ? <span className="transcoding-progress-transfer">{transferText}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`transcoding-progress-static status-${job.status}`}>
      {job.status === "completed" ? <strong>{Math.round(progress)}%</strong> : null}
      <span>{job.status === "queued" ? phaseText || t("transcoding.center.waitingForSlot") : phaseText || t(`transcoding.status.${job.status}`)}</span>
      {transferText ? <small className="transcoding-progress-transfer">{transferText}</small> : null}
    </div>
  );
}
