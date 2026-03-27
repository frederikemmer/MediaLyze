import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type ScanJob } from "./api";
import {
  ACTIVE_DUPLICATE_PHASE_POLL_INTERVAL_MS,
  ACTIVE_SCAN_PROGRESS_POLL_INTERVAL_MS,
  ScanJobsProvider,
  useScanJobs,
} from "./scan-jobs";

function createJob(id: number): ScanJob {
  return {
    id,
    library_id: id,
    library_name: `Library ${id}`,
    status: "running",
    job_type: "incremental",
    files_total: 100,
    files_scanned: 10,
    errors: 0,
    started_at: "2026-03-11T10:00:00Z",
    finished_at: null,
    progress_percent: 10,
    phase_key: "analyzing",
    phase_label: "Analyzing media",
    phase_detail: null,
    phase_progress_percent: 10,
    phase_current: 10,
    phase_total: 100,
    eta_seconds: null,
    scan_mode_label: "incremental",
    duplicate_detection_mode: "filename",
  };
}

function createQueuedJob(id: number): ScanJob {
  return {
    ...createJob(id),
    status: "queued",
    started_at: null,
    progress_percent: 0,
    phase_key: "queued",
    phase_label: "Queued",
    phase_detail: "Waiting to start",
    phase_progress_percent: 0,
    phase_current: 0,
    phase_total: 0,
  };
}

function Probe() {
  const { activeJobs, trackJob } = useScanJobs();
  return (
    <>
      <div data-testid="job-count">{activeJobs.length}</div>
      <button type="button" onClick={() => trackJob(createJob(1))}>
        track
      </button>
    </>
  );
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("ScanJobsProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibilityState("visible");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    setVisibilityState("visible");
  });

  it("refreshes once on mount but does not keep polling while no scan is tracked", async () => {
    const activeScanJobsSpy = vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    render(
      <ScanJobsProvider>
        <Probe />
      </ScanJobsProvider>,
    );

    await flushEffects();
    const initialCallCount = activeScanJobsSpy.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    expect(initialCallCount).toBeGreaterThan(0);
    expect(activeScanJobsSpy).toHaveBeenCalledTimes(initialCallCount);
  });

  it("starts polling after a scan job is tracked", async () => {
    const activeScanJobsSpy = vi.spyOn(api, "activeScanJobs").mockResolvedValue([createJob(1)]);

    render(
      <ScanJobsProvider>
        <Probe />
      </ScanJobsProvider>,
    );

    await flushEffects();
    const initialCallCount = activeScanJobsSpy.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "track" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_SCAN_PROGRESS_POLL_INTERVAL_MS);
    });

    await flushEffects();

    expect(activeScanJobsSpy.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("keeps a running job visible when a queued job for the same library is tracked", async () => {
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    function SameLibraryProbe() {
      const { activeJobs, trackJob } = useScanJobs();
      return (
        <>
          <div data-testid="job-status">{activeJobs[0]?.status ?? "none"}</div>
          <button type="button" onClick={() => trackJob(createJob(1))}>
            track-running
          </button>
          <button type="button" onClick={() => trackJob(createQueuedJob(1))}>
            track-queued
          </button>
        </>
      );
    }

    render(
      <ScanJobsProvider>
        <SameLibraryProbe />
      </ScanJobsProvider>,
    );

    await flushEffects();

    fireEvent.click(screen.getByRole("button", { name: "track-running" }));
    expect(screen.getByTestId("job-status").textContent).toBe("running");

    fireEvent.click(screen.getByRole("button", { name: "track-queued" }));
    expect(screen.getByTestId("job-status").textContent).toBe("running");
  });

  it("refreshes again on focus only while a scan is tracked", async () => {
    const activeScanJobsSpy = vi.spyOn(api, "activeScanJobs").mockResolvedValue([createJob(1)]);

    render(
      <ScanJobsProvider>
        <Probe />
      </ScanJobsProvider>,
    );

    await flushEffects();
    const initialCallCount = activeScanJobsSpy.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "track" }));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await flushEffects();

    expect(activeScanJobsSpy.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("uses the faster polling cadence during duplicate phases", async () => {
    const duplicateJob = { ...createJob(1), phase_key: "detecting_duplicates_artifacts", phase_label: "Detecting duplicates" };
    const activeScanJobsSpy = vi.spyOn(api, "activeScanJobs").mockResolvedValue([duplicateJob]);

    render(
      <ScanJobsProvider>
        <Probe />
      </ScanJobsProvider>,
    );

    await flushEffects();
    const initialCallCount = activeScanJobsSpy.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_DUPLICATE_PHASE_POLL_INTERVAL_MS);
    });

    expect(activeScanJobsSpy.mock.calls.length).toBeGreaterThan(initialCallCount);
  });
});
