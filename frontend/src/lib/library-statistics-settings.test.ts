import { beforeEach, describe, expect, it } from "vitest";

import {
  getVisibleDashboardStatisticPanels,
  getLibraryStatisticsSettings,
  getVisibleLibraryStatisticTableColumns,
  moveLibraryStatistic,
  saveLibraryStatisticsSettings,
} from "./library-statistics-settings";

describe("library statistics settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the expected defaults when nothing is stored", () => {
    const settings = getLibraryStatisticsSettings();

    expect(settings.order[0]).toBe("size");
    expect(settings.order[1]).toBe("quality_score");
    expect(settings.visibility.hdr_type.panelEnabled).toBe(true);
    expect(settings.visibility.hdr_type.tableEnabled).toBe(true);
    expect(settings.visibility.video_codec.dashboardEnabled).toBe(true);
    expect(settings.visibility.subtitle_sources.dashboardEnabled).toBe(false);
    expect(settings.visibility.audio_codecs.tableEnabled).toBe(false);
    expect(getVisibleLibraryStatisticTableColumns(settings)).toEqual([
      "size",
      "quality_score",
      "video_codec",
      "resolution",
      "hdr_type",
      "duration",
      "audio_languages",
      "subtitle_languages",
    ]);
    expect(getVisibleDashboardStatisticPanels(settings).map((entry) => entry.id)).toEqual([
      "video_codec",
      "resolution",
      "hdr_type",
      "audio_codecs",
      "audio_languages",
      "subtitle_languages",
    ]);
  });

  it("normalizes partial stored settings and keeps unsupported panel toggles disabled", () => {
    window.localStorage.setItem(
      "medialyze-library-statistics-settings",
      JSON.stringify({
        order: ["quality_score", "video_codec"],
        visibility: {
          quality_score: { panelEnabled: true, tableEnabled: false, dashboardEnabled: true },
          video_codec: { panelEnabled: false, tableEnabled: true, dashboardEnabled: false },
        },
      }),
    );

    const settings = getLibraryStatisticsSettings();

    expect(settings.order[0]).toBe("quality_score");
    expect(settings.order).toContain("subtitle_sources");
    expect(settings.visibility.quality_score.panelEnabled).toBe(false);
    expect(settings.visibility.quality_score.tableEnabled).toBe(false);
    expect(settings.visibility.quality_score.dashboardEnabled).toBe(false);
    expect(settings.visibility.video_codec.panelEnabled).toBe(false);
    expect(settings.visibility.video_codec.dashboardEnabled).toBe(false);
  });

  it("migrates the previous default preset to the new standard preset", () => {
    window.localStorage.setItem(
      "medialyze-library-statistics-settings",
      JSON.stringify({
        order: [
          "size",
          "video_codec",
          "resolution",
          "hdr_type",
          "duration",
          "audio_codecs",
          "audio_languages",
          "subtitle_languages",
          "subtitle_codecs",
          "subtitle_sources",
          "quality_score",
        ],
        visibility: {
          size: { panelEnabled: false, tableEnabled: true, dashboardEnabled: false },
          video_codec: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
          resolution: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
          hdr_type: { panelEnabled: true, tableEnabled: false, dashboardEnabled: true },
          duration: { panelEnabled: false, tableEnabled: true, dashboardEnabled: false },
          audio_codecs: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
          audio_languages: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
          subtitle_languages: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
          subtitle_codecs: { panelEnabled: true, tableEnabled: true, dashboardEnabled: false },
          subtitle_sources: { panelEnabled: true, tableEnabled: true, dashboardEnabled: false },
          quality_score: { panelEnabled: false, tableEnabled: true, dashboardEnabled: false },
        },
      }),
    );

    const settings = getLibraryStatisticsSettings();

    expect(settings.order[1]).toBe("quality_score");
    expect(settings.visibility.hdr_type.tableEnabled).toBe(true);
    expect(settings.visibility.audio_codecs.tableEnabled).toBe(false);
    expect(settings.visibility.subtitle_sources.tableEnabled).toBe(false);
    expect(settings.visibility.audio_codecs.dashboardEnabled).toBe(true);
  });

  it("persists reordered settings", () => {
    const current = getLibraryStatisticsSettings();
    const updated = saveLibraryStatisticsSettings(moveLibraryStatistic(current, "quality_score", "size"));
    const reloaded = getLibraryStatisticsSettings();

    expect(updated.order[0]).toBe("quality_score");
    expect(reloaded.order[0]).toBe("quality_score");
  });
});
