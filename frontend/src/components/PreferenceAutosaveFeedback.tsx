import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { acquireAutosaveSession } from "../lib/notification-actions";
import { useOptionalNotifications } from "../lib/notifications";

function page(pathname: string, search: string) {
  return pathname === "/settings" ? `${pathname}?section=${new URLSearchParams(search).get("section") ?? "libraries"}` : pathname;
}

export function PreferenceAutosaveFeedback() {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const notifications = useOptionalNotifications();
  const location = useLocation();
  const leases = useRef(new Map<string, ReturnType<typeof acquireAutosaveSession>>());
  const current = page(location.pathname, location.search);
  useEffect(() => {
    for (const [scope, lease] of leases.current) if (scope !== current) { lease.release(); leases.current.delete(scope); }
  }, [current]);
  useEffect(() => {
    const handle = (event: Event) => {
      if (!identity) return;
      const { promise, pathname, search } = (event as CustomEvent<{ promise: Promise<unknown>; pathname: string; search: string }>).detail;
      const scope = page(pathname, search);
      let lease = leases.current.get(scope);
      if (!lease) {
        const area = pathname === "/settings" ? "settings" : "library";
        lease = acquireAutosaveSession({ scopeKey: scope, topicKey: `preferences:${scope}`, source: { area, href: scope, label: t("notifications.actions.rest.preferencesTarget", { defaultValue: "Open preferences" }) }, successMessage: t("notifications.actions.rest.preferencesSaved", { defaultValue: "Changes saved." }), errorMessage: t("notifications.actions.rest.preferencesFailed", { defaultValue: "Could not save preferences." }), partialMessage: t("notifications.actions.rest.preferencesPartial", { defaultValue: "Some changes could not be saved." }) }, notifications?.notify);
        leases.current.set(scope, lease);
      }
      void lease.session.trackSave(promise).catch(() => {});
      if (scope !== current) { lease.release(); leases.current.delete(scope); }
    };
    window.addEventListener("medialyze-preference-save", handle);
    return () => window.removeEventListener("medialyze-preference-save", handle);
  }, [identity, current, notifications, t]);
  useEffect(() => {
    const failed = () => notifications?.notify({ type: "error", message: t("notifications.actions.rest.logoutFailed", { defaultValue: "Could not sign out." }), topicKey: "account:logout", source: { area: "settings", href: "/settings?section=accounts&account=me", label: t("access.myAccount") } });
    window.addEventListener("medialyze-logout-failed", failed);
    return () => window.removeEventListener("medialyze-logout-failed", failed);
  }, [notifications, t]);
  useEffect(() => () => { for (const lease of leases.current.values()) lease.release(); leases.current.clear(); }, []);
  return null;
}
