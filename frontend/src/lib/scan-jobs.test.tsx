import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type ScanJob } from "./api";
import { ACTIVE_SCAN_JOBS_POLL_INTERVAL_MS, ScanJobsProvider, useScanJobs } from "./scan-jobs";

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
    phase_label: "Analyzing media",
    phase_detail: null,
  };
}

function Probe() {
  const { activeJobs, stopAll, trackJob } = useScanJobs();
  return (
    <>
      <div data-testid="job-count">{activeJobs.length}</div>
      <button type="button" onClick={() => trackJob(createJob(1))}>
        track
      </button>
      <button type="button" onClick={() => void stopAll().catch(() => undefined)}>
        stop
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
      await vi.advanceTimersByTimeAsync(ACTIVE_SCAN_JOBS_POLL_INTERVAL_MS);
    });

    await flushEffects();

    expect(activeScanJobsSpy.mock.calls.length).toBeGreaterThan(initialCallCount);
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

  it("keeps tracked scans visible when cancel fails", async () => {
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);
    vi.spyOn(api, "cancelActiveScanJobs").mockRejectedValue(new Error("database busy"));

    render(
      <ScanJobsProvider>
        <Probe />
      </ScanJobsProvider>,
    );

    await flushEffects();
    fireEvent.click(screen.getByRole("button", { name: "track" }));
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await flushEffects();

    expect(screen.getByTestId("job-count")).toHaveTextContent("1");
  });
});
