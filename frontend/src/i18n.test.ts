import { afterEach, expect, it } from "vitest";
import i18n, { i18nReady } from "./i18n";

afterEach(async () => { await i18n.changeLanguage("en"); });

it("loads a selected language before committing the language switch and retains English fallback", async () => {
  await i18nReady;
  const english = i18n.t("common.save");
  await i18n.changeLanguage("de");
  expect(i18n.hasResourceBundle("de", "common")).toBe(true);
  expect(i18n.hasResourceBundle("en", "common")).toBe(true);
  expect(document.documentElement.lang).toBe("de");
  expect(localStorage.getItem("medialyze-language")).toBe("de");
  expect(i18n.t("common.save")).not.toBe(english);
});
