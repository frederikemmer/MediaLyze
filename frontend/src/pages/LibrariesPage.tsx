import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";

import { AsyncPanel } from "../components/AsyncPanel";
import { PathBrowser } from "../components/PathBrowser";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { useAppData } from "../lib/app-data";
import { api, type LibrarySummary } from "../lib/api";
import { formatBytes, formatDate, formatDuration } from "../lib/format";
import { getIgnorePatternSectionState, saveIgnorePatternSectionState } from "../lib/ignore-pattern-sections";
import {
  getLibraryStatisticsSettings,
  getOrderedLibraryStatisticDefinitions,
  moveLibraryStatistic,
  saveLibraryStatisticsSettings,
  updateLibraryStatisticVisibility,
  type LibraryStatisticId,
  type LibraryStatisticsSettings,
} from "../lib/library-statistics-settings";
import { useScanJobs } from "../lib/scan-jobs";

const EMPTY_FORM = {
  name: "",
  path: ".",
  type: "mixed",
  scan_mode: "manual",
};

type LibrarySettingsForm = {
  scan_mode: string;
  interval_minutes: number;
  debounce_seconds: number;
};

type IgnorePatternGroup = "user" | "default";

type IgnorePatternDrafts = Record<IgnorePatternGroup, string>;

type PersistedIgnorePatterns = Record<IgnorePatternGroup, string[]>;

function toLibrarySettingsForm(library: LibrarySummary): LibrarySettingsForm {
  return {
    scan_mode: library.scan_mode,
    interval_minutes: Number(library.scan_config.interval_minutes ?? 60),
    debounce_seconds: Number(library.scan_config.debounce_seconds ?? 15),
  };
}

function buildScanConfig(settings: LibrarySettingsForm): Record<string, number> {
  if (settings.scan_mode === "scheduled") {
    return { interval_minutes: settings.interval_minutes };
  }
  if (settings.scan_mode === "watch") {
    return { debounce_seconds: settings.debounce_seconds };
  }
  return {};
}

function settingsMatchLibrary(library: LibrarySummary, settings: LibrarySettingsForm | undefined): boolean {
  if (!settings) {
    return true;
  }
  const current = toLibrarySettingsForm(library);
  return (
    current.scan_mode === settings.scan_mode &&
    current.interval_minutes === settings.interval_minutes &&
    current.debounce_seconds === settings.debounce_seconds
  );
}

function normalizeIgnorePatterns(patterns: string[]): string[] {
  return patterns
    .map((line) => line.trim())
    .filter(Boolean);
}

function toPersistedIgnorePatterns(payload: {
  user_ignore_patterns?: string[];
  default_ignore_patterns?: string[];
}): PersistedIgnorePatterns {
  return {
    user: payload.user_ignore_patterns ?? [],
    default: payload.default_ignore_patterns ?? [],
  };
}

