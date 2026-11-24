import { afterEach, expect, it, vi } from "vitest";
import { preferenceStorage, restorePreferenceState, selectPreferenceIdentity } from "./preference-storage";

afterEach(() => { vi.restoreAllMocks(); selectPreferenceIdentity(null); localStorage.clear(); });

it("restores only supported keys into the selected identity, including favorites", () => {
  selectPreferenceIdentity("account:a", { "medialyze.compatibility-profile-favorites": "[\"x\"]", "medialyze-theme": "dark", "medialyze.other": "no" });
  expect(preferenceStorage.getItem("medialyze.compatibility-profile-favorites")).toBe('["x"]');
  expect(preferenceStorage.getItem("medialyze.other")).toBeNull();
  selectPreferenceIdentity("account:b");
  expect(preferenceStorage.getItem("medialyze-theme")).toBeNull();
});

it("keeps hydration and identical writes silent, but announces actual guest changes and removal", async () => {
  selectPreferenceIdentity("guest");
  const save = vi.fn();
  window.addEventListener("medialyze-preference-save", save);
  await restorePreferenceState(async () => preferenceStorage.setItem("medialyze-language", "de"));
  preferenceStorage.setItem("medialyze-language", "de");
  expect(save).not.toHaveBeenCalled();
  preferenceStorage.setItem("medialyze-language", "en");
  preferenceStorage.removeItem("medialyze-language");
  expect(save).toHaveBeenCalledTimes(2);
  window.removeEventListener("medialyze-preference-save", save);
});

it("announces a failed removal without exposing its error", async () => {
  selectPreferenceIdentity("guest");
  preferenceStorage.setItem("medialyze-theme", "dark");
  const save = vi.fn();
  window.addEventListener("medialyze-preference-save", save);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("secret"); });
  expect(() => preferenceStorage.removeItem("medialyze-theme")).toThrow();
  expect(save).toHaveBeenCalledTimes(1);
  await expect(save.mock.calls[0][0].detail.promise).rejects.toThrow("secret");
  window.removeEventListener("medialyze-preference-save", save);
});

it("leaves favorite local failure reporting to its owning hook", () => {
  selectPreferenceIdentity("guest");
  const save = vi.fn(); window.addEventListener("medialyze-preference-save", save);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(() => preferenceStorage.setItem("medialyze.compatibility-profile-favorites", "[]")).toThrow();
  expect(save).not.toHaveBeenCalled();
  window.removeEventListener("medialyze-preference-save", save);
});

it("announces user-driven layout and display preferences while excluding mount and navigation state", async () => {
  selectPreferenceIdentity("guest");
  const save = vi.fn();
  window.addEventListener("medialyze-preference-save", save);
  const included = ["medialyze-library-file-column-widths", "medialyze-transcoding-column-widths", "medialyze-library-statistics-settings-movies", "medialyze-comparison-selection-dashboard", "medialyze-comparison-selection-library", "medialyze-file-detail-audio-stream-primary", "medialyze-statistic-panel-layout-dashboard-main"];
  included.push("medialyze-file-compare-column-count");
  const excluded = ["medialyze-file-detail-sidebar-collapsed", "medialyze-dashboard-history-selected-metric", "medialyze-library-detail-history-range-selection", "medialyze-file-detail-panel-settings"];
  await restorePreferenceState(async () => included.forEach((key) => preferenceStorage.setItem(key, "initial")));
  expect(save).not.toHaveBeenCalled();
  excluded.forEach((key) => preferenceStorage.setItem(key, "value"));
  expect(save).not.toHaveBeenCalled();
  included.forEach((key) => preferenceStorage.setItem(key, "changed"));
  expect(save.mock.calls.map(([event]) => event.detail.key)).toEqual(included);
  included.forEach((key) => preferenceStorage.setItem(key, "changed"));
  expect(save).toHaveBeenCalledTimes(included.length);
  window.removeEventListener("medialyze-preference-save", save);
});
