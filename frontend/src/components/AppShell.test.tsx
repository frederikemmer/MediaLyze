import "../i18n";

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import { api, type AppSettings } from "../lib/api";
import { ScanJobsProvider } from "../lib/scan-jobs";
import { AppShell } from "./AppShell";

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
      ...overrideScanPerformance,
    },
    feature_flags: {
      show_dolby_vision_profiles: false,
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
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
  vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
  vi.spyOn(api, "libraries").mockResolvedValue([]);
  vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppShell", () => {
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
