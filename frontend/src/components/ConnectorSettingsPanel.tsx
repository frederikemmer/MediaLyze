import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FolderPlus,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AsyncPanel } from "./AsyncPanel";
import { ConnectorProviderIcon } from "./ConnectorProviderIcon";
import { SlidingTogglePill } from "./SlidingTogglePill";
import {
  api,
  type ConnectorConnection,
  type ConnectorBindingWrite,
  type ConnectorMappingOverview,
  type ConnectorSyncJob,
  type ConnectorUser,
  type LibrarySummary,
} from "../lib/api";

type ConnectionDraft = {
  name: string;
  baseUrl: string;
  syncInterval: string;
};

function providerLabel(provider: string) {
  return provider ? `${provider[0].toUpperCase()}${provider.slice(1)}` : provider;
}

function ConnectionUsers({ connection }: { connection: ConnectorConnection }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [users, setUsers] = useState<ConnectorUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await api.connectorUsers(connection.id));
      setLoaded(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [connection.id]);

  useEffect(() => {
    if (expanded && !loaded) void load();
  }, [expanded, load, loaded]);

  async function save(enabledIds: string[]) {
    setPending(true);
    setError(null);
    try {
      setUsers(await api.updateConnectorUsers(connection.id, enabledIds));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }

  const enabledIds = users.filter((user) => user.enabled_for_sync).map((user) => user.remote_id);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleUsers = (normalizedSearch
    ? users.filter((user) => user.name.toLocaleLowerCase().includes(normalizedSearch))
    : [...users]
  ).sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  const selectedUsers = visibleUsers.filter((user) => user.enabled_for_sync);
  const unselectedUsers = visibleUsers.filter((user) => !user.enabled_for_sync);

  function renderGroup(group: "selected" | "unselected", groupUsers: ConnectorUser[]) {
    if (!groupUsers.length) return null;
    const headingId = `connector-${connection.id}-user-group-${group}`;
    return (
      <section className="jellyfin-user-group" aria-labelledby={headingId}>
        <div className="jellyfin-user-group-heading">
          <h5 id={headingId}>{t(`connectors.users.groups.${group}`)}</h5>
          <span className="badge">{groupUsers.length}</span>
        </div>
        <div className="jellyfin-user-list">
          {groupUsers.map((user) => (
            <label key={user.remote_id}>
              <input
                type="checkbox"
                checked={user.enabled_for_sync}
                disabled={pending}
                onChange={() => void save(
                  user.enabled_for_sync
                    ? enabledIds.filter((id) => id !== user.remote_id)
                    : [...enabledIds, user.remote_id],
                )}
              />
              <span>{user.name}</span>
            </label>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="connector-detail-section connector-users-section">
      <button
        type="button"
        className="connector-users-toggle"
        aria-expanded={expanded}
        aria-controls={`connector-${connection.id}-users-body`}
        onClick={() => setExpanded((current) => !current)}
      >
        <div>
          <h4>{t("connectors.users.title")}</h4>
          <p>{loaded ? t("connectors.users.summary", { selected: enabledIds.length, total: users.length }) : t("connectors.users.description")}</p>
        </div>
        {expanded ? <ChevronDown aria-hidden="true" className="nav-icon" /> : <ChevronRight aria-hidden="true" className="nav-icon" />}
      </button>
      {expanded ? (
        <div className="connector-users-body" id={`connector-${connection.id}-users-body`}>
          {loading ? <div className="progress is-indeterminate"><span /></div> : null}
          {error ? <div className="alert" role="alert">{error}</div> : null}
          {!loading && loaded && !users.length ? <div className="notice">{t("connectors.users.empty")}</div> : null}
          {users.length ? (
            <div className="jellyfin-user-selection" aria-busy={pending}>
              <div className="jellyfin-user-selection-toolbar">
                <label className="jellyfin-user-search">
                  <Search aria-hidden="true" />
                  <span className="sr-only">{t("connectors.users.searchLabel")}</span>
                  <input type="search" value={search} placeholder={t("connectors.users.searchPlaceholder")} onChange={(event) => setSearch(event.target.value)} />
                </label>
                <div className="jellyfin-user-bulk-actions" role="group" aria-label={t("connectors.users.bulkActions")}>
                  <button type="button" className="secondary small jellyfin-user-bulk-button" disabled={pending || enabledIds.length === users.length} onClick={() => void save(users.map((user) => user.remote_id))}>{t("connectors.users.selectAll")}</button>
                  <button type="button" className="secondary small jellyfin-user-bulk-button" disabled={pending || enabledIds.length === 0} onClick={() => void save([])}>{t("connectors.users.selectNone")}</button>
                </div>
              </div>
              {visibleUsers.length ? <div className="jellyfin-user-groups">{renderGroup("selected", selectedUsers)}{renderGroup("unselected", unselectedUsers)}</div> : <div className="notice">{t("connectors.users.searchEmpty")}</div>}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type MappingSection = "libraries" | "paths";

function ConnectionMappings({
  connection,
  onChanged,
}: {
  connection: ConnectorConnection;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Record<MappingSection, boolean>>({ libraries: false, paths: false });
  const [overview, setOverview] = useState<ConnectorMappingOverview | null>(null);
  const [libraries, setLibraries] = useState<LibrarySummary[]>([]);
  const [bindingDraft, setBindingDraft] = useState<ConnectorBindingWrite[]>([]);
  const [linkDraft, setLinkDraft] = useState<Record<number, number[]>>({});
  const [createDraft, setCreateDraft] = useState<Record<number, { name: string; type: string; path: string }>>({});
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextLibraries] = await Promise.all([
        api.connectorMappingOverview(connection.id),
        api.libraries(),
      ]);
      setOverview(nextOverview);
      setLibraries(nextLibraries);
      setBindingDraft(nextOverview.libraries.flatMap((library) => library.locations.flatMap((location) => location.bindings.map((binding) => ({
        id: binding.id,
        location_id: binding.location_id,
        library_root_id: binding.library_root_id,
        source_prefix: binding.source_prefix,
        target_subpath: binding.target_subpath,
        case_mode: binding.case_mode,
        priority: binding.priority,
        active: binding.active,
      })))));
      setLinkDraft(Object.fromEntries(nextOverview.libraries.map((library) => [library.id, library.linked_library_ids])));
      setCreateDraft(Object.fromEntries(nextOverview.libraries.filter((library) => library.recommendation).map((library) => [library.id, {
        name: library.recommendation!.suggested_name,
        type: library.recommendation!.suggested_type,
        path: library.recommendation!.accessible_paths[0] ?? "",
      }])));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [connection.id]);

  useEffect(() => {
    if ((expanded.libraries || expanded.paths) && !overview && !loading) void load();
  }, [expanded, load, loading, overview]);

  async function changeMode(kind: MappingSection, mode: "automatic" | "manual") {
    setPending(`mode-${kind}`);
    setError(null);
    try {
      await api.updateConnector(connection.id, kind === "paths" ? { path_mapping_mode: mode } : { library_mapping_mode: mode });
      await onChanged();
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function saveBindings() {
    setPending("bindings");
    setError(null);
    try {
      await api.updateConnectorBindings(connection.id, bindingDraft);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function saveLinks() {
    if (!overview) return;
    setPending("links");
    setError(null);
    try {
      await api.updateConnectorLibraryLinks(connection.id, overview.libraries.map((library) => ({
        connector_library_id: library.id,
        library_ids: linkDraft[library.id] ?? [],
      })));
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function createLibrary(connectorLibraryId: number) {
    const draft = createDraft[connectorLibraryId];
    if (!draft?.name.trim() || !draft.path.trim()) return;
    setPending(`create-${connectorLibraryId}`);
    setError(null);
    try {
      await api.createLibraryForConnector(connection.id, connectorLibraryId, {
        name: draft.name.trim(),
        path: draft.path.trim(),
        paths: [draft.path.trim()],
        type: draft.type as LibrarySummary["type"],
        scan_mode: "manual",
      });
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  const allLocations = overview?.libraries.flatMap((library) => library.locations.map((location) => ({ ...location, libraryName: library.name }))) ?? [];
  const roots = libraries.flatMap((library) => (library.roots ?? []).map((root) => ({ ...root, libraryName: library.name })));

  function sectionHeader(kind: MappingSection, title: string, description: string) {
    const isExpanded = expanded[kind];
    return (
      <div className="connector-mapping-section-header">
        <button type="button" className="connector-users-toggle connector-mapping-section-copy-toggle" aria-expanded={isExpanded} onClick={() => setExpanded((current) => ({ ...current, [kind]: !current[kind] }))}>
          <div><h4>{title}</h4><p>{description}</p></div>
        </button>
        {modeControl(kind)}
        <button
          type="button"
          className="connector-mapping-expand-toggle"
          aria-label={t(isExpanded ? "panel.collapseAria" : "panel.expandAria", { title })}
          aria-expanded={isExpanded}
          onClick={() => setExpanded((current) => ({ ...current, [kind]: !current[kind] }))}
        >
          {isExpanded ? <ChevronDown aria-hidden="true" className="nav-icon" /> : <ChevronRight aria-hidden="true" className="nav-icon" />}
        </button>
      </div>
    );
  }

  function modeControl(kind: MappingSection) {
    const mode = kind === "paths" ? connection.path_mapping_mode : connection.library_mapping_mode;
    return (
      <div className="library-history-range-toggle connector-mapping-mode" role="group" aria-label={t(`connectors.mapping.${kind}.modeLabel`)}>
        <SlidingTogglePill activeKey={mode} className="nav-active-pill library-history-range-pill" />
        {(["automatic", "manual"] as const).map((candidate) => <button key={candidate} type="button" data-toggle-key={candidate} className={`library-history-range-button${mode === candidate ? " active" : ""}`} aria-pressed={mode === candidate} disabled={pending !== null} onClick={() => void changeMode(kind, candidate)}><span className="library-history-range-button-content"><span>{t(`connectors.mapping.mode.${candidate}`)}</span></span></button>)}
      </div>
    );
  }

  return (
    <>
      <section className="connector-detail-section connector-mapping-section">
        {sectionHeader("libraries", t("connectors.mapping.libraries.title"), t("connectors.mapping.libraries.description"))}
        {expanded.libraries ? <div className="connector-mapping-body">
          {loading ? <div className="progress is-indeterminate"><span /></div> : null}
          {overview ? <div className="connector-mapping-summary-card">
            <div className="connector-mapping-summary"><strong>{t("connectors.mapping.coverage", { percent: overview.coverage.matched_percent })}</strong><span>{t("connectors.mapping.coverageItems", { matched: overview.coverage.matched_items, total: overview.coverage.total_items })}</span></div>
            <div className="connector-mapping-coverage-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, overview.coverage.matched_percent))}%` }} /></div>
          </div> : null}
          {overview?.libraries.map((source) => <article className="connector-mapping-card connector-library-assignment-card" key={source.id}>
            <div className="connector-library-assignment-row">
              <div className="connector-library-assignment-source"><strong>{source.name}</strong></div>
              <span className="connector-library-assignment-arrow" aria-hidden="true">→</span>
              <div className="connector-library-choice-list">
                {libraries.map((library) => {
                  const required = source.required_library_ids.includes(library.id);
                  const checked = (linkDraft[source.id] ?? []).includes(library.id);
                  return <label className={`connector-library-choice${checked ? " is-selected" : ""}${required ? " is-required" : ""}`} key={library.id}><input type="checkbox" checked={checked} disabled={connection.library_mapping_mode === "automatic" || required || pending !== null} onChange={() => setLinkDraft((current) => ({ ...current, [source.id]: checked ? (current[source.id] ?? []).filter((id) => id !== library.id) : [...(current[source.id] ?? []), library.id] }))} /><span>{library.name}</span>{required ? <small>{t("connectors.mapping.requiredByPath")}</small> : null}</label>;
                })}
                {!libraries.length ? <span className="muted">{t("connectors.mapping.noLibraries")}</span> : null}
                {source.recommendation && createDraft[source.id] ? <details className="connector-technical-details connector-create-library-details"><summary><FolderPlus aria-hidden="true" />{t("connectors.mapping.createRecommendation")}</summary><div className="connector-create-recommendation connector-form-grid"><label><span>{t("connectors.name")}</span><input className="settings-choice-input" value={createDraft[source.id].name} onChange={(event) => setCreateDraft((current) => ({ ...current, [source.id]: { ...current[source.id], name: event.target.value } }))} /></label><label><span>{t("connectors.mapping.mediaType")}</span><select className="settings-choice-input" value={createDraft[source.id].type} onChange={(event) => setCreateDraft((current) => ({ ...current, [source.id]: { ...current[source.id], type: event.target.value } }))}>{["movies", "series", "music", "audiobooks", "mixed", "other"].map((type) => <option key={type} value={type}>{t(`libraryTypes.${type}`, { defaultValue: type })}</option>)}</select></label><label><span>{t("connectors.mapping.localPath")}</span><input className="settings-choice-input" value={createDraft[source.id].path} onChange={(event) => setCreateDraft((current) => ({ ...current, [source.id]: { ...current[source.id], path: event.target.value } }))} /></label><button type="button" className="secondary small connector-action-button" disabled={pending !== null || !createDraft[source.id].name.trim() || !createDraft[source.id].path.trim()} onClick={() => void createLibrary(source.id)}>{t("connectors.mapping.createLibrary")}</button></div></details> : null}
              </div>
            </div>
          </article>)}
          {connection.library_mapping_mode === "manual" && overview ? <button type="button" className="secondary small connector-action-button connector-mapping-save-action" disabled={pending !== null} onClick={() => void saveLinks()}>{t("connectors.mapping.saveAssignments")}</button> : null}
        </div> : null}
      </section>
      <section className="connector-detail-section connector-mapping-section">
        {sectionHeader("paths", t("connectors.mapping.paths.title"), t("connectors.mapping.paths.description"))}
        {expanded.paths ? <div className="connector-mapping-body">
          {loading ? <div className="progress is-indeterminate"><span /></div> : null}
          {bindingDraft.map((binding, index) => <article className="connector-mapping-card" key={binding.id ?? `new-${index}`}>
            <div className="connector-mapping-row-main"><select className="settings-choice-input" value={binding.location_id} disabled={connection.path_mapping_mode === "automatic"} onChange={(event) => setBindingDraft((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, location_id: Number(event.target.value) } : row))}>{allLocations.map((location) => <option key={location.id} value={location.id}>{location.libraryName}: {location.remote_path}</option>)}</select><span aria-hidden="true">→</span><select className="settings-choice-input" value={binding.library_root_id} disabled={connection.path_mapping_mode === "automatic"} onChange={(event) => setBindingDraft((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, library_root_id: Number(event.target.value) } : row))}>{roots.map((root) => <option key={root.id} value={root.id}>{root.libraryName}: {root.display_name}</option>)}</select><span className={`badge mapping-${overview?.libraries.flatMap((library) => library.locations.flatMap((location) => location.bindings)).find((row) => row.id === binding.id)?.verification_status ?? "manual"}`}>{t(`connectors.mapping.status.${overview?.libraries.flatMap((library) => library.locations.flatMap((location) => location.bindings)).find((row) => row.id === binding.id)?.verification_status ?? "manual"}`)}</span></div>
            <details className="connector-technical-details"><summary>{t("connectors.mapping.technicalFields")}</summary><div className="connector-form-grid"><label><span>{t("connectors.sourcePrefix")}</span><input className="settings-choice-input" value={binding.source_prefix} readOnly={connection.path_mapping_mode === "automatic"} onChange={(event) => setBindingDraft((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, source_prefix: event.target.value } : row))} /></label><label><span>{t("connectors.targetSubpath")}</span><input className="settings-choice-input" value={binding.target_subpath} readOnly={connection.path_mapping_mode === "automatic"} onChange={(event) => setBindingDraft((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, target_subpath: event.target.value } : row))} /></label><label><span>{t("connectors.caseMode")}</span><select className="settings-choice-input" value={binding.case_mode} disabled={connection.path_mapping_mode === "automatic"} onChange={(event) => setBindingDraft((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, case_mode: event.target.value as "sensitive" | "insensitive" } : row))}><option value="sensitive">{t("connectors.mapping.caseSensitive")}</option><option value="insensitive">{t("connectors.mapping.caseInsensitive")}</option></select></label><label><span>{t("connectors.priority")}</span><input className="settings-choice-input" type="number" value={binding.priority} readOnly={connection.path_mapping_mode === "automatic"} onChange={(event) => setBindingDraft((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, priority: Number(event.target.value) } : row))} /></label></div></details>
            {connection.path_mapping_mode === "manual" ? <button type="button" className="secondary small danger connector-action-button" onClick={() => setBindingDraft((current) => current.filter((_row, rowIndex) => rowIndex !== index))}><Trash2 aria-hidden="true" />{t("common.remove")}</button> : null}
          </article>)}
          {!bindingDraft.length && !loading ? <div className="notice">{t("connectors.mapping.noMappings")}</div> : null}
          {connection.path_mapping_mode === "manual" ? <div className="jellyfin-actions"><button type="button" className="secondary small connector-action-button" disabled={!allLocations.length || !roots.length || pending !== null} onClick={() => { const location = allLocations[0]; const root = roots[0]; if (location && root) setBindingDraft((current) => [...current, { location_id: location.id, library_root_id: root.id, source_prefix: location.remote_path, target_subpath: "", case_mode: "sensitive", priority: 0, active: true }]); }}><Plus aria-hidden="true" />{t("connectors.mapping.addMapping")}</button><button type="button" className="secondary small connector-action-button" disabled={pending !== null} onClick={() => void saveBindings()}>{t("connectors.mapping.saveMappings")}</button></div> : null}
        </div> : null}
      </section>
      {error ? <div className="alert" role="alert">{error}</div> : null}
    </>
  );
}

function ConnectionCard({
  connection,
  job,
  expanded,
  onToggle,
  onChanged,
  onCatalogChanged,
}: {
  connection: ConnectorConnection;
  job: ConnectorSyncJob | null;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onCatalogChanged?: () => void;
}) {
  const { t } = useTranslation();
  const legacyDefault = connection.config.legacy_default === true;
  const [draft, setDraft] = useState<ConnectionDraft>({
    name: connection.name,
    baseUrl: connection.base_url,
    syncInterval: String(connection.sync_interval_minutes),
  });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secretDialogOpen, setSecretDialogOpen] = useState(false);

  useEffect(() => {
    setDraft({
      name: connection.name,
      baseUrl: connection.base_url,
      syncInterval: String(connection.sync_interval_minutes),
    });
  }, [connection.base_url, connection.name, connection.sync_interval_minutes]);

  const interval = Number(draft.syncInterval);
  const validInterval = Number.isInteger(interval) && interval >= 5 && interval <= 10080;
  const dirty = draft.name.trim() !== connection.name
    || draft.baseUrl.trim() !== connection.base_url
    || (validInterval && interval !== connection.sync_interval_minutes);
  const syncRunning = job?.status === "queued" || job?.status === "running";

  async function save() {
    setPending("save");
    setError(null);
    setNotice(null);
    try {
      await api.updateConnector(connection.id, {
        ...(!legacyDefault ? { name: draft.name.trim() } : {}),
        base_url: draft.baseUrl.trim(),
        sync_interval_minutes: interval,
      });
      await onChanged();
      setNotice(t("connectors.saved"));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function testConnection() {
    setPending("test");
    setError(null);
    setNotice(null);
    try {
      const result = await api.testConnector(connection.id, {
        base_url: draft.baseUrl.trim(),
      });
      if (!result.success) throw new Error(result.error || t("connectors.testFailed"));
      setNotice(t("connectors.testSucceeded", { name: result.server_name || connection.name }));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function toggleEnabled() {
    setPending("toggle");
    setError(null);
    try {
      await api.updateConnector(connection.id, { enabled: !connection.enabled });
      await onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function syncNow() {
    setPending("sync");
    setError(null);
    setNotice(null);
    try {
      await api.syncConnector(connection.id);
      await onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function cancelSync() {
    setPending("cancel");
    setError(null);
    setNotice(null);
    try {
      await api.cancelConnectorSync(connection.id, job?.id);
      await onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (!window.confirm(t("connectors.deleteConfirm", { name: connection.name }))) return;
    setPending("delete");
    setError(null);
    try {
      await api.deleteConnector(connection.id);
      await onChanged();
      onCatalogChanged?.();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <article id={`connector-${connection.id}`} className={`media-card library-settings-card connector-connection-card${expanded ? " is-expanded" : " is-collapsed"}`}>
      <header className="connector-connection-header">
        <div className="connector-connection-header-main">
          <label
            className="toggle-switch connector-enabled-switch"
            title={t(connection.enabled ? "connectors.disable" : "connectors.enable")}
          >
            <input
              type="checkbox"
              role="switch"
              checked={connection.enabled}
              disabled={pending !== null || syncRunning || dirty || !connection.has_secret || !connection.base_url}
              aria-checked={connection.enabled}
              aria-busy={pending === "toggle"}
              aria-label={t(connection.enabled ? "connectors.disable" : "connectors.enable")}
              onChange={() => void toggleEnabled()}
            />
            <span className="toggle-switch-track connector-enabled-switch-track" aria-hidden="true">
              <span className="toggle-switch-thumb connector-enabled-switch-thumb" />
            </span>
          </label>
          <button
            type="button"
            className="connector-connection-toggle"
            aria-expanded={expanded}
            aria-controls={`connector-connection-${connection.id}`}
            onClick={onToggle}
          >
            <span className="connector-connection-chevron" aria-hidden="true">
              {expanded ? <ChevronDown className="nav-icon" /> : <ChevronRight className="nav-icon" />}
            </span>
            <span className="connector-connection-identity">
              <span className="connector-connection-title">
                <span className="connector-provider-icon" data-provider={connection.provider.toLowerCase()} title={providerLabel(connection.provider)}>
                  <ConnectorProviderIcon provider={connection.provider} aria-hidden="true" />
                  <span className="sr-only">{providerLabel(connection.provider)}</span>
                </span>
                <strong>{connection.name}</strong>
                <span className="connector-connection-url">{connection.base_url || t("connectors.notConfigured")}</span>
              </span>
            </span>
          </button>
        </div>
        <span className={`connector-status status-${syncRunning ? "running" : connection.last_status}`}>
          {t(`connectors.connectionStatus.${syncRunning ? "running" : connection.last_status}`, {
            defaultValue: connection.last_status,
          })}
        </span>
      </header>
      {expanded ? (
        <div className="library-settings-body connector-connection-body" id={`connector-connection-${connection.id}`}>
          <section className="connector-detail-section">
            <div className="connector-form-grid">
              <label><span>{t("connectors.name")}</span><input className="settings-choice-input" value={draft.name} disabled={legacyDefault} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label><span>{t("connectors.serverUrl")}</span><input className="settings-choice-input" type="url" value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
              <label><span>{t("connectors.syncInterval")}</span><input className="settings-choice-input" type="number" min={5} max={10080} value={draft.syncInterval} onChange={(event) => setDraft((current) => ({ ...current, syncInterval: event.target.value }))} /></label>
            </div>
            <div className="jellyfin-actions">
              <button type="button" className="connector-action-button" disabled={!dirty || !draft.name.trim() || !draft.baseUrl.trim() || !validInterval || pending !== null || syncRunning} onClick={() => void save()}><Check aria-hidden="true" />{t("common.save")}</button>
              <button type="button" className="secondary small connector-action-button" disabled={pending !== null || syncRunning} onClick={() => void testConnection()}>{pending === "test" ? <RefreshCw className="is-spinning" aria-hidden="true" /> : <Link2 aria-hidden="true" />}{t("connectors.test")}</button>
              <button type="button" className="secondary small connector-action-button" disabled={pending !== null || syncRunning || dirty || !connection.enabled} onClick={() => void syncNow()}><RefreshCw aria-hidden="true" />{t("connectors.sync")}</button>
              {syncRunning ? <button type="button" className="secondary small connector-action-button" disabled={pending !== null} onClick={() => void cancelSync()}><CircleStop aria-hidden="true" />{t("connectors.cancel")}</button> : null}
              <button type="button" className="secondary small connector-action-button connector-secret-action-button" disabled={pending !== null || syncRunning} onClick={() => setSecretDialogOpen(true)}><KeyRound aria-hidden="true" />{t(connection.has_secret ? "connectors.secretDialog.replaceButton" : "connectors.secretDialog.setButton")}</button>
              <button type="button" className="secondary small danger connector-action-button" disabled={pending !== null || syncRunning} onClick={() => void remove()}><Trash2 aria-hidden="true" />{t("connectors.delete")}</button>
            </div>
            {error ? <div className="alert" role="alert">{error}</div> : null}
            {notice ? <div className="notice success" role="status">{notice}</div> : null}
          </section>
          <ConnectionMappings connection={connection} onChanged={onChanged} />
          {connection.capabilities.users ? <ConnectionUsers connection={connection} /> : null}
        </div>
      ) : null}
      {secretDialogOpen ? <SetConnectorSecretDialog connection={connection} onClose={() => setSecretDialogOpen(false)} onSaved={onChanged} /> : null}
    </article>
  );
}

function SetConnectorSecretDialog({
  connection,
  onClose,
  onSaved,
}: {
  connection: ConnectorConnection;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `connector-${connection.id}-secret-dialog-title`;

  async function saveSecret() {
    const normalizedSecret = secret.trim();
    if (!normalizedSecret) return;
    setPending(true);
    setError(null);
    try {
      await api.updateConnector(connection.id, { secret: normalizedSecret });
      await onSaved();
      onClose();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="settings-create-library-backdrop" role="presentation" onMouseDown={() => { if (!pending) onClose(); }}>
      <section
        className="settings-create-library-dialog connector-secret-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-create-library-dialog-header">
          <div>
            <h2 id={titleId}>{t("connectors.secretDialog.title")}</h2>
            <p>{t(connection.has_secret ? "connectors.secretDialog.replaceDescription" : "connectors.secretDialog.description")}</p>
          </div>
          <button type="button" className="secondary icon-only-button" aria-label={t("common.close")} disabled={pending} onClick={onClose}><X aria-hidden="true" /></button>
        </div>
        {connection.has_secret ? <div className="notice">{t("connectors.secretDialog.existing")}</div> : null}
        <label>
          <span>{t("connectors.secret")}</span>
          <input className="settings-choice-input" type="password" autoComplete="new-password" autoFocus value={secret} onChange={(event) => setSecret(event.target.value)} />
        </label>
        {error ? <div className="alert" role="alert">{error}</div> : null}
        <div className="jellyfin-actions">
          <button type="button" disabled={!secret.trim() || pending} onClick={() => void saveSecret()}>{pending ? <RefreshCw className="is-spinning" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}{t("connectors.secretDialog.save")}</button>
          <button type="button" className="secondary" disabled={pending} onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </section>
    </div>
  );
}

function AddConnectorDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (connection: ConnectorConnection) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = Boolean(name.trim() && baseUrl.trim() && secret.trim());

  async function create() {
    setPending(true);
    setError(null);
    try {
      onCreated(await api.createConnector({
        provider: "jellyfin",
        name: name.trim(),
        base_url: baseUrl.trim(),
        secret: secret.trim(),
        sync_interval_minutes: 60,
        enabled: false,
      }));
    } catch (reason) {
      setError((reason as Error).message);
      setPending(false);
    }
  }

  return (
    <div className="settings-create-library-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-create-library-dialog connector-add-dialog" role="dialog" aria-modal="true" aria-labelledby="connector-add-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-create-library-dialog-header">
          <div><h2 id="connector-add-dialog-title">{t("connectors.addDialog.title")}</h2><p>{t("connectors.addDialog.description")}</p></div>
          <button type="button" className="secondary icon-only-button" aria-label={t("common.close")} disabled={pending} onClick={onClose}><X aria-hidden="true" /></button>
        </div>
        <label className="connector-provider-field">
          <span>{t("connectors.provider")}</span>
          <select className="settings-choice-input" defaultValue="jellyfin">
            <option value="jellyfin">Jellyfin</option>
            <option value="plex" disabled title={t("connectors.addDialog.plexTooltip")}>Plex — {t("connectors.addDialog.soon")}</option>
          </select>
        </label>
        <div className="connector-form-grid">
          <label><span>{t("connectors.name")}</span><input className="settings-choice-input" autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>{t("connectors.serverUrl")}</span><input className="settings-choice-input" type="url" placeholder="http://jellyfin:8096" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
          <label><span>{t("connectors.secret")}</span><input className="settings-choice-input" type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
        </div>
        {error ? <div className="alert" role="alert">{error}</div> : null}
        <div className="jellyfin-actions"><button type="button" disabled={!valid || pending} onClick={() => void create()}>{pending ? <RefreshCw className="is-spinning" aria-hidden="true" /> : <Plus aria-hidden="true" />}{t("connectors.create")}</button><button type="button" className="secondary" disabled={pending} onClick={onClose}>{t("common.cancel")}</button></div>
      </section>
    </div>
  );
}

export function ConnectorSettingsPanel({ onCatalogChanged }: { onCatalogChanged?: () => void }) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [jobs, setJobs] = useState<Record<number, ConnectorSyncJob | null>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    const nextConnections = await api.connectors();
    const nextJobs = Object.fromEntries(await Promise.all(nextConnections.map(async (connection) => [
      connection.id,
      await api.connectorSyncStatus(connection.id),
    ])));
    setConnections(nextConnections);
    setJobs(nextJobs);
    setExpanded((current) => {
      if (Object.keys(current).length) return current;
      const hashId = Number(window.location.hash.match(/^#connector-(\d+)$/)?.[1]);
      const selected = nextConnections.find((connection) => connection.id === hashId) ?? nextConnections[0];
      return selected ? { [selected.id]: true } : {};
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    load().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!connections.length) return undefined;
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [connections.length, load]);

  return (
    <>
      <AsyncPanel
        title={t("connectors.title")}
        subtitle={t("connectors.description")}
        loading={loading}
        error={error}
        collapseActions={<button type="button" className="secondary small settings-panel-header-action connector-action-button" onClick={() => setAddOpen(true)}><Plus aria-hidden="true" />{t("connectors.addConnection")}</button>}
      >
        {!connections.length ? <div className="notice">{t("connectors.empty")}</div> : null}
        <div className="connector-card-list">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              job={jobs[connection.id] ?? null}
              expanded={Boolean(expanded[connection.id])}
              onToggle={() => setExpanded((current) => ({ ...current, [connection.id]: !current[connection.id] }))}
              onChanged={load}
              onCatalogChanged={onCatalogChanged}
            />
          ))}
        </div>
      </AsyncPanel>
      {addOpen ? <AddConnectorDialog onClose={() => setAddOpen(false)} onCreated={(connection) => { setAddOpen(false); setExpanded((current) => ({ ...current, [connection.id]: true })); void load(); }} /> : null}
    </>
  );
}
