import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Layers3,
  List,
  Search,
  Server,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDuration } from "../lib/format";
import {
  groupPlaybackEntries,
  type PlaybackDisplayEntry,
  type PlaybackHistoryEntry,
  type PlaybackUndatedEntry,
} from "../lib/playback-history";
import {
  HistoryRangeToggle,
  type HistoryRangeSelection,
} from "./LibraryHistoryPanel";
import { SlidingTogglePill } from "./SlidingTogglePill";
import { TooltipTrigger } from "./TooltipTrigger";

export type { PlaybackHistoryEntry, PlaybackUndatedEntry } from "../lib/playback-history";

const USER_COLORS = ["#f05f2a", "#277a65", "#4f78c7", "#9a5cc2", "#9aaf1a", "#d48b20"];
const PAGE_SIZE = 8;
const RANGE_STORAGE_KEY = "medialyze-file-streaming-range-selection";
const EMPTY_UNDATED_ENTRIES: PlaybackUndatedEntry[] = [];

type PlaybackDisplayMode = "individual" | "grouped";

function dateKey(value: Date): string {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateKey(value: string | undefined, endOfDay = false): number | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
}

function readRangeSelection(): HistoryRangeSelection {
  if (typeof window === "undefined") return { mode: "all" };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RANGE_STORAGE_KEY) ?? "null");
    if (!["7d", "30d", "1y", "all", "custom"].includes(parsed?.mode)) {
      return { mode: "all" };
    }
    return {
      mode: parsed.mode,
      startDate: typeof parsed.startDate === "string" ? parsed.startDate : undefined,
      endDate: typeof parsed.endDate === "string" ? parsed.endDate : undefined,
    };
  } catch {
    return { mode: "all" };
  }
}

function rangeBounds(
  entries: PlaybackHistoryEntry[],
  selection: HistoryRangeSelection,
  individualPlaybackHistoryStartAt?: string | null,
): [number, number] | null {
  const timestamps = entries
    .map((entry) => Date.parse(entry.lastPlayedAt))
    .filter(Number.isFinite);
  if (!timestamps.length) return null;
  const individualHistoryStart = Date.parse(individualPlaybackHistoryStartAt ?? "");
  const earliest = Math.min(
    ...timestamps,
    ...(Number.isFinite(individualHistoryStart) ? [individualHistoryStart] : []),
  );
  const latest = Math.max(...timestamps);
  if (selection.mode === "all") {
    return earliest === latest
      ? [earliest - 12 * 60 * 60 * 1000, latest + 12 * 60 * 60 * 1000]
      : [earliest, latest];
  }
  if (selection.mode === "custom") {
    const start = parseDateKey(selection.startDate);
    const end = parseDateKey(selection.endDate ?? selection.startDate, true);
    if (start === null || end === null) return [earliest, latest];
    return start <= end ? [start, end] : [end, start];
  }
  const days = selection.mode === "7d" ? 7 : selection.mode === "30d" ? 30 : 365;
  return [latest - (days - 1) * 24 * 60 * 60 * 1000, latest];
}

