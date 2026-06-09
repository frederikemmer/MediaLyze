import "./i18n";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { App } from "./App";
import { api, type AppSettings } from "./lib/api";

const appVersionMock = vi.hoisted(() => ({ value: "dev" }));

vi.mock("./lib/app-version", () => ({
  get APP_VERSION() {
    return appVersionMock.value;
  },
}));

vi.mock("./pages/DashboardPage", () => ({ DashboardPage: () => <main>Dashboard route</main> }));
vi.mock("./pages/LibrariesPage", () => ({ LibrariesPage: () => <main>Settings route</main> }));
vi.mock("./pages/LibraryDetailPage", () => ({ LibraryDetailPage: () => <main>Library route</main> }));
vi.mock("./pages/SeriesDetailPage", () => ({ SeriesDetailPage: () => <main>Series route</main> }));
vi.mock("./pages/FileDetailPage", () => ({ FileDetailPage: () => <main>File route</main> }));

function createAppSettings(): AppSettings {
  return {
    ignore_patterns: [],
    user_ignore_patterns: [],
    default_ignore_patterns: [],
    scan_performance: {
      scan_worker_count: 4,
      parallel_scan_jobs: 2,
      comparison_scatter_point_limit: 5000,
    },
    feature_flags: {
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
      show_music_quality_score: false,
      unlimited_panel_size: false,
      in_depth_dolby_vision_profiles: false,
    },
    telemetry: {
      mode: "off",
      environment_disabled: false,
      installation_id_suffix: null,
      last_sent_at: null,
      last_user_visible_payload: null,
    },
  };
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  appVersionMock.value = "dev";
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  window.localStorage.clear();
  window.localStorage.setItem("medialyze-release-notes-seen-app-version", "dev");
  vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
  vi.spyOn(api, "libraries").mockResolvedValue([]);
  vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);
  vi.spyOn(api, "updateStatus").mockResolvedValue({
    current_version: "dev",
    latest_version: null,
    update_available: false,
    checked_at: null,
    release_notes: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App routing", () => {
  it("renders the UI elements catalog in development builds", async () => {
    const { container } = renderApp("/ui-elements");

    expect(await screen.findByRole("heading", { name: "UI elements" })).toBeInTheDocument();
    expect(screen.getByLabelText("Theme preview")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Header & navigation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings variants" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tables" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Runtime & scan logs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Library & file detail" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Duplicates, paths & telemetry" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dialogs, popovers & tooltips" })).toBeInTheDocument();

    expect(screen.getAllByText("Dashboard", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Settings", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Library detail", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("File detail", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Scan logs", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Release notes", { exact: false }).length).toBeGreaterThan(0);

    expect(screen.getByText("Quality picker and profile editor")).toBeInTheDocument();
    expect(screen.getByText("Analyzed files virtual table")).toBeInTheDocument();
    expect(screen.getByText("Recent scan log card")).toBeInTheDocument();
    expect(screen.getByText("Duplicate group cards")).toBeInTheDocument();
    expect(screen.getByText("File detail navigation and badges")).toBeInTheDocument();
    expect(screen.getByText("Release notes dialog")).toBeInTheDocument();
    expect(container.querySelector("button.icon-nav-button, button.library-nav-link")).toBeNull();
    expect(container.querySelectorAll("a.icon-nav-button, a.library-nav-link").length).toBeGreaterThanOrEqual(4);
  });

  it("redirects the UI elements catalog route outside development builds", async () => {
    appVersionMock.value = "0.14.0";
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.14.0");

    renderApp("/ui-elements");

    await waitFor(() => expect(screen.getByText("Dashboard route")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "UI elements" })).not.toBeInTheDocument();
  });
});
