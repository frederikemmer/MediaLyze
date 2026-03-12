import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import { api, type AppSettings, type BrowseResponse } from "../lib/api";
import { ScanJobsProvider } from "../lib/scan-jobs";
import { LibrariesPage } from "./LibrariesPage";

function createAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ignore_patterns: ["movie.tmp", "*/@eaDir/*"],
    user_ignore_patterns: ["movie.tmp"],
    default_ignore_patterns: ["*/@eaDir/*"],
    ...overrides,
  };
}

function createBrowseResponse(): BrowseResponse {
  return {
    current_path: ".",
    parent_path: null,
    entries: [
      {
        name: "media",
        path: "media",
        is_dir: true,
      },
    ],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AppDataProvider>
        <ScanJobsProvider>
          <LibrariesPage />
        </ScanJobsProvider>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(api, "libraries").mockResolvedValue([]);
  vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
  vi.spyOn(api, "browse").mockResolvedValue(createBrowseResponse());
  vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);
  vi.spyOn(api, "updateAppSettings").mockResolvedValue(createAppSettings());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("LibrariesPage ignore patterns", () => {
  it("shows custom patterns expanded and default patterns collapsed by default", async () => {
    renderPage();

    const customToggle = await screen.findByRole("button", { name: /custom ignore patterns/i });
    const defaultToggle = screen.getByRole("button", { name: /default ignore patterns/i });

    expect(customToggle).toHaveAttribute("aria-expanded", "true");
    expect(defaultToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Add a new ignore pattern")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("*/@eaDir/*")).not.toBeInTheDocument();
  });

  it("restores the persisted collapse state from localStorage", async () => {
    window.localStorage.setItem(
      "medialyze-ignore-pattern-sections",
      JSON.stringify({ customExpanded: false, defaultsExpanded: true }),
    );

    renderPage();

    const customToggle = await screen.findByRole("button", { name: /custom ignore patterns/i });
    const defaultToggle = screen.getByRole("button", { name: /default ignore patterns/i });

    expect(customToggle).toHaveAttribute("aria-expanded", "false");
    expect(defaultToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByDisplayValue("*/@eaDir/*")).toBeInTheDocument();
  });

  it("sends custom and default ignore patterns separately when editing defaults", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        ignore_patterns: ["movie.tmp", "*/#recycle/*"],
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/#recycle/*"],
      }),
    );

    renderPage();

    const defaultToggle = await screen.findByRole("button", { name: /default ignore patterns/i });
    fireEvent.click(defaultToggle);

    const defaultInput = await screen.findByDisplayValue("*/@eaDir/*");
    fireEvent.change(defaultInput, { target: { value: "*/#recycle/*" } });
    fireEvent.blur(defaultInput);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/#recycle/*"],
      }),
    );
  });
});
