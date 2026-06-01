import type { ReactNode } from "react";

import type { AudioStream, MediaFileStreamDetails } from "../lib/api";
import { formatCodecLabel, formatSpatialAudioProfileLabel } from "../lib/format";
import { formatHdrType } from "../lib/hdr";

export type StreamDetailsKind = "video" | "audio" | "subtitle";

type StreamDetailsListProps = {
  kind: StreamDetailsKind;
  detail: MediaFileStreamDetails | undefined;
  isLoading?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  surface?: "tooltip" | "panel";
  showSummary?: boolean;
  inDepthDolbyVisionProfiles?: boolean;
};

function formatTooltipLanguage(
  value: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const normalized = value?.trim();
  return normalized ? normalized : t("streamDetails.unknownLanguage");
}

function formatTooltipResolution(
  width: number | null | undefined,
  height: number | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (width && height) {
    return `${width}x${height}`;
  }
  return t("fileTable.na");
}

function formatAudioChannelLabel(
  channelLayout: string | null | undefined,
  channels: number | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const normalized = channelLayout?.trim().toLowerCase();
  const knownLayouts: Record<string, string> = {
    mono: t("streamDetails.mono"),
    "1.0": t("streamDetails.mono"),
    stereo: t("streamDetails.stereo"),
    "2.0": t("streamDetails.stereo"),
    "2.1": t("streamDetails.stereo"),
    "5.1": "5.1",
    "5.1(side)": "5.1",
    "5.1(back)": "5.1",
    "6.1": "5.1",
    "7.1": "7.1",
    "7.1(wide)": "7.1",
    "7.1(wide-side)": "7.1",
  };
  if (normalized && knownLayouts[normalized]) {
    return knownLayouts[normalized];
  }
  if (channels && channels > 0) {
    return t("streamDetails.channels", { count: channels });
  }
  return t("fileTable.na");
}

function formatSubtitleType(
  subtitleType: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const normalized = subtitleType?.trim().toLowerCase();
  if (normalized === "text") {
    return t("streamDetails.text");
  }
  if (normalized === "image") {
    return t("streamDetails.image");
  }
  return t("streamDetails.unknownType");
}

