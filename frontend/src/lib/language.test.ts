import { describe, expect, it } from "vitest";

import {
  formatFilenameLanguageCode,
  formatLanguageLabel,
  languageOptions,
  normalizeLanguageTag,
} from "./language";

describe("language helpers", () => {
  it("normalizes ISO aliases and retains BCP 47 regions", () => {
    expect(normalizeLanguageTag("deu")).toBe("de");
    expect(normalizeLanguageTag("eng_US")).toBe("en-US");
    expect(normalizeLanguageTag("ZH-hant-tw")).toBe("zh-Hant-TW");
    expect(normalizeLanguageTag("en-us-u-ca-gregory")).toBe("en-US-u-ca-gregory");
    expect(normalizeLanguageTag("en--US")).toBe("");
  });

  it("keeps unknown and undetermined codes explicit", () => {
    expect(formatLanguageLabel("und", "de")).toBe("Unbestimmt (und)");
    expect(formatLanguageLabel("xx-Qaaa", "en")).toContain("(xx-Qaaa)");
  });

  it("includes observed languages in the standard option list", () => {
    expect(languageOptions(["pt-BR", "deu"], "en")).toEqual(expect.arrayContaining(["pt-BR", "de"]));
  });

  it("formats filename languages as ISO 639-1 or ISO 639-2/B", () => {
    expect(formatFilenameLanguageCode("de", "iso_639_1")).toBe("de");
    expect(formatFilenameLanguageCode("de-DE", "iso_639_2")).toBe("ger-DE");
    expect(formatFilenameLanguageCode("eng", "iso_639_2")).toBe("eng");
    expect(formatFilenameLanguageCode("xx-Qaaa", "iso_639_2")).toBe("xx-Qaaa");
  });
});
