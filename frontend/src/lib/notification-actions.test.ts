import { describe, expect, it, vi } from "vitest";
import { acquireAutosaveSession, createAutosaveSession } from "./notification-actions";
import { clearIdentityRequests } from "./access-session";
import i18n from "../i18n";

const options = {
  scopeKey: "settings:application", topicKey: "settings:application",
  source: { area: "settings" as const, href: "/settings?section=application", label: "Settings" },
  successMessage: "Changes saved", errorMessage: "Could not save", partialMessage: "Some changes could not be saved",
};

describe("autosave departure feedback", () => {
  it("retains each writer's error context while sharing a page summary", async () => {
    const notify = vi.fn();
    const first = acquireAutosaveSession({ ...options, source: { ...options.source, href: "/settings?section=application#notification-settings" }, errorMessage: "Notification save failed" }, notify);
    const second = acquireAutosaveSession({ ...options, scopeKey: "personal-theme", errorMessage: "Preference save failed" }, notify);
    await second.session.trackSave(Promise.reject(new Error("private"))).catch(() => {});
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error", message: "Preference save failed" }));
    await first.session.trackSave(Promise.resolve());
    first.release(); second.release(); await Promise.resolve();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "warning", source: expect.objectContaining({ href: "/settings?section=application" }) }));
  });
  it("localizes the combined summary in the language selected before departure", async () => {
    const notify = vi.fn();
    const visit = acquireAutosaveSession(options, notify);
    await visit.session.trackSave(Promise.resolve());
    await i18n.changeLanguage("de");
    visit.release(); await Promise.resolve();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: "Änderungen gespeichert." }));
    await i18n.changeLanguage("en");
  });
  it("coalesces separate components in the same settings section", async () => {
    const notify = vi.fn();
    const first = acquireAutosaveSession(options, notify);
    const second = acquireAutosaveSession({ ...options, scopeKey: "other-panel", source: { ...options.source, href: options.source.href + "#another-panel" } }, notify);
    await first.session.trackSave(Promise.resolve());
    await second.session.trackSave(Promise.resolve());
    first.release(); await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
    second.release(); await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("keeps individual successes silent and confirms once on departure", async () => {
    const notify = vi.fn();
    const session = createAutosaveSession(options, notify);
    await session.trackSave(Promise.resolve(1));
    await session.trackSave(Promise.resolve(2));
    expect(notify).not.toHaveBeenCalled();
    session.leave(); session.leave();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", message: "Changes saved" }));
  });
  it("waits for a pending persistence request after leaving", async () => {
    const notify = vi.fn(); let resolve!: () => void;
    const session = createAutosaveSession(options, notify);
    const save = session.trackSave(new Promise<void>((done) => { resolve = done; }));
    session.leave();
    expect(notify).not.toHaveBeenCalled();
    resolve(); await save;
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("reports failure immediately, rethrows for rollback, and never claims all saved", async () => {
    const notify = vi.fn(); const session = createAutosaveSession(options, notify);
    await expect(session.trackSave(Promise.reject(new Error("private token")))).rejects.toThrow("private token");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error", message: "Could not save" }));
    await session.trackSave(Promise.resolve()); session.leave();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "warning" }));
    expect(JSON.stringify(notify.mock.calls)).not.toContain("private token");
  });
  it("keeps an untouched visit silent and summarizes failed writes without success", async () => {
    const notify = vi.fn(); createAutosaveSession(options, notify).leave();
    const session = createAutosaveSession(options, notify);
    await session.trackSave(Promise.reject(new Error())).catch(() => undefined);
    session.leave(); expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "warning", message: "Could not save" }));
  });
  it("drops delayed feedback after identity teardown", async () => {
    const notify = vi.fn(); let resolve!: () => void;
    const session = createAutosaveSession(options, notify);
    const save = session.trackSave(new Promise<void>((done) => { resolve = done; }));
    session.leave(); clearIdentityRequests(); resolve(); await save;
    expect(notify).not.toHaveBeenCalled();
  });
});
