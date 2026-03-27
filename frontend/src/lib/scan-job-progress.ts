import type { ScanJob } from "./api";

const ACTIVE_PHASE_KEYS = new Set([
  "discovering",
  "analyzing",
  "detecting_duplicates_preparing",
  "detecting_duplicates_artifacts",
  "detecting_duplicates_grouping",
]);

export function formatScanJobProgressPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (value >= 99 || value <= 0) {
    return String(Math.round(value));
  }
  return value.toFixed(1);
}

export function getDisplayedScanJobPercent(job: ScanJob): number {
  if (ACTIVE_PHASE_KEYS.has(job.phase_key)) {
    return job.phase_progress_percent;
  }
  return job.progress_percent;
}

export function describeActiveScanJob(
  t: (key: string, options?: Record<string, unknown>) => string,
  job: ScanJob,
): string {
  if (job.phase_key === "discovering") {
    return t("scanBanner.searchingFound", { count: job.files_total });
  }

  if (job.phase_key === "analyzing") {
    const total = job.queued_for_analysis > 0 ? job.queued_for_analysis : job.phase_total;
    if (total > 0) {
      const scanned = Math.min(total, Math.max(job.phase_current, job.files_scanned));
      if (job.unchanged_files > 0) {
        const discovered = Math.max(job.files_total, total + job.unchanged_files);
        return t("scanBanner.analyzingQueuedProgress", {
          scanned,
          total,
          percent: formatScanJobProgressPercent(job.phase_progress_percent),
          unchanged: job.unchanged_files,
          discovered,
        });
      }
      return t("scanBanner.analyzingProgress", {
        scanned,
        total,
        percent: formatScanJobProgressPercent(job.phase_progress_percent),
      });
    }
  }

  if (job.phase_detail) {
    return job.eta_seconds ? `${job.phase_detail} · ~${Math.max(1, Math.round(job.eta_seconds))}s remaining` : job.phase_detail;
  }

  return job.phase_label;
}
