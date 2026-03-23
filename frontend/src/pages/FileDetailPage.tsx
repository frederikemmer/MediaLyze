import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { AsyncPanel } from "../components/AsyncPanel";
import { PathSegmentTrail } from "../components/PathSegmentTrail";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { useAppData } from "../lib/app-data";
import { api, type MediaFileDetail, type MediaFileQualityScoreDetail } from "../lib/api";
import { formatBytes, formatCodecLabel, formatDuration } from "../lib/format";
import { formatHdrType } from "../lib/hdr";

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

export function FileDetailPage() {
  const { t } = useTranslation();
  const { fileId = "" } = useParams();
  const { appSettings } = useAppData();
  const [file, setFile] = useState<MediaFileDetail | null>(null);
  const [qualityDetail, setQualityDetail] = useState<MediaFileQualityScoreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showDolbyVisionProfiles = appSettings.feature_flags.show_dolby_vision_profiles;

  useEffect(() => {
    api
      .file(fileId)
      .then((payload) => {
        setFile(payload);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
    api
      .fileQualityScore(fileId)
      .then((payload) => setQualityDetail(payload))
      .catch(() => setQualityDetail(null));
  }, [fileId]);

  return (
    <>
      <section className="panel stack">
        <div className="detail-back">
          <Link to={`/libraries/${file?.library_id ?? ""}`} className="badge">
            {t("fileDetail.backToLibrary")}
          </Link>
        </div>
        <div className="file-detail-title-row">
          <h2 className="file-detail-title">{file?.filename ?? t("fileDetail.loading")}</h2>
          {file?.filename ? (
            <TooltipTrigger ariaLabel={t("fileDetail.showFullFilename")} content={file.filename}>
              ?
            </TooltipTrigger>
          ) : null}
        </div>
        <div className="meta-tags">
          <span className="badge">{file?.video_codec ? formatCodecLabel(file.video_codec, "video") : t("fileDetail.unknownCodec")}</span>
          {file?.resolution_category_label ? (
            <TooltipTrigger
              ariaLabel="Show exact resolution"
              content={file.resolution ?? t("fileDetail.unknownResolution")}
              className="file-detail-badge-tooltip-trigger"
            >
              <span className="badge">{file.resolution_category_label}</span>
            </TooltipTrigger>
          ) : (
            <span className="badge">{file?.resolution ?? t("fileDetail.unknownResolution")}</span>
          )}
          <span className="badge">{formatHdrType(file?.hdr_type, showDolbyVisionProfiles) ?? t("fileTable.sdr")}</span>
        </div>
        <div className="card-grid grid">
          <article className="media-card metric-card file-detail-path-card">
            <div className="metric-card-label-row">
              <p className="eyebrow">{t("fileDetail.relativePath")}</p>
              {file?.relative_path ? (
                <TooltipTrigger ariaLabel={t("fileDetail.showFullRelativePath")} content={file.relative_path}>
                  ?
                </TooltipTrigger>
              ) : null}
            </div>
            {file?.relative_path ? <PathSegmentTrail value={file.relative_path} /> : <h3>…</h3>}
          </article>
          <article className="media-card metric-card metric-card-teal">
            <p className="eyebrow">{t("fileDetail.size")}</p>
            <h3>{formatBytes(file?.size_bytes ?? 0)}</h3>
          </article>
          <article className="media-card metric-card metric-card-blue">
            <p className="eyebrow">{t("fileDetail.duration")}</p>
            <h3>{formatDuration(file?.duration ?? 0)}</h3>
          </article>
          <article className="media-card metric-card">
            <p className="eyebrow">{t("fileDetail.quality")}</p>
            <h3>{file ? `${file.quality_score}/10` : "…"}</h3>
          </article>
        </div>
      </section>

      <div className="media-grid">
        <AsyncPanel title={t("fileDetail.qualityBreakdown")} loading={!qualityDetail && !error} error={null}>
          {qualityDetail ? (
            <div className="quality-tooltip-content quality-detail-list">
              <div className="quality-tooltip-summary">
                <strong>{qualityDetail.score}/10</strong>
                <span>{t("quality.rawScore", { value: qualityDetail.score_raw.toFixed(2) })}</span>
              </div>
              {qualityDetail.breakdown.categories.map((category) => (
                <div className="quality-tooltip-row" key={category.key}>
                  <div className="quality-tooltip-head">
                    <strong>{t(`quality.category.${category.key}`)}</strong>
                    <span>{category.score.toFixed(1)}</span>
                  </div>
                  <div>{t("quality.weight", { value: category.weight })}</div>
                  {category.skipped ? <div>{t("quality.skipped")}</div> : null}
                  {category.unknown_mapping ? <div>{t("quality.unknownMapping")}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </AsyncPanel>
        <AsyncPanel title={t("fileDetail.format")} loading={!file && !error} error={error}>
          <JsonPreview value={file?.media_format ?? {}} />
        </AsyncPanel>
        <AsyncPanel title={t("fileDetail.videoStreams")} loading={!file && !error} error={error}>
          <JsonPreview value={file?.video_streams ?? []} />
        </AsyncPanel>
        <AsyncPanel title={t("fileDetail.audioStreams")} loading={!file && !error} error={error}>
          <JsonPreview value={file?.audio_streams ?? []} />
        </AsyncPanel>
        <AsyncPanel title={t("fileDetail.subtitles")} loading={!file && !error} error={error}>
          <JsonPreview
            value={{
              internal: file?.subtitle_streams ?? [],
              external: file?.external_subtitles ?? [],
            }}
          />
        </AsyncPanel>
      </div>

      <AsyncPanel title={t("fileDetail.rawJson")} loading={!file && !error} error={error}>
        <JsonPreview value={file?.raw_ffprobe_json ?? {}} />
      </AsyncPanel>
    </>
  );
}
