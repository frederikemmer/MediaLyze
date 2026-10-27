import { validNewPassword } from "../lib/password-policy";
import { useTheme, type ThemePreference } from "../lib/theme";
import i18n, { SUPPORTED_INTERFACE_LANGUAGES } from "../i18n";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Save, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { accessRequest } from "../lib/access-session";
import {
  emptyPolicy,
  useAuth,
  type AccessPolicy,
  type Identity,
} from "../lib/auth";
import { PasskeysPanel } from "./PasskeysPanel";
import { AsyncPanel } from "./AsyncPanel";
import { SlidingTogglePill } from "./SlidingTogglePill";
import { TooltipTrigger } from "./TooltipTrigger";
import { PasswordField } from "./PasswordField";
import { PasswordRequirements } from "./PasswordRequirements";

export type ManagedAccount = {
  id: string;
  username: string;
  owner: boolean;
  active: boolean;
  editable: boolean;
  policy: AccessPolicy;
  must_change_password: boolean;
};
export type AccessLibrary = { id: number; name: string; actions: string[] };
type GuestAccessProfile = {
  enabled: boolean;
  policy: AccessPolicy;
  editable: boolean;
};
export const globalPermissions = [
  "overview.dashboard",
  "overview.compare",
  "overview.storage",
  "settings.quality.view",
  "settings.quality.edit",
  "settings.hardware.view",
  "settings.hardware.edit",
  "settings.presets.view",
  "settings.presets.edit",
  "settings.app.view",
  "settings.app.edit",
  "connector.view",
  "connector.manage",
  "connector.playback",
  "access.users",
  "access.guest",
];
const presetsProfilesGlobalPermissions = [
  "settings.quality.view",
  "settings.quality.edit",
  "settings.hardware.view",
  "settings.hardware.edit",
  "settings.presets.view",
  "settings.presets.edit",
];
const presetsProfilesGlobalPermissionSet = new Set(
  presetsProfilesGlobalPermissions,
);
export const libraryPermissions = [
  "library.read",
  "library.preview",
  "library.download",
  "library.export",
  "library.scan",
  "library.edit",
  "library.paths",
  "library.delete",
  "transcode.view",
  "transcode.run",
  "transcode.cancel_own",
  "transcode.cancel_other",
  "transcode.clean",
  "transcode.replace",
];

export function AccessSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  mixed = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
  mixed?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <label className="toggle-switch">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-switch-track">
        <span className="toggle-switch-thumb" />
      </span>
    </label>
  );
}

/** A mode switch uses intersection, never union or implicit future grants. */
export function changeScope(
  policy: AccessPolicy,
  mode: AccessPolicy["mode"],
  libraries: AccessLibrary[],
): AccessPolicy {
  const actions = (id: number) =>
    policy.mode === "future"
      ? policy.shared
      : (policy.libraries[String(id)] ?? []);
  const common = libraries.length
    ? libraryPermissions.filter((right) =>
        libraries.every((l) => actions(l.id).includes(right)),
      )
    : [];
  if (mode === "per_library")
    return {
      ...policy,
      mode,
      shared: [],
      create: false,
      libraries: Object.fromEntries(
        libraries.map((l) => [String(l.id), [...actions(l.id)]]),
      ),
    };
  return {
    ...policy,
    mode,
    create: false,
    shared: common,
    libraries:
      mode === "all"
        ? Object.fromEntries(libraries.map((l) => [String(l.id), [...common]]))
        : {},
  };
}