function formatAudioBitRate(value: number | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return t("fileTable.na");
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)} Mbps`;
  }
  return `${Math.round(value / 1000)} kbps`;
}

function formatAudioSampleRate(value: number | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return t("fileTable.na");
  }
  return `${value} Hz`;
}

function formatOptionalStreamText(value: string | number | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : t("fileTable.na");
  }
  const normalized = value?.trim();
  return normalized ? normalized : t("fileTable.na");
}

function formatStreamFlag(value: boolean, t: (key: string, options?: Record<string, unknown>) => string): string {
  return value ? t("common.yes") : t("common.no");
}

function buildAudioStreamDetailRows(
  stream: AudioStream,
  t: (key: string, options?: Record<string, unknown>) => string,
): Array<{ key: string; label: string; value: string }> {
  return [
    { key: "streamIndex", label: t("streamDetails.streamIndex"), value: String(stream.stream_index) },
    {
      key: "codec",
      label: t("streamDetails.codec"),
      value: stream.codec ? formatCodecLabel(stream.codec, "audio") : t("fileTable.na"),
    },
    { key: "profile", label: t("streamDetails.profile"), value: formatOptionalStreamText(stream.profile, t) },
    {
      key: "spatialAudio",
      label: t("streamDetails.audioSpatial"),
      value: stream.spatial_audio_profile ? formatSpatialAudioProfileLabel(stream.spatial_audio_profile) : t("fileTable.na"),
    },
    {
      key: "channels",
      label: t("streamDetails.channelCount"),
      value: stream.channels ? String(stream.channels) : t("fileTable.na"),
    },
    {
      key: "channelLayout",
      label: t("streamDetails.channelLayout"),
      value: formatOptionalStreamText(stream.channel_layout, t),
    },
    { key: "sampleRate", label: t("streamDetails.sampleRate"), value: formatAudioSampleRate(stream.sample_rate, t) },
    { key: "bitRate", label: t("streamDetails.bitRate"), value: formatAudioBitRate(stream.bit_rate, t) },
    {
      key: "bitDepth",
      label: t("streamDetails.bitDepth"),
      value: stream.bit_depth ? `${stream.bit_depth}-bit` : t("fileTable.na"),
    },
    { key: "bitRateMode", label: t("streamDetails.bitRateMode"), value: formatOptionalStreamText(stream.bit_rate_mode, t) },
    {
      key: "compressionMode",
      label: t("streamDetails.compressionMode"),
      value: formatOptionalStreamText(stream.compression_mode, t),
    },
    { key: "replayGain", label: t("streamDetails.replayGain"), value: formatOptionalStreamText(stream.replay_gain, t) },
    {
      key: "replayGainPeak",
      label: t("streamDetails.replayGainPeak"),
      value: formatOptionalStreamText(stream.replay_gain_peak, t),
    },
    {
      key: "writingLibrary",
      label: t("streamDetails.writingLibrary"),
      value: formatOptionalStreamText(stream.writing_library, t),
    },
    { key: "md5", label: t("streamDetails.md5Unencoded"), value: formatOptionalStreamText(stream.md5_unencoded, t) },
    { key: "language", label: t("streamDetails.language"), value: formatTooltipLanguage(stream.language, t) },
    { key: "default", label: t("streamDetails.default"), value: formatStreamFlag(stream.default_flag, t) },
    { key: "forced", label: t("streamDetails.forced"), value: formatStreamFlag(stream.forced_flag, t) },
    { key: "title", label: t("fileTable.audioTitle"), value: formatOptionalStreamText(stream.title, t) },
    { key: "artist", label: t("fileTable.audioArtist"), value: formatOptionalStreamText(stream.artist, t) },
    { key: "album", label: t("fileTable.audioAlbum"), value: formatOptionalStreamText(stream.album, t) },
    { key: "albumArtist", label: t("fileTable.audioAlbumArtist"), value: formatOptionalStreamText(stream.album_artist, t) },
    { key: "genre", label: t("fileTable.audioGenre"), value: formatOptionalStreamText(stream.genre, t) },
    { key: "date", label: t("fileTable.audioDate"), value: formatOptionalStreamText(stream.date, t) },
    { key: "disc", label: t("fileTable.audioDisc"), value: formatOptionalStreamText(stream.disc, t) },
    { key: "composer", label: t("fileTable.audioComposer"), value: formatOptionalStreamText(stream.composer, t) },
  ];
}

function buildStreamRows(
  kind: StreamDetailsKind,
  detail: MediaFileStreamDetails,
  t: (key: string, options?: Record<string, unknown>) => string,
  inDepthDolbyVisionProfiles = false,
): {
  title: string;
  count: number;
  rows: Array<{
    key: string;
    lead: string;
    trail?: string;
    meta: string[];
  }>;
} {
  if (kind === "video") {
    return {
      title: t("fileDetail.videoStreams"),
      count: detail.video_streams.length,
      rows: detail.video_streams.map((stream) => ({
        key: `video-${stream.stream_index}`,
        lead: stream.codec ? formatCodecLabel(stream.codec, "video") : t("fileTable.na"),
        trail: formatTooltipResolution(stream.width, stream.height, t),
        meta: [
          formatHdrType(stream.hdr_type, { inDepthDolbyVisionProfiles }) ?? t("fileTable.sdr"),
          ...(stream.profile ? [stream.profile] : []),
        ],
      })),
    };
  }

  if (kind === "audio") {
    return {
      title: t("fileDetail.audioStreams"),
      count: detail.audio_streams.length,
      rows: detail.audio_streams.map((stream) => ({
        key: `audio-${stream.stream_index}`,
        lead: stream.codec ? formatCodecLabel(stream.codec, "audio") : t("fileTable.na"),
        trail: formatTooltipLanguage(stream.language, t),
        meta: [
          formatAudioChannelLabel(stream.channel_layout, stream.channels, t),
          ...(stream.spatial_audio_profile ? [formatSpatialAudioProfileLabel(stream.spatial_audio_profile)] : []),
          ...(stream.bit_rate_mode ? [stream.bit_rate_mode.toUpperCase()] : []),
          ...(stream.bit_depth ? [`${stream.bit_depth}-bit`] : []),
          ...(stream.compression_mode ? [stream.compression_mode] : []),
          ...(stream.replay_gain ? [`RG ${stream.replay_gain}`] : []),
          ...(stream.replay_gain_peak ? [`Peak ${stream.replay_gain_peak}`] : []),
          ...(stream.writing_library ? [stream.writing_library] : []),
          ...(stream.md5_unencoded ? [`MD5 ${stream.md5_unencoded}`] : []),
          ...(stream.default_flag ? [t("streamDetails.default")] : []),
          ...(stream.forced_flag ? [t("streamDetails.forced")] : []),
        ],
      })),
    };
  }

  const subtitleRows = [
    ...detail.subtitle_streams.map((stream) => ({
      key: `subtitle-${stream.stream_index}`,
      lead: formatTooltipLanguage(stream.language, t),
      trail: stream.codec ? formatCodecLabel(stream.codec, "subtitle") : t("fileTable.na"),
      meta: [
        t("streamDetails.internal"),
        formatSubtitleType(stream.subtitle_type, t),
        ...(stream.default_flag ? [t("streamDetails.default")] : []),
        ...(stream.forced_flag ? [t("streamDetails.forced")] : []),
      ],
    })),
    ...detail.external_subtitles.map((subtitle) => ({
      key: `external-${subtitle.path}`,
      lead: formatTooltipLanguage(subtitle.language, t),
      trail: subtitle.format ? formatCodecLabel(subtitle.format, "subtitle") : t("fileTable.na"),
      meta: [t("streamDetails.external")],
    })),
  ];

  return {
    title: t("fileDetail.subtitles"),
    count: subtitleRows.length,
    rows: subtitleRows,
  };
}

export function StreamDetailsList({
  kind,
  detail,
  isLoading = false,
  t,
  surface = "tooltip",
  showSummary = true,
  inDepthDolbyVisionProfiles = false,
}: StreamDetailsListProps): ReactNode {
  if (isLoading) {
    return t("streamDetails.loading");
  }
  if (!detail) {
    return t("streamDetails.unavailable");
  }

  const { title, count, rows } = buildStreamRows(kind, detail, t, inDepthDolbyVisionProfiles);
  if (rows.length === 0) {
    return t("streamDetails.none");
  }

  if (kind === "audio" && surface === "panel") {
    return (
      <div className="stream-tooltip-content stream-tooltip-content-panel">
        {showSummary ? (
          <div className="stream-tooltip-summary">
            <strong>{title}</strong>
            <span>{count}</span>
          </div>
        ) : null}
        {detail.audio_streams.map((stream, index) => {
          const row = rows[index];
          const detailRows = buildAudioStreamDetailRows(stream, t);
          return (
            <details className="stream-detail-entry" key={`audio-detail-${stream.stream_index}`} open={index === 0}>
              <summary className="stream-detail-entry-head">
                <div className="stream-tooltip-inline">
                  <strong>{row?.lead ?? t("fileTable.na")}</strong>
                  {row?.meta.length ? (
                    <div className="stream-tooltip-meta">
                      {row.meta.map((item) => (
                        <span className="stream-tooltip-pill" key={`audio-detail-${stream.stream_index}-${item}`}>
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span>{t("streamDetails.streamNumber", { number: stream.stream_index })}</span>
              </summary>
              <div className="stream-detail-entry-body">
                {detailRows.map((detailRow) => (
                  <div className="stream-detail-field" key={`${stream.stream_index}-${detailRow.key}`}>
                    <span className="stream-detail-field-label">{detailRow.label}</span>
                    <strong className="stream-detail-field-value">{detailRow.value}</strong>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    );
  }

  return (
    <div className={["stream-tooltip-content", surface === "panel" ? "stream-tooltip-content-panel" : ""].filter(Boolean).join(" ")}>
      {showSummary ? (
        <div className="stream-tooltip-summary">
          <strong>{title}</strong>
          <span>{count}</span>
        </div>
      ) : null}
      {rows.map((row) => (
        <div className="stream-tooltip-row" key={row.key}>
          <div className="stream-tooltip-head">
            <div className="stream-tooltip-inline">
              <strong>{row.lead}</strong>
              {row.meta.length > 0 ? (
                <div className="stream-tooltip-meta">
                  {row.meta.map((item) => (
                    <span className="stream-tooltip-pill" key={`${row.key}-${item}`}>
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {row.trail ? <span>{row.trail}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
