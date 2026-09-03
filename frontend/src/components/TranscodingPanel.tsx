import { Check, CircleAlert, Film, LoaderCircle, Play, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import {
  api,
  type FileTranscode,
  type MediaFileDetail,
  type TranscodeCapabilities,
  type TranscodeEncoderCapability,
  type TranscodeJob,
  type TranscodePlan,
  type TranscodeStreamAction,
  type AudioStream,
  type SubtitleStream,
  type VideoStream,
  type TranscodeValidation,
} from "../lib/api";
import { formatBytes, formatCodecLabel, formatDuration } from "../lib/format";
import { formatLanguageLabel, languageOptions, normalizeLanguageTag } from "../lib/language";
import { TooltipTrigger } from "./TooltipTrigger";

const PROFILE_KEYS = ["compatibility", "storage", "modern"] as const;
const STREAM_ACTIONS: TranscodeStreamAction[] = ["copy", "encode", "drop"];

type StreamKind = "video_streams" | "audio_streams" | "subtitle_streams";
type QualityMode = "crf" | "cq" | "qp" | "global_quality";
type QualitySpec = { mode: QualityMode; min: number; max: number; default: number; step: number };
type PresetFamily = "x264" | "qsv" | "nvenc" | "amf" | "svtav1" | "generic";
type PresetOption = { value: string; labelKey: string };

const QUALITY_SPECS: Record<string, QualitySpec> = {
  libx264: { mode: "crf", min: 0, max: 51, default: 23, step: 1 },
  libx265: { mode: "crf", min: 0, max: 51, default: 28, step: 1 },
  libsvtav1: { mode: "crf", min: 0, max: 63, default: 30, step: 1 },
  "libaom-av1": { mode: "crf", min: 0, max: 63, default: 30, step: 1 },
  "libvpx-vp9": { mode: "crf", min: 0, max: 63, default: 31, step: 1 },
};

// Keep a local fallback for older API responses. The backend sends these
// values from its FFmpeg capability probe, but a browser can briefly retain a
// response from before a server upgrade. AV1/VP8/VP9 VAAPI use FFmpeg's
// global_quality (not the H.264/HEVC-only qp option).
const HARDWARE_QUALITY_SPECS: Record<string, QualitySpec> = {
  h264_vaapi: { mode: "qp", min: 0, max: 51, default: 23, step: 1 },
  hevc_vaapi: { mode: "qp", min: 0, max: 51, default: 23, step: 1 },
  av1_vaapi: { mode: "global_quality", min: 1, max: 255, default: 80, step: 1 },
  vp8_vaapi: { mode: "global_quality", min: 1, max: 127, default: 60, step: 1 },
  vp9_vaapi: { mode: "global_quality", min: 1, max: 255, default: 120, step: 1 },
  mpeg2_vaapi: { mode: "global_quality", min: 1, max: 51, default: 23, step: 1 },
  mjpeg_vaapi: { mode: "global_quality", min: 1, max: 100, default: 80, step: 1 },
  h264_qsv: { mode: "global_quality", min: 1, max: 51, default: 23, step: 1 },
  hevc_qsv: { mode: "global_quality", min: 1, max: 51, default: 23, step: 1 },
  av1_qsv: { mode: "global_quality", min: 1, max: 51, default: 23, step: 1 },
  vp9_qsv: { mode: "global_quality", min: 1, max: 51, default: 23, step: 1 },
  mpeg2_qsv: { mode: "global_quality", min: 1, max: 51, default: 23, step: 1 },
  mjpeg_qsv: { mode: "global_quality", min: 1, max: 100, default: 80, step: 1 },
};

// FFmpeg exposes the speed/quality trade-off as `preset` for these encoder
// families.  Keep the values curated instead of forwarding arbitrary option
// text from the capability probe: the probe reports option names, but not a
// reliable, portable list of accepted values.
const X264_PRESETS: PresetOption[] = [
  { value: "ultrafast", labelKey: "ultrafast" },
  { value: "superfast", labelKey: "superfast" },
  { value: "veryfast", labelKey: "veryfast" },
  { value: "faster", labelKey: "faster" },
  { value: "fast", labelKey: "fast" },
  { value: "medium", labelKey: "medium" },
  { value: "slow", labelKey: "slow" },
  { value: "slower", labelKey: "slower" },
  { value: "veryslow", labelKey: "veryslow" },
];

const QSV_PRESETS: PresetOption[] = [
  { value: "veryfast", labelKey: "veryfast" },
  { value: "faster", labelKey: "faster" },
  { value: "fast", labelKey: "fast" },
  { value: "medium", labelKey: "medium" },
  { value: "slow", labelKey: "slow" },
  { value: "slower", labelKey: "slower" },
  { value: "veryslow", labelKey: "veryslow" },
];

const NVENC_PRESETS: PresetOption[] = [
  { value: "p1", labelKey: "p1" },
  { value: "p2", labelKey: "p2" },
  { value: "p3", labelKey: "p3" },
  { value: "p4", labelKey: "p4" },
  { value: "p5", labelKey: "p5" },
  { value: "p6", labelKey: "p6" },
  { value: "p7", labelKey: "p7" },
];

const AMF_PRESETS: PresetOption[] = [
  { value: "speed", labelKey: "speed" },
  { value: "balanced", labelKey: "balanced" },
  { value: "quality", labelKey: "qualityFirst" },
];

const SVT_AV1_PRESETS: PresetOption[] = [
  { value: "0", labelKey: "svt0" },
  { value: "2", labelKey: "svt2" },
  { value: "4", labelKey: "svt4" },
  { value: "6", labelKey: "svt6" },
  { value: "8", labelKey: "svt8" },
  { value: "10", labelKey: "svt10" },
  { value: "12", labelKey: "svt12" },
  { value: "13", labelKey: "svt13" },
];

const GENERIC_PRESETS: PresetOption[] = [
  { value: "fast", labelKey: "fast" },
  { value: "medium", labelKey: "medium" },
  { value: "slow", labelKey: "slow" },
];

const AUDIO_BITRATES: Record<string, number[]> = {
  aac: [64_000, 96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
  libfdk_aac: [64_000, 96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
  libopus: [48_000, 64_000, 96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
  opus: [48_000, 64_000, 96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
  libvorbis: [64_000, 96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
  libmp3lame: [96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
  ac3: [192_000, 256_000, 384_000, 448_000, 640_000],
  eac3: [192_000, 256_000, 384_000, 448_000, 640_000],
  flac: [0],
};

const DEFAULT_AUDIO_BITRATES = AUDIO_BITRATES.aac;
const DEFAULT_FILENAME_TEMPLATE = "[{resolution}, {dynRange}, {codec}] [{audioLanguages}]";

function filenameTemplateForSubtitleOption(includeSubtitleLanguages: boolean): string {
  return includeSubtitleLanguages
    ? `${DEFAULT_FILENAME_TEMPLATE} [{subtitleLanguages}]`
    : DEFAULT_FILENAME_TEMPLATE;
}

function isKnownDefaultFilenameTemplate(template: string): boolean {
  return template === DEFAULT_FILENAME_TEMPLATE || template === filenameTemplateForSubtitleOption(true);
}

function setSubtitleToken(template: string, enabled: boolean): string {
  if (enabled) {
    return template.includes("{subtitleLanguages}")
      ? template
      : `${template.trim()} [{subtitleLanguages}]`;
  }
  return template
    .replace(/\s*\[\s*\{subtitleLanguages\}\s*\]/g, "")
    .replace(/\{subtitleLanguages\}/g, "")
    .replace(/\[\s*[,;|+\-]*\s*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function filenameLanguageSet(
  decisions: TranscodePlan["audio_streams"] | TranscodePlan["subtitle_streams"],
  sources: AudioStream[] | SubtitleStream[],
): string[] {
  return [...new Set(
    decisions
      .filter((decision) => decision.action !== "drop")
      .map((decision) => {
        const source = sources.find((entry) => entry.stream_index === decision.stream_index);
        return normalizeLanguageTag(decision.language ?? source?.language) ?? (decision.language ?? source?.language ?? "").trim();
      })
      .filter(Boolean),
  )].sort();
}

function filenamePreviewValues(file: MediaFileDetail, data: FileTranscode, plan: TranscodePlan): Record<string, string> {
  const primaryPlan = plan.video_streams.find((stream) => stream.action !== "drop");
  const sourceVideo = file.video_streams.find((stream) => stream.stream_index === primaryPlan?.stream_index) ?? file.video_streams[0];
  const width = primaryPlan?.width ?? sourceVideo?.width ?? data.original.width;
  const height = primaryPlan?.height ?? sourceVideo?.height ?? data.original.height;
  const codec = primaryPlan?.action === "encode"
    ? primaryPlan.codec ?? primaryPlan.encoder
    : sourceVideo?.codec ?? data.original.video_codec;
  const audioLanguages = filenameLanguageSet(plan.audio_streams, file.audio_streams);
  const subtitleLanguages = filenameLanguageSet(plan.subtitle_streams, file.subtitle_streams);
  const externalLanguages = plan.external_subtitles
    .filter((entry) => entry.action !== "drop")
    .map((entry) => {
      const source = file.external_subtitles.find((subtitle) => subtitle.id === entry.subtitle_id);
      return normalizeLanguageTag(entry.language ?? source?.language) ?? (entry.language ?? source?.language ?? "").trim();
    })
    .filter(Boolean);
  const allSubtitleLanguages = [...new Set([...subtitleLanguages, ...externalLanguages])].sort();
  const bitrate = primaryPlan?.bitrate ?? sourceVideo?.bit_rate;
  return {
    resolution: width && height ? `${width}x${height}` : "",
    dynRange: plan.dynamic_range === "preserve"
      ? data.original.dynamic_range ?? file.hdr_type ?? ""
      : plan.dynamic_range,
    codec: (codec ?? "").toUpperCase(),
    audioLanguages: audioLanguages.join("+"),
    subtitleLanguages: allSubtitleLanguages.join("+"),
    container: plan.container.toUpperCase(),
    videoBitrate: bitrate ? `${(bitrate / 1_000_000).toFixed(1).replace(/\.0$/, "")}Mbps` : "",
  };
}

function renderFilenamePreview(file: MediaFileDetail, data: FileTranscode, plan: TranscodePlan): string {
  const includeSubtitleLanguages = plan.include_subtitle_languages ?? plan.filename_template.includes("{subtitleLanguages}");
  const override = plan.filename_template_override ?? !isKnownDefaultFilenameTemplate(plan.filename_template);
  const template = override ? plan.filename_template : filenameTemplateForSubtitleOption(includeSubtitleLanguages);
  const values = filenamePreviewValues(file, data, plan);
  let rendered = template;
  for (const [token, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{${token}}`, value);
  }
  rendered = rendered
    .replace(/\[\s*[,;|+\-]*\s*\]/g, "")
    .replace(/([\[,;|+])\s*([,;|+])/g, "$1")
    .replace(/\s*,\s*(?=\])/g, "")
    .replace(/\[\s*,\s*/g, "[")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  const stem = file.filename.replace(/\.[^./\\]+$/, "");
  return `${`${stem} ${rendered}`.trim() || "transcoded"}.${plan.container}`;
}

function encoderQualitySpec(encoder: TranscodeEncoderCapability | undefined): QualitySpec {
  const fallback = encoder ? QUALITY_SPECS[encoder.name] ?? HARDWARE_QUALITY_SPECS[encoder.name] : undefined;
  const inferredMode: QualityMode | undefined = encoder?.name.endsWith("_vaapi")
    ? "qp"
    : encoder?.name.endsWith("_qsv")
      ? "global_quality"
      : encoder && /_(nvenc|amf|videotoolbox)$/.test(encoder.name)
        ? "cq"
        : undefined;
  const mode = encoder?.quality_mode ?? fallback?.mode ?? inferredMode ?? "crf";
  const min = encoder?.quality_min ?? fallback?.min ?? (mode === "global_quality" ? 1 : 0);
  const max = encoder?.quality_max ?? fallback?.max ?? 51;
  const defaultValue = encoder?.quality_default ?? fallback?.default ?? 23;
  const step = encoder?.quality_step ?? fallback?.step ?? 1;
  return { mode, min, max, default: defaultValue, step };
}

function encoderPresetFamily(encoder: TranscodeEncoderCapability | undefined): PresetFamily | null {
  if (!encoder || !encoder.options.some((option) => option.toLowerCase() === "preset")) return null;
  const name = encoder.name.toLowerCase();
  // VAAPI currently ignores `preset` in the backend command builder; do not
  // expose a control that would look active while having no effect.
  if (name.endsWith("_vaapi")) return null;
  if (name === "libx264" || name === "libx265") return "x264";
  if (name === "libsvtav1") return "svtav1";
  if (name.endsWith("_qsv")) return "qsv";
  if (name.endsWith("_nvenc")) return "nvenc";
  if (name.endsWith("_amf")) return "amf";
  return "generic";
}

function encoderPresetOptions(encoder: TranscodeEncoderCapability | undefined): PresetOption[] {
  switch (encoderPresetFamily(encoder)) {
    case "x264": return X264_PRESETS;
    case "qsv": return QSV_PRESETS;
    case "nvenc": return NVENC_PRESETS;
    case "amf": return AMF_PRESETS;
    case "svtav1": return SVT_AV1_PRESETS;
    case "generic": return GENERIC_PRESETS;
    default: return [];
  }
}

function defaultPresetForEncoder(encoder: TranscodeEncoderCapability | undefined): string | null {
  const options = encoderPresetOptions(encoder);
  if (!options.length) return null;
  switch (encoderPresetFamily(encoder)) {
    case "svtav1": return "6";
    case "nvenc": return "p4";
    case "amf": return "balanced";
    default: return "medium";
  }
}

function selectedPresetValue(
  stream: TranscodePlan["video_streams"][number],
  encoder: TranscodeEncoderCapability | undefined,
): string | null {
  const options = encoderPresetOptions(encoder);
  if (!options.length) return null;
  return options.some((option) => option.value === stream.preset)
    ? stream.preset ?? defaultPresetForEncoder(encoder)
    : defaultPresetForEncoder(encoder);
}

function presetGuidanceKey(family: PresetFamily | null): string {
  return family ?? "default";
}

function clampQuality(value: number, spec: QualitySpec): number {
  return Math.min(spec.max, Math.max(spec.min, Math.round(value / spec.step) * spec.step));
}

function qualityModeLabel(mode: QualityMode): string {
  return mode === "global_quality" ? "ICQ" : mode.toUpperCase();
}

function formatAudioBitrate(value: number | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!value || value <= 0) return t("transcoding.lossless");
  return `${Math.round(value / 1000)} kb/s`;
}

function resolutionOptions(
  source: VideoStream | undefined,
  currentWidth: number | null | undefined,
  currentHeight: number | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): Array<{ value: string; width: number | null; height: number | null; label: string }> {
  const options: Array<{ value: string; width: number | null; height: number | null; label: string }> = [
    {
      value: "original",
      width: null,
      height: null,
      label: source?.width && source.height
        ? t("transcoding.originalResolution", { width: source.width, height: source.height })
        : t("transcoding.original"),
    },
  ];
  if (source?.width && source.height) {
    for (const height of [360, 480, 720, 1080, 1440, 2160]) {
      if (height > source.height) continue;
      const width = Math.max(2, Math.round((source.width * height) / source.height / 2) * 2);
      const value = `${width}x${height}`;
      if (options.some((option) => option.value === value)) continue;
      options.push({
        value,
        width,
        height,
        label: t("transcoding.resolutionPreset", { height, width }),
      });
    }
  }
  if (currentWidth && currentHeight && !options.some((option) => option.value === `${currentWidth}x${currentHeight}`)) {
    options.push({
      value: `${currentWidth}x${currentHeight}`,
      width: currentWidth,
      height: currentHeight,
      label: `${currentWidth}×${currentHeight}`,
    });
  }
  return options;
}

function streamKindLabel(kind: StreamKind): "video" | "audio" | "subtitle" {
  return kind === "video_streams" ? "video" : kind === "audio_streams" ? "audio" : "subtitle";
}

function sourceForStream(
  file: MediaFileDetail,
  kind: StreamKind,
  streamIndex: number,
): VideoStream | AudioStream | SubtitleStream | undefined {
  return kind === "video_streams"
    ? file.video_streams.find((entry) => entry.stream_index === streamIndex)
    : kind === "audio_streams"
      ? file.audio_streams.find((entry) => entry.stream_index === streamIndex)
      : file.subtitle_streams.find((entry) => entry.stream_index === streamIndex);
}

function selectedQuality(stream: TranscodePlan[StreamKind][number], spec: QualitySpec): number {
  return clampQuality(stream.crf ?? stream.cq ?? spec.default, spec);
}

function defaultAudioBitrate(source: AudioStream | undefined, encoderName: string): number {
  const values = AUDIO_BITRATES[encoderName] ?? DEFAULT_AUDIO_BITRATES;
  if (values.length === 1) return values[0];
  const sourceBitrate = source?.bit_rate ?? 192_000;
  return values.reduce((closest, value) => Math.abs(value - sourceBitrate) < Math.abs(closest - sourceBitrate) ? value : closest, values[0]);
}

function pickEncoder(
  kind: StreamKind,
  sourceCodec: string | null | undefined,
  container: TranscodePlan["container"],
  encoders: TranscodeEncoderCapability[],
): TranscodeEncoderCapability | undefined {
  const candidates = encoders.filter((encoder) => {
    if (!encoder.available) return false;
    if (kind === "video_streams") return ["h264", "hevc", "av1", "vp8", "vp9", "mjpeg", "mpeg2video"].includes(encoder.codec);
    if (kind === "audio_streams") return ["aac", "opus", "vorbis", "ac3", "eac3", "flac", "mp3"].includes(encoder.codec);
    const allowed = container === "mp4" ? ["mov_text"] : container === "webm" ? ["webvtt"] : ["subrip", "ass", "webvtt", "mov_text"];
    return allowed.includes(encoder.codec);
  });
  const matching = candidates.find((encoder) => encoder.codec === (sourceCodec ?? "").toLowerCase());
  return matching ?? candidates[0];
}

function encoderInfo(
  encoder: TranscodeEncoderCapability | undefined,
  kind: "video" | "audio" | "subtitle",
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!encoder) return t("transcoding.noEncoderAvailable");
  const spec = encoderQualitySpec(encoder);
  const quality = kind === "video"
    ? t("transcoding.encoderQualitySummary", { mode: qualityModeLabel(spec.mode), min: spec.min, max: spec.max, default: spec.default })
    : t("transcoding.encoderStreamSummary", { kind: t(`transcoding.streamKinds.${kind}`), codec: formatCodecLabel(encoder.codec, kind), mode: encoder.hardware ? t("transcoding.hardware") : t("transcoding.cpu") });
  return t("transcoding.encoderInfo", {
    encoder: encoder.name,
    codec: formatCodecLabel(encoder.codec, kind),
    mode: encoder.hardware ? t("transcoding.hardware") : t("transcoding.cpu"),
    quality,
  });
}

function qualityGuidance(
  encoder: TranscodeEncoderCapability | undefined,
  spec: QualitySpec,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const name = encoder?.name ?? "";
  const key = spec.mode === "global_quality"
    ? "globalQuality"
    : name === "libx264" ? "libx264" : name === "libx265" ? "libx265" : /av1/i.test(name) ? "av1" : spec.mode === "crf" ? "default" : "hardware";
  return t(`transcoding.qualityGuidance.${key}`);
}

type StreamControlFieldsProps = {
  kind: StreamKind;
  stream: TranscodePlan[StreamKind][number];
  source: VideoStream | AudioStream | SubtitleStream | undefined;
  plan: TranscodePlan;
  encoders: TranscodeEncoderCapability[];
  languageTags: string[];
  languageLocale: string;
  controlClass: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  onPatch: (patch: Record<string, unknown>) => void;
};

type StreamLanguageFieldProps = {
  kind: "audio_streams" | "subtitle_streams";
  stream: TranscodePlan["audio_streams"][number] | TranscodePlan["subtitle_streams"][number];
  source: AudioStream | SubtitleStream | undefined;
  languageTags: string[];
  languageLocale: string;
  controlClass: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  disabled?: boolean;
  onPatch?: (patch: Record<string, unknown>) => void;
};

function StreamActionField({
  streamIndex,
  value,
  controlClass,
  t,
  onChange,
}: {
  streamIndex: number;
  value: string;
  controlClass: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  onChange: (value: TranscodeStreamAction) => void;
}) {
  return (
    <div className="transcode-action-field">
      <select
        className={controlClass}
        aria-label={t("transcoding.streamAction", { index: streamIndex })}
        title={t("transcoding.actionHelp")}
        value={STREAM_ACTIONS.includes(value as TranscodeStreamAction) ? value : "copy"}
        onChange={(event) => onChange(event.target.value as TranscodeStreamAction)}
      >
        {STREAM_ACTIONS.map((action) => <option key={action} value={action}>{t(`transcoding.actions.${action}`)}</option>)}
      </select>
      <TooltipTrigger
        className="transcode-dropdown-tooltip"
        ariaLabel={t("transcoding.actionHelpAria")}
        content={t("transcoding.actionHelp")}
      />
    </div>
  );
}

function StreamLanguageField({
  kind,
  stream,
  source,
  languageTags,
  languageLocale,
  controlClass,
  t,
  disabled = false,
  onPatch,
}: StreamLanguageFieldProps) {
  const sourceLanguage = source?.language;
  const selectedLanguage = normalizeLanguageTag(stream.language ?? sourceLanguage) || "und";
  return (
    <label className="transcode-control-field transcode-language-field">
      <span className="transcode-select-with-tooltip">
        <span className="sr-only">{t("transcoding.language")}</span>
        <select
          className={controlClass}
          aria-label={`${streamKindLabel(kind)} ${stream.stream_index} language`}
          title={t("transcoding.languageHelp")}
          value={languageTags.includes(selectedLanguage) ? selectedLanguage : "und"}
          disabled={disabled}
          onChange={(event) => onPatch?.({ language: event.target.value })}
        >
          {languageTags.map((tag) => <option key={tag} value={tag}>{formatLanguageLabel(tag, languageLocale)}</option>)}
        </select>
        <TooltipTrigger
          className="transcode-dropdown-tooltip"
          ariaLabel={t("transcoding.languageHelpAria")}
          content={t("transcoding.languageHelp")}
        />
      </span>
    </label>
  );
}

function StreamControlFields({
  kind,
  stream,
  source,
  plan,
  encoders,
  languageTags,
  languageLocale,
  controlClass,
  t,
  onPatch,
}: StreamControlFieldsProps) {
  const sourceCodec = source?.codec;
  const selected = encoders.find((encoder) => encoder.name === stream.encoder)
    ?? pickEncoder(kind, sourceCodec, plan.container, encoders);
  const selectedName = selected?.name ?? "";
  const codecKind = streamKindLabel(kind);
  if (kind === "video_streams") {
    const spec = encoderQualitySpec(selected);
    const quality = selectedQuality(stream, spec);
    const presetFamily = encoderPresetFamily(selected);
    const presetOptions = encoderPresetOptions(selected);
    const preset = selectedPresetValue(stream, selected);
    const resolutions = resolutionOptions(source as VideoStream | undefined, stream.width, stream.height, t);
    const resolutionValue = stream.width && stream.height ? `${stream.width}x${stream.height}` : "original";
    return (
      <div className="transcode-stream-encode-fields transcode-video-encode-fields">
        <label className="transcode-control-field transcode-encoder-field">
          <span className="transcode-field-label">
            <span>{t("transcoding.encoder")}</span>
            <TooltipTrigger ariaLabel={t("transcoding.encoderInfoAria", { encoder: selectedName || t("transcoding.encoder") })} content={encoderInfo(selected, "video", t)} />
          </span>
          <select
            className={controlClass}
            aria-label={`video ${stream.stream_index} encoder`}
            value={selectedName}
            onChange={(event) => {
              const next = encoders.find((encoder) => encoder.name === event.target.value);
              const nextSpec = encoderQualitySpec(next);
              const nextQuality = clampQuality(quality, nextSpec);
              onPatch({
                encoder: event.target.value,
                codec: next?.codec ?? stream.codec,
                crf: nextSpec.mode === "crf" ? nextQuality : null,
                cq: nextSpec.mode === "crf" ? null : nextQuality,
                preset: defaultPresetForEncoder(next),
              });
            }}
          >
            {!selectedName ? <option value="">{t("transcoding.noEncoderAvailable")}</option> : null}
            {encoders.map((encoder) => <option key={encoder.name} value={encoder.name} title={encoderInfo(encoder, "video", t)}>{encoder.name} · {formatCodecLabel(encoder.codec, "video")} · {encoder.hardware ? t("transcoding.hardware") : t("transcoding.cpu")}</option>)}
          </select>
        </label>
        <label className="transcode-control-field transcode-range-field">
          <span className="transcode-field-label">
            <span>{t("transcoding.quality", { mode: qualityModeLabel(spec.mode) })}</span>
            <TooltipTrigger ariaLabel={t("transcoding.qualityHelpAria")} content={t("transcoding.qualityHelp", { mode: qualityModeLabel(spec.mode), min: spec.min, max: spec.max, default: spec.default, guidance: qualityGuidance(selected, spec, t) })} />
          </span>
          <span className="transcode-range-row">
            <input
              className={controlClass}
              aria-label={`video ${stream.stream_index} quality`}
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={quality}
              aria-valuetext={`${qualityModeLabel(spec.mode)} ${quality}`}
              onChange={(event) => {
                const nextQuality = Number(event.target.value);
                onPatch({ crf: spec.mode === "crf" ? nextQuality : null, cq: spec.mode === "crf" ? null : nextQuality });
              }}
            />
            <output>{quality}</output>
          </span>
        </label>
        {presetOptions.length ? (
          <label className="transcode-control-field transcode-preset-field">
            <span className="transcode-field-label">
              <span>{t("transcoding.speedPreset")}</span>
              <TooltipTrigger
                ariaLabel={t("transcoding.presetHelpAria")}
                content={t("transcoding.presetHelp", { guidance: t(`transcoding.presetGuidance.${presetGuidanceKey(presetFamily)}`) })}
              />
            </span>
            <select
              className={controlClass}
              aria-label={`video ${stream.stream_index} speed preset`}
              title={t("transcoding.presetHelp", { guidance: t(`transcoding.presetGuidance.${presetGuidanceKey(presetFamily)}`) })}
              value={preset ?? ""}
              onChange={(event) => onPatch({ preset: event.target.value || null })}
            >
              {presetOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value} · {t(`transcoding.presetValues.${option.labelKey}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="transcode-control-field transcode-resolution-field">
          <span className="transcode-field-label">
            <span>{t("transcoding.resolution")}</span>
            <TooltipTrigger ariaLabel={t("transcoding.resolutionHelpAria")} content={t("transcoding.resolutionHelp")} />
          </span>
          <select
            className={controlClass}
            aria-label={`video ${stream.stream_index} resolution`}
            value={resolutions.some((option) => option.value === resolutionValue) ? resolutionValue : "original"}
            onChange={(event) => {
              const option = resolutions.find((entry) => entry.value === event.target.value);
              onPatch({ width: option?.width ?? null, height: option?.height ?? null });
            }}
          >
            {resolutions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
    );
  }

  if (kind === "audio_streams") {
    const values = AUDIO_BITRATES[selectedName] ?? DEFAULT_AUDIO_BITRATES;
    const currentBitrate = stream.bitrate && values.includes(stream.bitrate) ? stream.bitrate : defaultAudioBitrate(source as AudioStream | undefined, selectedName);
    const sliderIndex = Math.max(0, values.indexOf(currentBitrate));
    return (
      <div className="transcode-stream-encode-fields">
        <label className="transcode-control-field transcode-encoder-field">
          <span className="transcode-field-label">
            <span>{t("transcoding.encoder")}</span>
            <TooltipTrigger ariaLabel={t("transcoding.encoderInfoAria", { encoder: selectedName || t("transcoding.encoder") })} content={encoderInfo(selected, "audio", t)} />
          </span>
          <select
            className={controlClass}
            aria-label={`audio ${stream.stream_index} encoder`}
            value={selectedName}
            onChange={(event) => {
              const next = encoders.find((encoder) => encoder.name === event.target.value);
              onPatch({ encoder: event.target.value, codec: next?.codec ?? stream.codec, bitrate: defaultAudioBitrate(source as AudioStream | undefined, event.target.value) || null });
            }}
          >
            {!selectedName ? <option value="">{t("transcoding.noEncoderAvailable")}</option> : null}
            {encoders.map((encoder) => <option key={encoder.name} value={encoder.name} title={encoderInfo(encoder, "audio", t)}>{encoder.name} · {formatCodecLabel(encoder.codec, "audio")} · {encoder.hardware ? t("transcoding.hardware") : t("transcoding.cpu")}</option>)}
          </select>
        </label>
        <label className="transcode-control-field transcode-range-field">
          <span className="transcode-field-label">
            <span>{t("transcoding.bitrate")}</span>
            <TooltipTrigger ariaLabel={t("transcoding.bitrateHelpAria")} content={t("transcoding.bitrateHelp")} />
          </span>
          <span className="transcode-range-row">
            <input
              className={controlClass}
              aria-label={`audio ${stream.stream_index} bitrate`}
              type="range"
              min={0}
              max={Math.max(0, values.length - 1)}
              step={1}
              value={sliderIndex}
              aria-valuetext={formatAudioBitrate(currentBitrate, t)}
              disabled={values.length === 1 && values[0] === 0}
              onChange={(event) => onPatch({ bitrate: values[Number(event.target.value)] || null })}
            />
            <output>{formatAudioBitrate(currentBitrate, t)}</output>
          </span>
        </label>
        <StreamLanguageField
          kind="audio_streams"
          stream={stream}
          source={source as AudioStream | undefined}
          languageTags={languageTags}
          languageLocale={languageLocale}
          controlClass={controlClass}
          t={t}
          onPatch={onPatch}
        />
      </div>
    );
  }

  return (
    <div className="transcode-stream-encode-fields">
      <label className="transcode-control-field transcode-encoder-field">
        <span className="transcode-field-label">
          <span>{t("transcoding.subtitleFormat")}</span>
          <TooltipTrigger ariaLabel={t("transcoding.encoderInfoAria", { encoder: selectedName || t("transcoding.subtitleFormat") })} content={encoderInfo(selected, "subtitle", t)} />
        </span>
        <select
          className={controlClass}
          aria-label={`subtitle ${stream.stream_index} format`}
          value={selectedName}
          onChange={(event) => {
            const next = encoders.find((encoder) => encoder.name === event.target.value);
            onPatch({ encoder: event.target.value, codec: next?.codec ?? stream.codec });
          }}
        >
          {!selectedName ? <option value="">{t("transcoding.noEncoderAvailable")}</option> : null}
          {encoders.map((encoder) => <option key={encoder.name} value={encoder.name} title={encoderInfo(encoder, "subtitle", t)}>{formatCodecLabel(encoder.codec, "subtitle")} · {encoder.name}</option>)}
        </select>
      </label>
      <StreamLanguageField
        kind="subtitle_streams"
        stream={stream}
        source={source as SubtitleStream | undefined}
        languageTags={languageTags}
        languageLocale={languageLocale}
        controlClass={controlClass}
        t={t}
        onPatch={onPatch}
      />
    </div>
  );
}

function clonePlan(plan: TranscodePlan): TranscodePlan {
  const clone = JSON.parse(JSON.stringify(plan)) as TranscodePlan;
  for (const kind of ["video_streams", "audio_streams", "subtitle_streams"] as const) {
    clone[kind] = clone[kind].map((stream) => stream.action === "keep" ? { ...stream, action: "copy" } : stream);
  }
  return clone;
}

function jobIsActive(job: TranscodeJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

function updateStreamPlan(
  plan: TranscodePlan,
  kind: StreamKind,
  streamIndex: number,
  patch: Record<string, unknown>,
): TranscodePlan {
  return {
    ...plan,
    profile: "expert",
    [kind]: plan[kind].map((stream) => stream.stream_index === streamIndex ? { ...stream, ...patch } : stream),
  };
}

function TranscodeJobHistory({ jobs }: { jobs: TranscodeJob[] }) {
  const { t } = useTranslation();
  if (!jobs.length) {
    return <p className="field-hint">{t("transcoding.history.empty")}</p>;
  }
  return (
    <div className="transcode-history-list">
      {jobs.map((job) => (
        <details key={job.id} className="file-history-entry">
          <summary className="file-history-entry-head">
            <strong>{t(`transcoding.profiles.${job.profile}`, { defaultValue: job.profile })}</strong>
            <span className={`badge transcode-status-${job.status}`}>{t(`transcoding.status.${job.status}`)}</span>
            <span>{job.output_relative_path}</span>
          </summary>
          <div className="transcode-job-detail">
            <dl>
              <div><dt>{t("transcoding.sourcePath")}</dt><dd><code>{job.source_path_snapshot}</code></dd></div>
              <div><dt>{t("transcoding.outputPath")}</dt><dd><code>{job.output_path_snapshot}</code></dd></div>
            </dl>
            <code>{job.ffmpeg_command}</code>
            {job.warnings.length ? <ul>{job.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
            {job.error ? <p className="notice error">{job.error}</p> : null}
            <details>
              <summary>{t("transcoding.history.plan")}</summary>
              <pre className="json-preview">{JSON.stringify(job.plan, null, 2)}</pre>
            </details>
            {job.result_file_id ? (
              <div className="transcode-job-links">
                <Link to={`/files/${job.result_file_id}`}>{t("transcoding.openVariant")}</Link>
                {job.source_file_id ? <Link to={`/files/compare?left=${job.source_file_id}&right=${job.result_file_id}`}>{t("transcoding.openComparison")}</Link> : null}
              </div>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

export function FileTranscodeHistory({ fileId }: { fileId: string | number }) {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<TranscodeJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.fileTranscode(fileId, controller.signal)
      .then((payload) => {
        setJobs(payload.jobs);
        setError(null);
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [fileId]);
  return (
    <section className="transcode-history-section">
      <h3>{t("transcoding.history.title")}</h3>
      {error ? <p className="notice error">{error}</p> : null}
      {jobs ? <TranscodeJobHistory jobs={jobs} /> : <p className="field-hint">{t("panel.loading")}</p>}
    </section>
  );
}

export function TranscodingPanel({ file }: { file: MediaFileDetail }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<FileTranscode | null>(null);
  const [capabilities, setCapabilities] = useState<TranscodeCapabilities | null>(null);
  const [plan, setPlan] = useState<TranscodePlan | null>(null);
  const [validation, setValidation] = useState<TranscodeValidation | null>(null);
  const [job, setJob] = useState<TranscodeJob | null>(null);
  const [openStreamGroups, setOpenStreamGroups] = useState<Record<StreamKind, boolean>>({
    video_streams: true,
    audio_streams: false,
    subtitle_streams: false,
  });
  const [openExternalSubtitles, setOpenExternalSubtitles] = useState(false);
  const [rawProbe, setRawProbe] = useState<Record<string, unknown> | null>(file.raw_ffprobe_json);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextData, nextCapabilities] = await Promise.all([
      api.fileTranscode(file.id),
      api.transcodeCapabilities(),
    ]);
    setData(nextData);
    setCapabilities(nextCapabilities);
    setPlan((current) => current ?? clonePlan(nextData.profiles.compatibility));
    setJob(nextData.jobs.find(jobIsActive) ?? null);
    setError(null);
  }, [file.id]);

  useEffect(() => {
    setData(null);
    setCapabilities(null);
    setPlan(null);
    setValidation(null);
    setJob(null);
    setOpenStreamGroups({ video_streams: true, audio_streams: false, subtitle_streams: false });
    setOpenExternalSubtitles(false);
    setError(null);
    setLoading(true);
    void refresh().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => setRawProbe(file.raw_ffprobe_json), [file.id, file.raw_ffprobe_json]);

  useEffect(() => {
    if (!job || !jobIsActive(job)) return;
    const activeJobId = job.id;
    const intervalId = window.setInterval(() => {
      void api.transcodeJob(activeJobId).then((nextJob) => {
        setJob(nextJob);
        if (!jobIsActive(nextJob)) void refresh();
      }).catch((reason: Error) => setError(reason.message));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [job, refresh]);

  const availableVideoEncoders = useMemo(
    () => capabilities?.encoders.filter((encoder) => (
      encoder.available && (encoder.hardware || ["h264", "hevc", "av1", "vp8", "vp9", "mjpeg", "mpeg2video"].includes(encoder.codec))
    )) ?? [],
    [capabilities],
  );
  const availableAudioEncoders = useMemo(
    () => capabilities?.encoders.filter((encoder) => encoder.available && ["aac", "opus", "vorbis", "ac3", "eac3", "flac", "mp3"].includes(encoder.codec)) ?? [],
    [capabilities],
  );
  const availableSubtitleEncoders = useMemo(() => {
    const allowedByContainer: Record<TranscodePlan["container"], string[]> = {
      mp4: ["mov_text"],
      webm: ["webvtt"],
      mkv: ["subrip", "ass", "webvtt", "mov_text"],
    };
    const allowed = allowedByContainer[plan?.container ?? "mkv"];
    return capabilities?.encoders.filter((encoder) => encoder.available && allowed.includes(encoder.codec)) ?? [];
  }, [capabilities, plan?.container]);
  const languageTags = useMemo(
    () => languageOptions([
      ...file.audio_streams.map((stream) => stream.language),
      ...file.subtitle_streams.map((stream) => stream.language),
      ...file.external_subtitles.map((subtitle) => subtitle.language),
    ], i18n.language),
    [file.audio_streams, file.subtitle_streams, file.external_subtitles, i18n.language],
  );

  const selectProfile = useCallback((profile: typeof PROFILE_KEYS[number]) => {
    if (!data) return;
    setPlan(clonePlan(data.profiles[profile]));
    setValidation(null);
  }, [data]);

  const validate = useCallback(async (): Promise<TranscodeValidation | null> => {
    if (!plan) return null;
    setValidating(true);
    setError(null);
    try {
      const result = await api.validateFileTranscode(file.id, plan);
      setValidation(result);
      setPlan(result.normalized_plan);
      return result;
    } catch (reason) {
      setError((reason as Error).message);
      return null;
    } finally {
      setValidating(false);
    }
  }, [file.id, plan]);

  const start = useCallback(async () => {
    const result = await validate();
    if (!result?.valid || !plan) return;
    setStarting(true);
    try {
      const nextJob = await api.startFileTranscode(file.id, result.normalized_plan);
      setJob(nextJob);
      setValidation(result);
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setStarting(false);
    }
  }, [file.id, plan, validate]);

  if (loading) return <div className="panel-loader"><LoaderCircle className="spin" aria-hidden="true" />{t("panel.loading")}</div>;
  if (!data || !plan || !capabilities) return <p className="notice error">{error ?? t("transcoding.unavailable")}</p>;

  const activeJob = jobIsActive(job) ? job : null;
  const transcodeControlClass = "settings-choice-input transcode-control";

  return (
    <div className="transcoding-panel">
      {error ? <p className="notice error">{error}</p> : null}
      {!capabilities.ffmpeg_available ? <p className="notice error">{capabilities.error ?? t("transcoding.ffmpegUnavailable")}</p> : null}

      <section className="transcode-original-card">
        <div><Film aria-hidden="true" /><strong>{data.original.filename}</strong></div>
        <dl>
          <div><dt>{t("fileTable.size")}</dt><dd>{formatBytes(data.original.size_bytes ?? 0)}</dd></div>
          <div><dt>{t("fileTable.duration")}</dt><dd>{formatDuration(data.original.duration_seconds ?? 0)}</dd></div>
          <div><dt>{t("fileTable.resolution")}</dt><dd>{data.original.width && data.original.height ? `${data.original.width}x${data.original.height}` : "n/a"}</dd></div>
          <div><dt>{t("fileTable.codec")}</dt><dd>{formatCodecLabel(data.original.video_codec, "video")}</dd></div>
          <div><dt>{t("fileTable.hdr")}</dt><dd>{data.original.dynamic_range ?? "SDR"}</dd></div>
        </dl>
        <details onToggle={(event) => {
          if (event.currentTarget.open && rawProbe === null) {
            void api.fileRawFfprobe(file.id).then((payload) => setRawProbe(payload.raw_ffprobe_json ?? {})).catch((reason: Error) => setError(reason.message));
          }
        }}>
          <summary>{t("fileDetail.rawJson")}</summary>
          <pre className="json-preview">{JSON.stringify(rawProbe ?? {}, null, 2)}</pre>
        </details>
      </section>

      <div className="transcode-configuration-grid">
        <label>
          <span>{t("transcoding.profile")}</span>
          <select className={transcodeControlClass} value={PROFILE_KEYS.includes(plan.profile as typeof PROFILE_KEYS[number]) ? plan.profile : "expert"} onChange={(event) => {
            const profile = event.target.value;
            if (profile !== "expert") selectProfile(profile as typeof PROFILE_KEYS[number]);
          }}>
            {PROFILE_KEYS.map((profile) => <option key={profile} value={profile}>{t(`transcoding.profiles.${profile}`)}</option>)}
            <option value="expert">{t("transcoding.profiles.expert")}</option>
          </select>
        </label>
        <label>
          <span>{t("transcoding.container")}</span>
          <select className={transcodeControlClass} value={plan.container} onChange={(event) => {
            setPlan({ ...plan, profile: "expert", container: event.target.value as TranscodePlan["container"] });
            setValidation(null);
          }}>
            {capabilities.containers.map((container) => <option key={container} value={container}>{container.toUpperCase()}</option>)}
          </select>
        </label>
        <label>
          <span>{t("transcoding.dynamicRange")}</span>
          <select className={transcodeControlClass} value={plan.dynamic_range} onChange={(event) => {
            setPlan({ ...plan, profile: "expert", dynamic_range: event.target.value as TranscodePlan["dynamic_range"] });
            setValidation(null);
          }}>
            {([
              "preserve",
              "sdr",
              "hdr10",
              "hlg",
              ...(capabilities.dolby_vision_passthrough
                && data.original.dynamic_range?.toLowerCase().includes("dolby")
                && ["mkv", "mp4"].includes(plan.container)
                && ["hevc", "h265"].includes(data.original.video_codec?.toLowerCase() ?? "")
                && plan.video_streams.every((stream) => stream.action === "keep" || stream.action === "copy")
                ? ["dolby_vision" as const]
                : []),
            ] as const).map((value) => <option key={value} value={value}>{t(`transcoding.dynamicRanges.${value}`)}</option>)}
          </select>
        </label>
        <label>
          <span>{t("transcoding.outputMode")}</span>
          <select
            className={transcodeControlClass}
            value={plan.output_mode ?? "transcode_output"}
            onChange={(event) => {
              setPlan({
                ...plan,
                profile: "expert",
                output_mode: event.target.value as NonNullable<TranscodePlan["output_mode"]>,
                replacement_confirmed: false,
              });
              setValidation(null);
            }}
          >
            <option value="transcode_output">{t("transcoding.transcodeOutput")}</option>
            <option value="same_directory">{t("transcoding.sameDirectory")}</option>
            <option value="replace_original">{t("transcoding.replaceOriginal")}</option>
          </select>
          <span className="field-hint">{t("transcoding.outputModeHint")}</span>
        </label>
      </div>

      {plan.output_mode === "replace_original" ? (
        <div className="transcode-replacement-warning">
          <div className="notice warning">{t("transcoding.replacementWarning")}</div>
          <p className="field-hint">{t("common.replacementTestingNotice")}</p>
          <label className="transcode-filename-option">
            <input
              type="checkbox"
              checked={Boolean(plan.replacement_confirmed)}
              onChange={(event) => setPlan({ ...plan, replacement_confirmed: event.target.checked })}
            />
            <span>{t("transcoding.replacementConfirm")}</span>
          </label>
        </div>
      ) : null}

      <section className="transcode-streams">
        {(["video_streams", "audio_streams", "subtitle_streams"] as const).map((kind) => (
          <details
            key={kind}
            className="transcode-stream-group"
            open={openStreamGroups[kind]}
            onToggle={(event) => {
              const isOpen = event.currentTarget.open;
              setOpenStreamGroups((current) => ({ ...current, [kind]: isOpen }));
            }}
          >
            <summary className="transcode-stream-group-summary">
              <span>{t(`transcoding.streamGroups.${kind}`)}</span>
              <span className="transcode-stream-group-count">{plan[kind].length}</span>
            </summary>
            {plan[kind].map((stream) => {
              const source = sourceForStream(file, kind, stream.stream_index);
              const language = source && "language" in source ? source.language : null;
              const streamAction = stream.action === "keep" ? "copy" : stream.action;
              const codecKind = streamKindLabel(kind);
              const streamEncoders = kind === "video_streams" ? availableVideoEncoders : kind === "audio_streams" ? availableAudioEncoders : availableSubtitleEncoders;
              const selectedEncoder = streamEncoders.find((encoder) => encoder.name === stream.encoder) ?? pickEncoder(kind, source?.codec, plan.container, streamEncoders);
              const resetToCopy = () => {
                setPlan(updateStreamPlan(plan, kind, stream.stream_index, {
                  action: "copy",
                  codec: null,
                  encoder: null,
                  bitrate: null,
                  crf: null,
                  cq: null,
                  width: null,
                  height: null,
                  frame_rate: null,
                  pixel_format: null,
                  profile: null,
                  level: null,
                  preset: null,
                  gop_size: null,
                  language: null,
                  title: null,
                }));
                setValidation(null);
              };
              const setAction = (action: TranscodeStreamAction) => {
                if (action === "copy") {
                  resetToCopy();
                  return;
                }
                if (action === "drop") {
                  setPlan(updateStreamPlan(plan, kind, stream.stream_index, { action }));
                  setValidation(null);
                  return;
                }
                const encoder = selectedEncoder ?? pickEncoder(kind, source?.codec, plan.container, streamEncoders);
                const quality = encoderQualitySpec(encoder);
                const sourceLanguage = source && "language" in source ? normalizeLanguageTag(source.language) : "und";
                setPlan(updateStreamPlan(plan, kind, stream.stream_index, {
                  action: "encode",
                  encoder: encoder?.name ?? null,
                  codec: encoder?.codec ?? stream.codec,
                  crf: kind === "video_streams" && quality.mode === "crf" ? quality.default : null,
                  cq: kind === "video_streams" && quality.mode !== "crf" ? quality.default : null,
                  preset: kind === "video_streams" ? defaultPresetForEncoder(encoder) : null,
                  bitrate: kind === "audio_streams" ? defaultAudioBitrate(source as AudioStream | undefined, encoder?.name ?? "aac") || null : null,
                  language: kind !== "video_streams" ? sourceLanguage || "und" : null,
                  width: null,
                  height: null,
                }));
                setValidation(null);
              };
              return (
                <article key={stream.stream_index} className="transcode-stream-row">
                  <div className="transcode-stream-meta">
                    <strong>#{stream.stream_index}</strong>
                    <span>{formatCodecLabel(source?.codec, codecKind)}</span>
                    {language ? <span className="transcode-language-badge">{formatLanguageLabel(language, i18n.language)}</span> : <span className="transcode-language-badge">{formatLanguageLabel("und", i18n.language)}</span>}
                  </div>
                  <StreamActionField
                    streamIndex={stream.stream_index}
                    value={streamAction}
                    controlClass={transcodeControlClass}
                    t={t}
                    onChange={setAction}
                  />
                  {streamAction === "encode" ? (
                    <StreamControlFields
                      kind={kind}
                      stream={stream}
                      source={source}
                      plan={plan}
                      encoders={streamEncoders}
                      languageTags={languageTags}
                      languageLocale={i18n.language}
                      controlClass={transcodeControlClass}
                      t={t}
                      onPatch={(patch) => {
                        setPlan(updateStreamPlan(plan, kind, stream.stream_index, patch));
                        setValidation(null);
                      }}
                    />
                  ) : null}
                  {streamAction === "copy" ? (
                    <>
                      {kind !== "video_streams" ? (
                        <StreamLanguageField
                          kind={kind}
                          stream={stream}
                          source={source as AudioStream | SubtitleStream | undefined}
                          languageTags={languageTags}
                          languageLocale={i18n.language}
                          controlClass={transcodeControlClass}
                          t={t}
                          disabled
                        />
                      ) : null}
                    </>
                  ) : null}
                </article>
              );
            })}
          </details>
        ))}
        {file.external_subtitles.length ? (
          <details
            className="transcode-stream-group"
            open={openExternalSubtitles}
            onToggle={(event) => {
              const isOpen = event.currentTarget.open;
              setOpenExternalSubtitles(isOpen);
            }}
          >
            <summary className="transcode-stream-group-summary">
              <span>{t("transcoding.externalSubtitles")}</span>
              <span className="transcode-stream-group-count">{file.external_subtitles.length}</span>
            </summary>
            {file.external_subtitles.map((subtitle) => {
              const selected = plan.external_subtitles.find((entry) => entry.subtitle_id === subtitle.id);
              return (
                <label key={subtitle.id} className="transcode-external-subtitle">
                  <input type="checkbox" checked={Boolean(selected && selected.action !== "drop")} onChange={(event) => {
                    setPlan({
                      ...plan,
                      profile: "expert",
                      external_subtitles: event.target.checked
                        ? [...plan.external_subtitles.filter((entry) => entry.subtitle_id !== subtitle.id), { subtitle_id: subtitle.id, action: "encode", codec: plan.container === "mp4" ? "mov_text" : plan.container === "webm" ? "webvtt" : "srt", language: subtitle.language }]
                        : plan.external_subtitles.filter((entry) => entry.subtitle_id !== subtitle.id),
                    });
                  }} />
                  <span>{subtitle.path} · {formatLanguageLabel(subtitle.language, i18n.language)} · {subtitle.format ?? "n/a"}</span>
                </label>
              );
            })}
          </details>
        ) : null}
      </section>

      <section className="transcode-stream-section">
        <h3>{t("transcoding.attachments")}</h3>
        {!data.attachments.length ? <p className="field-hint">{t("transcoding.noAttachments")}</p> : (
          <div className="transcode-attachment-list">
            {data.attachments.map((attachment) => (
              <article key={attachment.stream_index}>
                <strong>#{attachment.stream_index} · {attachment.filename ?? attachment.title ?? t("transcoding.attachment")}</strong>
                <span>{[attachment.codec, attachment.mimetype, attachment.title].filter(Boolean).join(" · ") || "—"}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="transcode-global-options">
        {(["chapters", "metadata", "cover", "attachments"] as const).map((option) => (
          <label key={option}>
            <input type="checkbox" checked={plan[option] === "keep"} onChange={(event) => setPlan({ ...plan, profile: "expert", [option]: event.target.checked ? "keep" : "drop" })} />
            <span>{t(`transcoding.options.${option}`)}</span>
          </label>
        ))}
      </div>

      {(() => {
        const includeSubtitleLanguages = plan.include_subtitle_languages ?? plan.filename_template.includes("{subtitleLanguages}");
        const templateOverride = plan.filename_template_override ?? !isKnownDefaultFilenameTemplate(plan.filename_template);
        const defaultTemplate = filenameTemplateForSubtitleOption(includeSubtitleLanguages);
        const displayedTemplate = templateOverride ? plan.filename_template : defaultTemplate;
        const preview = renderFilenamePreview(file, data, plan);
        return (
          <section className="transcode-filename-section">
            <div className="transcode-filename-heading">
              <h3>{t("transcoding.filenameTemplate")}</h3>
              <TooltipTrigger
                ariaLabel={t("transcoding.filenameTemplateHelpAria")}
                content={t("transcoding.filenameTemplateHelp")}
              />
            </div>
            <label className="transcode-filename-option">
              <input
                type="checkbox"
                checked={templateOverride}
                onChange={(event) => {
                  const nextOverride = event.target.checked;
                  setPlan({
                    ...plan,
                    profile: "expert",
                    filename_template_override: nextOverride,
                    filename_template: nextOverride ? plan.filename_template || defaultTemplate : defaultTemplate,
                  });
                  setValidation(null);
                }}
              />
              <span>{t("transcoding.filenameTemplateOverride")}</span>
            </label>
            <label className="transcode-filename-option">
              <input
                type="checkbox"
                checked={includeSubtitleLanguages}
                onChange={(event) => {
                  const nextInclude = event.target.checked;
                  setPlan({
                    ...plan,
                    profile: "expert",
                    include_subtitle_languages: nextInclude,
                    filename_template: templateOverride
                      ? setSubtitleToken(plan.filename_template, nextInclude)
                      : filenameTemplateForSubtitleOption(nextInclude),
                  });
                  setValidation(null);
                }}
              />
              <span>{t("transcoding.filenameIncludeSubtitleLanguages")}</span>
            </label>
            <input
              className={transcodeControlClass}
              value={displayedTemplate}
              disabled={!templateOverride}
              aria-label={t("transcoding.filenameTemplate")}
              onChange={(event) => {
                const nextTemplate = event.target.value;
                setPlan({
                  ...plan,
                  profile: "expert",
                  filename_template: nextTemplate,
                  filename_template_override: true,
                  include_subtitle_languages: nextTemplate.includes("{subtitleLanguages}"),
                });
                setValidation(null);
              }}
            />
            <small>{t("transcoding.filenameTokens")}</small>
            <div className="transcode-filename-preview">
              <span>{t("transcoding.filenamePreview")}</span>
              <code aria-live="polite">{preview}</code>
            </div>
            <small className="transcode-filename-help">{t("transcoding.filenameTemplateOverrideHelp")}</small>
          </section>
        );
      })()}

      <div className="transcode-actions">
        <button type="button" className="secondary transcode-action-button" onClick={() => void validate()} disabled={validating || Boolean(activeJob)}>
          {validating ? <LoaderCircle className="spin" aria-hidden="true" /> : <Check aria-hidden="true" />}{t("transcoding.validate")}
        </button>
        <button type="button" className="transcode-action-button transcode-start-button" onClick={() => void start()} disabled={starting || Boolean(activeJob) || !capabilities.ffmpeg_available || (plan.output_mode === "replace_original" && !plan.replacement_confirmed)}>
          {starting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{t("transcoding.start")}
        </button>
      </div>

      {validation ? (
        <section className={`transcode-validation ${validation.valid ? "is-valid" : "is-invalid"}`}>
          <h3>{validation.valid ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{t("transcoding.validation.title")}</h3>
          <strong>{validation.output_filename}</strong>
          <code>{validation.output_path}</code>
          <div className="transcode-diff-grid">
            {(["kept_streams", "changed_streams", "removed_streams", "added_streams"] as const).map((key) => (
              <div key={key}><strong>{t(`transcoding.validation.${key}`)}</strong><span>{validation[key].join(", ") || "—"}</span></div>
            ))}
          </div>
          {validation.warnings.map((warning) => <p className="notice compact" key={warning}>{warning}</p>)}
          {validation.errors.map((validationError) => <p className="notice compact error" key={validationError}>{validationError}</p>)}
          <details><summary>{t("transcoding.command")}</summary><code className="transcode-command">{validation.ffmpeg_command}</code></details>
        </section>
      ) : null}

      {activeJob ? (
        <section className="transcode-progress" aria-live="polite">
          <div><strong>{t(`transcoding.status.${activeJob.status}`)}</strong><span>{Math.round(activeJob.progress_percent)}%</span></div>
          <progress max={100} value={activeJob.progress_percent} />
          <p>{activeJob.speed ?? "—"} · {activeJob.eta_seconds != null ? t("transcoding.eta", { seconds: Math.ceil(activeJob.eta_seconds) }) : "—"}</p>
          <button type="button" className="secondary danger" onClick={() => void api.cancelTranscodeJob(activeJob.id).then(setJob)}><Square aria-hidden="true" />{t("common.cancel")}</button>
        </section>
      ) : null}

      <section className="transcode-variants">
        <h3>{t("transcoding.variants")}</h3>
        {(() => {
          const comparisonVariant = data.variants.find((variant) => variant.output_file_id);
          return comparisonVariant?.output_file_id ? (
            <div className="transcode-preview-link-card">
              <Link
                className="secondary transcode-preview-link"
                to={`/files/${data.original.id ?? file.id}/preview?compare=${comparisonVariant.output_file_id}`}
              >
                <Play aria-hidden="true" />
                {t("transcoding.openPreviewComparison")}
              </Link>
            </div>
          ) : <p className="field-hint">{t("transcoding.noVariants")}</p>;
        })()}
      </section>

      <section className="transcode-history-section">
        <h3>{t("transcoding.history.title")}</h3>
        <TranscodeJobHistory jobs={data.jobs} />
      </section>
    </div>
  );
}
