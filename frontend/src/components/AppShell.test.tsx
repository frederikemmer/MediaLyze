import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import { api, type AppSettings } from "../lib/api";
import { ScanJobsProvider } from "../lib/scan-jobs";
import { AppShell } from "./AppShell";

vi.mock("../lib/app-version", () => ({ APP_VERSION: "0.8.3" }));

type AppSettingsOverrides = Omit<Partial<AppSettings>, "scan_performance" | "feature_flags"> & {
  scan_performance?: Partial<NonNullable<AppSettings["scan_performance"]>>;
  feature_flags?: Partial<AppSettings["feature_flags"]>;
};

function createAppSettings(overrides: AppSettingsOverrides = {}): AppSettings {
  const {
    feature_flags: overrideFeatureFlags = {},
    scan_performance: overrideScanPerformance = {},
    ...restOverrides
  } = overrides;

  return {
    ignore_patterns: [],
    user_ignore_patterns: [],
    default_ignore_patterns: [],
    scan_performance: {
      scan_worker_count: 4,
      parallel_scan_jobs: 2,
      comparison_scatter_point_limit: 5000,
      ...overrideScanPerformance,
    },
    feature_flags: {
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
      show_music_quality_score: false,
      unlimited_panel_size: false,
      in_depth_dolby_vision_profiles: false,
      ...overrideFeatureFlags,
    },
    ...restOverrides,
  };
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AppDataProvider>
        <ScanJobsProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<div>Dashboard</div>} />
            </Route>
          </Routes>
        </ScanJobsProvider>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
  vi.spyOn(api, "libraries").mockResolvedValue([]);
  vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("shows release notes for the current version until dismissed", async () => {
    renderShell();

    expect(await screen.findByRole("dialog", { name: "What's new" })).toBeInTheDocument();
    expect(screen.getAllByText("Version 0.8.3").length).toBeGreaterThan(0);
    expect(screen.getByText(/default the full-width app shell feature flag/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /version 0\.8\.2/i })).toBeInTheDocument();
    expect(screen.queryByText(/backfill legacy library-history snapshots/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /version 0\.8\.2/i }));

    expect(screen.getByText(/backfill legacy library-history snapshots/i)).toBeInTheDocument();
    expect(screen.queryByText(/default the full-width app shell feature flag/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close release notes" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "What's new" })).not.toBeInTheDocument());
    expect(window.localStorage.getItem("medialyze-release-notes-seen-version")).toBe("0.8.3");

    fireEvent.click(screen.getByRole("button", { name: "Show release notes for v0.8.3" }));

    expect(await screen.findByRole("dialog", { name: "What's new" })).toBeInTheDocument();
    expect(screen.getByText(/default the full-width app shell feature flag/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open GitHub repository" })).toHaveAttribute(
      "href",
      "https://github.com/frederikemmer/MediaLyze/",
    );
    expect(screen.getByRole("link", { name: "Open GitHub repository" })).toHaveAttribute(
      "data-tooltip",
      "Open GitHub repository",
    );
    expect(screen.getByRole("link", { name: "Report an issue" })).toHaveAttribute(
      "href",
      "https://github.com/frederikemmer/MediaLyze/issues/new/choose",
    );
    expect(screen.getByRole("link", { name: "Report an issue" })).toHaveAttribute(
      "data-tooltip",
      "Report an issue",
    );

    fireEvent.mouseDown(document.querySelector(".release-notes-backdrop")!);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "What's new" })).not.toBeInTheDocument());
  });

  it("does not show already dismissed release notes for the current version", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-version", "0.8.3");

    renderShell();

    await waitFor(() => expect(api.libraries).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "What's new" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show release notes for v0.8.3" }));

    expect(await screen.findByRole("dialog", { name: "What's new" })).toBeInTheDocument();
  });

  it("applies the full-width shell class when the feature flag is enabled", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_full_width_app_shell: true,
        },
      }),
    );

    const { container } = renderShell();

    await waitFor(() =>
      expect(container.querySelector(".media-app-shell")).toHaveClass("media-app-shell-full-width"),
    );
  });
});
