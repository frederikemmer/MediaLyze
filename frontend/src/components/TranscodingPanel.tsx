import { AudioLines, Captions, Check, ChevronDown, ChevronRight, CircleAlert, Copy, ExternalLink, Film, LoaderCircle, Play, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import {
  api,
  type FileTranscode,
  type FilenameCleanupPreset,
  type MediaFileDetail,
  type TranscodeCapabilities,
  type TranscodeFederation,
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
import { parseTranscodeSpeed, TranscodeProgressSummary } from "./TranscodeProgressSummary";
import { TooltipTrigger } from "./TooltipTrigger";

const PROFILE_KEYS = ["compatibility", "storage", "modern"] as const;
const STREAM_ACTIONS: TranscodeStreamAction[] = ["copy", "encode", "drop"];
const STREAM_KINDS = ["video_streams", "audio_streams", "subtitle_streams"] as const;
const TARGET_VIDEO_CODECS = ["h264", "hevc", "av1", "vp8", "vp9", "mpeg2video", "mjpeg"] as const;
const TARGET_AUDIO_CODECS = ["aac", "opus", "vorbis", "ac3", "eac3", "flac", "mp3"] as const;
const TARGET_SUBTITLE_CODECS = ["subrip", "ass", "webvtt", "mov_text"] as const;
const FILENAME_CLEANUP_OPTIONS: Array<{ value: FilenameCleanupPreset; labelKey: string }> = [
  { value: "none", labelKey: "none" },
  { value: "square_brackets", labelKey: "squareBrackets" },
  { value: "round_brackets", labelKey: "roundBrackets" },
  { value: "square_and_round_brackets", labelKey: "squareAndRoundBrackets" },
  { value: "all_brackets", labelKey: "allBrackets" },
  { value: "custom", labelKey: "custom" },
];
const FILENAME_CLEANUP_PATTERNS: Partial<Record<Exclude<FilenameCleanupPreset, "none" | "custom">, string>> = {
  square_brackets: "\\[[^\\[\\]]*\\]",
  round_brackets: "\\([^()]*\\)",
  square_and_round_brackets: "\\[[^\\[\\]]*\\]|\\([^()]*\\)",
  all_brackets: "\\[[^\\[\\]]*\\]|\\([^()]*\\)|\\{[^{}]*\\}",
};
const FILENAME_METADATA_TOKENS = [
  { token: "resolution", labelKey: "resolution" },
  { token: "dynRange", labelKey: "dynRange" },
  { token: "codec", labelKey: "codec" },
  { token: "audioLanguages", labelKey: "audioLanguages" },
  { token: "subtitleLanguages", labelKey: "subtitleLanguages" },
  { token: "container", labelKey: "container" },
  { token: "videoBitrate", labelKey: "videoBitrate" },
] as const;
type FilenameMetadataToken = typeof FILENAME_METADATA_TOKENS[number]["token"];
type FilenameTemplatePart =
  | { type: "text"; value: string }
  | { type: "token"; token: FilenameMetadataToken };

const FILENAME_METADATA_TOKEN_PATTERN = /\{(resolution|dynRange|codec|audioLanguages|subtitleLanguages|container|videoBitrate)\}/g;

function filenameTemplateParts(template: string): FilenameTemplatePart[] {
  const parts: FilenameTemplatePart[] = [];
  let cursor = 0;
  FILENAME_METADATA_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILENAME_METADATA_TOKEN_PATTERN.exec(template)) !== null) {
    if (match.index > cursor) parts.push({ type: "text", value: template.slice(cursor, match.index) });
    parts.push({ type: "token", token: match[1] as FilenameMetadataToken });
    cursor = match.index + match[0].length;
  }
  if (cursor < template.length) parts.push({ type: "text", value: template.slice(cursor) });
  return parts;
}

function escapeFilenameTemplateHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function filenameTemplateEditorMarkup(template: string): string {
  return filenameTemplateParts(template).map((part) => part.type === "token"
    ? `<span class="transcode-filename-inline-token" contenteditable="false" data-filename-token="${part.token}">{${part.token}}</span>`
    : `<span class="transcode-filename-inline-text">${escapeFilenameTemplateHtml(part.value)}</span>`).join("");
}

function filenameTemplateNodeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").length;
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const element = node as HTMLElement;
  const token = element.dataset.filenameToken;
  if (token) return `{${token}}`.length;
  if (element.tagName === "BR") return 1;
  return Array.from(node.childNodes).reduce((total, child) => total + filenameTemplateNodeLength(child), 0);
}

function filenameTemplateFromEditor(root: HTMLElement): string {
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as HTMLElement;
    const token = element.dataset.filenameToken;
    if (token) return `{${token}}`;
    if (element.tagName === "BR") return "\n";
    const content = Array.from(node.childNodes).map(serialize).join("");
    return element !== root && (element.tagName === "DIV" || element.tagName === "P") ? `${content}\n` : content;
  };
  return Array.from(root.childNodes).map(serialize).join("").replace(/\u00a0/g, " ");
}

function filenameTemplateOffsetFromPoint(root: HTMLElement, container: Node, offset: number): number | null {
  if (container !== root && !root.contains(container)) return null;

  const measure = (node: Node): number | null => {
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) return Math.min(offset, (node.textContent ?? "").length);
      const children = Array.from(node.childNodes);
      return children.slice(0, Math.min(offset, children.length)).reduce((total, child) => total + filenameTemplateNodeLength(child), 0);
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.filenameToken) return null;
    let before = 0;
    for (const child of Array.from(node.childNodes)) {
      const result = measure(child);
      if (result !== null) return before + result;
      before += filenameTemplateNodeLength(child);
    }
    return null;
  };

  return measure(root);
}

function filenameTemplateSelectionFromEditor(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) return null;
  const start = filenameTemplateOffsetFromPoint(root, selection.anchorNode, selection.anchorOffset);
  const end = filenameTemplateOffsetFromPoint(root, selection.focusNode, selection.focusOffset);
  if (start === null || end === null) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

