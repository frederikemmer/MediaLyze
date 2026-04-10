import type { ReactNode } from "react";

import type { MediaFileStreamDetails } from "../lib/api";
import { formatCodecLabel, formatSpatialAudioProfileLabel } from "../lib/format";
import { formatHdrType } from "../lib/hdr";

export type StreamDetailsKind = "video" | "audio" | "subtitle";

type StreamDetailsListProps = {
  kind: StreamDetailsKind;
  detail: MediaFileStreamDetails | undefined;
  isLoading?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  surface?: "tooltip" | "panel";
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

function buildStreamRows(
  kind: StreamDetailsKind,
  detail: MediaFileStreamDetails,
  t: (key: string, options?: Record<string, unknown>) => string,
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
        meta: [formatHdrType(stream.hdr_type) ?? t("fileTable.sdr"), ...(stream.profile ? [stream.profile] : [])],
      })),
    };
  }

  if (kind === "audio") {
    return {
      title: t("fileDetail.audioStreams"),
      count: detail.audio_streams.length,
      rows: detail.audio_streams.map((stream) => ({
        key: `audio-${stream.stream_index}`,
        lead: formatTooltipLanguage(stream.language, t),
        trail: stream.codec ? formatCodecLabel(stream.codec, "audio") : t("fileTable.na"),
        meta: [
          formatAudioChannelLabel(stream.channel_layout, stream.channels, t),
          ...(stream.spatial_audio_profile ? [formatSpatialAudioProfileLabel(stream.spatial_audio_profile)] : []),
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
}: StreamDetailsListProps): ReactNode {
  if (isLoading) {
    return t("streamDetails.loading");
  }
  if (!detail) {
    return t("streamDetails.unavailable");
  }

  const { title, count, rows } = buildStreamRows(kind, detail, t);
  if (rows.length === 0) {
    return t("streamDetails.none");
  }

  return (
    <div className={["stream-tooltip-content", surface === "panel" ? "stream-tooltip-content-panel" : ""].filter(Boolean).join(" ")}>
      <div className="stream-tooltip-summary">
        <strong>{title}</strong>
        <span>{count}</span>
      </div>
      {rows.map((row) => (
        <div className="stream-tooltip-row" key={row.key}>
          <div className="stream-tooltip-head">
            <strong>{row.lead}</strong>
            {row.trail ? <span>{row.trail}</span> : null}
          </div>
          <div className="stream-tooltip-meta">
            {row.meta.map((item) => (
              <span className="stream-tooltip-pill" key={`${row.key}-${item}`}>
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
