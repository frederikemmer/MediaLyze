import "../i18n";

import { describe, expect, it } from "vitest";
import i18n from "i18next";

import type { ScanJob } from "./api";
import { describeActiveScanJob, formatScanJobProgressPercent } from "./scan-job-progress";

function createJob(overrides: Partial<ScanJob> = {}): ScanJob {
  return {
    id: 1,
    library_id: 1,
    library_name: "Movies",
    status: "running",
    job_type: "incremental",
    files_total: 8982,
    files_scanned: 22,
    errors: 0,
    started_at: "2026-03-27T10:00:00Z",
    finished_at: null,
    progress_percent: 70,
    phase_key: "analyzing",
    phase_label: "Analyzing media",
    phase_detail: "22 of 8982 files analyzed",
    phase_progress_percent: 100,
    phase_current: 22,
    phase_total: 8982,
    eta_seconds: null,
    scan_mode_label: "incremental",
    duplicate_detection_mode: "filename",
    queued_for_analysis: 22,
    unchanged_files: 8960,
    ...overrides,
  };
}

describe("scan job progress helpers", () => {
  it("formats active analysis text from queued and unchanged counts instead of library total", () => {
    const detail = describeActiveScanJob(i18n.t.bind(i18n), createJob());

    expect(detail).toContain("22/22 queued files analyzed");
    expect(detail).toContain("8960 unchanged");
  });

  it("formats non-integer progress values consistently", () => {
    expect(formatScanJobProgressPercent(15.04)).toBe("15.0");
    expect(formatScanJobProgressPercent(0)).toBe("0");
    expect(formatScanJobProgressPercent(100)).toBe("100");
  });
});