export function LibrariesPage() {
  const { t, i18n } = useTranslation();
  const { libraries, librariesLoaded, loadLibraries, upsertLibrary, removeLibrary: removeLibraryFromStore } = useAppData();
  const [isLoadingLibraries, setIsLoadingLibraries] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [settingsForms, setSettingsForms] = useState<Record<number, LibrarySettingsForm>>({});
  const autoSaveTimers = useRef<Record<number, number>>({});
  const [libraryMessages, setLibraryMessages] = useState<Record<number, string | null>>({});
  const [statisticsSettings, setStatisticsSettings] = useState<LibraryStatisticsSettings>(() => getLibraryStatisticsSettings());
  const [draggedStatisticId, setDraggedStatisticId] = useState<LibraryStatisticId | null>(null);
  const [dropTargetStatisticId, setDropTargetStatisticId] = useState<LibraryStatisticId | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [userIgnorePatternInputs, setUserIgnorePatternInputs] = useState<string[]>([]);
  const [defaultIgnorePatternInputs, setDefaultIgnorePatternInputs] = useState<string[]>([]);
  const [ignorePatternDrafts, setIgnorePatternDrafts] = useState<IgnorePatternDrafts>({ user: "", default: "" });
  const [ignorePatternSectionState, setIgnorePatternSectionState] = useState(() => getIgnorePatternSectionState());
  const [ignorePatternsLoadError, setIgnorePatternsLoadError] = useState<string | null>(null);
  const [ignorePatternsStatus, setIgnorePatternsStatus] = useState<string | null>(null);
  const [isLoadingIgnorePatterns, setIsLoadingIgnorePatterns] = useState(true);
  const [isSavingIgnorePatterns, setIsSavingIgnorePatterns] = useState(false);
  const ignorePatternsSaveTimer = useRef<number | null>(null);
  const ignorePatternsRequestId = useRef(0);
  const ignorePatternsSuccessId = useRef(0);
  const persistedIgnorePatterns = useRef<PersistedIgnorePatterns>({ user: [], default: [] });
  const { activeJobs, hasActiveJobs, refresh, trackJob } = useScanJobs();
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const orderedStatistics = getOrderedLibraryStatisticDefinitions(statisticsSettings);

  const refreshLibraries = (showLoading = false, force = false) => {
    if (showLoading) {
      setIsLoadingLibraries(true);
    }
    return loadLibraries(force)
      .then((payload) => {
        setError(null);
        return payload;
      })
      .catch((reason: Error) => {
        setError(reason.message);
        throw reason;
      })
      .finally(() => {
        if (showLoading) {
          setIsLoadingLibraries(false);
        }
      });
  };

  useEffect(() => {
    if (librariesLoaded) {
      setIsLoadingLibraries(false);
      return;
    }
    void refreshLibraries(true).catch(() => undefined);
  }, [librariesLoaded]);

  useEffect(() => {
    setSettingsForms((current) => {
      const next = { ...current };
      for (const library of libraries) {
        if (!next[library.id] || settingsMatchLibrary(library, next[library.id])) {
          next[library.id] = toLibrarySettingsForm(library);
        }
      }
      return next;
    });
  }, [libraries]);

  useEffect(() => {
    if (hadActiveJobsRef.current && !hasActiveJobs) {
      void refreshLibraries(false, true).catch(() => undefined);
    }
    hadActiveJobsRef.current = hasActiveJobs;
  }, [hasActiveJobs]);

  useEffect(() => {
    let active = true;
    setIsLoadingIgnorePatterns(true);
    void api
      .appSettings()
      .then((payload) => {
        if (!active) {
          return;
        }
        const persisted = toPersistedIgnorePatterns(payload);
        persistedIgnorePatterns.current = persisted;
        ignorePatternsSuccessId.current = ignorePatternsRequestId.current;
        setUserIgnorePatternInputs(persisted.user);
        setDefaultIgnorePatternInputs(persisted.default);
        setIgnorePatternsLoadError(null);
      })
      .catch((reason: Error) => {
        if (!active) {
          return;
        }
        setIgnorePatternsLoadError(reason.message);
      })
      .finally(() => {
        if (active) {
          setIsLoadingIgnorePatterns(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(autoSaveTimers.current)) {
        window.clearTimeout(timer);
      }
      if (ignorePatternsSaveTimer.current) {
        window.clearTimeout(ignorePatternsSaveTimer.current);
      }
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const created = await api.createLibrary(form);
      upsertLibrary(created);
      setForm(EMPTY_FORM);
      setSubmitError(null);
    } catch (reason) {
      setSubmitError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function updateLibraryForm(
    libraryId: number,
    patch: Partial<LibrarySettingsForm>,
  ) {
    const current = settingsForms[libraryId] ?? {
      scan_mode: "manual",
      interval_minutes: 60,
      debounce_seconds: 15,
    };
    const next = { ...current, ...patch };
    setSettingsForms((forms) => ({
      ...forms,
      [libraryId]: next,
    }));
    setLibraryMessages((messages) => ({ ...messages, [libraryId]: null }));

    if (autoSaveTimers.current[libraryId]) {
      window.clearTimeout(autoSaveTimers.current[libraryId]);
    }

    autoSaveTimers.current[libraryId] = window.setTimeout(async () => {
      try {
        const updated = await api.updateLibrarySettings(libraryId, {
          scan_mode: next.scan_mode,
          scan_config: buildScanConfig(next),
        });
        upsertLibrary(updated);
        setSettingsForms((forms) => ({
          ...forms,
          [libraryId]: toLibrarySettingsForm(updated),
        }));
        setLibraryMessages((messages) => ({ ...messages, [libraryId]: null }));
      } catch (reason) {
        setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
      } finally {
        delete autoSaveTimers.current[libraryId];
      }
    }, 450);
  }

  async function runLibraryScan(libraryId: number) {
    const current = settingsForms[libraryId];
    if (current && autoSaveTimers.current[libraryId]) {
      window.clearTimeout(autoSaveTimers.current[libraryId]);
      delete autoSaveTimers.current[libraryId];
      try {
        const updated = await api.updateLibrarySettings(libraryId, {
          scan_mode: current.scan_mode,
          scan_config: buildScanConfig(current),
        });
        upsertLibrary(updated);
      } catch (reason) {
        setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
        return;
      }
    }

    try {
      const job = await api.scanLibrary(libraryId, "incremental");
      trackJob(job);
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: null }));
    } catch (reason) {
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
      return;
    }
  }

  async function renameLibrary(library: LibrarySummary) {
    const nextName = window.prompt(t("libraries.renamePrompt"), library.name);
    if (nextName === null) {
      return;
    }

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === library.name) {
      return;
    }

    try {
      const updated = await api.updateLibrarySettings(library.id, { name: trimmedName });
      upsertLibrary(updated);
      setLibraryMessages((messages) => ({ ...messages, [library.id]: null }));
    } catch (reason) {
      setLibraryMessages((messages) => ({ ...messages, [library.id]: (reason as Error).message }));
    }
  }

  async function removeLibrary(libraryId: number) {
    try {
      await api.deleteLibrary(libraryId);
      removeLibraryFromStore(libraryId);
      setSettingsForms((currentForms) => {
        const next = { ...currentForms };
        delete next[libraryId];
        return next;
      });
      setLibraryMessages((messages) => {
        const next = { ...messages };
        delete next[libraryId];
        return next;
      });
      await refresh();
    } catch (reason) {
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
    }
  }

  function persistIgnorePatternSectionStateValue(
    nextState: Parameters<typeof saveIgnorePatternSectionState>[0],
  ) {
    setIgnorePatternSectionState(saveIgnorePatternSectionState(nextState));
  }

  function toggleIgnorePatternSection(section: "customExpanded" | "defaultsExpanded") {
    persistIgnorePatternSectionStateValue({
      ...ignorePatternSectionState,
      [section]: !ignorePatternSectionState[section],
    });
  }

  async function persistIgnorePatterns(nextUserPatterns: string[], nextDefaultPatterns: string[]) {
    const requestId = ignorePatternsRequestId.current + 1;
    ignorePatternsRequestId.current = requestId;
    setIsSavingIgnorePatterns(true);
    try {
      const updated = await api.updateAppSettings({
        user_ignore_patterns: normalizeIgnorePatterns(nextUserPatterns),
        default_ignore_patterns: normalizeIgnorePatterns(nextDefaultPatterns),
      });
      const persisted = toPersistedIgnorePatterns(updated);
      if (requestId > ignorePatternsSuccessId.current) {
        ignorePatternsSuccessId.current = requestId;
        persistedIgnorePatterns.current = persisted;
      }
      if (requestId === ignorePatternsRequestId.current) {
        setUserIgnorePatternInputs(persisted.user);
        setDefaultIgnorePatternInputs(persisted.default);
        setIgnorePatternsStatus(null);
      }
      return persisted;
    } catch (reason) {
      if (requestId === ignorePatternsRequestId.current) {
        setUserIgnorePatternInputs(persistedIgnorePatterns.current.user);
        setDefaultIgnorePatternInputs(persistedIgnorePatterns.current.default);
        setIgnorePatternsStatus((reason as Error).message);
      }
      return null;
    } finally {
      if (requestId === ignorePatternsRequestId.current) {
        setIsSavingIgnorePatterns(false);
      }
    }
  }

  function scheduleIgnorePatternsSave(nextUserPatterns: string[], nextDefaultPatterns: string[]) {
    setUserIgnorePatternInputs(nextUserPatterns);
    setDefaultIgnorePatternInputs(nextDefaultPatterns);
    setIgnorePatternsStatus(null);
    if (ignorePatternsSaveTimer.current) {
      window.clearTimeout(ignorePatternsSaveTimer.current);
    }
    ignorePatternsSaveTimer.current = window.setTimeout(() => {
      ignorePatternsSaveTimer.current = null;
      void persistIgnorePatterns(nextUserPatterns, nextDefaultPatterns);
    }, 450);
  }

  function flushIgnorePatternsSave(nextUserPatterns: string[], nextDefaultPatterns: string[]) {
    if (ignorePatternsSaveTimer.current) {
      window.clearTimeout(ignorePatternsSaveTimer.current);
      ignorePatternsSaveTimer.current = null;
    }
    return persistIgnorePatterns(nextUserPatterns, nextDefaultPatterns);
  }

  async function addIgnorePattern(group: IgnorePatternGroup) {
    const candidate = ignorePatternDrafts[group].trim();
    if (!candidate) {
      return;
    }
    const nextUserPatterns = group === "user" ? [...userIgnorePatternInputs, candidate] : userIgnorePatternInputs;
    const nextDefaultPatterns =
      group === "default" ? [...defaultIgnorePatternInputs, candidate] : defaultIgnorePatternInputs;
    const updated = await flushIgnorePatternsSave(nextUserPatterns, nextDefaultPatterns);
    if (updated) {
      setIgnorePatternDrafts((current) => ({ ...current, [group]: "" }));
    }
  }

  async function removeIgnorePattern(group: IgnorePatternGroup, index: number) {
    const sourcePatterns = group === "user" ? userIgnorePatternInputs : defaultIgnorePatternInputs;
    const nextPatterns = sourcePatterns.filter((_, rowIndex) => rowIndex !== index);
    if (group === "user") {
      setUserIgnorePatternInputs(nextPatterns);
      await flushIgnorePatternsSave(nextPatterns, defaultIgnorePatternInputs);
      return;
    }
    setDefaultIgnorePatternInputs(nextPatterns);
    await flushIgnorePatternsSave(userIgnorePatternInputs, nextPatterns);
  }

  function updateIgnorePattern(group: IgnorePatternGroup, index: number, value: string) {
    const sourcePatterns = group === "user" ? userIgnorePatternInputs : defaultIgnorePatternInputs;
    const nextPatterns = sourcePatterns.map((pattern, rowIndex) => (rowIndex === index ? value : pattern));
    if (group === "user") {
      scheduleIgnorePatternsSave(nextPatterns, defaultIgnorePatternInputs);
      return;
    }
    scheduleIgnorePatternsSave(userIgnorePatternInputs, nextPatterns);
  }

  async function finalizeIgnorePatternEdit(group: IgnorePatternGroup, index: number) {
    const sourcePatterns = group === "user" ? userIgnorePatternInputs : defaultIgnorePatternInputs;
    const currentValue = sourcePatterns[index];
    if (currentValue === undefined) {
      return;
    }
    const nextPatterns = sourcePatterns.map((pattern, rowIndex) => (rowIndex === index ? pattern.trim() : pattern));
    if (group === "user") {
      setUserIgnorePatternInputs(nextPatterns);
      await flushIgnorePatternsSave(nextPatterns, defaultIgnorePatternInputs);
      return;
    }
    setDefaultIgnorePatternInputs(nextPatterns);
    await flushIgnorePatternsSave(userIgnorePatternInputs, nextPatterns);
  }

  function updateStatisticsSettings(
    transform: (current: LibraryStatisticsSettings) => LibraryStatisticsSettings,
  ) {
    setStatisticsSettings((current) => saveLibraryStatisticsSettings(transform(current)));
  }

  function toggleStatisticVisibility(
    statisticId: LibraryStatisticId,
    area: "panelEnabled" | "tableEnabled" | "dashboardEnabled",
  ) {
    updateStatisticsSettings((current) =>
      updateLibraryStatisticVisibility(current, statisticId, {
        [area]: !current.visibility[statisticId][area],
      }),
    );
  }

  function handleStatisticDrop(targetId: LibraryStatisticId) {
    if (!draggedStatisticId) {
      return;
    }

    updateStatisticsSettings((current) => moveLibraryStatistic(current, draggedStatisticId, targetId));
    setDraggedStatisticId(null);
    setDropTargetStatisticId(null);
  }

  function renderIgnorePatternSection(
    group: IgnorePatternGroup,
    title: string,
    expanded: boolean,
    toggleKey: "customExpanded" | "defaultsExpanded",
    inputId: string,
  ) {
    const patterns = group === "user" ? userIgnorePatternInputs : defaultIgnorePatternInputs;
    const draftValue = ignorePatternDrafts[group];
    const ToggleIcon = expanded ? ChevronDown : ChevronRight;

    return (
      <div className="ignore-pattern-section" key={group}>
        <button
          type="button"
          className="secondary ignore-pattern-section-toggle"
          aria-expanded={expanded}
          onClick={() => toggleIgnorePatternSection(toggleKey)}
        >
          <span className="ignore-pattern-section-title">{title}</span>
          <span className="ignore-pattern-section-meta">
            <span className="badge">{patterns.length}</span>
            <ToggleIcon aria-hidden="true" className="nav-icon" />
          </span>
        </button>
        {expanded ? (
          <div className="ignore-pattern-section-body">
            <div className="ignore-pattern-row ignore-pattern-row-draft">
              <input
                id={inputId}
                type="text"
                value={draftValue}
                onChange={(event) => {
                  setIgnorePatternDrafts((current) => ({ ...current, [group]: event.target.value }));
                  setIgnorePatternsStatus(null);
                }}
                placeholder={t("libraries.ignorePatternsPlaceholder")}
                spellCheck={false}
              />
              <button
                type="button"
                className="secondary icon-only-button"
                aria-label={t("libraries.ignorePatternsAddAria")}
                title={t("libraries.ignorePatternsAddAria")}
                disabled={isSavingIgnorePatterns || !draftValue.trim()}
                onClick={() => void addIgnorePattern(group)}
              >
                <Plus aria-hidden="true" className="nav-icon" />
              </button>
            </div>
            <div className="ignore-patterns-stack">
              {patterns.map((pattern, index) => (
                <div className="ignore-pattern-row ignore-pattern-row-saved" key={`${group}-ignore-pattern-${index}`}>
                  <input
                    type="text"
                    value={pattern}
                    onChange={(event) => updateIgnorePattern(group, index, event.target.value)}
                    onBlur={() => void finalizeIgnorePatternEdit(group, index)}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="secondary icon-only-button"
                    aria-label={t("libraries.ignorePatternsRemoveAria", { index: index + 1 })}
                    title={t("libraries.ignorePatternsRemoveAria", { index: index + 1 })}
                    disabled={isSavingIgnorePatterns}
                    onClick={() => void removeIgnorePattern(group, index)}
                  >
                    <Trash2 aria-hidden="true" className="nav-icon" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="settings-layout">
        <div className="settings-main-column">
          <AsyncPanel title={t("libraries.configured")} loading={isLoadingLibraries} error={error}>
            <div className="listing">
              {!libraries.length ? <div className="notice">{t("libraries.addFirstLibrary")}</div> : null}
              {libraries.map((library) => (
                <div className="media-card library-settings-card" key={library.id}>
                  <div className="library-settings-header">
                    <div className="item-meta">
                      <div className="meta-tags">
                        <span className="badge">{t(`libraryTypes.${library.type}`)}</span>
                        <span className="badge">{t(`scanModes.${library.scan_mode}`)}</span>
                        {activeJobs
                          .filter((job) => job.library_id === library.id)
                          .map((job) => (
                            <span className="badge scan-badge" key={job.id}>
                              {job.files_total > 0 ? `${job.progress_percent}%` : t("libraries.active")}
                            </span>
                          ))}
                      </div>
                      <div className="library-title-row">
                        <h3>
                          <Link to={`/libraries/${library.id}`} className="file-link">
                            {library.name}
                          </Link>
                        </h3>
                        <div className="library-title-actions">
                          <button
                            type="button"
                            className="secondary icon-only-button"
                            aria-label={t("libraries.renameAria", { name: library.name })}
                            title={t("libraries.renameAria", { name: library.name })}
                            onClick={() => void renameLibrary(library)}
                          >
                            <Pencil aria-hidden="true" className="nav-icon" />
                          </button>
                          <button
                            type="button"
                            className="secondary icon-only-button"
                            aria-label={t("libraries.deleteAria", { name: library.name })}
                            title={t("libraries.deleteAria", { name: library.name })}
                            onClick={() => void removeLibrary(library.id)}
                          >
                            <Trash2 aria-hidden="true" className="nav-icon" />
                          </button>
                          <button
                            type="button"
                            className="small"
                            onClick={() => void runLibraryScan(library.id)}
                          >
                            {t("libraries.scanNow")}
                          </button>
                        </div>
                      </div>
                      <p className="media-meta">{library.path}</p>
                    </div>
                    <div className="library-stats">
                      <span>{library.file_count} {t("libraries.files").toLowerCase()}</span>
                      <span>{formatBytes(library.total_size_bytes)}</span>
                      <span>{formatDuration(library.total_duration_seconds)}</span>
                      <span>{t("libraries.lastScan")}: {formatDate(library.last_scan_at)}</span>
                    </div>
                  </div>
                  {activeJobs.find((job) => job.library_id === library.id) ? (
                    <div className="progress">
                      <span
                        style={{
                          width: `${activeJobs.find((job) => job.library_id === library.id)?.progress_percent ?? 0}%`,
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="library-settings-form">
                    <div className="field">
                      <label htmlFor={`scan-mode-${library.id}`}>{t("libraries.scanMode")}</label>
                      <select
                        id={`scan-mode-${library.id}`}
                        value={settingsForms[library.id]?.scan_mode ?? library.scan_mode}
                        onChange={(event) =>
                          updateLibraryForm(library.id, { scan_mode: event.target.value })
                        }
                      >
                        <option value="manual">{t("scanModes.manual")}</option>
                        <option value="scheduled">{t("scanModes.scheduled")}</option>
                        <option value="watch">{t("scanModes.watch")}</option>
                      </select>
                    </div>
                    {(settingsForms[library.id]?.scan_mode ?? library.scan_mode) === "scheduled" ? (
                      <div className="field">
                        <label htmlFor={`interval-minutes-${library.id}`}>{t("libraries.intervalMinutes")}</label>
                        <input
                          id={`interval-minutes-${library.id}`}
                          type="number"
                          min={5}
                          value={settingsForms[library.id]?.interval_minutes ?? 60}
                          onChange={(event) =>
                            updateLibraryForm(library.id, {
                              interval_minutes: Number(event.target.value),
                            })
                          }
                        />
                      </div>
                    ) : null}
                    {(settingsForms[library.id]?.scan_mode ?? library.scan_mode) === "watch" ? (
                      <div className="field">
                        <label htmlFor={`debounce-seconds-${library.id}`}>{t("libraries.debounceSeconds")}</label>
                        <input
                          id={`debounce-seconds-${library.id}`}
                          type="number"
                          min={3}
                          value={settingsForms[library.id]?.debounce_seconds ?? 15}
                          onChange={(event) =>
                            updateLibraryForm(library.id, {
                              debounce_seconds: Number(event.target.value),
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                  {libraryMessages[library.id] ? <div className="alert">{libraryMessages[library.id]}</div> : null}
                </div>
              ))}
            </div>
          </AsyncPanel>

          <AsyncPanel title={t("libraryStatistics.title")}>
            <div className="settings-sidebar-stack">
              <p className="settings-copy">{t("libraryStatistics.subtitle")}</p>
              <div className="settings-table-shell">
                <table className="settings-data-table library-statistics-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("libraryStatistics.name")}</th>
                      <th scope="col">{t("libraryStatistics.statistics")}</th>
                      <th scope="col">{t("libraryStatistics.table")}</th>
                      <th scope="col">{t("libraryStatistics.dashboard")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedStatistics.map((statistic) => {
                      const visibility = statisticsSettings.visibility[statistic.id];
                      return (
                        <tr
                          key={statistic.id}
                          className={dropTargetStatisticId === statistic.id ? "is-drop-target" : undefined}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (draggedStatisticId && draggedStatisticId !== statistic.id) {
                              setDropTargetStatisticId(statistic.id);
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            handleStatisticDrop(statistic.id);
                          }}
                        >
                          <td>
                            <div className="statistic-name-cell">
                              <span
                                className={`statistics-drag-handle${draggedStatisticId === statistic.id ? " is-dragging" : ""}`}
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", statistic.id);
                                  setDraggedStatisticId(statistic.id);
                                  setDropTargetStatisticId(statistic.id);
                                }}
                                onDragEnd={() => {
                                  setDraggedStatisticId(null);
                                  setDropTargetStatisticId(null);
                                }}
                                title={t("libraryStatistics.dragHint")}
                                aria-hidden="true"
                              >
                                <GripVertical className="nav-icon" />
                              </span>
                              <span>{t(statistic.nameKey)}</span>
                            </div>
                          </td>
                          <td className="settings-checkbox-cell">
                            <input
                              type="checkbox"
                              checked={visibility.panelEnabled}
                              disabled={!statistic.supportsPanel}
                              title={!statistic.supportsPanel ? t("libraryStatistics.unavailable") : undefined}
                              onChange={() => toggleStatisticVisibility(statistic.id, "panelEnabled")}
                            />
                          </td>
                          <td className="settings-checkbox-cell">
                            <input
                              type="checkbox"
                              checked={visibility.tableEnabled}
                              disabled={!statistic.supportsTable}
                              title={!statistic.supportsTable ? t("libraryStatistics.unavailable") : undefined}
                              onChange={() => toggleStatisticVisibility(statistic.id, "tableEnabled")}
                            />
                          </td>
                          <td className="settings-checkbox-cell">
                            <input
                              type="checkbox"
                              checked={visibility.dashboardEnabled}
                              disabled={!statistic.supportsDashboard}
                              title={!statistic.supportsDashboard ? t("libraryStatistics.unavailable") : undefined}
                              onChange={() => toggleStatisticVisibility(statistic.id, "dashboardEnabled")}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </AsyncPanel>
        </div>

        <div className="settings-sidebar">
          <AsyncPanel title={t("libraries.createTitle")} error={submitError}>
            <form className="form-grid" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="library-name">{t("libraries.name")}</label>
                <input
                  id="library-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t("libraries.namePlaceholder")}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="library-type">{t("libraries.type")}</label>
                <select
                  id="library-type"
                  value={form.type}
                  onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
                >
                  <option value="movies">{t("libraryTypes.movies")}</option>
                  <option value="series">{t("libraryTypes.series")}</option>
                  <option value="mixed">{t("libraryTypes.mixed")}</option>
                  <option value="other">{t("libraryTypes.other")}</option>
                </select>
              </div>
              <PathBrowser
                value={form.path}
                onChange={(path) => setForm((current) => ({ ...current, path }))}
              />
              <button type="submit" disabled={submitting}>
                {submitting ? t("libraries.creating") : t("libraries.createButton")}
              </button>
            </form>
          </AsyncPanel>

          <AsyncPanel
            title={t("libraries.ignorePatternsTitle")}
            subtitle={t("libraries.ignorePatternsSubtitle")}
            loading={isLoadingIgnorePatterns}
            error={ignorePatternsLoadError}
          >
            <div className="form-grid">
              <div className="field">
                <div className="field-label-row">
                  <label>{t("libraries.ignorePatternsLabel")}</label>
                  <TooltipTrigger
                    ariaLabel={t("libraries.ignorePatternsTooltipAria")}
                    content={t("libraries.ignorePatternsTooltip")}
                    preserveLineBreaks
                  >
                    ?
                  </TooltipTrigger>
                </div>
                <div className="ignore-pattern-sections">
                  {renderIgnorePatternSection(
                    "user",
                    t("libraries.ignorePatternsCustomTitle"),
                    ignorePatternSectionState.customExpanded,
                    "customExpanded",
                    "custom-ignore-patterns",
                  )}
                  {renderIgnorePatternSection(
                    "default",
                    t("libraries.ignorePatternsDefaultTitle"),
                    ignorePatternSectionState.defaultsExpanded,
                    "defaultsExpanded",
                    "default-ignore-patterns",
                  )}
                </div>
                <p className="field-hint">{t("libraries.ignorePatternsHint")}</p>
              </div>
              {ignorePatternsStatus ? <div className="alert">{ignorePatternsStatus}</div> : null}
            </div>
          </AsyncPanel>

          <AsyncPanel title={t("libraries.appSettings")}>
            <div className="settings-sidebar-stack">
              <div className="field">
                <label htmlFor="app-language">{t("libraries.language")}</label>
                <select
                  id="app-language"
                  value={i18n.resolvedLanguage ?? "en"}
                  onChange={(event) => void i18n.changeLanguage(event.target.value)}
                >
                  <option value="en">{t("language.en")}</option>
                  <option value="de">{t("language.de")}</option>
                </select>
              </div>
            </div>
          </AsyncPanel>
        </div>
      </div>
    </>
  );
}