export function RightsTree({
  value,
  onChange,
  libraries,
  actor,
  locked = false,
  guest = false,
}: {
  value: AccessPolicy;
  onChange: (p: AccessPolicy) => void;
  libraries: AccessLibrary[];
  actor: Identity;
  locked?: boolean;
  guest?: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const query = search.trim().toLocaleLowerCase();
  const label = (right: string) =>
    t(`access.permissions.${right.replaceAll(".", "_")}`);
  const permissionHelp = (right: string) => {
    if (right === "settings.app.view") {
      return {
        ariaLabel: t("access.operationalScopeTooltipAria"),
        content: t("access.operationalScopeHint"),
      };
    }
    if (right === "settings.app.edit") {
      return {
        ariaLabel: t("access.globalAppEditTooltipAria"),
        content: t("access.globalAppEditHint"),
      };
    }
    if (right === "connector.view") {
      return {
        ariaLabel: t("access.connectorCatalogTooltipAria"),
        content: t("access.connectorCatalogHint"),
      };
    }
    return null;
  };
  const matches = (text: string) => text.toLocaleLowerCase().includes(query);
  const transcodingMatches = matches(t("access.transcoding")) || matches(t("access.transcodingRightsHint"));
  const allowed = (right: string, libraryId?: number): boolean =>
    !locked &&
    (actor.owner ||
      (libraryId === undefined
        ? actor.policy.global.includes(right)
        : actor.policy.mode === "future"
          ? actor.policy.shared.includes(right)
          : libraryId === -1
            ? libraries.length > 0 &&
              libraries.every((l) =>
                (actor.policy.libraries[String(l.id)] ?? []).includes(right),
              )
            : (actor.policy.libraries[String(libraryId)] ?? []).includes(
                right,
              )));
  function update(rights: string[], enabled: boolean, libraryId?: number) {
    const next = structuredClone(value);
    if (libraryId === undefined)
      next.global = enabled
        ? [...new Set([...next.global, ...rights])]
        : next.global.filter((r) => !rights.includes(r));
    else if (next.mode === "per_library") {
      const current = next.libraries[String(libraryId)] ?? [];
      next.libraries[String(libraryId)] = enabled
        ? [...new Set([...current, ...rights])]
        : current.filter((r) => !rights.includes(r));
    } else {
      next.shared = enabled
        ? [...new Set([...next.shared, ...rights])]
        : next.shared.filter((r) => !rights.includes(r));
      if (next.mode === "all")
        next.libraries = Object.fromEntries(
          libraries.map((l) => [String(l.id), [...next.shared]]),
        );
    }
    if (
      !next.shared.includes("library.read") ||
      !next.shared.includes("library.edit") ||
      !next.shared.includes("library.paths")
    )
      next.create = false;
    onChange(next);
  }
  function rows(
    rights: string[],
    selected: string[],
    libraryId?: number,
    groupMatches = false,
  ) {
    let showTranscodingHeading = true;
    return rights
      .filter((r) => !query || groupMatches || matches(label(r)) || (r.startsWith("transcode.") && transcodingMatches))
      .map((right) => {
        const help = permissionHelp(right);
        const heading = right.startsWith("transcode.") && showTranscodingHeading;
        if (heading) showTranscodingHeading = false;
        const enabled =
          allowed(right, libraryId) && !(guest && right.startsWith("access."));
        const row = (
          <span className="access-permission-row">
            <span className="access-permission-label">
              <span>{label(right)}</span>
              {help ? (
                <TooltipTrigger
                  ariaLabel={
                    enabled
                      ? help.ariaLabel
                      : `${help.ariaLabel}: ${t("access.notDelegable")}`
                  }
                  content={
                    enabled
                      ? help.content
                      : `${help.content} ${t("access.notDelegable")}`
                  }
                  className="access-permission-tooltip"
                />
              ) : null}
            </span>
            <AccessSwitch
              checked={selected.includes(right)}
              label={label(right)}
              disabled={!enabled}
              onChange={(v) => update([right], v, libraryId)}
            />
          </span>
        );
        const control = enabled || help ? (
          <span key={right}>{row}</span>
        ) : (
          <TooltipTrigger
            key={right}
            as="span"
            className="access-permission-disabled"
            ariaLabel={`${label(right)}: ${t("access.notDelegable")}`}
            content={t("access.notDelegable")}
          >
            {row}
          </TooltipTrigger>
        );
        return (
          <Fragment key={right}>
            {heading && (
              <div className="access-permission-section-heading">
                <h3>{t("access.transcoding")}</h3>
                <TooltipTrigger
                  ariaLabel={t("access.transcodingTooltipAria")}
                  content={t("access.transcodingRightsHint")}
                  className="access-permission-tooltip"
                />
              </div>
            )}
            {control}
          </Fragment>
        );
      });
  }
  function group(
    id: string,
    title: string,
    rights: string[],
    selected: string[],
    libraryId?: number,
    children?: React.ReactNode,
  ) {
    const matched =
      matches(title) || (id === "transcoding" && transcodingMatches);
    if (
      query &&
      !matched &&
      !rights.some((r) => matches(label(r))) &&
      !(id === "transcoding" && transcodingMatches) &&
      !(transcodingMatches && rights.some(r => r.startsWith("transcode."))) &&
      !children
    )
      return null;
    const delegable = rights.filter(
      (r) => allowed(r, libraryId) && !(guest && r.startsWith("access.")),
    );
    const selectedCount = rights.filter((r) => selected.includes(r)).length;
    const open = Boolean(query || opened[id]);
    return (
      <section className="access-right-group" key={id}>
        <div className="access-tree-header">
          <button
            type="button"
            className="access-tree-trigger"
            aria-expanded={open}
            aria-controls={`access-group-${id}`}
            onClick={() => setOpened({ ...opened, [id]: !opened[id] })}
          >
            <span className="connector-connection-chevron">
              {open ? (
                <ChevronDown className="nav-icon" />
              ) : (
                <ChevronRight className="nav-icon" />
              )}
            </span>
            <strong>{title}</strong>
          </button>
          <AccessSwitch
            checked={rights.length > 0 && selectedCount === rights.length}
            mixed={selectedCount > 0 && selectedCount < rights.length}
            disabled={Boolean(query) || !delegable.length}
            label={t("access.selectGroup", { group: title })}
            onChange={(v) => update(delegable, v, libraryId)}
          />
        </div>
        {open && (
          <div id={`access-group-${id}`} className="access-tree-body">
            {rows(rights, selected, libraryId, matched)}
            {children}
          </div>
        )}
      </section>
    );
  }
  const libraryBulkTargets = (value.mode === "per_library"
    ? libraries.map((library) => ({ id: library.id, selected: value.libraries[String(library.id)] ?? [] }))
    : [{ id: -1, selected: value.shared }]
  ).map((target) => ({
    ...target,
    rights: libraryPermissions.filter((right) => locked || allowed(right, target.id)),
  }));
  const canBulkCreate = !locked && value.mode === "future" &&
    (actor.owner || actor.policy.create) &&
    ["library.read", "library.edit", "library.paths"].every((right) => allowed(right, -1));
  const libraryBulkStates = libraryBulkTargets.flatMap((target) =>
    target.rights.map((right) => target.selected.includes(right)),
  );
  if (canBulkCreate || (locked && value.mode === "future")) libraryBulkStates.push(value.create);
  const allLibraryRightsSelected = libraryBulkStates.length > 0 && libraryBulkStates.every(Boolean);
  function updateLibraryGroup(enabled: boolean) {
    const next = structuredClone(value);
    const updateRights = (selected: string[], rights: string[]) => enabled
      ? [...new Set([...selected, ...rights])]
      : selected.filter((right) => !rights.includes(right));
    for (const target of libraryBulkTargets) {
      if (next.mode === "per_library") {
        if (target.rights.length) next.libraries[String(target.id)] = updateRights(target.selected, target.rights);
      } else {
        next.shared = updateRights(target.selected, target.rights);
        if (next.mode === "all") next.libraries = Object.fromEntries(
          libraries.map((library) => [String(library.id), [...next.shared]]),
        );
      }
    }
    const creationRequirementsMet = ["library.read", "library.edit", "library.paths"].every((right) => next.shared.includes(right));
    if (canBulkCreate) next.create = enabled && creationRequirementsMet;
    if (!creationRequirementsMet) next.create = false;
    onChange(next);
  }
  const libMatch = matches(t("access.groups.libraries"));
  const libraryHits =
    !query ||
    libMatch ||
    matches(t("access.libraryAccess")) ||
    transcodingMatches ||
    libraryPermissions.some((r) => matches(label(r))) ||
    libraries.some((l) => matches(l.name));
  return (
    <div className="access-rights">
      <label className="settings-navigation-search access-search-field">
        <Search aria-hidden="true" className="nav-icon" />
        <span className="sr-only">{t("access.searchRights")}</span>
        <input
          id="access-right-search"
          type="search"
          placeholder={t("access.searchRights")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {query && (
        <p className="muted" role="status">
          {t("access.clearSearch")}
        </p>
      )}
      {query &&
        !libraryHits &&
        !matches(t("access.groups.presetsProfiles")) &&
        !globalPermissions.some(
          (r) =>
            matches(label(r)) || matches(t(`access.groups.${r.split(".")[0]}`)),
        ) && (
          <p className="muted" role="status">
            {t("access.noPermissions")}
          </p>
        )}
      {group(
        "overview",
        t("access.groups.overview"),
        globalPermissions.filter((r) => r.startsWith("overview.")),
        value.global,
      )}
      {libraryHits && (
        <section className="access-right-group">
          <div className="access-tree-header">
            <button
              type="button"
              className="access-tree-trigger"
              aria-expanded={Boolean(query || opened.libraries)}
              aria-controls="access-library-tree"
              onClick={() =>
                setOpened({ ...opened, libraries: !opened.libraries })
              }
            >
              <span className="connector-connection-chevron">
                {query || opened.libraries ? (
                  <ChevronDown className="nav-icon" />
                ) : (
                  <ChevronRight className="nav-icon" />
                )}
              </span>
              <strong>{t("access.groups.libraries")}</strong>
            </button>
            <select
              aria-label={t("access.scope")}
              value={value.mode}
              disabled={locked}
              onChange={(e) =>
                onChange(
                  changeScope(
                    value,
                    e.target.value as AccessPolicy["mode"],
                    libraries,
                  ),
                )
              }
            >
              <option value="per_library">{t("access.perLibrary")}</option>
              <option
                value="all"
                disabled={!actor.owner && !actor.all_scope_available}
              >
                {t("access.allLibraries")}
              </option>
              <option
                value="future"
                disabled={!actor.owner && actor.policy.mode !== "future"}
              >
                {t("access.futureLibraries")}
              </option>
            </select>
            <AccessSwitch
              checked={allLibraryRightsSelected}
              mixed={!allLibraryRightsSelected && libraryBulkStates.some(Boolean)}
              disabled={locked || Boolean(query) || !libraryBulkStates.length}
              label={t("access.selectGroup", { group: t("access.groups.libraries") })}
              onChange={updateLibraryGroup}
            />
          </div>
          {(query || opened.libraries) && (
            <div className="access-tree-body" id="access-library-tree">
              <div className="access-permission-section-heading">
                <h3>{t("access.libraryAccess")}</h3>
                <TooltipTrigger
                  ariaLabel={t("access.libraryAccessTooltipAria")}
                  content={
                    guest
                      ? `${t("access.scopeHint")}\n\n${t("access.guestJobHint")}`
                      : t("access.scopeHint")
                  }
                  className="access-permission-tooltip"
                  preserveLineBreaks
                />
              </div>
              {value.mode === "per_library" ? (
                libraries
                  .filter(
                    (l) =>
                      !query ||
                      libMatch ||
                      matches(l.name) ||
                      transcodingMatches ||
                      libraryPermissions.some((r) => matches(label(r))),
                  )
                  .map((l) =>
                    group(
                      `lib-${l.id}`,
                      l.name,
                      libraryPermissions,
                      value.libraries[String(l.id)] ?? [],
                      l.id,
                    ),
                  )
              ) : (
                <>{rows(libraryPermissions, value.shared, -1, libMatch)}</>
              )}
              <h3>{t("access.libraryManagement")}</h3>
              <span className="access-permission-row">
                <span className="access-permission-label">
                  <span>{t("access.createLibraries")}</span>
                  <TooltipTrigger
                    ariaLabel={t("access.createTooltipAria")}
                    content={t("access.createHint")}
                    className="access-permission-tooltip"
                  />
                </span>
                <AccessSwitch
                  label={t("access.createLibraries")}
                  checked={value.create}
                  disabled={
                    locked ||
                    value.mode !== "future" ||
                    !value.shared.includes("library.read") ||
                    !value.shared.includes("library.edit") ||
                    !value.shared.includes("library.paths") ||
                    (!actor.owner && !actor.policy.create)
                  }
                  onChange={(create) => onChange({ ...value, create })}
                />
              </span>
            </div>
          )}
        </section>
      )}
      {["settings", "connector", "transcoding", "access"].map((id) =>
        group(
          id,
          id === "transcoding"
            ? t("access.groups.presetsProfiles")
            : t(`access.groups.${id}`),
          id === "transcoding"
            ? presetsProfilesGlobalPermissions
            : globalPermissions.filter(
                (r) =>
                  r.startsWith(id + ".") &&
                  !(
                    id === "settings" &&
                    presetsProfilesGlobalPermissionSet.has(r)
                  ),
              ),
          value.global,
        ),
      )}
    </div>
  );
}

export function PersonalAccountPanel() {
  const { identity, logout, refresh } = useAuth();
  const { preference, setPreference } = useTheme();
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [username, setUsername] = useState(identity?.username ?? "");
  const [message, setMessage] = useState("");
  if (!identity) return null;
  return (
    <div className="form-grid">
      <div className="app-settings-performance-grid">
        <label>
          {t("libraries.language")}
          <select
            className="settings-choice-input"
            value={i18n.resolvedLanguage ?? "en"}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
          >
            {SUPPORTED_INTERFACE_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t(`language.${language}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("libraries.theme")}
          <select
            className="settings-choice-input"
            value={preference}
            onChange={(e) => setPreference(e.target.value as ThemePreference)}
          >
            {["system", "light", "dark"].map((theme) => (
              <option key={theme} value={theme}>
                {t(`theme.${theme}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {identity.owner && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void accessRequest("/me/account", {
              method: "PATCH",
              body: JSON.stringify({ username, password: current }),
            })
              .then(async () => {
                setCurrent("");
                await refresh();
              })
              .catch(() => setMessage(t("access.saveError")));
          }}
        >
          <div className="app-settings-performance-grid personal-account-credentials-grid">
            <label>
              {t("access.username")}
              <input
                value={username}
                maxLength={64}
                disabled={identity.username_locked}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label>
              {t("access.currentPassword")}
              <PasswordField
                value={current}
                autoComplete="current-password"
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="button-row personal-account-actions">
            <button
              type="submit"
              disabled={
                identity.username_locked || username === identity.username
              }
            >
              {t("access.save")}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => void logout()}
            >
              {t("access.logout")}
            </button>
          </div>
          {identity.username_locked && (
            <p className="muted">{t("access.environmentLocked")}</p>
          )}
          {message && <p role="alert">{message}</p>}
        </form>
      )}
      {identity.kind === "account" && !identity.owner && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validNewPassword(next)) {
              setMessage(t("access.passwordRequirements"));
              return;
            }
            void accessRequest("/auth/password", {
              method: "POST",
              body: JSON.stringify({
                current_password: current,
                password: next,
              }),
            })
              .then(refresh)
              .catch(() => setMessage(t("access.saveError")));
          }}
        >
          <label>
            {t("access.currentPassword")}
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
          <label>
            {t("access.newPassword")}
            <input
              type="password"
              autoComplete="new-password"
              minLength={5}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              disabled={identity.password_locked}
              required
            />
          </label>
          {identity.password_locked && (
            <p className="muted">{t("access.environmentLocked")}</p>
          )}
          <div className="button-row personal-account-actions">
            <button type="submit" disabled={identity.password_locked}>
              {t("access.save")}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => void logout()}
            >
              {t("access.logout")}
            </button>
          </div>
          {message && <p role="alert">{message}</p>}
        </form>
      )}
      {identity.kind === "account" && <PasskeysPanel />}
    </div>
  );
}

