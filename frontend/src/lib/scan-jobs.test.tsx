import i18n from "../i18n";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanJobCard } from "../components/AppShell";
import { api, type ScanJob } from "./api";
import { emptyPolicy, type Identity } from "./auth";
import { ScanJobsProvider, useScanJobs } from "./scan-jobs";

const auth = vi.hoisted(() => ({ identity: null as Identity | null,
  has: (_right: string, _id?: number): boolean => false }));
vi.mock("./auth", async (original) => ({ ...await original<typeof import("./auth")>(), useAuth: () => auth }));

const job: ScanJob = { id: 1, library_id: 7, library_name: "Movies", status: "running",
  job_type: "quality_recompute", files_total: 10, files_scanned: 7, errors: 0,
  started_at: null, finished_at: null, progress_percent: 70, progress_mode: "determinate",
  phase_label: "Recomputing quality scores", phase_detail: null };
function Probe() {
  const scans = useScanJobs();
  return <>
    <output data-testid="jobs">{scans.activeJobs.map(j => j.id).join(",")}</output>
    <button onClick={() => scans.trackJob({ ...job, id: 2, library_id: 8 })}>Track hidden</button>
    <button onClick={() => scans.stopAll()}>Stop all</button>
    <button onClick={() => scans.refresh()}>Refresh</button>
  </>;
}
beforeEach(async () => {
  await i18n.changeLanguage("en");
  auth.identity = { id: "reader", username: "Reader", kind: "account", owner: false,
    revision: 1, must_change_password: false,
    policy: { ...emptyPolicy(), libraries: { "7": ["library.read"] } } };
  auth.has = (right, id) => right === "library.read" && id === 7;
  vi.spyOn(api, "activeScanJobs").mockResolvedValue([job]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("scan metadata access", () => {
  it("loads scoped scan/quality progress for a non-owner and ignores hidden tracked jobs", async () => {
    render(<ScanJobsProvider><Probe /></ScanJobsProvider>);
    await waitFor(() => expect(screen.getByTestId("jobs")).toHaveTextContent("1"));
    fireEvent.click(screen.getByText("Track hidden"));
    expect(screen.getByTestId("jobs")).toHaveTextContent(/^1$/);
    expect(api.activeScanJobs).toHaveBeenCalledTimes(1);
  });

  it("retains readable jobs that a bulk cancellation did not authorize", async () => {
    vi.spyOn(api, "cancelActiveScanJobs").mockResolvedValue({ canceled_jobs: 0 });
    render(<ScanJobsProvider><Probe /></ScanJobsProvider>);
    await waitFor(() => expect(screen.getByTestId("jobs")).toHaveTextContent("1"));
    await act(async () => { fireEvent.click(screen.getByText("Stop all")); });
    expect(screen.getByTestId("jobs")).toHaveTextContent(/^1$/);
    expect(api.activeScanJobs).toHaveBeenCalledTimes(2);
  });

  it("shows read-only progress without the cancellation action", () => {
    const stop = vi.fn();
    const { rerender } = render(<ScanJobCard job={job} stopping={false} onStop={stop} canStop={false} />);
    expect(screen.getByText("Movies")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: i18n.t("scanBanner.metrics.stopJob") })).not.toBeInTheDocument();
    rerender(<ScanJobCard job={job} stopping={false} onStop={stop} canStop />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("scanBanner.metrics.stopJob") }));
    expect(stop).toHaveBeenCalledOnce();
  });
});
