import "../i18n";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import * as auth from "../lib/auth";
import { HistoryReconstructionControl, emptyHistoryStatus } from "./HistoryReconstructionControl";

beforeEach(() => {
  vi.spyOn(auth, "useAuth").mockReturnValue({ identity: {
    id: "scanner", username: "Scanner", kind: "account", owner: false,
    revision: 1, must_change_password: false,
    policy: { ...auth.emptyPolicy(), libraries: { "7": ["library.read", "library.scan"] } },
  }, status: null, has: (right, id) => (right === "library.scan" || right === "library.read") && id === 7,
  refresh: async () => {}, logout: async () => {} });
  vi.spyOn(api, "historyReconstructionStatus").mockResolvedValue(emptyHistoryStatus());
  vi.spyOn(api, "reconstructHistory").mockResolvedValue({ ...emptyHistoryStatus(), status: "queued", phase: "loading_libraries", library_ids: [7] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("submits only its library without global app-settings permission", async () => {
  render(<HistoryReconstructionControl libraryId={7} />);
  await waitFor(() => expect(api.historyReconstructionStatus).toHaveBeenCalledWith(7));
  fireEvent.click(screen.getByRole("button", { name: "Reconstruct history" }));
  await waitFor(() => expect(api.reconstructHistory).toHaveBeenCalledWith(7));
  expect(await screen.findByRole("button", { name: "Reconstructing…" })).toBeDisabled();
});

it("uses the server's authorized bulk scope and keeps metadata-only controls hidden", async () => {
  const { unmount } = render(<HistoryReconstructionControl />);
  await waitFor(() => expect(api.historyReconstructionStatus).toHaveBeenCalledWith(undefined));
  fireEvent.click(screen.getByRole("button", { name: "Reconstruct history" }));
  await waitFor(() => expect(api.reconstructHistory).toHaveBeenCalledWith(undefined));
  unmount();
  render(<HistoryReconstructionControl libraryId={8} />);
  expect(screen.queryByRole("button", { name: "Reconstruct history" })).not.toBeInTheDocument();
});

it("keeps selected active scans protected and catalog fixtures non-mutating", () => {
  const { rerender } = render(<HistoryReconstructionControl libraryId={7} blocked />);
  expect(screen.getByRole("button", { name: "Reconstruct history" })).toBeDisabled();
  rerender(<HistoryReconstructionControl fixture={emptyHistoryStatus()} />);
  fireEvent.click(screen.getByRole("button", { name: "Reconstruct history" }));
  expect(api.reconstructHistory).not.toHaveBeenCalled();
});

it("does not let an older status response overwrite a new request", async () => {
  let finish: ((value: ReturnType<typeof emptyHistoryStatus>) => void) | undefined;
  vi.mocked(api.historyReconstructionStatus).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<HistoryReconstructionControl libraryId={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Reconstruct history" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reconstructing…" })).toBeDisabled());
  await act(async () => { finish?.(emptyHistoryStatus()); });
  expect(screen.getByRole("button", { name: "Reconstructing…" })).toBeDisabled();
});

it("shows failed status refreshes and lets the user retry", async () => {
  vi.mocked(api.historyReconstructionStatus)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(emptyHistoryStatus());
  render(<HistoryReconstructionControl libraryId={7} />);

  expect(await screen.findByRole("alert")).toHaveTextContent("History status could not be refreshed.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText(/Last successful status update:/)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("explains when reconstructed history is being saved", () => {
  render(<HistoryReconstructionControl fixture={{ ...emptyHistoryStatus(), status: "running", phase: "saving_history", progress_percent: 99 }} />);
  expect(screen.getByText("Saving reconstructed history")).toBeInTheDocument();
});
