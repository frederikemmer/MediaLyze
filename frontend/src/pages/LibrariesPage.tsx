import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AsyncPanel } from "../components/AsyncPanel";
import { PathBrowser } from "../components/PathBrowser";
import { api, type LibrarySummary } from "../lib/api";
import { formatBytes, formatDate, formatDuration } from "../lib/format";
import { useScanJobs } from "../lib/scan-jobs";

const EMPTY_FORM = {
  name: "",
  path: ".",
  type: "mixed",
  scan_mode: "manual",
};

export function LibrariesPage() {
  const { t } = useTranslation();
  const [libraries, setLibraries] = useState<LibrarySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [settingsForms, setSettingsForms] = useState<
    Record<number, { scan_mode: string; interval_minutes: number; debounce_seconds: number }>
  >({});
  const [libraryMessages, setLibraryMessages] = useState<Record<number, string | null>>({});
  const [form, setForm] = useState(EMPTY_FORM);
  const { activeJobs, hasActiveJobs, refresh } = useScanJobs();

  const loadLibraries = () => {
    api
      .libraries()
      .then((payload) => {
        setLibraries(payload);
        setSettingsForms((current) => {
          const next = { ...current };
          for (const library of payload) {
            next[library.id] ??= {
              scan_mode: library.scan_mode,
              interval_minutes: Number(library.scan_config.interval_minutes ?? 60),
              debounce_seconds: Number(library.scan_config.debounce_seconds ?? 15),
            };
          }
          return next;
        });
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  };

  useEffect(() => {
    loadLibraries();
  }, []);

  useEffect(() => {
    if (!hasActiveJobs) {
      return;
    }
    const timer = window.setInterval(loadLibraries, 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.createLibrary(form);
      setForm(EMPTY_FORM);
      setSubmitError(null);
      loadLibraries();
    } catch (reason) {
      setSubmitError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function updateLibraryForm(
    libraryId: number,
    patch: Partial<{ scan_mode: string; interval_minutes: number; debounce_seconds: number }>,
  ) {
    setSettingsForms((current) => ({
      ...current,
      [libraryId]: {
        scan_mode: current[libraryId]?.scan_mode ?? "manual",
        interval_minutes: current[libraryId]?.interval_minutes ?? 60,
        debounce_seconds: current[libraryId]?.debounce_seconds ?? 15,
        ...patch,
      },
    }));
  }

  async function saveLibrarySettings(libraryId: number) {
    const current = settingsForms[libraryId];
    if (!current) {
      return;
    }
    try {
      await api.updateLibrarySettings(libraryId, {
        scan_mode: current.scan_mode,
        scan_config:
          current.scan_mode === "scheduled"
            ? { interval_minutes: current.interval_minutes }
            : current.scan_mode === "watch"
              ? { debounce_seconds: current.debounce_seconds }
              : {},
      });
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: "Settings saved." }));
      loadLibraries();
    } catch (reason) {
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
    }
  }

  async function runLibraryScan(libraryId: number, scanType: "incremental" | "full" = "incremental") {
    try {
      await api.scanLibrary(libraryId, scanType);
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: null }));
      await refresh();
      loadLibraries();
    } catch (reason) {
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
    }
  }

  return (
    <>
      <AsyncPanel title="Configured libraries" loading={!libraries.length && !error} error={error}>
        <div className="listing">
          {libraries.map((library) => (
            <div className="media-card library-settings-card" key={library.id}>
              <div className="library-settings-header">
                <div className="item-meta">
                  <div className="meta-tags">
                    <span className="badge">{library.type}</span>
                    <span className="badge">{library.scan_mode}</span>
                    {activeJobs
                      .filter((job) => job.library_id === library.id)
                      .map((job) => (
                        <span className="badge scan-badge" key={job.id}>
                          {job.files_total > 0 ? `${job.progress_percent}%` : "active"}
                        </span>
                      ))}
                  </div>
                  <h3>
                    <Link to={`/libraries/${library.id}`} className="file-link">
                      {library.name}
                    </Link>
                  </h3>
                  <p className="media-meta">{library.path}</p>
                </div>
                <div className="library-stats">
                  <span>{library.file_count} files</span>
                  <span>{formatBytes(library.total_size_bytes)}</span>
                  <span>{formatDuration(library.total_duration_seconds)}</span>
                  <span>Last scan: {formatDate(library.last_scan_at)}</span>
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
              <form
                className="library-settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveLibrarySettings(library.id);
                }}
              >
                <div className="field">
                  <label htmlFor={`scan-mode-${library.id}`}>Mode</label>
                  <select
                    id={`scan-mode-${library.id}`}
                    value={settingsForms[library.id]?.scan_mode ?? library.scan_mode}
                    onChange={(event) =>
                      updateLibraryForm(library.id, { scan_mode: event.target.value })
                    }
                  >
                    <option value="manual">manual</option>
                    <option value="scheduled">scheduled</option>
                    <option value="watch">watch</option>
                  </select>
                </div>
                {(settingsForms[library.id]?.scan_mode ?? library.scan_mode) === "scheduled" ? (
                  <div className="field">
                    <label htmlFor={`interval-minutes-${library.id}`}>Interval in minutes</label>
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
                    <label htmlFor={`debounce-seconds-${library.id}`}>Debounce in seconds</label>
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
                <div className="library-settings-actions">
                  {libraryMessages[library.id] ? <div className="alert success">{libraryMessages[library.id]}</div> : null}
                  <div className="toolbar">
                    <button type="submit" className="secondary small">
                      Save settings
                    </button>
                    <button
                      type="button"
                      className="small"
                      onClick={() => void runLibraryScan(library.id, "incremental")}
                    >
                      Scan now
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => void runLibraryScan(library.id, "full")}
                    >
                      Full scan
                    </button>
                  </div>
                </div>
              </form>
            </div>
          ))}
        </div>
      </AsyncPanel>

      <AsyncPanel
        title="Create library"
        subtitle="Path selection is restricted to directories below MEDIA_ROOT."
        error={submitError}
      >
        <form className="form-grid" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="library-name">Name</label>
            <input
              id="library-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Movies archive"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="library-type">Library type</label>
            <select
              id="library-type"
              value={form.type}
              onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
            >
              <option value="movies">movies</option>
              <option value="series">series</option>
              <option value="mixed">mixed</option>
              <option value="other">other</option>
            </select>
          </div>
          <PathBrowser
            value={form.path}
            onChange={(path) => setForm((current) => ({ ...current, path }))}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create library"}
          </button>
        </form>
      </AsyncPanel>
    </>
  );
}