function restoreFilenameTemplateCaret(root: HTMLElement, targetOffset: number): void {
  const boundary = (() => {
    let consumed = 0;
    const visit = (node: Node): { container: Node; offset: number } | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        const length = (node.textContent ?? "").length;
        if (targetOffset <= consumed + length) return { container: node, offset: Math.max(0, targetOffset - consumed) };
        consumed += length;
        return null;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        const token = element.dataset.filenameToken;
        if (token) {
          const length = `{${token}}`.length;
          const parent = node.parentNode;
          if (parent && targetOffset <= consumed + length) {
            const index = Array.prototype.indexOf.call(parent.childNodes, node) as number;
            return { container: parent, offset: targetOffset <= consumed ? index : index + 1 };
          }
          consumed += length;
          return null;
        }
      }
      for (const child of Array.from(node.childNodes)) {
        const result = visit(child);
        if (result) return result;
      }
      return null;
    };
    return visit(root) ?? { container: root, offset: root.childNodes.length };
  })();

  root.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(boundary.container, boundary.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

type StreamKind = (typeof STREAM_KINDS)[number];
type QualityMode = "crf" | "cq" | "qp" | "global_quality";
type QualitySpec = { mode: QualityMode; min: number; max: number; default: number; step: number };
type PresetFamily = "x264" | "qsv" | "nvenc" | "amf" | "svtav1" | "generic";
type PresetOption = { value: string; labelKey: string };

function qualityRangeIsReversed(spec: QualitySpec): boolean {
  // CRF, CQ, QP, and FFmpeg's constant-quality/global-quality indexes all use
  // lower numeric values for higher quality in the encoder modes we expose.
  // Keep this decision in one place so a future higher-is-better mode can opt
  // out without changing the range control itself.
  return spec.mode === "crf" || spec.mode === "cq" || spec.mode === "qp" || spec.mode === "global_quality";
}

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

function filenameCleanupPattern(plan: TranscodePlan): string | null {
  const preset = plan.filename_cleanup_preset ?? "none";
  if (preset === "none") return null;
  if (preset === "custom") return plan.filename_cleanup_regex?.trim() || null;
  return FILENAME_CLEANUP_PATTERNS[preset] ?? null;
}

function filenameCleanupError(plan: TranscodePlan): string | null {
  const pattern = filenameCleanupPattern(plan);
  if (!pattern) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch {
    return "invalid";
  }
}

function cleanFilenameStem(stem: string, plan: TranscodePlan): string {
  const pattern = filenameCleanupPattern(plan);
  if (!pattern || filenameCleanupError(plan)) return stem;
  return stem.replace(new RegExp(pattern, "g"), "").replace(/\s+/g, " ").trim().replace(/^[ ._-]+|[ ._-]+$/g, "");
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
  const metadataSeparator = plan.filename_metadata_separator ?? ", ";
  const bitrate = primaryPlan?.bitrate ?? sourceVideo?.bit_rate;
  return {
    resolution: width && height ? `${width}x${height}` : "",
    dynRange: plan.dynamic_range === "preserve"
      ? data.original.dynamic_range ?? file.hdr_type ?? ""
      : plan.dynamic_range,
    codec: (codec ?? "").toUpperCase(),
    audioLanguages: audioLanguages.join(metadataSeparator),
    subtitleLanguages: allSubtitleLanguages.join(metadataSeparator),
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
  const stem = cleanFilenameStem(file.filename.replace(/\.[^./\\]+$/, ""), plan);
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

function streamTabLabelKey(kind: StreamKind): "video" | "audio" | "subtitles" {
  return kind === "video_streams" ? "video" : kind === "audio_streams" ? "audio" : "subtitles";
}

function StreamKindIcon({ kind }: { kind: StreamKind }) {
  if (kind === "video_streams") return <Film aria-hidden="true" />;
  if (kind === "audio_streams") return <AudioLines aria-hidden="true" />;
  return <Captions aria-hidden="true" />;
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

function targetCodecOptions(
  kind: StreamKind,
  container: TranscodePlan["container"],
): string[] {
  const values = kind === "video_streams"
    ? [...TARGET_VIDEO_CODECS]
    : kind === "audio_streams"
      ? [...TARGET_AUDIO_CODECS]
      : [...TARGET_SUBTITLE_CODECS];
  const allowedByContainer: Record<TranscodePlan["container"], Partial<Record<StreamKind, string[]>>> = {
    mkv: {},
    mp4: {
      video_streams: ["h264", "hevc", "av1", "mjpeg"],
      audio_streams: ["aac", "ac3", "eac3", "mp3"],
      subtitle_streams: ["mov_text"],
    },
    webm: {
      video_streams: ["vp8", "vp9", "av1"],
      audio_streams: ["opus", "vorbis"],
      subtitle_streams: ["webvtt"],
    },
  };
  const allowed = allowedByContainer[container][kind];
  const filtered = allowed ? values.filter((codec) => allowed.includes(codec)) : values;
  return filtered;
}

function targetCodecInfo(
  codec: string,
  kind: "video" | "audio" | "subtitle",
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return t("transcoding.targetCodecInfo", {
    codec: formatCodecLabel(codec, kind),
  });
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
  dynamicRangeOptions: TranscodePlan["dynamic_range"][];
  onPlanPatch: (patch: Partial<TranscodePlan>) => void;
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
  expanded,
  onChange,
}: {
  streamIndex: number;
  value: string;
  controlClass: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  expanded: boolean;
  onChange: (value: TranscodeStreamAction) => void;
}) {
  const action = STREAM_ACTIONS.includes(value as TranscodeStreamAction)
    ? value as TranscodeStreamAction
    : "copy";
  const ActionIcon = action === "copy" ? Copy : action === "encode" ? RefreshCw : Trash2;
  return (
    <div className={`transcode-action-field ${expanded ? "is-expanded" : "is-collapsed"}`} data-action={action}>
      <ActionIcon aria-hidden="true" className="transcode-stream-action-icon" />
      <select
        className={`${controlClass} transcode-action-select`}
        aria-label={t("transcoding.streamAction", { index: streamIndex })}
        title={t("transcoding.actionHelp")}
        value={action}
        onChange={(event) => onChange(event.target.value as TranscodeStreamAction)}
      >
        {STREAM_ACTIONS.map((action) => <option key={action} value={action}>{t(`transcoding.actions.${action}`)}</option>)}
      </select>
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
  dynamicRangeOptions,
  onPlanPatch,
}: StreamControlFieldsProps) {
  const sourceCodec = source?.codec;
  const targetCodecs = targetCodecOptions(kind, plan.container);
  const selectedCodec = stream.codec ?? targetCodecs[0] ?? sourceCodec ?? "";
  // Local capabilities only provide sensible quality-control defaults. The
  // worker-specific encoder is resolved by the backend for the final target.
  const selected = encoders.find((encoder) => encoder.codec === selectedCodec)
    ?? pickEncoder(kind, selectedCodec, plan.container, encoders);
  if (kind === "video_streams") {
    const spec = encoderQualitySpec(selected);
    const quality = selectedQuality(stream, spec);
    const qualityRangeClassName = `${controlClass} transcode-quality-range${qualityRangeIsReversed(spec) ? " is-reversed" : ""}`;
    const presetFamily = encoderPresetFamily(selected);
    const presetOptions = encoderPresetOptions(selected);
    const preset = selectedPresetValue(stream, selected);
    const resolutions = resolutionOptions(source as VideoStream | undefined, stream.width, stream.height, t);
    const resolutionValue = stream.width && stream.height ? `${stream.width}x${stream.height}` : "original";
    const patchQuality = (value: number) => {
      const nextQuality = clampQuality(value, spec);
      onPatch({ crf: spec.mode === "crf" ? nextQuality : null, cq: spec.mode === "crf" ? null : nextQuality });
    };
    return (
      <div className="transcode-stream-encode-fields transcode-video-encode-fields">
        <label className="transcode-control-field transcode-dynamic-range-field">
          <span className="transcode-field-label">
            <span>{t("transcoding.dynamicRange")}</span>
          </span>
          <select
            className={controlClass}
            aria-label={`video ${stream.stream_index} dynamic range`}
            value={plan.dynamic_range}
            onChange={(event) => onPlanPatch({ dynamic_range: event.target.value as TranscodePlan["dynamic_range"] })}
          >
            {dynamicRangeOptions.map((value) => <option key={value} value={value}>{t(`transcoding.dynamicRanges.${value}`)}</option>)}
          </select>
        </label>
        <label className="transcode-control-field transcode-codec-field">
          <span className="transcode-field-label">
            <span>{t("transcoding.targetCodec")}</span>
            <TooltipTrigger ariaLabel={t("transcoding.targetCodecInfoAria")} content={targetCodecInfo(selectedCodec, "video", t)} />
          </span>
          <select
            className={controlClass}
            aria-label={`video ${stream.stream_index} codec`}
            value={targetCodecs.includes(selectedCodec) ? selectedCodec : targetCodecs[0] ?? ""}
            onChange={(event) => {
              const nextCodec = event.target.value;
              const next = encoders.find((encoder) => encoder.codec === nextCodec)
                ?? pickEncoder(kind, nextCodec, plan.container, encoders);
              const nextSpec = encoderQualitySpec(next);
              const nextQuality = clampQuality(quality, nextSpec);
              onPatch({
                encoder: null,
                codec: nextCodec,
                crf: nextSpec.mode === "crf" ? nextQuality : null,
                cq: nextSpec.mode === "crf" ? null : nextQuality,
                preset: null,
              });
            }}
          >
            {targetCodecs.map((codec) => <option key={codec} value={codec}>{formatCodecLabel(codec, "video")}</option>)}
          </select>
        </label>
        <label className="transcode-control-field transcode-range-field">
          <span className="transcode-field-label">
            <span>{t("transcoding.quality", { mode: qualityModeLabel(spec.mode) })}</span>
            <TooltipTrigger ariaLabel={t("transcoding.qualityHelpAria")} content={t("transcoding.qualityHelp", { mode: qualityModeLabel(spec.mode), min: spec.min, max: spec.max, default: spec.default, guidance: qualityGuidance(selected, spec, t) })} />
          </span>
          <span className="transcode-range-row">
            <input
              className={qualityRangeClassName}
              aria-label={`video ${stream.stream_index} quality`}
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={quality}
              aria-valuetext={`${qualityModeLabel(spec.mode)} ${quality}`}
              onChange={(event) => patchQuality(Number(event.target.value))}
            />
            <input
              className={`${controlClass} transcode-range-value`}
              aria-label={`video ${stream.stream_index} quality value`}
              type="number"
              inputMode="numeric"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={quality}
              onChange={(event) => {
                if (!event.target.value) return;
                const nextQuality = Number(event.target.value);
                if (Number.isFinite(nextQuality)) patchQuality(nextQuality);
              }}
            />
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
    const values = AUDIO_BITRATES[selectedCodec] ?? DEFAULT_AUDIO_BITRATES;
    const currentBitrate = stream.bitrate && values.includes(stream.bitrate) ? stream.bitrate : defaultAudioBitrate(source as AudioStream | undefined, selectedCodec);
    const sliderIndex = Math.max(0, values.indexOf(currentBitrate));
    return (
      <div className="transcode-stream-encode-fields">
        <label className="transcode-control-field transcode-codec-field">
          <span className="transcode-field-label">
            <span>{t("transcoding.targetCodec")}</span>
            <TooltipTrigger ariaLabel={t("transcoding.targetCodecInfoAria")} content={targetCodecInfo(selectedCodec, "audio", t)} />
          </span>
          <select
            className={controlClass}
            aria-label={`audio ${stream.stream_index} codec`}
            value={targetCodecs.includes(selectedCodec) ? selectedCodec : targetCodecs[0] ?? ""}
            onChange={(event) => {
              const nextCodec = event.target.value;
              onPatch({ encoder: null, codec: nextCodec, bitrate: defaultAudioBitrate(source as AudioStream | undefined, nextCodec) || null });
            }}
          >
            {targetCodecs.map((codec) => <option key={codec} value={codec}>{formatCodecLabel(codec, "audio")}</option>)}
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
      <label className="transcode-control-field transcode-codec-field">
        <span className="transcode-field-label">
          <span>{t("transcoding.targetCodec")}</span>
          <TooltipTrigger ariaLabel={t("transcoding.targetCodecInfoAria")} content={targetCodecInfo(selectedCodec, "subtitle", t)} />
        </span>
        <select
          className={controlClass}
          aria-label={`subtitle ${stream.stream_index} codec`}
          value={targetCodecs.includes(selectedCodec) ? selectedCodec : targetCodecs[0] ?? ""}
          onChange={(event) => {
            onPatch({ encoder: null, codec: event.target.value });
          }}
        >
          {targetCodecs.map((codec) => <option key={codec} value={codec}>{formatCodecLabel(codec, "subtitle")}</option>)}
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

const COPY_STREAM_PATCH: Record<string, unknown> = {
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
};

function clonePlan(plan: TranscodePlan): TranscodePlan {
  const clone = JSON.parse(JSON.stringify(plan)) as TranscodePlan;
  for (const kind of STREAM_KINDS) {
    clone[kind] = clone[kind].map((stream) => stream.action === "keep" ? { ...stream, action: "copy" } : stream);
  }
  return clone;
}

function defaultUnchangedPlan(plan: TranscodePlan): TranscodePlan {
  const clone = clonePlan(plan);
  for (const kind of STREAM_KINDS) {
    clone[kind] = clone[kind].map((stream) => ({ ...stream, ...COPY_STREAM_PATCH }) as typeof stream);
  }
  return clone;
}

function automaticEncoderPlan(plan: TranscodePlan): TranscodePlan {
  return {
    ...plan,
    video_streams: plan.video_streams.map((stream) => stream.action === "encode" ? { ...stream, encoder: null } : stream),
    audio_streams: plan.audio_streams.map((stream) => stream.action === "encode" ? { ...stream, encoder: null } : stream),
    subtitle_streams: plan.subtitle_streams.map((stream) => stream.action === "encode" ? { ...stream, encoder: null } : stream),
  };
}

function targetLabel(plan: TranscodePlan, federation: TranscodeFederation | null): string {
  if (plan.target_mode === "member") {
    return federation?.members.find((member) => member.installation_id === plan.target_member_id)?.display_name ?? plan.target_member_id ?? "member";
  }
  return plan.target_mode === "automatic" ? "automatic" : "local";
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
            <span className="file-history-entry-chevron" aria-hidden="true">
              <ChevronRight className="nav-icon" />
            </span>
            <strong>{t(`transcoding.profiles.${job.profile}`, { defaultValue: job.profile })}</strong>
            <span className={`badge transcode-status-${job.status}`}>{t(`transcoding.status.${job.status}`)}</span>
            <span>{job.output_relative_path}</span>
          </summary>
          <div className="transcode-job-detail">
            <dl>
              <div><dt>{t("transcoding.sourcePath")}</dt><dd><code>{job.source_path_snapshot}</code></dd></div>
              <div><dt>{t("transcoding.outputPath")}</dt><dd><code>{job.output_path_snapshot}</code></dd></div>
              {job.target_member_name || job.target_member_id ? <div><dt>{t("transcoding.federation.target")}</dt><dd>{job.target_member_name ?? job.target_member_id}</dd></div> : null}
              {job.processing_phase ? <div><dt>{t("transcoding.federation.phase")}</dt><dd>{t(`transcoding.federation.phases.${job.processing_phase}`, { defaultValue: job.phase_detail ?? job.processing_phase })}</dd></div> : null}
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
      <h3>{t("fileDetail.history.withTranscoding")}</h3>
      {error ? <p className="notice error">{error}</p> : null}
      {jobs ? <TranscodeJobHistory jobs={jobs} /> : <p className="field-hint">{t("panel.loading")}</p>}
    </section>
  );
}

export function TranscodingPanel({ file }: { file: MediaFileDetail }) {
  const { t, i18n } = useTranslation();
  const federationAutoAppliedRef = useRef(false);
  const [data, setData] = useState<FileTranscode | null>(null);
  const [capabilities, setCapabilities] = useState<TranscodeCapabilities | null>(null);
  const [federation, setFederation] = useState<TranscodeFederation | null>(null);
  const [plan, setPlan] = useState<TranscodePlan | null>(null);
  const [selectedSavedProfileId, setSelectedSavedProfileId] = useState<number | null>(null);
  const [validation, setValidation] = useState<TranscodeValidation | null>(null);
  const [job, setJob] = useState<TranscodeJob | null>(null);
  const [activeStreamTab, setActiveStreamTab] = useState<StreamKind>("video_streams");
  const [expandedStreamRows, setExpandedStreamRows] = useState<Record<StreamKind, number | null>>({
    video_streams: null,
    audio_streams: null,
    subtitle_streams: null,
  });
  const [openExternalSubtitles, setOpenExternalSubtitles] = useState(false);
  const [openFilenameSection, setOpenFilenameSection] = useState(true);
  const [metadataTokensOpen, setMetadataTokensOpen] = useState(false);
  const filenameTemplateInputRef = useRef<HTMLDivElement | null>(null);
  const filenameTemplateSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const speedHistoryRef = useRef<number[]>([]);
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
    setPlan((current) => current ?? defaultUnchangedPlan(nextData.profiles.compatibility));
    setJob(nextData.jobs.find(jobIsActive) ?? null);
    setError(null);
  }, [file.id]);

  useEffect(() => {
    let disposed = false;
    api.transcodeFederation()
      .then((payload) => { if (!disposed) setFederation(payload); })
      .catch(() => { if (!disposed) setFederation(null); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    setData(null);
    setCapabilities(null);
    setPlan(null);
    federationAutoAppliedRef.current = false;
    setSelectedSavedProfileId(null);
    setValidation(null);
    setJob(null);
    setActiveStreamTab("video_streams");
    setExpandedStreamRows({ video_streams: null, audio_streams: null, subtitle_streams: null });
    setOpenExternalSubtitles(false);
    setOpenFilenameSection(true);
    setMetadataTokensOpen(false);
    filenameTemplateSelectionRef.current = null;
    speedHistoryRef.current = [];
    setError(null);
    setLoading(true);
    void refresh().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!federation?.settings.enabled || !plan || federationAutoAppliedRef.current || plan.target_mode !== "local") return;
    federationAutoAppliedRef.current = true;
    setPlan({ ...automaticEncoderPlan(plan), target_mode: "automatic" });
  }, [federation?.settings.enabled, plan]);

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

  useEffect(() => {
    if (!job || !jobIsActive(job)) return;
    const value = parseTranscodeSpeed(job.speed);
    if (value === null || speedHistoryRef.current.at(-1) === value) return;
    speedHistoryRef.current = [...speedHistoryRef.current, value].slice(-36);
  }, [job?.id, job?.speed, job?.status]);

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

  const setPlanKeepingTarget = useCallback((nextPlan: TranscodePlan) => {
    setPlan((current) => ({
      ...nextPlan,
      target_mode: current?.target_mode ?? nextPlan.target_mode ?? "local",
      target_member_id: current?.target_member_id ?? nextPlan.target_member_id ?? null,
      target_device_id: current?.target_device_id ?? nextPlan.target_device_id ?? null,
    }));
  }, []);

  const selectProfile = useCallback((profile: typeof PROFILE_KEYS[number]) => {
    if (!data) return;
    setSelectedSavedProfileId(null);
    setPlanKeepingTarget(clonePlan(data.profiles[profile]));
    setValidation(null);
  }, [data, setPlanKeepingTarget]);

  const setExpertPlan = useCallback((next: TranscodePlan) => {
    setSelectedSavedProfileId(null);
    setPlan(next);
  }, []);

  const insertFilenameToken = useCallback((token: string) => {
    if (!plan) return;
    const currentTemplate = plan.filename_template_override === false
      ? filenameTemplateForSubtitleOption(plan.include_subtitle_languages ?? plan.filename_template.includes("{subtitleLanguages}"))
      : plan.filename_template;
    const insertion = `{${token}}`;
    const selection = filenameTemplateSelectionRef.current;
    const start = selection ? Math.min(selection.start, currentTemplate.length) : currentTemplate.length;
    const end = selection ? Math.min(selection.end, currentTemplate.length) : start;
    const nextTemplate = `${currentTemplate.slice(0, start)}${insertion}${currentTemplate.slice(end)}`;
    setExpertPlan({
      ...plan,
      profile: "expert",
      filename_template: nextTemplate,
      filename_template_override: true,
      include_subtitle_languages: nextTemplate.includes("{subtitleLanguages}"),
    });
    setMetadataTokensOpen(false);
    setValidation(null);
    window.setTimeout(() => {
      const nextInput = filenameTemplateInputRef.current;
      if (!nextInput) return;
      const nextPosition = start + insertion.length;
      restoreFilenameTemplateCaret(nextInput, nextPosition);
      filenameTemplateSelectionRef.current = { start: nextPosition, end: nextPosition };
    }, 0);
  }, [plan, setExpertPlan]);

  const updateFilenameTemplate = useCallback((nextTemplate: string) => {
    if (!plan) return;
    setExpertPlan({
      ...plan,
      profile: "expert",
      filename_template: nextTemplate,
      filename_template_override: true,
      include_subtitle_languages: nextTemplate.includes("{subtitleLanguages}"),
    });
    setValidation(null);
  }, [plan, setExpertPlan]);

  const handleFilenameTemplateKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const editor = event.currentTarget;
    const selection = filenameTemplateSelectionFromEditor(editor);
    if (!selection || selection.start !== selection.end) return;

    const currentTemplate = filenameTemplateFromEditor(editor);
    const tokenText = FILENAME_METADATA_TOKENS
      .map(({ token }) => `{${token}}`)
      .find((candidate) => event.key === "Backspace"
        ? currentTemplate.slice(0, selection.start).endsWith(candidate)
        : currentTemplate.slice(selection.start).startsWith(candidate));
    if (!tokenText) return;

    event.preventDefault();
    const start = event.key === "Backspace" ? selection.start - tokenText.length : selection.start;
    const end = event.key === "Backspace" ? selection.start : selection.start + tokenText.length;
    const nextTemplate = `${currentTemplate.slice(0, start)}${currentTemplate.slice(end)}`;
    filenameTemplateSelectionRef.current = { start, end: start };
    updateFilenameTemplate(nextTemplate);
    window.setTimeout(() => {
      const nextEditor = filenameTemplateInputRef.current;
      if (nextEditor) restoreFilenameTemplateCaret(nextEditor, start);
    }, 0);
  }, [updateFilenameTemplate]);

  const validate = useCallback(async (): Promise<TranscodeValidation | null> => {
    if (!plan) return null;
    setValidating(true);
    setError(null);
    try {
      const result = await api.validateFileTranscode(file.id, automaticEncoderPlan(plan));
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

  const displayedFilenameTemplate = plan
    ? plan.filename_template_override === false
      ? filenameTemplateForSubtitleOption(plan.include_subtitle_languages ?? plan.filename_template.includes("{subtitleLanguages}"))
      : plan.filename_template
    : "";

  useLayoutEffect(() => {
    const editor = filenameTemplateInputRef.current;
    const selection = filenameTemplateSelectionRef.current;
    if (!editor || !selection || document.activeElement !== editor) return;
    restoreFilenameTemplateCaret(editor, selection.end);
  }, [displayedFilenameTemplate]);

  if (loading) return <div className="panel-loader"><LoaderCircle className="spin" aria-hidden="true" />{t("panel.loading")}</div>;
  if (!data || !plan || !capabilities) return <p className="notice error">{error ?? t("transcoding.unavailable")}</p>;

  const activeJob = jobIsActive(job) ? job : null;
  const transcodeControlClass = "settings-choice-input transcode-control";
  const dynamicRangeOptions: TranscodePlan["dynamic_range"][] = ["preserve", "sdr", "hdr10", "hlg"];
  if (
    capabilities.dolby_vision_passthrough
    && data.original.dynamic_range?.toLowerCase().includes("dolby")
    && ["mkv", "mp4"].includes(plan.container)
    && ["hevc", "h265"].includes(data.original.video_codec?.toLowerCase() ?? "")
    && plan.video_streams.every((stream) => stream.action === "keep" || stream.action === "copy")
  ) {
    dynamicRangeOptions.push("dolby_vision");
  }

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
      </section>

      <div className="transcode-configuration-grid">
        <label>
          <span>{t("transcoding.profile")}</span>
          <select className={transcodeControlClass} value={selectedSavedProfileId !== null && data.saved_profiles?.some((entry) => entry.profile.id === selectedSavedProfileId) ? `saved:${selectedSavedProfileId}` : PROFILE_KEYS.includes(plan.profile as typeof PROFILE_KEYS[number]) ? plan.profile : "expert"} onChange={(event) => {
            const profile = event.target.value;
            if (profile.startsWith("saved:")) {
              const savedProfile = data.saved_profiles?.find((entry) => `saved:${entry.profile.id}` === profile);
              if (savedProfile) {
                setSelectedSavedProfileId(savedProfile.profile.id);
                setPlanKeepingTarget(clonePlan(savedProfile.plan));
                setValidation(null);
              }
            } else if (profile !== "expert") {
              selectProfile(profile as typeof PROFILE_KEYS[number]);
            } else {
              setExpertPlan({ ...plan, profile: "expert" });
              setValidation(null);
            }
          }}>
            {PROFILE_KEYS.map((profile) => <option key={profile} value={profile}>{t(`transcoding.profiles.${profile}`)}</option>)}
            {data.saved_profiles?.map((entry) => (
              <option key={`saved:${entry.profile.id}`} value={`saved:${entry.profile.id}`}>
                {entry.profile.name} · v{entry.profile.version}
              </option>
            ))}
            <option value="expert">{t("transcoding.profiles.expert")}</option>
          </select>
        </label>
        <label>
          <span>{t("transcoding.container")}</span>
          <select className={transcodeControlClass} value={plan.container} onChange={(event) => {
            setExpertPlan({ ...plan, profile: "expert", container: event.target.value as TranscodePlan["container"] });
            setValidation(null);
          }}>
            {capabilities.containers.map((container) => <option key={container} value={container}>{container.toUpperCase()}</option>)}
          </select>
        </label>
        <label>
          <span>{t("transcoding.outputMode")}</span>
          <select
            className={transcodeControlClass}
            title={t("transcoding.outputModeHint")}
            value={plan.output_mode ?? "transcode_output"}
            onChange={(event) => {
              setExpertPlan({
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
        </label>
        <label>
          <span>{t("transcoding.federation.target")}</span>
          <select
            className={transcodeControlClass}
            title={t("transcoding.federation.targetHint", { target: targetLabel(plan, federation) })}
            value={plan.target_mode === "member" ? `member:${plan.target_member_id ?? ""}` : (plan.target_mode ?? "local")}
            onChange={(event) => {
              const rawValue = event.target.value;
              const isMember = rawValue.startsWith("member:");
              const next = (isMember ? "member" : rawValue) as NonNullable<TranscodePlan["target_mode"]>;
              setExpertPlan({
                ...plan,
                profile: "expert",
                target_mode: next,
                target_member_id: isMember ? rawValue.slice("member:".length) : null,
                target_device_id: null,
              });
              setValidation(null);
            }}
          >
            <option value="local">{t("transcoding.federation.targetLocal")}</option>
            <option value="automatic" disabled={!federation?.settings.enabled}>{t("transcoding.federation.targetAutomatic")}</option>
            {federation?.members.map((member) => <option key={member.installation_id} value={`member:${member.installation_id}`} disabled={!member.reachable}>{member.display_name}</option>)}
          </select>
        </label>
        {plan.target_mode === "member" && plan.target_member_id ? (() => {
          const member = federation?.members.find((candidate) => candidate.installation_id === plan.target_member_id);
          const devices = member?.capabilities?.devices?.filter((device) => device.status === "available") ?? [];
          return devices.length ? (
            <label>
              <span>{t("transcoding.federation.targetDevice")}</span>
              <select className={transcodeControlClass} value={plan.target_device_id ?? ""} onChange={(event) => setExpertPlan({ ...plan, profile: "expert", target_device_id: event.target.value || null })}>
                <option value="">{t("transcoding.federation.anyDevice")}</option>
                <option value="cpu">{t("transcoding.federation.cpuDevice")}</option>
                {devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.backend}</option>)}
              </select>
            </label>
          ) : null;
        })() : null}
      </div>

      {plan.output_mode === "replace_original" ? (
        <div className="transcode-replacement-warning">
          <div className="notice warning">{t("transcoding.replacementWarning")}</div>
          <p className="field-hint">{t("common.replacementTestingNotice")}</p>
          <label className="transcode-filename-option">
            <input
              type="checkbox"
              checked={Boolean(plan.replacement_confirmed)}
              onChange={(event) => setExpertPlan({ ...plan, replacement_confirmed: event.target.checked })}
            />
            <span>{t("transcoding.replacementConfirm")}</span>
          </label>
        </div>
      ) : null}

      <section className="transcode-streams">
        <div className="transcode-automation-tab-controls transcode-stream-tabs">
          <div className="transcode-automation-tab-list" role="tablist" aria-label={t("transcoding.streamTabs.ariaLabel")} aria-orientation="horizontal">
            {STREAM_KINDS.map((kind, index) => {
              const tabKey = streamTabLabelKey(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  id={`transcode-stream-tab-${tabKey}`}
                  role="tab"
                  className={`transcode-automation-tab-button transcode-stream-tab${activeStreamTab === kind ? " active" : ""}`}
                  aria-selected={activeStreamTab === kind}
                  aria-controls={`transcode-stream-panel-${tabKey}`}
                  tabIndex={activeStreamTab === kind ? 0 : -1}
                  onClick={() => setActiveStreamTab(kind)}
                  onKeyDown={(event) => {
                    let nextIndex: number | null = null;
                    if (event.key === "ArrowRight") nextIndex = (index + 1) % STREAM_KINDS.length;
                    if (event.key === "ArrowLeft") nextIndex = (index - 1 + STREAM_KINDS.length) % STREAM_KINDS.length;
                    if (event.key === "Home") nextIndex = 0;
                    if (event.key === "End") nextIndex = STREAM_KINDS.length - 1;
                    if (nextIndex === null) return;
                    event.preventDefault();
                    const nextKind = STREAM_KINDS[nextIndex];
                    setActiveStreamTab(nextKind);
                    window.requestAnimationFrame(() => document.getElementById(`transcode-stream-tab-${streamTabLabelKey(nextKind)}`)?.focus());
                  }}
                >
                  <StreamKindIcon kind={kind} />
                  <span className="transcode-automation-tab-label">{t(`transcoding.streamTabs.${tabKey}`)}</span>
                  <span className="transcode-stream-tab-count">{plan[kind].length}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div
          id={`transcode-stream-panel-${streamTabLabelKey(activeStreamTab)}`}
          className="transcode-stream-tabpanel"
          role="tabpanel"
          aria-labelledby={`transcode-stream-tab-${streamTabLabelKey(activeStreamTab)}`}
          tabIndex={0}
        >
          <div className="transcode-stream-list">
            {plan[activeStreamTab].length ? plan[activeStreamTab].map((stream) => {
              const kind = activeStreamTab;
              const source = sourceForStream(file, kind, stream.stream_index);
              const language = source && "language" in source ? source.language : null;
              const languageLabel = formatLanguageLabel(language ?? "und", i18n.language);
              const streamAction = stream.action === "keep" ? "copy" : stream.action;
              const codecKind = streamKindLabel(kind);
              const streamEncoders = kind === "video_streams" ? availableVideoEncoders : kind === "audio_streams" ? availableAudioEncoders : availableSubtitleEncoders;
              const streamCodecs = targetCodecOptions(kind, plan.container);
              const selectedCodec = stream.codec && streamCodecs.includes(stream.codec)
                ? stream.codec
                : streamCodecs[0] ?? source?.codec ?? "";
              const selectedEncoder = streamEncoders.find((encoder) => encoder.codec === selectedCodec)
                ?? pickEncoder(kind, selectedCodec, plan.container, streamEncoders);
              const isExpanded = expandedStreamRows[kind] === stream.stream_index;
              const detailsId = `transcode-stream-details-${kind}-${stream.stream_index}`;
              const resetToCopy = () => {
                setExpertPlan(updateStreamPlan(plan, kind, stream.stream_index, COPY_STREAM_PATCH));
                setValidation(null);
              };
              const setAction = (action: TranscodeStreamAction) => {
                if (action === "copy") {
                  resetToCopy();
                  return;
                }
                if (action === "drop") {
                  setExpertPlan(updateStreamPlan(plan, kind, stream.stream_index, { action }));
                  setValidation(null);
                  return;
                }
                const targetCodec = selectedCodec || selectedEncoder?.codec || source?.codec || "";
                const quality = encoderQualitySpec(selectedEncoder);
                const sourceLanguage = source && "language" in source ? normalizeLanguageTag(source.language) : "und";
                setExpertPlan(updateStreamPlan(plan, kind, stream.stream_index, {
                  action: "encode",
                  encoder: null,
                  codec: targetCodec || null,
                  crf: kind === "video_streams" && quality.mode === "crf" ? quality.default : null,
                  cq: kind === "video_streams" && quality.mode !== "crf" ? quality.default : null,
                  preset: null,
                  bitrate: kind === "audio_streams" ? defaultAudioBitrate(source as AudioStream | undefined, targetCodec || "aac") || null : null,
                  language: kind !== "video_streams" ? sourceLanguage || "und" : null,
                  width: null,
                  height: null,
                }));
                setValidation(null);
              };
              return (
                <article key={stream.stream_index} className={`transcode-stream-list-item${isExpanded ? " is-expanded" : ""}`}>
                  <div className="transcode-stream-list-row">
                    <button
                      type="button"
                      className="transcode-stream-row-trigger"
                      aria-label={`${t(`transcoding.streamKinds.${codecKind}`)} ${stream.stream_index}: ${formatCodecLabel(source?.codec, codecKind)} · ${languageLabel}`}
                      aria-expanded={isExpanded}
                      aria-controls={isExpanded ? detailsId : undefined}
                      onClick={() => setExpandedStreamRows((current) => ({ ...current, [kind]: isExpanded ? null : stream.stream_index }))}
                    >
                      <span className="transcode-stream-row-copy">
                        <strong>#{stream.stream_index}</strong>
                        <span>{formatCodecLabel(source?.codec, codecKind)}</span>
                        <span className="transcode-language-badge">{languageLabel}</span>
                      </span>
                      <ChevronDown aria-hidden="true" />
                    </button>
                    <StreamActionField
                      streamIndex={stream.stream_index}
                      value={streamAction}
                      controlClass={transcodeControlClass}
                      t={t}
                      expanded={isExpanded}
                      onChange={setAction}
                    />
                  </div>
                  {isExpanded ? (
                    <div id={detailsId} className="transcode-stream-details">
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
                          dynamicRangeOptions={dynamicRangeOptions}
                          onPlanPatch={(patch) => {
                            setExpertPlan({ ...plan, ...patch, profile: "expert" });
                            setValidation(null);
                          }}
                          onPatch={(patch) => {
                            setExpertPlan(updateStreamPlan(plan, kind, stream.stream_index, patch));
                            setValidation(null);
                          }}
                        />
                      ) : streamAction === "copy" ? (
                        <div className="transcode-stream-copy-details">
                          <p className="field-hint transcode-stream-copy-note">{t("transcoding.copyNote")}</p>
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
                        </div>
                      ) : <p className="field-hint transcode-stream-drop-note">{t("transcoding.dropNote")}</p>}
                    </div>
                  ) : null}
                </article>
              );
            }) : <p className="field-hint transcode-stream-empty">{t("transcoding.noStreams")}</p>}
          </div>
        </div>
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
                    setExpertPlan({
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

      {data.attachments.length ? (
        <section className="transcode-stream-section">
          <h3>{t("transcoding.attachments")}</h3>
          <div className="transcode-attachment-list">
            {data.attachments.map((attachment) => (
              <article key={attachment.stream_index}>
                <strong>#{attachment.stream_index} · {attachment.filename ?? attachment.title ?? t("transcoding.attachment")}</strong>
                <span>{[attachment.codec, attachment.mimetype, attachment.title].filter(Boolean).join(" · ") || "—"}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="transcode-global-options">
        {(["chapters", "metadata", "cover", "attachments"] as const).map((option) => (
          <label key={option}>
            <input type="checkbox" checked={plan[option] === "keep"} onChange={(event) => setExpertPlan({ ...plan, profile: "expert", [option]: event.target.checked ? "keep" : "drop" })} />
            <span>{t(`transcoding.options.${option}`)}</span>
          </label>
        ))}
      </div>

      {(() => {
        const displayedTemplate = displayedFilenameTemplate;
        const filenameCleanupPreset = plan.filename_cleanup_preset ?? "none";
        const cleanupError = filenameCleanupError(plan);
        const preview = renderFilenamePreview(file, data, plan);
        return (
          <section className={`media-card library-settings-card transcode-filename-section${openFilenameSection ? " is-expanded" : " is-collapsed"}`}>
            <header className="transcode-filename-header">
              <button
                type="button"
                className="transcode-filename-toggle"
                aria-expanded={openFilenameSection}
                aria-controls={`transcode-filename-${file.id}`}
                onClick={() => setOpenFilenameSection((current) => !current)}
              >
                <span className="transcode-filename-chevron" aria-hidden="true">
                  {openFilenameSection ? <ChevronDown className="nav-icon" /> : <ChevronRight className="nav-icon" />}
                </span>
                <span className="transcode-filename-heading">
                  <h3>{t("transcoding.filenameTemplate")}</h3>
                </span>
              </button>
              <TooltipTrigger
                ariaLabel={t("transcoding.filenameTemplateHelpAria")}
                content={t("transcoding.filenameTemplateHelp")}
              />
            </header>
            {openFilenameSection ? (
              <div className="transcode-filename-body" id={`transcode-filename-${file.id}`}>
                <div
                  ref={filenameTemplateInputRef}
                  className={`${transcodeControlClass} transcode-filename-template-input transcode-filename-template-editor`}
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-label={t("transcoding.filenameTemplate")}
                  aria-multiline="false"
                  aria-valuetext={displayedTemplate}
                  onInput={(event) => {
                    const nextTemplate = filenameTemplateFromEditor(event.currentTarget);
                    const selection = filenameTemplateSelectionFromEditor(event.currentTarget);
                    if (selection) filenameTemplateSelectionRef.current = selection;
                    updateFilenameTemplate(nextTemplate);
                  }}
                  onKeyDown={handleFilenameTemplateKeyDown}
                  onSelect={(event) => {
                    const selection = filenameTemplateSelectionFromEditor(event.currentTarget);
                    if (selection) filenameTemplateSelectionRef.current = selection;
                  }}
                  onKeyUp={(event) => {
                    const selection = filenameTemplateSelectionFromEditor(event.currentTarget);
                    if (selection) filenameTemplateSelectionRef.current = selection;
                  }}
                  onMouseUp={(event) => {
                    const selection = filenameTemplateSelectionFromEditor(event.currentTarget);
                    if (selection) filenameTemplateSelectionRef.current = selection;
                  }}
                  onBlur={(event) => {
                    const selection = filenameTemplateSelectionFromEditor(event.currentTarget);
                    if (selection) filenameTemplateSelectionRef.current = selection;
                  }}
                  dangerouslySetInnerHTML={{ __html: filenameTemplateEditorMarkup(displayedTemplate) }}
                />
                <div className="transcode-filename-metadata-tools">
                  <button
                    type="button"
                    className="secondary small settings-panel-header-action transcode-filename-metadata-toggle"
                    aria-expanded={metadataTokensOpen}
                    aria-controls={`transcode-filename-metadata-${file.id}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setMetadataTokensOpen((current) => !current)}
                  >
                    <Plus aria-hidden="true" size={14} />
                    {t("transcoding.filenameAddMetadata")}
                  </button>
                  {metadataTokensOpen ? (
                    <div
                      className="transcode-filename-token-list"
                      id={`transcode-filename-metadata-${file.id}`}
                      role="group"
                      aria-label={t("transcoding.filenameMetadataTokens")}
                    >
                      {FILENAME_METADATA_TOKENS.map(({ token, labelKey }) => (
                        <button
                          key={token}
                          type="button"
                          className="secondary small transcode-filename-token-pill"
                          aria-label={t(`transcoding.filenameMetadataTokenOptions.${labelKey}`)}
                          title={t(`transcoding.filenameMetadataTokenOptions.${labelKey}`)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertFilenameToken(token)}
                        >
                          {`{${token}}`}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="transcode-filename-options-row">
                  <label className="transcode-filename-field transcode-filename-divider-field">
                    <span className="transcode-field-label">
                      <span>{t("transcoding.filenameMetadataSeparator")}</span>
                      <TooltipTrigger
                        ariaLabel={t("transcoding.filenameMetadataSeparatorHelpAria")}
                        content={t("transcoding.filenameMetadataSeparatorHelp")}
                      />
                    </span>
                    <input
                      className={transcodeControlClass}
                      aria-label={t("transcoding.filenameMetadataSeparator")}
                      value={plan.filename_metadata_separator ?? ", "}
                      onChange={(event) => {
                        setExpertPlan({
                          ...plan,
                          profile: "expert",
                          filename_metadata_separator: event.target.value,
                        });
                        setValidation(null);
                      }}
                    />
                  </label>
                  <div className="transcode-filename-cleanup">
                    <div className="transcode-filename-cleanup-heading">
                      <h4>{t("transcoding.filenameCleanup")}</h4>
                      <TooltipTrigger
                        ariaLabel={t("transcoding.filenameCleanupHelpAria")}
                        content={t("transcoding.filenameCleanupHelp")}
                      />
                    </div>
                    <label className="transcode-filename-field transcode-filename-cleanup-control">
                      <span className="sr-only">{t("transcoding.filenameCleanupPreset")}</span>
                      <select
                        className={transcodeControlClass}
                        aria-label={t("transcoding.filenameCleanupPreset")}
                        value={filenameCleanupPreset}
                        onChange={(event) => {
                          setExpertPlan({
                            ...plan,
                            profile: "expert",
                            filename_cleanup_preset: event.target.value as FilenameCleanupPreset,
                          });
                          setValidation(null);
                        }}
                      >
                        {FILENAME_CLEANUP_OPTIONS.map(({ value, labelKey }) => (
                          <option key={value} value={value}>{t(`transcoding.filenameCleanupOptions.${labelKey}`)}</option>
                        ))}
                      </select>
                    </label>
                    {filenameCleanupPreset === "custom" ? (
                      <label className="transcode-filename-field transcode-filename-cleanup-control">
                        <span className="sr-only">{t("transcoding.filenameCleanupRegex")}</span>
                        <input
                          className={transcodeControlClass}
                          aria-label={t("transcoding.filenameCleanupRegex")}
                          placeholder={t("transcoding.filenameCleanupRegexPlaceholder")}
                          value={plan.filename_cleanup_regex ?? ""}
                          onChange={(event) => {
                            setExpertPlan({
                              ...plan,
                              profile: "expert",
                              filename_cleanup_preset: "custom",
                              filename_cleanup_regex: event.target.value,
                            });
                            setValidation(null);
                          }}
                        />
                      </label>
                    ) : null}
                    {cleanupError ? <p className="notice compact error" role="alert">{t("transcoding.filenameCleanupInvalid")}</p> : null}
                  </div>
                </div>
                <div className="transcode-filename-preview is-prominent">
                  <span>{t("transcoding.filenamePreview")}</span>
                  <code aria-live="polite">{preview}</code>
                </div>
              </div>
            ) : null}
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
        <section className="transcode-progress transcode-progress-compact" aria-live="polite">
          <div className="transcode-progress-compact-content">
            <TranscodeProgressSummary job={activeJob} sampledSpeeds={speedHistoryRef.current} t={t} compact />
            <Link className="secondary small transcode-progress-center-link" to="/transcoding">
              <ExternalLink aria-hidden="true" />
              {t("transcoding.openTranscodingCenter")}
            </Link>
          </div>
          <div className="transcode-progress-actions">
            <button type="button" className="secondary danger" onClick={() => void api.cancelTranscodeJob(activeJob.id).then(setJob)}><Square aria-hidden="true" />{t("common.cancel")}</button>
          </div>
        </section>
      ) : null}

    </div>
  );
}
