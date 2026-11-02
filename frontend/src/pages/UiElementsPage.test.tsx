import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { AppDataProvider } from "../lib/app-data";
import { NotificationProvider } from "../lib/notifications";
import { UiElementsPage } from "./UiElementsPage";
import i18n from "../i18n";

it("keeps the real catalog sections, shared fixtures and navigation contracts", async () => {
  await i18n.changeLanguage("en");
  // The catalog intentionally contains thousands of controls. Its inventory
  // needs markup, not effects for every fixture or repeated visibility walks.
  // Interactive behavior is covered by the shared components' DOM tests.
  const markup = renderToStaticMarkup(<MemoryRouter><AppDataProvider><NotificationProvider><UiElementsPage /></NotificationProvider></AppDataProvider></MemoryRouter>);
  const document = new DOMParser().parseFromString(markup, "text/html");
  const headings = [...document.querySelectorAll("h1, h2, h3, h4")].map(node => node.textContent);
  expect(headings).toEqual(expect.arrayContaining([
    "UI elements", "Header & navigation", "Settings variants", "Tables", "Runtime & scan logs",
    "Library & file detail", "Duplicates, paths & telemetry", "Dialogs, popovers & tooltips",
  ]));
  expect(document.querySelector(".ui-elements-theme-field select")).not.toBeNull();
  for (const text of [
    "Dashboard", "Settings", "Library detail", "File detail", "Scan logs", "Release notes",
    "Quality profiles list and metric accordions", "Analyzed files virtual table", "Recent scan log card",
    "Duplicate group cards", "File detail navigation and badges", "Release notes dialog",
  ]) expect(document.body.textContent).toContain(text);
  const navigationButtons = document.querySelectorAll("button.icon-nav-button:not(.media-header-account-trigger), button.library-nav-link");
  expect(navigationButtons.length).toBeGreaterThan(0);
  navigationButtons.forEach(button => {
    expect(button.closest(".media-nav-library-menu")).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Libraries");
    expect(["true", "false"]).toContain(button.getAttribute("aria-expanded"));
  });
  expect(document.querySelectorAll("a.icon-nav-button, a.library-nav-link").length).toBeGreaterThanOrEqual(4);
});