function formatTimestamp(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatTimelineLabel(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function PlaybackHistoryPanel({
  entries: sourceEntries,
  undatedEntries: sourceUndatedEntries = EMPTY_UNDATED_ENTRIES,
  durationSeconds,
  individualEventsAvailable = true,
  individualPlaybackHistoryStartAt,
  showAllWhenUnstacked = false,
  showProvider = true,
}: {
  entries: PlaybackHistoryEntry[];
  undatedEntries?: PlaybackUndatedEntry[];
  durationSeconds?: number | null;
  individualEventsAvailable?: boolean;
  individualPlaybackHistoryStartAt?: string | null;
  showAllWhenUnstacked?: boolean;
  showProvider?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const entries = useMemo<PlaybackHistoryEntry[]>(
    () =>
      sourceEntries
        .filter((entry) => entry.playCount > 0 && Number.isFinite(Date.parse(entry.lastPlayedAt)))
        .slice()
        .sort((left, right) => Date.parse(right.lastPlayedAt) - Date.parse(left.lastPlayedAt)),
    [sourceEntries],
  );
  const undatedEntries = useMemo(
    () => sourceUndatedEntries.filter((entry) => entry.playCount > 0),
    [sourceUndatedEntries],
  );
  const users = useMemo(
    () => Array.from(
      new Map(
        [...entries, ...undatedEntries].map((entry) => [
          `${entry.provider}:${entry.userId}`,
          entry,
        ]),
      ).values(),
    ),
    [entries, undatedEntries],
  );
  const providers = useMemo(
    () => [...new Set([...entries, ...undatedEntries].map((entry) => entry.provider))],
    [entries, undatedEntries],
  );
  const [rangeSelection, setRangeSelection] = useState<HistoryRangeSelection>(readRangeSelection);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(
    () => new Set(
      [...entries, ...undatedEntries].map((entry) => `${entry.provider}:${entry.userId}`),
    ),
  );
  const [selectedProvider, setSelectedProvider] = useState("all");
  const [displayMode, setDisplayMode] = useState<PlaybackDisplayMode>("individual");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const [page, setPage] = useState(0);
  const knownUserKeysRef = useRef(
    new Set([...entries, ...undatedEntries].map((entry) => `${entry.provider}:${entry.userId}`)),
  );

  useEffect(() => {
    const nextUserKeys = new Set(users.map((user) => `${user.provider}:${user.userId}`));
    setSelectedUsers((current) => {
      const next = new Set([...current].filter((id) => nextUserKeys.has(id)));
      nextUserKeys.forEach((id) => {
        if (!knownUserKeysRef.current.has(id)) next.add(id);
      });
      return next;
    });
    knownUserKeysRef.current = nextUserKeys;
  }, [users]);

  const bounds = useMemo(
    () => rangeBounds(entries, rangeSelection, individualPlaybackHistoryStartAt),
    [entries, individualPlaybackHistoryStartAt, rangeSelection],
  );
  const individualHistoryStartTimestamp = useMemo(() => {
    const timestamp = Date.parse(individualPlaybackHistoryStartAt ?? "");
    return Number.isFinite(timestamp) ? timestamp : null;
  }, [individualPlaybackHistoryStartAt]);
  const filteredSourceEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase(i18n.language);
    return entries.filter((entry) => {
      const timestamp = Date.parse(entry.lastPlayedAt);
      const userKey = `${entry.provider}:${entry.userId}`;
      return (
        selectedUsers.has(userKey)
        && (selectedProvider === "all" || entry.provider === selectedProvider)
        && (!bounds || (timestamp >= bounds[0] && timestamp <= bounds[1]))
        && (!normalizedSearch
          || entry.userName.toLocaleLowerCase(i18n.language).includes(normalizedSearch)
          || entry.provider.toLocaleLowerCase(i18n.language).includes(normalizedSearch))
      );
    });
  }, [bounds, entries, i18n.language, search, selectedProvider, selectedUsers]);
  const filteredUndatedEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase(i18n.language);
    return undatedEntries.filter((entry) => {
      const userKey = `${entry.provider}:${entry.userId}`;
      return (
        selectedUsers.has(userKey)
        && (selectedProvider === "all" || entry.provider === selectedProvider)
        && (!normalizedSearch
          || entry.userName.toLocaleLowerCase(i18n.language).includes(normalizedSearch)
          || entry.provider.toLocaleLowerCase(i18n.language).includes(normalizedSearch))
      );
    });
  }, [i18n.language, search, selectedProvider, selectedUsers, undatedEntries]);
  const filteredEntries = useMemo<PlaybackDisplayEntry[]>(
    () =>
      displayMode === "grouped"
        ? groupPlaybackEntries(filteredSourceEntries, durationSeconds)
        : filteredSourceEntries.map((entry) => ({
            ...entry,
            eventCount: 1,
            firstPlayedAt: entry.lastPlayedAt,
          })),
    [displayMode, durationSeconds, filteredSourceEntries],
  );
  const effectivePageSize =
    showAllWhenUnstacked && displayMode === "individual"
      ? Math.max(1, filteredEntries.length)
      : PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / effectivePageSize));
  const visibleEntries = filteredEntries.slice(
    page * effectivePageSize,
    (page + 1) * effectivePageSize,
  );
  const selectedEntry = selectedId === null
    ? null
    : filteredEntries.find((entry) => entry.id === selectedId) ?? filteredEntries[0] ?? null;
  const minimumDate = entries.length
    ? dateKey(new Date(Math.min(
        ...entries.map((entry) => Date.parse(entry.lastPlayedAt)),
        ...(individualHistoryStartTimestamp !== null ? [individualHistoryStartTimestamp] : []),
      )))
    : null;
  const maximumDate = entries.length ? dateKey(new Date(Math.max(...entries.map((entry) => Date.parse(entry.lastPlayedAt))))) : null;
  const individualHistoryBoundaryPosition =
    individualHistoryStartTimestamp !== null && bounds && bounds[1] > bounds[0]
      ? ((individualHistoryStartTimestamp - bounds[0]) / (bounds[1] - bounds[0])) * 100
      : null;
  const individualHistoryBoundaryVisible =
    individualHistoryBoundaryPosition !== null
    && individualHistoryBoundaryPosition >= 0
    && individualHistoryBoundaryPosition <= 100;
  const timestampedPlaybackCount = entries.reduce((total, entry) => total + entry.playCount, 0);
  const undatedPlaybackCount = undatedEntries.reduce((total, entry) => total + entry.playCount, 0);
  const totalPlaybackCount = timestampedPlaybackCount + undatedPlaybackCount;
  const filteredUndatedPlaybackCount = filteredUndatedEntries.reduce(
    (total, entry) => total + entry.playCount,
    0,
  );
  const hasResumePosition = filteredEntries.some(
    (entry) => (entry.resumePositionSeconds ?? 0) > 0 && !entry.completed,
  );
  const hasCompletionState = filteredEntries.some((entry) => entry.completed != null);

  useEffect(() => {
    setPage(0);
  }, [displayMode, rangeSelection, search, selectedProvider, selectedUsers]);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  function updateRangeSelection(next: HistoryRangeSelection) {
    setRangeSelection(next);
    window.localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(next));
  }

  function toggleUser(userKey: string) {
    setSelectedUsers((current) => {
      const next = new Set(current);
      if (next.has(userKey)) next.delete(userKey);
      else next.add(userKey);
      return next;
    });
  }

  function exportCsv() {
    const rows = [
      [
        t("jellyfin.playbackHistory.lastPlayback"),
        t("jellyfin.playbackHistory.user"),
        t("jellyfin.playbackHistory.provider"),
        t("jellyfin.playbackHistory.plays"),
        ...(hasCompletionState ? [t("jellyfin.playbackHistory.state")] : []),
        ...(hasResumePosition ? [t("jellyfin.playbackHistory.resumePosition")] : []),
      ],
      ...filteredEntries.map((entry) => [
        entry.lastPlayedAt,
        entry.userName,
        entry.provider,
        entry.playCount,
        ...(hasCompletionState
          ? [
              entry.completed == null
                ? ""
                : entry.completed
                  ? t("jellyfin.playbackHistory.completed")
                  : t("jellyfin.playbackHistory.notCompleted"),
            ]
          : []),
        ...(hasResumePosition
          ? [
              (entry.resumePositionSeconds ?? 0) > 0
                ? formatDuration(entry.resumePositionSeconds ?? 0)
                : "",
            ]
          : []),
      ]),
      ...filteredUndatedEntries.map((entry) => [
        t("jellyfin.playbackHistory.unknownTimestamp"),
        entry.userName,
        entry.provider,
        entry.playCount,
        ...(hasCompletionState ? [""] : []),
        ...(hasResumePosition ? [""] : []),
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "medialyze-playback-summary.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!entries.length && !undatedEntries.length) {
    return <div className="notice">{t("jellyfin.noPlaybackData")}</div>;
  }

  return (
    <div className="playback-history">
      <div className="playback-history-controls">
        <div className="playback-history-control-block">
          <span className="playback-history-control-label">{t("jellyfin.playbackHistory.range")}</span>
          <HistoryRangeToggle
            selection={rangeSelection}
            onChange={updateRangeSelection}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            defaultStartDate={bounds ? dateKey(new Date(bounds[0])) : minimumDate}
            defaultEndDate={bounds ? dateKey(new Date(bounds[1])) : maximumDate}
            ariaLabel={t("jellyfin.playbackHistory.range")}
          />
        </div>
        {showProvider && providers.length > 1 ? (
          <label className="playback-history-provider-filter">
            <span className="playback-history-control-label">{t("jellyfin.playbackHistory.provider")}</span>
            <select className="settings-choice-input" value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)}>
              <option value="all">{t("jellyfin.playbackHistory.allProviders")}</option>
              {providers.map((provider) => <option key={provider}>{provider}</option>)}
            </select>
          </label>
        ) : null}
        <div className="playback-history-control-block playback-history-display-control">
          <span className="playback-history-display-heading">
            <span className="playback-history-control-label">
              {t("jellyfin.playbackHistory.stacking")}
            </span>
            <TooltipTrigger
              ariaLabel={t("jellyfin.playbackHistory.stackingTooltipAria")}
              content={t(
                individualEventsAvailable
                  ? "jellyfin.playbackHistory.stackingTooltip"
                  : "jellyfin.playbackHistory.stackingUnavailableTooltip",
              )}
              preserveLineBreaks
            >
              <Info aria-hidden="true" />
            </TooltipTrigger>
          </span>
          <div
            className="library-history-range-toggle playback-history-display-toggle"
            role="group"
            aria-label={t("jellyfin.playbackHistory.displayMode")}
          >
            <SlidingTogglePill
              activeKey={displayMode}
              className="nav-active-pill library-history-range-pill"
            />
            <TooltipTrigger
              dataToggleKey="individual"
              className={`library-history-range-button playback-history-display-button${displayMode === "individual" ? " active" : ""}`}
              ariaLabel={t("jellyfin.playbackHistory.showIndividual")}
              content={t(
                individualEventsAvailable
                  ? "jellyfin.playbackHistory.showIndividualTooltip"
                  : "jellyfin.playbackHistory.availableTimestamps",
              )}
              ariaPressed={displayMode === "individual"}
              pinOnClick={false}
              onClick={() => setDisplayMode("individual")}
            >
              <List aria-hidden="true" />
            </TooltipTrigger>
            <TooltipTrigger
              dataToggleKey="grouped"
              className={`library-history-range-button playback-history-display-button${displayMode === "grouped" ? " active" : ""}`}
              ariaLabel={t("jellyfin.playbackHistory.groupNearby")}
              content={t(
                individualEventsAvailable
                  ? "jellyfin.playbackHistory.groupNearbyTooltip"
                  : "jellyfin.playbackHistory.groupUnavailable",
              )}
              ariaPressed={displayMode === "grouped"}
              pinOnClick={false}
              onClick={() => setDisplayMode("grouped")}
            >
              <Layers3 aria-hidden="true" />
            </TooltipTrigger>
          </div>
        </div>
        <div className="playback-history-users">
          <span className="playback-history-control-label">{t("jellyfin.playbackHistory.users")}</span>
          <div className="playback-history-user-list">
            {users.map((user, index) => {
              const userKey = `${user.provider}:${user.userId}`;
              const active = selectedUsers.has(userKey);
              return (
                <button
                  key={userKey}
                  type="button"
                  className={`playback-history-user${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => toggleUser(userKey)}
                >
                  <span
                    className="playback-history-user-dot"
                    style={{ "--playback-user-color": USER_COLORS[index % USER_COLORS.length] } as CSSProperties}
                  />
                  <span>{user.userName}</span>
                  {showProvider && providers.length > 1 ? <small>{user.provider}</small> : null}
                  <span className="playback-history-user-check">{active ? "✓" : ""}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p className="playback-history-scope-note">
        {t(
          individualEventsAvailable
            ? "jellyfin.playbackHistory.scopeNote"
            : "jellyfin.playbackHistory.aggregateScopeNote",
        )}
      </p>
      <p className="playback-history-data-summary">
        {t("jellyfin.playbackHistory.coverageSummary", {
          timestamped: timestampedPlaybackCount,
          total: totalPlaybackCount,
          undated: undatedPlaybackCount,
        })}
      </p>

      <div className={`playback-history-layout${selectedEntry ? " has-detail" : ""}`}>
        <div className="playback-history-main">
          {entries.length ? (
            <section className="playback-history-timeline" aria-label={t("jellyfin.playbackHistory.timeline")}>
              <div className="playback-history-timeline-axis" aria-hidden="true">
                <span>{bounds ? formatTimelineLabel(bounds[0], i18n.language) : "—"}</span>
                <span>{bounds ? formatTimelineLabel(bounds[1], i18n.language) : "—"}</span>
              </div>
              <div className="playback-history-timeline-track">
                <span className="playback-history-timeline-line" />
                {individualHistoryBoundaryVisible ? (
                  <span
                    className="playback-history-availability-boundary"
                    style={{
                      "--playback-history-boundary-position": `${individualHistoryBoundaryPosition}%`,
                    } as CSSProperties}
                    aria-hidden="true"
                  />
                ) : null}
                {filteredEntries.map((entry) => {
                  const userIndex = users.findIndex(
                    (user) => user.provider === entry.provider && user.userId === entry.userId,
                  );
                  const timestamp = Date.parse(entry.lastPlayedAt);
                  const position = bounds && bounds[1] > bounds[0]
                    ? ((timestamp - bounds[0]) / (bounds[1] - bounds[0])) * 100
                    : 50;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={[
                        "playback-history-timeline-event",
                        entry.eventCount > 1 ? "is-cluster" : "",
                        selectedEntry?.id === entry.id ? "is-selected" : "",
                      ].filter(Boolean).join(" ")}
                      data-event-count={entry.eventCount}
                      style={{
                        "--playback-event-position": `${Math.max(0, Math.min(100, position))}%`,
                        "--playback-user-color": USER_COLORS[userIndex % USER_COLORS.length],
                      } as CSSProperties}
                      aria-label={
                        entry.eventCount > 1
                          ? t("jellyfin.playbackHistory.groupedEventLabel", {
                              user: entry.userName,
                              count: entry.eventCount,
                              start: formatTimestamp(entry.firstPlayedAt, i18n.language),
                              end: formatTimestamp(entry.lastPlayedAt, i18n.language),
                            })
                          : `${entry.userName}, ${formatTimestamp(entry.lastPlayedAt, i18n.language)}`
                      }
                      title={`${entry.userName} · ${formatTimestamp(entry.lastPlayedAt, i18n.language)}`}
                      onClick={() => setSelectedId(entry.id)}
                    />
                  );
                })}
              </div>
              {individualHistoryStartTimestamp !== null ? (
                <p className="playback-history-availability-note">
                  <span className="playback-history-availability-key" aria-hidden="true" />
                  {t("jellyfin.playbackHistory.individualHistoryFrom", {
                    date: formatTimestamp(
                      individualPlaybackHistoryStartAt as string,
                      i18n.language,
                    ),
                  })}
                </p>
              ) : null}
            </section>
          ) : (
            <div className="notice playback-history-no-timestamps">
              {t("jellyfin.playbackHistory.noTimestampedPlaybacks")}
            </div>
          )}

          <div className="playback-history-table-toolbar">
            <label className="playback-history-search">
              <Search aria-hidden="true" />
              <span className="sr-only">{t("jellyfin.playbackHistory.search")}</span>
              <input
                type="search"
                value={search}
                placeholder={t("jellyfin.playbackHistory.search")}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <span className="playback-history-result-count">
              {t(
                displayMode === "grouped"
                  ? "jellyfin.playbackHistory.groupCount"
                  : "jellyfin.playbackHistory.latestCount",
                { count: filteredEntries.length },
              )}
            </span>
            <button
              type="button"
              className="secondary small playback-history-export-button"
              disabled={!filteredEntries.length && !filteredUndatedEntries.length}
              onClick={exportCsv}
            >
              {t("jellyfin.playbackHistory.export")}
            </button>
          </div>

          {visibleEntries.length ? (
            <div className="playback-history-table-scroll">
              <table className="playback-history-table">
                <thead>
                  <tr>
                    <th>{t("jellyfin.playbackHistory.lastPlayback")}</th>
                    <th>{t("jellyfin.playbackHistory.user")}</th>
                    {showProvider ? <th>{t("jellyfin.playbackHistory.provider")}</th> : null}
                    <th>{t("jellyfin.playbackHistory.plays")}</th>
                    {hasCompletionState ? <th>{t("jellyfin.playbackHistory.state")}</th> : null}
                    {hasResumePosition ? <th>{t("jellyfin.playbackHistory.resumePosition")}</th> : null}
                    <th><span className="sr-only">{t("jellyfin.playbackHistory.openDetail")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((entry) => {
                    const userIndex = users.findIndex(
                      (user) => user.provider === entry.provider && user.userId === entry.userId,
                    );
                    return (
                      <tr
                        key={entry.id}
                        className={selectedEntry?.id === entry.id ? "is-selected" : ""}
                        onClick={() => setSelectedId(entry.id)}
                      >
                        <td>
                          <span className="playback-history-timestamp">
                            <span
                              className="playback-history-table-dot"
                              style={{ "--playback-user-color": USER_COLORS[userIndex % USER_COLORS.length] } as CSSProperties}
                            />
                            {formatTimestamp(entry.lastPlayedAt, i18n.language)}
                          </span>
                        </td>
                        <td>{entry.userName}</td>
                        {showProvider ? <td><span className="playback-history-provider"><Server aria-hidden="true" />{entry.provider}</span></td> : null}
                        <td>{entry.playCount}</td>
                        {hasCompletionState ? (
                          <td>
                            {entry.completed == null ? "—" : (
                              <span className={`playback-history-state${entry.completed ? " is-complete" : ""}`}>
                                {entry.completed ? <CheckCircle2 aria-hidden="true" /> : <span className="playback-history-state-box" />}
                                {entry.completed
                                  ? t("jellyfin.playbackHistory.completed")
                                  : t("jellyfin.playbackHistory.notCompleted")}
                              </span>
                            )}
                          </td>
                        ) : null}
                        {hasResumePosition ? (
                          <td>
                            {(entry.resumePositionSeconds ?? 0) > 0 && !entry.completed
                              ? formatDuration(entry.resumePositionSeconds ?? 0)
                              : "—"}
                          </td>
                        ) : null}
                        <td><ChevronRight aria-hidden="true" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="notice">
              {t("jellyfin.playbackHistory.noTimestampedResults")}
            </div>
          )}

          {pageCount > 1 ? (
            <div className="playback-history-pagination">
              <button
                type="button"
                className="secondary icon-only-button"
                aria-label={t("jellyfin.playbackHistory.previous")}
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <span>{t("jellyfin.playbackHistory.page", { current: page + 1, total: pageCount })}</span>
              <button
                type="button"
                className="secondary icon-only-button"
                aria-label={t("jellyfin.playbackHistory.next")}
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((current) => current + 1)}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {filteredUndatedEntries.length ? (
            <section
              className="playback-history-undated"
              aria-labelledby="playback-history-undated-title"
            >
              <div className="playback-history-undated-header">
                <div>
                  <h3 id="playback-history-undated-title">
                    {t("jellyfin.playbackHistory.unknownTimeTitle")}
                  </h3>
                  <p>{t("jellyfin.playbackHistory.unknownTimeDescription")}</p>
                </div>
                <span>
                  {t("jellyfin.playbackHistory.unknownPlayCount", {
                    count: filteredUndatedPlaybackCount,
                  })}
                </span>
              </div>
              <ul className="playback-history-undated-list">
                {filteredUndatedEntries.map((entry) => {
                  const userIndex = users.findIndex(
                    (user) => user.provider === entry.provider && user.userId === entry.userId,
                  );
                  return (
                    <li key={entry.id}>
                      <span
                        className="playback-history-table-dot"
                        style={{
                          "--playback-user-color": USER_COLORS[userIndex % USER_COLORS.length],
                        } as CSSProperties}
                      />
                      <strong>{entry.userName}</strong>
                      {showProvider ? <span className="playback-history-provider">
                        <Server aria-hidden="true" />
                        {entry.provider}
                      </span> : null}
                      <span className="playback-history-undated-count">
                        {t("jellyfin.playbackHistory.unknownPlayCount", {
                          count: entry.playCount,
                        })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        {selectedEntry ? (
          <aside className="playback-history-detail" aria-label={t("jellyfin.playbackHistory.detail")}>
            <div className="playback-history-detail-header">
              <div>
                <span className="playback-history-control-label">{t("jellyfin.playbackHistory.detail")}</span>
                <h3>{selectedEntry.userName}</h3>
              </div>
              <button
                type="button"
                className="secondary icon-only-button async-panel-toggle-icon-button-flat"
                aria-label={t("common.close")}
                onClick={() => setSelectedId(null)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <dl className="playback-history-detail-list">
              <div>
                <dt>{t("jellyfin.playbackHistory.lastPlayback")}</dt>
                <dd>{formatTimestamp(selectedEntry.lastPlayedAt, i18n.language)}</dd>
              </div>
              {showProvider ? <div>
                <dt>{t("jellyfin.playbackHistory.provider")}</dt>
                <dd><span className="playback-history-provider"><Server aria-hidden="true" />{selectedEntry.provider}</span></dd>
              </div> : null}
              <div>
                <dt>{t("jellyfin.playbackHistory.plays")}</dt>
                <dd>{selectedEntry.playCount}</dd>
              </div>
              {selectedEntry.completed != null ? (
                <div>
                  <dt>{t("jellyfin.playbackHistory.state")}</dt>
                  <dd>
                    {selectedEntry.completed
                      ? t("jellyfin.playbackHistory.completed")
                      : t("jellyfin.playbackHistory.notCompleted")}
                  </dd>
                </div>
              ) : null}
              {(selectedEntry.resumePositionSeconds ?? 0) > 0 && !selectedEntry.completed ? (
                <div>
                  <dt>{t("jellyfin.playbackHistory.resumePosition")}</dt>
                  <dd>{formatDuration(selectedEntry.resumePositionSeconds ?? 0)}</dd>
                  {durationSeconds && durationSeconds > 0 ? (
                    <span className="playback-history-progress">
                      <span
                        style={{
                          width: `${Math.min(
                            100,
                            ((selectedEntry.resumePositionSeconds ?? 0) / durationSeconds) * 100,
                          )}%`,
                        }}
                      />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </dl>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
