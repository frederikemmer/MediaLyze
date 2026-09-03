import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { api, type LibrarySummary, type TranscodeJob } from "../lib/api";
import { formatDate } from "../lib/format";

export function TranscodeHistorySettingsPanel({ libraries }: { libraries: LibrarySummary[] }) {
  const { t } = useTranslation();
  const [libraryId, setLibraryId] = useState("");
  const [status, setStatus] = useState<"" | TranscodeJob["status"]>("");
  const [startedAfter, setStartedAfter] = useState("");
  const [startedBefore, setStartedBefore] = useState("");
  const [jobs, setJobs] = useState<TranscodeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.transcodeJobs({
      libraryId: libraryId ? Number(libraryId) : undefined,
      status: status || undefined,
      startedAfter: startedAfter ? new Date(startedAfter).toISOString() : undefined,
      startedBefore: startedBefore ? new Date(startedBefore).toISOString() : undefined,
      limit: 200,
    }).then((payload) => {
      setJobs(payload.items);
      setError(null);
    }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [libraryId, startedAfter, startedBefore, status]);

  return (
    <section className="global-transcode-history">
      <div>
        <h3>{t("transcoding.globalHistory")}</h3>
        <p className="field-hint">{t("transcoding.globalHistoryHint")}</p>
      </div>
      <div className="global-transcode-history-filters">
        <label><span>{t("transcoding.filters.library")}</span><select value={libraryId} onChange={(event) => setLibraryId(event.target.value)}><option value="">{t("common.all")}</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
        <label><span>{t("transcoding.filters.status")}</span><select value={status} onChange={(event) => setStatus(event.target.value as "" | TranscodeJob["status"])}><option value="">{t("common.all")}</option>{(["queued", "running", "completed", "canceled", "failed"] as const).map((value) => <option key={value} value={value}>{t(`transcoding.status.${value}`)}</option>)}</select></label>
        <label><span>{t("transcoding.filters.from")}</span><input type="datetime-local" value={startedAfter} onChange={(event) => setStartedAfter(event.target.value)} /></label>
        <label><span>{t("transcoding.filters.to")}</span><input type="datetime-local" value={startedBefore} onChange={(event) => setStartedBefore(event.target.value)} /></label>
      </div>
      {loading ? <p className="field-hint">{t("panel.loading")}</p> : null}
      {error ? <p className="notice error">{error}</p> : null}
      {!loading && !jobs.length ? <p className="field-hint">{t("transcoding.history.empty")}</p> : null}
      <div className="transcode-history-list">
        {jobs.map((job) => (
          <details key={job.id} className="file-history-entry">
            <summary className="file-history-entry-head"><strong>{job.output_relative_path}</strong><span className={`badge transcode-status-${job.status}`}>{t(`transcoding.status.${job.status}`)}</span><span>{formatDate(job.created_at)}</span></summary>
            <div className="transcode-job-detail">
              <dl>
                <div><dt>{t("transcoding.sourcePath")}</dt><dd><code>{job.source_path_snapshot}</code></dd></div>
                <div><dt>{t("transcoding.outputPath")}</dt><dd><code>{job.output_path_snapshot}</code></dd></div>
                <div><dt>{t("transcoding.device")}</dt><dd>{job.device_id ?? "—"}</dd></div>
                <div><dt>{t("transcoding.hardwareBackend")}</dt><dd>{job.hardware_backend ?? "—"}</dd></div>
                <div><dt>{t("transcoding.ffmpegVersion")}</dt><dd>{job.ffmpeg_version ?? "—"}</dd></div>
                <div><dt>{t("transcoding.threads")}</dt><dd>{job.cpu_thread_budget ?? "—"}</dd></div>
                <div><dt>{t("transcoding.progress")}</dt><dd>{Math.round(job.progress_percent)}%</dd></div>
                <div><dt>{t("transcoding.speed")}</dt><dd>{job.speed ?? "—"}</dd></div>
                <div><dt>{t("transcoding.etaLabel")}</dt><dd>{job.eta_seconds != null ? t("transcoding.eta", { seconds: Math.ceil(job.eta_seconds) }) : "—"}</dd></div>
                <div><dt>{t("transcoding.retryAttempts")}</dt><dd>{job.attempt ?? 0} / {job.retry_count ?? 0}</dd></div>
              </dl>
              <code>{job.ffmpeg_command}</code>
              {job.warnings.length ? <ul>{job.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
              {job.error ? <p className="notice error">{job.error}</p> : null}
              <pre className="json-preview">{JSON.stringify(job.plan, null, 2)}</pre>
              <div className="transcode-job-links">
                {job.source_file_id ? <Link to={`/files/${job.source_file_id}`}>{t("transcoding.openSource")}</Link> : null}
                {job.result_file_id ? <Link to={`/files/${job.result_file_id}`}>{t("transcoding.openVariant")}</Link> : null}
                {job.source_file_id && job.result_file_id ? <Link to={`/files/compare?left=${job.source_file_id}&right=${job.result_file_id}`}>{t("transcoding.openComparison")}</Link> : null}
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
