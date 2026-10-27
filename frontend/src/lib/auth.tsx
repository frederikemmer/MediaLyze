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
  clearIdentityRequests,
  setCsrf,
  setExpectedIdentity,
} from "./access-session";
import {
  preferenceStorage,
  preferenceSnapshot,
  selectPreferenceIdentity,
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
  owner: boolean;
  kind: "account" | "guest" | "desktop";
  revision: number;
  must_change_password: boolean;
  policy: AccessPolicy;
  username_locked?: boolean;
  password_locked?: boolean;
  all_scope_available?: boolean;
};
type AuthStatus = {
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
  has: (right: string, libraryId?: number) => boolean;
};
const AuthContext = createContext<AuthValue>({
  identity: null,
  status: null,
  refresh: async () => {},
  logout: async () => {},
  has: () => false,
});
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const identityRef = useRef<Identity | null>(null);
  const epoch = useRef(0);
  const prefsRef = useRef<Record<string, unknown>>({});
  const mounted = useRef(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const refreshing = useRef<Promise<void> | null>(null);
  async function refresh() {
    if (refreshing.current) return refreshing.current;
    const work = loadStatus();
    refreshing.current = work;
    try {
      await work;
    } finally {
      refreshing.current = null;
    }
  }
  async function loadStatus() {
    const result = await accessRequest<AuthStatus>("/auth/status");
    setCsrf(result.csrf);
    const previous = identityRef.current;
    const next = result.identity;
    setExpectedIdentity(next ? `${next.kind}:${next.id}:${next.revision}` : "");
    let ticket = epoch.current;
    if (
      previous?.id !== next?.id ||
      previous?.kind !== next?.kind ||
      previous?.revision !== next?.revision
    ) {
      clearIdentityRequests();
      setReady(false);
      ticket = ++epoch.current;
      if (next?.kind === "account" && !next.must_change_password) {
        const prefs =
          await accessRequest<Record<string, unknown>>("/me/preferences");
        if (ticket !== epoch.current || !mounted.current) return;
        prefsRef.current = prefs;
        const ui = prefs.ui_preferences as
          { interface_language?: string; color_theme?: string } | undefined;
        selectPreferenceIdentity(`account:${next.id}`, {
          ...((prefs.storage ?? {}) as Record<string, string>),
          ...(ui?.color_theme ? { "medialyze-theme": ui.color_theme } : {}),
        });
        await i18n.changeLanguage(
          ui?.interface_language ??
            (prefs.storage as Record<string, string> | undefined)?.[
              "medialyze-language"
            ] ??
            "en",
        );
      } else {
        selectPreferenceIdentity(next?.kind === "guest" ? "guest" : null);
        if (next?.kind === "guest") {
          await i18n.changeLanguage(
            preferenceStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "en",
          );
        }
      }
    }
    if (ticket !== epoch.current) return;
    if (mounted.current) {
      identityRef.current = next;
      setStatus(result);
      setReady(true);
    }
  }
  async function logout() {
    await accessRequest("/auth/logout", { method: "POST" });
    clearIdentityRequests();
    await refreshing.current?.catch(() => {});
    await refresh();
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => setError(t("access.connectionError")));
    const expired = () => {
      epoch.current += 1;
      clearIdentityRequests();
      identityRef.current = null;
      setExpectedIdentity("");
      selectPreferenceIdentity(null);
      setError("");
      setReady(false);
      void refresh().catch(() => setError(t("access.connectionError")));
    };
    window.addEventListener("medialyze-session-expired", expired);
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 15000);
    const focus = () => {
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
    const save = () => {
      clearTimeout(timeout);
      const id = identityRef.current?.id;
      timeout = setTimeout(() => {
        if (
          identityRef.current?.kind !== "account" ||
          identityRef.current.id !== id
        )
          return;
        const storage = preferenceSnapshot();
        const prefs = {
          ...prefsRef.current,
          storage,
          ui_preferences: {
            interface_language: storage["medialyze-language"] ?? "en",
            color_theme: storage["medialyze-theme"] ?? "system",
          },
        };
        void accessRequest("/me/preferences", {
          method: "PUT",
          body: JSON.stringify(prefs),
        }).catch(() => setError(t("access.preferencesError")));
      }, 500);
    };
    window.addEventListener("medialyze-preferences-changed", save);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("medialyze-preferences-changed", save);
    };
  }, []);
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
  const value = { identity, status, refresh, logout, has };
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
  if (!identity || identity.must_change_password) {
    const change = Boolean(identity?.must_change_password);
    const setup = status?.setup_required;
    return (
      <AuthContext.Provider value={value}>
        <ThemeProvider>
          <main className="access-login panel">
            <h1>
              {t(
                change
                  ? "access.changePassword"
                  : setup
                    ? "access.setup"
                    : "access.login",
              )}
            </h1>
            <p className="muted">
              {t(
                change
                  ? "access.changeRequired"
                  : setup
                    ? "access.setupHint"
                    : "access.loginHint",
              )}
            </p>
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
                void accessRequest(path, {
                  method: "POST",
                  body: JSON.stringify(payload),
                })
                  .then(async () => {
                    setPassword("");
                    setCurrentPassword("");
                    await refresh();
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
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </label>
              )}
              <label>
                {t(change ? "access.newPassword" : "access.password")}
                <input
                  type="password"
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
                {!change && !setup && status?.guest_enabled && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={pending}
                    onClick={() => {
                      void accessRequest("/auth/guest", { method: "POST" })
                        .then(refresh)
                        .catch(() => setError(t("access.loginError")));
                    }}
                  >
                    {t("access.continueGuest")}
                  </button>
                )}
                {change && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void logout()}
                  >
                    {t("access.logout")}
                  </button>
                )}
              </div>
            </form>
          </main>
        </ThemeProvider>
      </AuthContext.Provider>
    );
  }
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
