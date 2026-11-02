import type { HistoryReconstructionStatus, ScanJob, TranscodeJob } from "./api";

export type ExplicitJobStart =
  | { kind: "scan"; job: ScanJob }
  | { kind: "transcode"; job: TranscodeJob }
  | { kind: "connector_sync"; connectionId: number; connectionName: string; jobId: number }
  | { kind: "jellyfin_sync"; jobId: number }
  | { kind: "history_reconstruction"; status: HistoryReconstructionStatus; libraryId?: number };

export const EXPLICIT_JOB_START_EVENT = "medialyze:explicit-job-start";

export function trackExplicitJobStart(job: ExplicitJobStart): void {
  window.dispatchEvent(new CustomEvent<ExplicitJobStart>(EXPLICIT_JOB_START_EVENT, { detail: job }));
}
