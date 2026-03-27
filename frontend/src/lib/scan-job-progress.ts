import type { ScanJob } from "./api";

export function formatScanJobProgressPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (value >= 99 || value <= 0) {
    return String(Math.round(value));
  }
  return value.toFixed(1);
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
        return t("scanBanner.analyzingQueuedProgress", {
          scanned,
          total,
          percent: formatScanJobProgressPercent(job.phase_progress_percent),
          unchanged: job.unchanged_files,
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
