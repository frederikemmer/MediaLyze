import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AsyncPanel } from "../components/AsyncPanel";
import { LoaderPinwheelIcon } from "../components/LoaderPinwheelIcon";
import { StatCard } from "../components/StatCard";
import { api, type MediaSeriesDetail } from "../lib/api";
import { formatBytes, formatDate, formatDuration } from "../lib/format";

export function SeriesDetailPage() {
  const { libraryId = "", seriesId = "" } = useParams();
  const { t } = useTranslation();
  const [detail, setDetail] = useState<MediaSeriesDetail | null>(null);
  const [expandedSeasonIds, setExpandedSeasonIds] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api
      .librarySeriesDetail(libraryId, seriesId, controller.signal)
      .then((payload) => {
        setDetail(payload);
        setExpandedSeasonIds(Object.fromEntries(payload.seasons.map((season) => [season.id, true])));
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") {
          setError(reason.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [libraryId, seriesId]);

  if (loading && !detail) {
    return (
      <div className="panel-loader">
        <LoaderPinwheelIcon className="panel-loader-icon" size={30} />
        <span>{t("libraryDetail.series.loading")}</span>
      </div>
    );
  }

  return (
    <>
      <section className="panel stack">
        <div className="panel-title-row">
          <h2>{detail?.title ?? t("libraryDetail.series.title")}</h2>
          <Link to={`/libraries/${libraryId}`} className="secondary">
            {t("libraryDetail.series.backToLibrary")}
          </Link>
        </div>
        {detail ? (
          <div className="card-grid grid">
            <StatCard label={t("libraryDetail.series.seasons")} value={String(detail.season_count)} />
            <StatCard label={t("libraryDetail.series.episodes")} value={String(detail.episode_count)} />
            <StatCard label={t("libraryDetail.storage")} value={formatBytes(detail.total_size_bytes)} tone="teal" />
            <StatCard label={t("libraryDetail.duration")} value={formatDuration(detail.total_duration_seconds)} tone="blue" />
            <StatCard label={t("libraryDetail.lastScan")} value={formatDate(detail.last_analyzed_at)} />
          </div>
        ) : null}
        {error ? <div className="notice">{error}</div> : null}
      </section>

      <AsyncPanel title={t("libraryDetail.series.seasons")} error={error}>
        {detail ? (
          <div className="duplicate-group-list">
            {detail.seasons.map((season) => {
              const expanded = Boolean(expandedSeasonIds[season.id]);
              return (
                <div className="media-card duplicate-group-card" key={season.id}>
                  <button
                    type="button"
                    className="scan-log-summary"
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedSeasonIds((current) => ({ ...current, [season.id]: !current[season.id] }))
                    }
                  >
                    <div className="scan-log-summary-head">
                      <div className="scan-log-summary-copy">
                        <strong>{season.title}</strong>
                        <span>{season.relative_path}</span>
                      </div>
                      <div className="meta-tags">
                        <span className="badge">{season.episode_count}</span>
                        <span className="badge">{formatBytes(season.total_size_bytes)}</span>
                        {expanded ? <ChevronDown aria-hidden="true" className="nav-icon" /> : <ChevronRight aria-hidden="true" className="nav-icon" />}
                      </div>
                    </div>
                  </button>
                  {expanded ? (
                    <div className="scan-log-path-list duplicate-group-items-scroll">
                      {season.episodes.map((episode) => (
                        <div className="scan-log-pattern-card" key={episode.id}>
                          <div className="scan-log-detail-title">
                            <Link to={`/files/${episode.id}`} className="file-link">
                              {episode.episode_number
                                ? `E${String(episode.episode_number).padStart(2, "0")} ${episode.episode_title ?? episode.filename}`
                                : episode.filename}
                            </Link>
                            <span className="badge">{formatBytes(episode.size_bytes)}</span>
                          </div>
                          <code className="scan-log-path">{episode.relative_path}</code>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </AsyncPanel>
    </>
  );
}
