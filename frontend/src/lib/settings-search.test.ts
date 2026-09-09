import { describe, expect, it } from "vitest";

import {
  isConfidentSettingsSearchMatch,
  rankSettingsSearchTargets,
  type SettingsSearchTarget,
} from "./settings-search";

const targets: SettingsSearchTarget[] = [
  {
    id: "compatibility-tab-combination",
    panel: "compatibilityProfiles",
    label: "Combination",
    context: "Hardware & software profiles",
    aliases: ["Kombination"],
    focus: "compatibility-tab-combination",
  },
  {
    id: "settings-panel-transcoding",
    panel: "transcoding",
    label: "Transcoding",
    context: "Application",
    aliases: ["Encoding"],
    focus: "settings-panel-transcoding",
  },
];

describe("settings search", () => {
  it("ranks an exact nested-tab match first", () => {
    const [match] = rankSettingsSearchTargets(targets, "Combination", "transcoding");

    expect(match.target.id).toBe("compatibility-tab-combination");
    expect(match.target.focus).toBe("compatibility-tab-combination");
    expect(isConfidentSettingsSearchMatch(match)).toBe(true);
  });

  it("accepts a small typo in a nested-tab label", () => {
    const [match] = rankSettingsSearchTargets(targets, "Combinaton");

    expect(match.target.id).toBe("compatibility-tab-combination");
    expect(isConfidentSettingsSearchMatch(match)).toBe(true);
  });

  it("prefers a result in the active settings page when scores are otherwise equal", () => {
    const [match] = rankSettingsSearchTargets(targets, "encoding", "transcoding");

    expect(match.target.panel).toBe("transcoding");
  });

  it("does not create suggestions for a one-character query", () => {
    expect(rankSettingsSearchTargets(targets, "c")).toEqual([]);
  });
});
