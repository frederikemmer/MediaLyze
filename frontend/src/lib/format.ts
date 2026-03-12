export type CodecKind = "video" | "audio" | "subtitle";

const COMMON_CODEC_LABELS: Record<string, string> = {
  av1: "AV1",
  h264: "H.264 / AVC",
  hevc: "H.265 / HEVC",
  vp9: "VP9",
  vc1: "VC-1",
  aac: "AAC",
  ac3: "Dolby Digital",
  eac3: "Dolby Digital Plus",
  dts: "DTS",
  dca: "DTS",
  flac: "FLAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  alac: "ALAC",
  pcm_bluray: "PCM Blu-ray",
  pcm_s16le: "PCM 16-bit Little-Endian",
  pcm_s16be: "PCM 16-bit Big-Endian",
  pcm_s24le: "PCM 24-bit Little-Endian",
  pcm_s24be: "PCM 24-bit Big-Endian",
  pcm_s32le: "PCM 32-bit Little-Endian",
  pcm_s32be: "PCM 32-bit Big-Endian",
  subrip: "SubRip (SRT)",
  srt: "SubRip (SRT)",
  ass: "ASS",
  ssa: "SSA",
  webvtt: "WebVTT",
  mov_text: "MOV text",
  hdmv_pgs_subtitle: "PGS",
  dvd_subtitle: "VobSub / DVD Subtitle",
  dvb_subtitle: "DVB Subtitle",
  xsub: "DivX XSUB",
  idx: "VobSub IDX",
  sub: "VobSub SUB",
};

const VIDEO_CODEC_LABELS: Record<string, string> = {
  mpeg2video: "MPEG-2 Video",
  mpeg4: "MPEG-4 Part 2",
  prores: "Apple ProRes",
  mjpeg: "MJPEG",
};

function humanizeCodecLabel(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((token) => {
      if (token.length <= 4 && /[a-z]/i.test(token)) {
        return token.toUpperCase();
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

export function formatCodecLabel(value: string | null | undefined, kind: CodecKind): string {
  if (!value) {
    return "Unknown";
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "Unknown";
  }

  const kindSpecific = kind === "video" ? VIDEO_CODEC_LABELS[normalized] : undefined;
  return kindSpecific ?? COMMON_CODEC_LABELS[normalized] ?? humanizeCodecLabel(normalized);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "n/a";
  }

  const SECONDS_PER_MINUTE = 60;
  const SECONDS_PER_HOUR = 3600;
  const SECONDS_PER_DAY = 86400;
  const SECONDS_PER_YEAR = 31536000; // 365 days

  let remaining = seconds;
  const parts: string[] = [];

  const years = Math.floor(remaining / SECONDS_PER_YEAR);
  if (years > 0) {
    parts.push(`${years}a`);
    remaining %= SECONDS_PER_YEAR;
  }

  const days = Math.floor(remaining / SECONDS_PER_DAY);
  if (days > 0) {
    parts.push(`${days}d`);
    remaining %= SECONDS_PER_DAY;
  }

  const hours = Math.floor(remaining / SECONDS_PER_HOUR);
  if (hours > 0) {
    parts.push(`${hours}h`);
    remaining %= SECONDS_PER_HOUR;
  }

  const minutes = Math.floor(remaining / SECONDS_PER_MINUTE);
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  return parts.length > 0 ? parts.join(" ") : "0m";
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "never";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
