import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { AsyncPanel } from "../components/AsyncPanel";
import { api, type MediaFileDetail } from "../lib/api";
import { formatBytes, formatCodecLabel, formatDuration } from "../lib/format";

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

export function FileDetailPage() {
  const { t } = useTranslation();
  const { fileId = "" } = useParams();
  const [file, setFile] = useState<MediaFileDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .file(fileId)
      .then((payload) => {
        setFile(payload);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [fileId]);

  return (
    <>
      <section className="panel stack">
        <div className="detail-back">
          <Link to={`/libraries/${file?.library_id ?? ""}`} className="badge">
            {t("fileDetail.backToLibrary")}
          </Link>
        </div>
        <p className="eyebrow">{t("fileDetail.eyebrow")}</p>
        <h2>{file?.filename ?? t("fileDetail.loading")}</h2>
        <div className="meta-tags">
          <span className="badge">{file?.video_codec ? formatCodecLabel(file.video_codec, "video") : t("fileDetail.unknownCodec")}</span>
          <span className="badge">{file?.resolution ?? t("fileDetail.unknownResolution")}</span>
          <span className="badge">{file?.hdr_type ?? t("fileTable.sdr")}</span>
        </div>
        <div className="card-grid grid">
          <article className="media-card metric-card">
            <p className="eyebrow">{t("fileDetail.relativePath")}</p>
            <h3>{file?.relative_path ?? "…"}</h3>
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
