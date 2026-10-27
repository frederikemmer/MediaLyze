import { describe, expect, it } from "vitest";

import {
  settingsPanelFromSection,
  settingsSectionForPanel,
} from "./settings-panel-state";

describe("settings panel URL state", () => {
  it("maps stable URL slugs to every settings panel", () => {
    expect(settingsPanelFromSection("libraries")).toBe("configuredLibraries");
    expect(settingsPanelFromSection("jellyfin")).toBe("jellyfin");
    expect(settingsPanelFromSection("quality-profiles")).toBe("qualityProfiles");
    expect(settingsPanelFromSection("compatibility-profiles")).toBe("compatibilityProfiles");
    expect(settingsPanelFromSection("application")).toBe("appSettings");
    expect(settingsPanelFromSection("resolution-categories")).toBe("qualityProfiles");
    expect(settingsPanelFromSection("pattern-recognition")).toBe("patternRecognition");
    expect(settingsPanelFromSection("history-retention")).toBe("historyRetention");
    expect(settingsPanelFromSection("scan-logs")).toBe("recentScanLogs");
    expect(settingsPanelFromSection("telemetry")).toBe("telemetry");
  });

  it("keeps legacy internal ids readable and emits canonical slugs", () => {
    expect(settingsPanelFromSection("configuredLibraries")).toBe("configuredLibraries");
    expect(settingsPanelFromSection("unknown")).toBeNull();
    expect(settingsSectionForPanel("recentScanLogs")).toBe("scan-logs");
  });
});
