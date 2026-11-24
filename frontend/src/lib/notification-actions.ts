import { useEffect, useRef } from "react";
import { identityGeneration } from "./access-session";
import { useOptionalNotifications, type NotificationInput } from "./notifications";
import i18n from "../i18n";

type AutosaveOptions = {
  /** The page/section whose changes are confirmed together on departure. */
  scopeKey: string;
  topicKey: string;
  source: NotificationInput["source"];
  successMessage: string;
  errorMessage: string;
  partialMessage?: string;
  failureMessage?: string;
};
type Notify = (input: NotificationInput) => unknown;
const visits = new Map<string, { session: ReturnType<typeof createAutosaveSession>; users: number }>();

function visitKey(options: AutosaveOptions) {
  const target = new URL(options.source.href, "http://medialyze.invalid");
  // Ignore editor focus/tab fragments: all panels on one settings page share a summary.
  const page = target.pathname === "/settings"
    ? `${target.pathname}?section=${target.searchParams.get("section") ?? "libraries"}`
    : target.pathname;
  return `${identityGeneration()}:${page}`;
}

export function acquireAutosaveSession(options: AutosaveOptions, notify?: Notify) {
  const key = visitKey(options);
  let visit = visits.get(key);
  if (!visit) {
    const destination = new URL(options.source.href, "http://medialyze.invalid");
    visit = { session: createAutosaveSession({
      ...options,
      get source(): NotificationInput["source"] {
        return destination.pathname === "/settings"
          ? { area: "settings", href: `/settings?section=${destination.searchParams.get("section") ?? "libraries"}`, label: i18n.t("settings.title", { defaultValue: "Settings" }) }
          : options.source;
      },
      get successMessage() { return i18n.t("notifications.actions.common.saved", { defaultValue: "Changes saved." }); },
      get partialMessage() { return i18n.t("notifications.actions.common.partial", { defaultValue: "Some changes could not be saved." }); },
      get failureMessage() { return i18n.t("notifications.actions.common.failed", { defaultValue: "Changes could not be saved." }); },
    }, notify), users: 0 };
    visits.set(key, visit);
  }
  visit.users += 1;
  const current = visit;
  return {
    session: {
      ...current.session,
      trackSave<T>(promise: Promise<T>, feedback = options): Promise<T> {
        return current.session.trackSave(promise, feedback);
      },
    },
    release() {
      current.users -= 1;
      queueMicrotask(() => {
        if (current.users || visits.get(key) !== current) return;
        visits.delete(key);
        current.session.leave();
      });
    },
  };
}

/** One visit: observe actual persistence, independently of subsequent view refreshes. */
export function createAutosaveSession(options: AutosaveOptions, notify?: Notify) {
  const generation = identityGeneration();
  let pending = 0;
  let saved = 0;
  let failed = 0;
  let departed = false;
  let reported = false;
  const emit = (type: NotificationInput["type"], message: string, feedback = options) => {
    if (generation !== identityGeneration()) return;
    notify?.({ type, message, topicKey: feedback.topicKey, source: feedback.source });
  };
  const finish = () => {
    if (!departed || pending || reported) return;
    reported = true;
    if (!saved) {
      if (failed) emit("warning", options.failureMessage ?? options.errorMessage);
      return;
    }
    if (failed) {
      // A failed write must never become an unconditional "all saved" message.
      if (options.partialMessage) emit("warning", options.partialMessage);
    } else emit("success", options.successMessage);
  };
  return {
    trackSave<T>(promise: Promise<T>, feedback = options): Promise<T> {
      pending += 1;
      return promise.then((value) => {
        saved += 1;
        return value;
      }, (error: unknown) => {
        failed += 1;
        emit("error", feedback.errorMessage, feedback);
        throw error;
      }).finally(() => {
        pending -= 1;
        finish();
      });
    },
    leave() {
      departed = true;
      finish();
    },
  };
}

/** Errors immediately; one confirmed summary on page/section departure. */
export function useAutosaveNotifications(options: AutosaveOptions) {
  const notifications = useOptionalNotifications();
  const latest = useRef({ options, notify: notifications?.notify });
  latest.current = { options, notify: notifications?.notify };
  const session = useRef<ReturnType<typeof createAutosaveSession> | null>(null);
  useEffect(() => {
    const lease = acquireAutosaveSession(latest.current.options, latest.current.notify);
    session.current = lease.session;
    return () => {
      // Keep the visit available for an owner's unmount cleanup flushing a debounce.
      // release() defers departure until every synchronous cleanup has registered writes.
      lease.release();
    };
  }, [options.scopeKey]);
  return {
    trackSave<T>(promise: Promise<T>): Promise<T> {
      return session.current?.trackSave(promise, latest.current.options) ?? promise;
    },
  };
}