function policyFingerprint(policy: AccessPolicy) {
  return JSON.stringify({
    ...policy,
    global: [...policy.global].sort(),
    shared: [...policy.shared].sort(),
    libraries: Object.fromEntries(Object.entries(policy.libraries)
      .filter(([, rights]) => policy.mode !== "per_library" || rights.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, rights]) => [id, [...rights].sort()])),
  });
}

export function AccountsPanel({
  fixture,
  openOwnAccount = false,
  onCloseAccount,
  overviewResetKey = 0,
}: {
  openOwnAccount?: boolean;
  onCloseAccount?: () => void;
  overviewResetKey?: number;
  fixture?: {
    accounts: ManagedAccount[];
    libraries: AccessLibrary[];
    actor: Identity;
    guest?: GuestAccessProfile;
  };
}) {
  const auth = useAuth();
  const { t } = useTranslation();
  const actor = fixture?.actor ?? auth.identity;
  const [accounts, setAccounts] = useState<ManagedAccount[]>(
    fixture?.accounts ?? [],
  );
  const [libraries, setLibraries] = useState<AccessLibrary[]>(
    fixture?.libraries ?? [],
  );
  const [guest, setGuest] = useState<GuestAccessProfile>(fixture?.guest ?? {
    enabled: false,
    policy: emptyPolicy(),
    editable: true,
  });
  const [accessLoaded, setAccessLoaded] = useState(Boolean(fixture));
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState("rights");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(emptyPolicy());
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const editorFormId = useId();
  const passwordRequirementsId = useId();
  const passwordInput = useRef<HTMLInputElement | null>(null);
  const [passwordValidationAttempt, setPasswordValidationAttempt] = useState(0);
  useEffect(() => {
    if (passwordValidationAttempt > 0) passwordInput.current?.reportValidity();
  }, [passwordValidationAttempt]);
  const [savedDraft, setSavedDraft] = useState({ name: "", active: true, policy: emptyPolicy() });
  const previousOverviewResetKey = useRef(overviewResetKey);
  const canUsers = Boolean(fixture || (actor?.kind !== "desktop" && auth.has("access.users")));
  const canGuest = Boolean(fixture || (actor?.kind !== "desktop" && auth.has("access.guest")));
  async function load() {
    if (fixture || actor?.kind === "desktop") {
      setAccessLoaded(true);
      return;
    }
    try {
      const [items, libs, guestProfile] = await Promise.all([
        canUsers ? accessRequest<ManagedAccount[]>("/users") : [],
        canUsers || canGuest
          ? accessRequest<AccessLibrary[]>("/access/libraries")
          : [],
        canGuest ? accessRequest<typeof guest>("/access/guest") : guest,
      ]);
      setAccounts(
        actor?.kind === "account" && !items.some((a) => a.id === actor.id)
          ? [{ ...actor, active: true, editable: false }, ...items]
          : items,
      );
      setLibraries(libs);
      setGuest(guestProfile);
      setAccessLoaded(true);
    } catch {
      setError(t("access.loadError"));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (previousOverviewResetKey.current === overviewResetKey) return;
    previousOverviewResetKey.current = overviewResetKey;
    setSelected(null);
    setTab("rights");
    setQuery("");
    setSecret("");
    setError(null);
  }, [overviewResetKey]);
  const openedPersonalLink = useRef(false);
  useEffect(() => {
    if (!openOwnAccount) openedPersonalLink.current = false;
    if (
      !fixture &&
      openOwnAccount &&
      !openedPersonalLink.current &&
      actor?.kind === "account" &&
      accounts.some((a) => a.id === actor.id)
    ) {
      openedPersonalLink.current = true;
      open(actor.id);
      setTab("account");
    }
  }, [accounts, openOwnAccount]);
  if (!actor) return null;
  if (actor.kind === "desktop" && !fixture) return null;
  if (actor.kind === "guest") {
    return (
      <AsyncPanel title={t("access.title")}>
        <PersonalAccountPanel />
      </AsyncPanel>
    );
  }
  function open(id: string) {
    const account = accounts.find((a) => a.id === id);
    const initial = {
      name: account?.username ?? "",
      active: id === "guest" ? guest.enabled : (account?.active ?? true),
      policy: structuredClone(
        id === "guest"
          ? guest.policy
          : id === "new" && canGuest
            ? guest.policy
            : account?.policy ?? emptyPolicy(),
      ),
    };
    setSelected(id);
    setName(initial.name);
    setSecret("");
    setActive(initial.active);
    setDraft(initial.policy);
    setSavedDraft(initial);
    setTab(id === "new" ? "account" : "rights");
    setError(null);
  }
  const target = accounts.find((a) => a.id === selected);
  const isSelf = !fixture && target?.id === actor.id;
  const locked = Boolean(
    target?.owner ||
    (target && !target.editable) ||
    (selected === "guest" && !guest.editable),
  );
  const dirty = Boolean(selected && !locked && (
    name !== savedDraft.name || active !== savedDraft.active || secret ||
    policyFingerprint(draft) !== policyFingerprint(savedDraft.policy)
  ));
  function closeEditor() {
    if (pending || (dirty && !window.confirm(t("access.confirmDiscard")))) return;
    setSecret("");
    setSelected(null);
    setError(null);
    onCloseAccount?.();
  }
  const shownPolicy = target?.owner
    ? {
        ...emptyPolicy(),
        global: globalPermissions,
        mode: "future" as const,
        shared: libraryPermissions,
        create: true,
      }
    : draft;
  async function save() {
    if (locked || pending || !selected || !dirty) return;
    if (selected !== "guest" && (selected === "new" || secret) && !validNewPassword(secret)) {
      setError(null);
      setTab("account");
      setPasswordValidationAttempt((attempt) => attempt + 1);
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (selected === "guest") {
        const saved = fixture
          ? { ...guest, enabled: active, policy: structuredClone(draft) }
          : await accessRequest<typeof guest>("/access/guest", {
            method: "PUT", body: JSON.stringify({ enabled: active, policy: draft }),
          });
        setGuest(saved);
        setActive(saved.enabled);
        setDraft(structuredClone(saved.policy));
        setSavedDraft({ name, active: saved.enabled, policy: structuredClone(saved.policy) });
      } else {
        const saved = fixture
          ? { ...target, id: selected === "new" ? crypto.randomUUID() : selected,
            username: name, active, policy: structuredClone(draft), owner: false,
            editable: true, must_change_password: Boolean(secret) || Boolean(target?.must_change_password) }
          : await accessRequest<ManagedAccount>(selected === "new" ? "/users" : `/users/${selected}`, {
            method: selected === "new" ? "POST" : "PATCH",
            body: JSON.stringify(selected === "new"
              ? { username: name, password: secret, policy: draft }
              : { username: name, active, policy: draft, ...(secret ? { password: secret } : {}) }),
          });
        setAccounts((current) => current.some((account) => account.id === saved.id)
          ? current.map((account) => account.id === saved.id ? saved : account)
          : [...current, saved]);
        setName(saved.username);
        setActive(saved.active);
        setDraft(structuredClone(saved.policy));
        setSavedDraft({ name: saved.username, active: saved.active, policy: structuredClone(saved.policy) });
        setSelected(saved.id);
      }
      setSecret("");
    } catch {
      setError(t("access.saveError"));
    } finally {
      setPending(false);
    }
  }
  async function removeAccount() {
    if (!target || target.owner || locked || pending) return;
    if (!fixture && !window.confirm(t("access.confirmDelete", { name }))) return;
    setPending(true);
    setError(null);
    try {
      if (!fixture) await accessRequest(`/users/${target.id}`, { method: "DELETE" });
      setAccounts((current) => current.filter((account) => account.id !== target.id));
      setSelected(null);
    } catch {
      setError(t("access.saveError"));
    } finally {
      setPending(false);
    }
  }
  return (
    <AsyncPanel
      title={
        selected
          ? selected === "guest"
            ? t("access.guest")
            : selected === "new"
              ? t("access.addAccount")
              : name
          : t("access.title")
      }
      titleAddon={
        selected ? (
          <>
            {target?.owner && !isSelf && tab === "rights" ? (
              <span className="muted">{t("access.readOnly")}</span>
            ) : null}
            {target?.owner && !isSelf ? null : (
              <div
                className="library-history-range-toggle access-editor-tabs"
                role="group"
                aria-label={t("access.editorTabs")}
              >
                <SlidingTogglePill
                  activeKey={tab}
                  className="nav-active-pill library-history-range-pill"
                />
                {["rights", "account"].map((id) => (
                  <button
                    key={id}
                    type="button"
                    data-toggle-key={id}
                    className={`library-history-range-button${tab === id ? " active" : ""}`}
                    aria-pressed={tab === id}
                    onClick={() => setTab(id)}
                  >
                    {t(`access.${id}`)}
                  </button>
                ))}
              </div>
            )}
            {!isSelf && !target?.owner ? (
              <AccessSwitch
                checked={active}
                disabled={locked || pending || selected === "new"}
                label={t("access.activeAccount", {
                  name:
                    selected === "guest"
                      ? t("access.guest")
                      : name || t("access.addAccount"),
                })}
                onChange={setActive}
              />
            ) : null}
          </>
        ) : undefined
      }
      error={selected ? undefined : error}
      className="access-accounts-panel"
      collapseActions={
        selected ? (
          <>
            {target && !target.owner && !(isSelf && tab === "account") && (
              <button type="button" className="icon-button icon-button-borderless icon-button-static"
                aria-label={t("access.delete")} data-tooltip={t("access.delete")}
                disabled={locked || pending} onClick={() => void removeAccount()}>
                <Trash2 className="nav-icon" aria-hidden="true" />
              </button>
            )}
            {!target?.owner && !(isSelf && tab === "account") && (
              <button type="submit" form={editorFormId}
                className="icon-button icon-button-borderless icon-button-static"
                aria-label={t("access.save")} data-tooltip={t("access.save")}
                aria-busy={pending}
                disabled={locked || pending || !dirty || (selected === "new" && !name.trim())}>
                <Save className="nav-icon" aria-hidden="true" />
              </button>
            )}
            <button type="button" className="icon-button icon-button-borderless icon-button-static"
              aria-label={t("access.close")} data-tooltip={t("access.close")}
              disabled={pending} onClick={closeEditor}>
              <X className="nav-icon" aria-hidden="true" />
            </button>
          </>
        ) : canUsers ? (
          <button
            type="button"
            className="icon-button icon-button-borderless icon-button-static"
            aria-label={t("access.addAccount")}
            disabled={!accessLoaded}
            onClick={() => open("new")}
          >
            <Plus className="nav-icon" />
          </button>
        ) : undefined
      }
    >
      {!selected ? (
        <>
          <label className="settings-navigation-search access-search-field">
            <Search aria-hidden="true" className="nav-icon" />
            <span className="sr-only">{t("access.searchAccounts")}</span>
            <input
              id="access-account-search"
              type="search"
              placeholder={t("access.searchAccounts")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="access-account-list">
            {accounts
              .filter((a) =>
                a.username
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
              )
              .map((account) => (
                <article className="media-card access-account-card" key={account.id}>
                  <div className="access-account-card-content">
                    <button
                      type="button"
                      className="access-account-trigger"
                      onClick={() => open(account.id)}
                    >
                      <span
                        className={`access-account-avatar${account.owner ? " is-owner" : ""}`}
                        aria-hidden="true"
                      >
                        {account.username
                          .split(/[\s._@-]+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => Array.from(part)[0])
                          .join("")
                          .toLocaleUpperCase()}
                      </span>
                      <span className="access-account-copy">
                        <strong>{account.username}</strong>
                        <small>
                          {t(account.owner ? "access.owner" : "access.user")}
                        </small>
                      </span>
                    </button>
                    <ChevronRight
                      className="nav-icon access-account-chevron"
                      aria-hidden="true"
                    />
                  </div>
                </article>
              ))}
            {canGuest &&
              t("access.guest")
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()) && (
                <article className="media-card access-account-card">
                  <div className="access-account-card-content">
                    <button
                      type="button"
                      className="access-account-trigger"
                      onClick={() => open("guest")}
                    >
                      <span
                        className="access-account-avatar"
                        aria-hidden="true"
                      >
                        {Array.from(t("access.guest"))[0]}
                      </span>
                      <span className="access-account-copy">
                        <strong>{t("access.guest")}</strong>
                      </span>
                    </button>
                    <ChevronRight
                      className="nav-icon access-account-chevron"
                      aria-hidden="true"
                    />
                  </div>
                </article>
              )}
            {!accounts.length && !canGuest && (
              <p className="empty-state">{t("access.noAccounts")}</p>
            )}
          </div>
        </>
      ) : (
        <>
          <form
            id={editorFormId}
            onSubmit={(e) => {
              e.preventDefault();
              if (!locked && !pending) void save();
            }}
          >
            {error && <p role="alert" className="alert">{error}</p>}
            {target?.owner && !isSelf ? (
              <p className="muted access-owner-hint">{t("access.ownerHint")}</p>
            ) : null}
            {tab === "rights" || (target?.owner && !isSelf) ? (
              <>
                {target?.owner && isSelf && (
                  <p className="muted access-owner-hint">{t("access.ownerHint")}</p>
                )}
                <RightsTree
                  value={shownPolicy}
                  onChange={setDraft}
                  libraries={libraries}
                  actor={actor}
                  locked={locked || pending}
                  guest={selected === "guest"}
                />
              </>
            ) : isSelf ? null : (
              <div className="form-grid">
                {selected !== "guest" && (
                  <label>
                    {t("access.username")}
                    <input
                      required
                      maxLength={64}
                      value={name}
                      disabled={locked || pending}
                      autoComplete="off"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}
                {selected !== "guest" && !target?.owner && (
                  <div className="password-requirements-field">
                    <label>
                      {t(
                        selected === "new"
                          ? "access.temporaryPassword"
                          : "access.resetPassword",
                      )}
                      <input
                        ref={(input) => {
                          passwordInput.current = input;
                          input?.setCustomValidity(secret && !validNewPassword(secret)
                            ? t("access.passwordRequirements") : "");
                        }}
                        type="password"
                        autoComplete="new-password"
                        required={selected === "new"}
                        minLength={5}
                        disabled={locked || pending}
                        value={secret}
                        aria-describedby={passwordRequirementsId}
                        onChange={(e) => {
                          const value = e.currentTarget.value;
                          e.currentTarget.setCustomValidity(value && !validNewPassword(value)
                            ? t("access.passwordRequirements") : "");
                          setSecret(value);
                        }}
                      />
                    </label>
                    <PasswordRequirements id={passwordRequirementsId} value={secret} />
                  </div>
                )}
                {selected === "guest" ? null : (
                  <p className="muted">
                    {t(target?.owner ? "access.ownerHint" : "access.temporaryHint")}
                  </p>
                )}
              </div>
            )}
          </form>
          {isSelf && tab === "account" && <PersonalAccountPanel />}
        </>
      )}
    </AsyncPanel>
  );
}
