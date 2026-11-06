import { authenticatePasskey, passkeyCanceled, supportsPasskeys } from "./passkeys";
import { Navigate, useLocation, useNavigate } from "react-router";
import { AccessScreen } from "../components/AccessScreen";
import { PasswordField } from "../components/PasswordField";
import { validNewPassword } from "./password-policy";
import { ThemeProvider } from "./theme";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import i18n, { LANGUAGE_STORAGE_KEY } from "../i18n";
import {
  accessRequest,
  identityGeneration,
  clearIdentityRequests,
  setCsrf,
  setExpectedIdentity,
} from "./access-session";
import {
  preferenceStorage,
  announcePreferenceSave,
  preferenceSnapshot,
  selectPreferenceIdentity,
  restorePreferenceState,
} from "./preference-storage";

export type AccessPolicy = {
  global: string[];
  mode: "per_library" | "all" | "future";
  libraries: Record<string, string[]>;
  shared: string[];
  create: boolean;
};
export const emptyPolicy = (): AccessPolicy => ({
  global: [],
  mode: "per_library",
  libraries: {},
  shared: [],
  create: false,
});
export type Identity = {
  id: string;
  username: string;
  email?: string | null;
  owner: boolean;
  kind: "account" | "guest" | "desktop";
  revision: number;
  must_change_password: boolean;
  policy: AccessPolicy;
  username_locked?: boolean;
  password_locked?: boolean;
  username_env_configured?: boolean;
  password_env_configured?: boolean;
  all_scope_available?: boolean;
};
type AuthStatus = {
  passkeys?: { enabled: boolean; reason: string };
  setup_required: boolean;
  guest_enabled: boolean;
  csrf: string;
  identity: Identity | null;
  permissions: string[];
  library_permissions: string[];
};
type AuthValue = {
  identity: Identity | null;
  status: AuthStatus | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAfterCredentialChange?: () => Promise<void>;
  has: (right: string, libraryId?: number) => boolean;
};
const AuthContext = createContext<AuthValue>({
  identity: null,
  status: null,
  refresh: async () => {},
  logout: async () => {},
  refreshAfterCredentialChange: async () => {},
  has: () => false,
});
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === "/login";
  const loginPageRef = useRef(isLoginPage);
  loginPageRef.current = isLoginPage;
  const requestedReturn = (location.state as { from?: unknown } | null)?.from;
  const returnTo =
    typeof requestedReturn === "string" &&
    requestedReturn.startsWith("/") &&
    !requestedReturn.startsWith("//") &&
    requestedReturn.split(/[?#]/)[0] !== "/login"
      ? requestedReturn
      : "/";
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const identityRef = useRef<Identity | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const refreshing = useRef<Promise<void> | null>(null);
  const credentialChangePending = useRef(false);
  const awaitingCredentialSignIn = useRef(false);
  const [credentialNotice, setCredentialNotice] = useState<"saved" | "refreshFailed" | null>(null);
  async function refreshAfterCredentialChange() {
    credentialChangePending.current = true;
    setReady(false);
    const work = refreshSession();
    const ticket = epoch.current;
    try { await work; }
    catch {
      if (mounted.current && ticket === epoch.current) {
        // The mutation revoked this session even if status could not be reloaded.
        identityRef.current = null;
        setExpectedIdentity("");
        selectPreferenceIdentity(null);
        awaitingCredentialSignIn.current = true;
        setCredentialNotice("refreshFailed");
        setStatus((previous) => previous ? { ...previous, identity: null, setup_required: false } : previous);
        setError("");
        setUsername("");
        setPassword("");
        setCurrentPassword("");
        setReady(true);
      }
    }
    finally { credentialChangePending.current = false; }
  }
  async function refresh() {
    if (refreshing.current) return refreshing.current;
    const work = loadStatus();
    refreshing.current = work;
    try {
      await work;
    } finally {
      if (refreshing.current === work) refreshing.current = null;
    }
  }
  async function refreshSession() {
    // A login/logout must never reuse a poll started with the previous session.
    epoch.current += 1;
    clearIdentityRequests();
    refreshing.current = null;
    await refresh();
  }
  async function loadStatus() {
    let ticket = epoch.current;
    try {
      let result = await accessRequest<AuthStatus>("/auth/status");
      if (ticket !== epoch.current || !mounted.current) return;
      setCsrf(result.csrf);
      // Explicit sign-in stays open; ordinary visits enter only the server-enabled Guest profile.
      if (
        !result.identity &&
        !credentialChangePending.current &&
        !awaitingCredentialSignIn.current &&
        result.guest_enabled &&
        !result.setup_required &&
        !loginPageRef.current
      ) {
        await accessRequest("/auth/guest", { method: "POST" });
        if (ticket !== epoch.current || !mounted.current) return;
        result = await accessRequest<AuthStatus>("/auth/status");
        if (ticket !== epoch.current || !mounted.current) return;
        setCsrf(result.csrf);
      }
      const previous = identityRef.current;
      const next = result.identity;
      if (credentialChangePending.current && previous?.kind === "account" && !next) {
        awaitingCredentialSignIn.current = true;
        setCredentialNotice("saved");
      } else if (next) {
        awaitingCredentialSignIn.current = false;
        setCredentialNotice(null);
      }
      setExpectedIdentity(next ? `${next.kind}:${next.id}:${next.revision}` : "");
      if (
        previous?.id !== next?.id ||
        previous?.kind !== next?.kind ||
        previous?.revision !== next?.revision
      ) {
        clearIdentityRequests();
        setReady(false);
        ticket = ++epoch.current;
        if (next && next.kind !== "guest" && !next.must_change_password) {
          const prefs =
            await accessRequest<Record<string, unknown>>("/me/preferences");
          if (ticket !== epoch.current || !mounted.current) return;
          const ui = prefs.ui_preferences as
            { interface_language?: string; color_theme?: string } | undefined;
          selectPreferenceIdentity(`${next.kind}:${next.id}`, {
            ...((prefs.storage ?? {}) as Record<string, string>),
            ...(ui?.color_theme ? { "medialyze-theme": ui.color_theme } : {}),
          });
          await restorePreferenceState(() => i18n.changeLanguage(
            ui?.interface_language ??
              (prefs.storage as Record<string, string> | undefined)?.[
                "medialyze-language"
              ] ??
              "en",
          ));
        } else {
          selectPreferenceIdentity(next?.kind === "guest" ? "guest" : null);
          if (next?.kind === "guest") {
            await restorePreferenceState(() => i18n.changeLanguage(
              preferenceStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "en",
            ));
          }
        }
      }
      if (ticket !== epoch.current) return;
      if (mounted.current) {
        identityRef.current = next;
        setStatus(result);
        setReady(true);
      }
    } catch (reason) {
      // Aborted requests from a superseded session are expected, not login errors.
      if (ticket !== epoch.current || !mounted.current) return;
      throw reason;
    }
  }
  async function logout() {
    const generation = identityGeneration();
    try {
      await accessRequest("/auth/logout", { method: "POST" });
    } catch (error) {
      if (generation === identityGeneration()) window.dispatchEvent(new Event("medialyze-logout-failed"));
      throw error;
    }
    await refreshSession();
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => setError(t("access.connectionError")));
    const expired = () => {
      epoch.current += 1;
      clearIdentityRequests();
      refreshing.current = null;
      identityRef.current = null;
      setExpectedIdentity("");
      selectPreferenceIdentity(null);
      setError("");
      setReady(false);
      void refresh().catch(() => setError(t("access.connectionError")));
    };
    window.addEventListener("medialyze-session-expired", expired);
    const timer = window.setInterval(() => {
      if (!document.hidden && !pendingRef.current) void refresh().catch(() => {});
    }, 15000);
    const focus = () => {
      if (pendingRef.current) return;
      void refresh().catch(() => {});
    };
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("medialyze-session-expired", expired);
    };
  }, []);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    let pending: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
    let writes: Promise<void> = Promise.resolve();
    const save = (event: Event) => {
      clearTimeout(timeout);
      const id = identityRef.current?.id;
      const generation = identityGeneration();
      if (!identityRef.current || identityRef.current.kind === "guest") return;
      const promise = new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
      announcePreferenceSave((event as CustomEvent<{ key: string }>).detail?.key ?? "", promise);
      timeout = setTimeout(() => {
        const batch = pending; pending = [];
        const storage = preferenceSnapshot();
        const valid = () => identityRef.current?.kind !== "guest" && identityRef.current?.id === id && identityGeneration() === generation && mounted.current;
        const work = writes.then(async () => {
          if (!valid()) throw new DOMException("Identity changed", "AbortError");
          const prefs = { storage, ui_preferences: {
            interface_language: storage["medialyze-language"] ?? "en",
            color_theme: storage["medialyze-theme"] ?? "system",
          } };
          await accessRequest<Record<string, unknown>>("/me/preferences", { method: "PATCH", body: JSON.stringify(prefs) });
        });
        writes = work.catch(() => {});
        void work.then(() => batch.forEach(({ resolve }) => resolve()), (error: unknown) => batch.forEach(({ reject }) => reject(error)));
      }, 500);
    };
    window.addEventListener("medialyze-preferences-changed", save);
    return () => {
      clearTimeout(timeout);
      pending.forEach(({ reject }) => reject(new DOMException("Identity changed", "AbortError")));
      window.removeEventListener("medialyze-preferences-changed", save);
    };
  }, []);
  useEffect(() => {
    if (!isLoginPage && ready && !identityRef.current && status?.guest_enabled) {
      void refresh().catch(() => setError(t("access.connectionError")));
    }
  }, [isLoginPage]);
  const identity = status?.identity ?? null;
  const has = (right: string, libraryId?: number) =>
    Boolean(
      identity &&
      (identity.owner ||
        (libraryId === undefined
          ? identity.policy.global.includes(right)
          : (identity.policy.mode === "future"
              ? identity.policy.shared
              : (identity.policy.libraries[String(libraryId)] ?? [])
            ).includes(right))),
    );
  const value = { identity, status, refresh, logout, refreshAfterCredentialChange, has };
  if (!ready)
    return (
      <div className="empty-state" aria-busy={!error}>
        {error || t("access.loading")}
        {error && (
          <button
            type="button"
            onClick={() => {
              setError("");
              void refresh().catch(() => setError(t("access.connectionError")));
            }}
          >
            {t("access.retry")}
          </button>
        )}
      </div>
    );
  if (!identity || identity.must_change_password || (identity.kind === "guest" && isLoginPage)) {
    const change = Boolean(identity?.must_change_password);
    const setup = status?.setup_required;
    return (
      <AuthContext.Provider value={value}>
        <ThemeProvider>
          <AccessScreen mode={change ? "password" : setup ? "setup" : "login"}>
            {credentialNotice && !identity && <div role="status" className={credentialNotice === "refreshFailed" ? "notice warning" : "alert success"}>
              {credentialNotice === "refreshFailed"
                ? t("notifications.actions.accounts.signInAgainRefreshFailed", { defaultValue: "Change saved, but the session could not be refreshed. Please sign in again." })
                : t("notifications.actions.accounts.signInAgain", { defaultValue: "Change saved – please sign in again." })}
              <button type="button" className="secondary" onClick={() => setCredentialNotice(null)}>{t("notifications.actions.accounts.dismiss", { defaultValue: "Dismiss" })}</button>
            </div>}
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                if ((change || setup) && !validNewPassword(password)) {
                  setError(t("access.passwordRequirements"));
                  return;
                }
                setPending(true);
                setError("");
                const path = change
                  ? "/auth/password"
                  : setup
                    ? "/auth/setup"
                    : "/auth/login";
                const payload = change
                  ? { current_password: currentPassword, password }
                  : { username, password };
                // Refresh pre-auth CSRF too: a concurrent status poll may have
                // replaced its cookie before this form was submitted.
                void refreshSession()
                  .then(() => accessRequest(path, {
                    method: "POST",
                    body: JSON.stringify(payload),
                  }))
                  .then(async () => {
                    awaitingCredentialSignIn.current = false;
                    setPassword("");
                    setCurrentPassword("");
                    if (change) {
                      try { await refreshAfterCredentialChange(); }
                      catch { setError(t("notifications.actions.accounts.refreshFailed", { defaultValue: "Changes were saved, but the account could not be refreshed." })); }
                    } else {
                      await refreshSession();
                    }
                    if (isLoginPage && !change) navigate(returnTo, { replace: true });
                  })
                  .catch(() => setError(t("access.loginError")))
                  .finally(() => setPending(false));
              }}
            >
              {!change && (
                <label>
                  {t("access.username")}
                  <input
                    autoComplete="username"
                    required
                    maxLength={64}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
              )}
              {change && (
                <label>
                  {t("access.currentPassword")}
                  <PasswordField
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </label>
              )}
              <label>
                {t(change ? "access.newPassword" : "access.password")}
                <PasswordField
                  autoComplete={
                    change || setup ? "new-password" : "current-password"
                  }
                  aria-describedby={error ? "access-password-error" : undefined}
                  minLength={change || setup ? 5 : 1}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {error && (
                <p id="access-password-error" role="alert" className="alert">
                  {error}
                </p>
              )}
              <div className="button-row">
                <button type="submit" disabled={pending}>
                  {t(
                    change
                      ? "access.save"
                      : setup
                        ? "access.setup"
                        : "access.login",
                  )}
                </button>
                {!change && !setup && status?.passkeys?.enabled && (
                  <button type="button" className="secondary" disabled={pending || !supportsPasskeys()}
                    onClick={() => {
                      setPending(true); setError("");
                      void refreshSession()
                        .then(authenticatePasskey)
                        .then(async () => { awaitingCredentialSignIn.current = false; await refreshSession(); if (isLoginPage) navigate(returnTo, { replace: true }); })
                        .catch((reason) => { if (!passkeyCanceled(reason)) setError(t("passkeys.loginError")); })
                        .finally(() => setPending(false));
                    }}>
                    {t("passkeys.login")}
                  </button>
                )}
                {!change && !setup && status?.guest_enabled && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={pending}
                    onClick={() => {
                      setPending(true);
                      setError("");
                      awaitingCredentialSignIn.current = false;
                      const enter = identity?.kind === "guest"
                        ? Promise.resolve()
                        : refreshSession()
                          .then(() => accessRequest("/auth/guest", { method: "POST" }))
                          .then(refreshSession);
                      void enter
                        .then(() => navigate(returnTo, { replace: true }))
                        .catch(() => setError(t("access.loginError")))
                        .finally(() => setPending(false));
                    }}
                  >
                    {t("access.continueGuest")}
                  </button>
                )}
                {change && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => { void logout().catch(() => setError(t("notifications.actions.accounts.logoutFailed", { defaultValue: "Could not sign out." }))); }}
                  >
                    {t("access.logout")}
                  </button>
                )}
              </div>
            </form>
          </AccessScreen>
        </ThemeProvider>
      </AuthContext.Provider>
    );
  }
  if (isLoginPage) return <Navigate to={returnTo} replace />;
  return (
    <AuthContext.Provider value={value}>
      <div key={`${identity.kind}:${identity.id}:${identity.revision}`}>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    </AuthContext.Provider>
  );
}

export function hasLibraryPermission(
  identity: Identity | null,
  right: string,
): boolean {
  return Boolean(
    identity &&
    (identity.owner ||
      (identity.policy.mode === "future"
        ? identity.policy.shared.includes(right)
        : Object.values(identity.policy.libraries).some((actions) =>
            actions.includes(right),
          ))),
  );
}
