import "../i18n";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildDefaultLibraryStatisticsSettings } from "../lib/library-statistics-settings";
import { TableViewSettingsEditor } from "./TableViewSettingsEditor";

describe("TableViewSettingsEditor", () => {
  it("only lists table columns that can render for the active library type", () => {
    render(
      <TableViewSettingsEditor
        settings={buildDefaultLibraryStatisticsSettings()}
        libraryType="music"
        showMusicQualityScore
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("Narrator")).not.toBeInTheDocument();
    expect(screen.queryByText("Series part")).not.toBeInTheDocument();
    expect(screen.getByText("Artist")).toBeInTheDocument();
    expect(screen.getByText("Album")).toBeInTheDocument();
  });

  it("uses table column labels for audiobook metadata instead of raw statistic keys", () => {
    render(
      <TableViewSettingsEditor
        settings={buildDefaultLibraryStatisticsSettings()}
        libraryType="audiobooks"
        showMusicQualityScore
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Narrator")).toBeInTheDocument();
    expect(screen.getByText("Series part")).toBeInTheDocument();
    expect(screen.queryByText("Series parts")).not.toBeInTheDocument();
    expect(screen.getAllByText("Description").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Copyright").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Book language").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ASIN").length).toBeGreaterThan(0);
    expect(screen.queryByText("libraryStatistics.items.audiobook_language")).not.toBeInTheDocument();
    expect(screen.queryByText("libraryStatistics.items.audiobook_series_parts")).not.toBeInTheDocument();
  });
});
