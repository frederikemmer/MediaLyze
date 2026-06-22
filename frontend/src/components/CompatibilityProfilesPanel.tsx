import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Github, Plus, Save, Search, SquareArrowOutUpRight, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AsyncPanel } from "./AsyncPanel";
import { CopyIcon } from "./CopyIcon";
import { DeleteIcon } from "./DeleteIcon";
import { ProfileFavoriteButton } from "./ProfileFavoriteButton";
import { SlidingTogglePill } from "./SlidingTogglePill";
import { SquarePenIcon } from "./SquarePenIcon";
import {
  api,
  type CompatibilityProfile,
  type HardwareProfile,
  type HardwareVideoCapability,
  type PlaybackMode,
  type ProfileSource,
  type SoftwareCapability,
  type SoftwareProfile,
} from "../lib/api";
import { getDesktopBridge } from "../lib/desktop";
import {
  favoriteProfileKey,
  readFavoriteProfileKeys,
  writeFavoriteProfileKeys,
} from "../lib/profile-favorites";

type ProfileTab = "hardware" | "software" | "compatibility";
type EditableProfile = HardwareProfile | SoftwareProfile;
type CapabilitySection = "video" | "audio" | "containers" | "subtitles" | "rules" | "sources";

const HARDWARE_CATEGORIES = [
  "streaming_device",
  "smart_tv",
  "game_console",
  "computer",
  "mobile_device",
  "set_top_box",
  "disc_player",
  "projector",
  "other",
] as const;

const SOFTWARE_CATEGORIES = [
  "player",
  "media_server",
  "web_browser",
  "operating_system",
  "mobile_app",
  "transcoder",
  "other",
] as const;

const VERIFICATION_METHODS = [
  "manufacturer documentation",
  "project documentation",
  "independent testing",
  "community verification",
  "personal testing",
] as const;

const VIDEO_CODEC_OPTIONS = [
  { value: "h264", label: "H.264 / AVC" },
  { value: "hevc", label: "H.265 / HEVC" },
  { value: "vvc", label: "H.266 / VVC" },
  { value: "av1", label: "AV1" },
  { value: "vp9", label: "VP9" },
  { value: "vp8", label: "VP8" },
  { value: "mpeg1video", label: "MPEG-1 Video" },
  { value: "mpeg2video", label: "MPEG-2 Video" },
  { value: "mpeg4", label: "MPEG-4 Part 2" },
  { value: "vc1", label: "VC-1" },
  { value: "wmv3", label: "Windows Media Video 9" },
  { value: "prores", label: "Apple ProRes" },
  { value: "dnxhd", label: "Avid DNxHD / DNxHR" },
  { value: "cfhd", label: "GoPro CineForm" },
  { value: "ffv1", label: "FFV1" },
  { value: "huffyuv", label: "HuffYUV" },
  { value: "utvideo", label: "UT Video" },
  { value: "theora", label: "Theora" },
  { value: "dirac", label: "Dirac / VC-2" },
  { value: "mjpeg", label: "Motion JPEG" },
  { value: "jpeg2000", label: "JPEG 2000" },
  { value: "jpegxl", label: "JPEG XL" },
  { value: "h263", label: "H.263" },
  { value: "h261", label: "H.261" },
  { value: "rv40", label: "RealVideo 4" },
  { value: "svq3", label: "Sorenson Video 3" },
  { value: "flv1", label: "Flash Video 1" },
  { value: "cinepak", label: "Cinepak" },
  { value: "hap", label: "HAP" },
  { value: "rawvideo", label: "Raw video" },
  { value: "apv", label: "Advanced Professional Video" },
] as const;

const CONTAINER_OPTIONS = [
  { value: "mp4", label: "MP4 / ISO Base Media" },
  { value: "mkv", label: "Matroska Video" },
  { value: "webm", label: "WebM" },
  { value: "mov", label: "QuickTime Movie" },
  { value: "m4v", label: "MPEG-4 Video" },
  { value: "ismv", label: "Smooth Streaming Video" },
  { value: "avi", label: "AVI" },
  { value: "ts", label: "MPEG Transport Stream" },
  { value: "m2ts", label: "Blu-ray MPEG-2 Transport Stream" },
  { value: "mts", label: "AVCHD Transport Stream" },
  { value: "mpg", label: "MPEG Program Stream" },
  { value: "mpeg", label: "MPEG Program Stream" },
  { value: "vob", label: "DVD Video Object" },
  { value: "evo", label: "HD DVD Video Object" },
  { value: "mxf", label: "Material Exchange Format" },
  { value: "gxf", label: "General eXchange Format" },
  { value: "asf", label: "Advanced Systems Format" },
  { value: "wmv", label: "Windows Media Video" },
  { value: "flv", label: "Flash Video" },
  { value: "f4v", label: "Flash MP4 Video" },
  { value: "3gp", label: "3GPP" },
  { value: "3g2", label: "3GPP2" },
  { value: "ogv", label: "Ogg Video" },
  { value: "ogg", label: "Ogg" },
  { value: "ogm", label: "Ogg Media" },
  { value: "rm", label: "RealMedia" },
  { value: "rmvb", label: "RealMedia Variable Bitrate" },
  { value: "divx", label: "DivX Media Format" },
  { value: "wtv", label: "Windows Recorded TV" },
  { value: "nut", label: "NUT" },
  { value: "y4m", label: "YUV4MPEG2" },
] as const;

const AUDIO_CODEC_OPTIONS = [
  { value: "aac", label: "AAC" },
  { value: "ac3", label: "Dolby Digital / AC-3" },
  { value: "eac3", label: "Dolby Digital Plus / E-AC-3" },
  { value: "truehd", label: "Dolby TrueHD" },
  { value: "mlp", label: "Meridian Lossless Packing" },
  { value: "ac4", label: "Dolby AC-4" },
  { value: "dts", label: "DTS" },
  { value: "dts_hd", label: "DTS-HD" },
  { value: "dtshd", label: "DTS-HD (legacy profile id)" },
  { value: "mp3", label: "MP3" },
  { value: "mp2", label: "MPEG Audio Layer II" },
  { value: "mp1", label: "MPEG Audio Layer I" },
  { value: "opus", label: "Opus" },
  { value: "vorbis", label: "Vorbis" },
  { value: "flac", label: "FLAC" },
  { value: "alac", label: "Apple Lossless / ALAC" },
  { value: "wavpack", label: "WavPack" },
  { value: "ape", label: "Monkey's Audio" },
  { value: "tta", label: "True Audio / TTA" },
  { value: "tak", label: "TAK" },
  { value: "als", label: "MPEG-4 Audio Lossless Coding" },
  { value: "pcm_s16le", label: "PCM signed 16-bit little-endian" },
  { value: "pcm_s16be", label: "PCM signed 16-bit big-endian" },
  { value: "pcm_s24le", label: "PCM signed 24-bit little-endian" },
  { value: "pcm_s24be", label: "PCM signed 24-bit big-endian" },
  { value: "pcm_s32le", label: "PCM signed 32-bit little-endian" },
  { value: "pcm_s32be", label: "PCM signed 32-bit big-endian" },
  { value: "pcm_f32le", label: "PCM float 32-bit little-endian" },
  { value: "pcm_f64le", label: "PCM float 64-bit little-endian" },
  { value: "pcm_bluray", label: "Blu-ray LPCM" },
  { value: "pcm_dvd", label: "DVD LPCM" },
  { value: "pcm_s24daud", label: "D-Cinema Audio PCM" },
  { value: "dsd_lsbf", label: "DSD little-endian" },
  { value: "dsd_msbf", label: "DSD big-endian" },
  { value: "wma1", label: "Windows Media Audio 1" },
  { value: "wma2", label: "Windows Media Audio 2" },
  { value: "wmapro", label: "Windows Media Audio Pro" },
  { value: "wmalossless", label: "Windows Media Audio Lossless" },
  { value: "amr_nb", label: "AMR Narrowband" },
  { value: "amr_wb", label: "AMR Wideband" },
  { value: "speex", label: "Speex" },
  { value: "mpegh_3d_audio", label: "MPEG-H 3D Audio" },
  { value: "atrac3", label: "ATRAC3" },
  { value: "atrac3p", label: "ATRAC3plus" },
  { value: "atrac9", label: "ATRAC9" },
  { value: "cook", label: "RealAudio Cook" },
  { value: "ra_144", label: "RealAudio 1.0" },
  { value: "ra_288", label: "RealAudio 2.0" },
  { value: "nellymoser", label: "Nellymoser" },
  { value: "adpcm_ima_wav", label: "IMA ADPCM WAV" },
  { value: "aptx", label: "aptX" },
  { value: "aptx_hd", label: "aptX HD" },
  { value: "sbc", label: "Bluetooth SBC" },
  { value: "lc3", label: "Bluetooth LC3" },
] as const;

const SUBTITLE_FORMAT_OPTIONS = [
  { value: "subrip", label: "SubRip / SRT" },
  { value: "srt", label: "SubRip with embedded timing" },
  { value: "ass", label: "Advanced SubStation Alpha" },
  { value: "ssa", label: "SubStation Alpha" },
  { value: "webvtt", label: "WebVTT" },
  { value: "mov_text", label: "MOV / MP4 Timed Text" },
  { value: "ttml", label: "TTML" },
  { value: "dfxp", label: "DFXP / TTML" },
  { value: "hdmv_pgs_subtitle", label: "Blu-ray PGS" },
  { value: "pgs", label: "Blu-ray PGS (profile alias)" },
  { value: "dvd_subtitle", label: "DVD VobSub" },
  { value: "vobsub", label: "DVD VobSub (profile alias)" },
  { value: "dvb_subtitle", label: "DVB Bitmap Subtitles" },
  { value: "dvb_teletext", label: "DVB Teletext" },
  { value: "eia_608", label: "EIA-608 Closed Captions" },
  { value: "eia_708", label: "EIA-708 Closed Captions" },
  { value: "hdmv_text_subtitle", label: "Blu-ray Text Subtitles" },
  { value: "microdvd", label: "MicroDVD" },
  { value: "mpl2", label: "MPL2" },
  { value: "sami", label: "SAMI" },
  { value: "jacosub", label: "JACOsub" },
  { value: "pjs", label: "PJS" },
  { value: "realtext", label: "RealText" },
  { value: "subviewer", label: "SubViewer" },
  { value: "subviewer1", label: "SubViewer 1" },
  { value: "vplayer", label: "VPlayer" },
  { value: "aqtitle", label: "AQTitle" },
  { value: "stl", label: "Spruce Subtitle Format" },
  { value: "scc", label: "Scenarist Closed Captions" },
  { value: "lrc", label: "LRC Lyrics" },
] as const;

const CAPABILITY_KEYS: Record<Exclude<CapabilitySection, "sources" | "rules">, string[]> = {
  video: VIDEO_CODEC_OPTIONS.map((codec) => codec.value),
  audio: AUDIO_CODEC_OPTIONS.map((codec) => codec.value),
  containers: CONTAINER_OPTIONS.map((container) => container.value),
  subtitles: SUBTITLE_FORMAT_OPTIONS.map((format) => format.value),
};

type HardwareSupport = boolean | "passthrough_only" | "limited";

const GITHUB_ISSUE_URL = "https://github.com/frederikemmer/MediaLyze/issues/new";
const SAFE_ISSUE_URL_LENGTH = 7000;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function localId(id: string): string {
  return `${id.replace(/-local(?:-\d+)?$/, "")}-local`;
}

function profileIdFromName(name: string, fallback: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
  return normalized.length >= 2 ? normalized : fallback;
}

function uniqueProfileId(baseId: string, existingIds: Iterable<string>): string {
  const ids = new Set(existingIds);
  if (!ids.has(baseId)) return baseId;
  let suffix = 2;
  while (ids.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

function uniqueLocalId(id: string, profiles: EditableProfile[]): string {
  const baseId = localId(id);
  return uniqueProfileId(baseId, profiles.map((profile) => profile.id));
}

export function buildProfileIssue(
  profile: EditableProfile,
  reason: string,
): { url: string; overflowBody: string | null } {
  const isChange = Boolean(profile.base_profile_id);
  const title = isChange
    ? `[profile change] ${profile.name}`
    : `[profile proposal] ${profile.name}`;
  const label = isChange ? "enhancement" : "new feature";
  const body = [
    isChange
      ? `## Proposed change\n\nBase profile: \`${profile.base_profile_id}\` version ${profile.base_profile_version}`
      : "## New profile proposal",
    `\n\n## Reason\n\n${reason.trim() || "No additional reason provided."}`,
    `\n\n## Profile JSON\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\``,
  ].join("");
  const params = new URLSearchParams({ title, labels: label, body });
  const url = `${GITHUB_ISSUE_URL}?${params.toString()}`;
  if (url.length <= SAFE_ISSUE_URL_LENGTH) {
    return { url, overflowBody: null };
  }
  const shortBody = [
    isChange
      ? `Profile change for \`${profile.base_profile_id}\` version ${profile.base_profile_version}.`
      : `New profile proposal for \`${profile.id}\`.`,
    "",
    "The full proposal was copied to the clipboard by MediaLyze. Paste it into this issue.",
  ].join("\n");
  return {
    url: `${GITHUB_ISSUE_URL}?${new URLSearchParams({ title, labels: label, body: shortBody }).toString()}`,
    overflowBody: body,
  };
}

async function openExternalUrl(url: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge?.openExternalUrl) {
    await bridge.openExternalUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function hardwareTemplate(): HardwareProfile {
  const date = today();
  return {
    schema_version: 1,
    profile_version: 1,
    id: "new-hardware-profile",
    name: "New hardware profile",
    category: "streaming_device",
    manufacturer: "",
    year: new Date().getFullYear(),
    status: "local",
    added: date,
    last_modified: date,
    video: {},
    audio: {},
    containers: [],
    subtitles: {},
    sources: [],
  };
}

function softwareTemplate(): SoftwareProfile {
  const date = today();
  return {
    schema_version: 1,
    profile_version: 1,
    id: "new-software-profile",
    name: "New software profile",
    category: "player",
    developer: "",
    platforms: [],
    status: "local",
    added: date,
    last_modified: date,
    video: {},
    audio: {},
    containers: {},
    subtitles: {},
    rules: [],
    server_fallback: "unsupported",
    sources: [],
  };
}

export function CompatibilityProfilesPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ProfileTab>("hardware");
  const [hardware, setHardware] = useState<HardwareProfile[]>([]);
  const [software, setSoftware] = useState<SoftwareProfile[]>([]);
  const [compatibility, setCompatibility] = useState<CompatibilityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableProfile | null>(null);
  const [draftOriginId, setDraftOriginId] = useState<string | null>(null);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [capabilityDrafts, setCapabilityDrafts] = useState<Record<CapabilitySection, string>>({
    video: "{}",
    audio: "{}",
    containers: "[]",
    subtitles: "{}",
    rules: "[]",
    sources: "[]",
  });
  const [reason, setReason] = useState("");
  const [compatibilityDraft, setCompatibilityDraft] = useState<CompatibilityProfile | null>(null);
  const [searchQueries, setSearchQueries] = useState<Record<ProfileTab, string>>({
    hardware: "",
    software: "",
    compatibility: "",
  });
  const [favoriteProfileKeys, setFavoriteProfileKeys] = useState(readFavoriteProfileKeys);

  async function load() {
    setLoading(true);
    try {
      const [nextHardware, nextSoftware, nextCompatibility] = await Promise.all([
        api.hardwareProfiles(),
        api.softwareProfiles(),
        api.compatibilityProfiles(),
      ]);
      setHardware(nextHardware);
      setSoftware(nextSoftware);
      setCompatibility(nextCompatibility);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("compatibilityProfiles.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const profiles = tab === "hardware" ? hardware : software;
  const profileNames = useMemo(
    () => new Map([...hardware, ...software].map((profile) => [profile.id, profile.name])),
    [hardware, software],
  );
  const normalizedSearchQuery = searchQueries[tab].trim().toLocaleLowerCase();
  const filteredProfiles = profiles.filter((profile) => (
    !normalizedSearchQuery
    || profile.name.toLocaleLowerCase().includes(normalizedSearchQuery)
    || profile.id.toLocaleLowerCase().includes(normalizedSearchQuery)
  ));
  const filteredCompatibility = compatibility.filter((profile) => {
    if (!normalizedSearchQuery) return true;
    const hardwareName = profileNames.get(profile.hardware_profile_id) ?? "";
    const softwareName = profileNames.get(profile.software_profile_id) ?? "";
    return [
      profile.name,
      profile.id,
      profile.hardware_profile_id,
      profile.software_profile_id,
      hardwareName,
      softwareName,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery));
  });

  function isFavorite(type: ProfileTab, id: string) {
    return favoriteProfileKeys.has(favoriteProfileKey(type, id));
  }

  function toggleFavorite(type: ProfileTab, id: string) {
    setFavoriteProfileKeys((current) => {
      const next = new Set(current);
      const key = favoriteProfileKey(type, id);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      writeFavoriteProfileKeys(next);
      return next;
    });
  }

  function renderFavoriteAction(type: ProfileTab, id: string, name: string) {
    const favorite = isFavorite(type, id);
    const label = t(
      favorite ? "compatibilityProfiles.favoriteRemoveAria" : "compatibilityProfiles.favoriteAddAria",
      { name },
    );
    return (
      <ProfileFavoriteButton
        favorite={favorite}
        label={label}
        onClick={() => toggleFavorite(type, id)}
      />
    );
  }

  function renderProfileSearch() {
    return (
      <div className="compatibility-profile-search">
        <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
        <input
          type="search"
          value={searchQueries[tab]}
          aria-label={t("compatibilityProfiles.searchAria", {
            type: t(`compatibilityProfiles.tabs.${tab}`),
          })}
          placeholder={t("compatibilityProfiles.searchPlaceholder")}
          onChange={(event) => setSearchQueries((current) => ({
            ...current,
            [tab]: event.target.value,
          }))}
        />
        {searchQueries[tab] ? (
          <button
            type="button"
            className="compatibility-profile-search-clear"
            aria-label={t("compatibilityProfiles.clearSearch")}
            onClick={() => setSearchQueries((current) => ({ ...current, [tab]: "" }))}
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  function setProfileDraft(next: EditableProfile, originId: string) {
    setDraft(next);
    setDraftOriginId(originId);
    setExpandedProfileId(originId);
    setCapabilityDrafts({
      video: JSON.stringify(next.video, null, 2),
      audio: JSON.stringify(next.audio, null, 2),
      containers: JSON.stringify(next.containers, null, 2),
      subtitles: JSON.stringify(next.subtitles, null, 2),
      rules: JSON.stringify("rules" in next ? next.rules : [], null, 2),
      sources: JSON.stringify(next.sources, null, 2),
    });
    setReason("");
    setMessage(null);
  }

  function editProfile(profile: EditableProfile) {
    const next = structuredClone(profile);
    delete next.catalog_source;
    if (profile.catalog_source === "official") {
      next.id = uniqueLocalId(profile.id, profiles);
      next.name = `${profile.name} (Local)`;
      next.status = "local";
      next.profile_version = 1;
      next.base_profile_id = profile.id;
      next.base_profile_version = profile.profile_version;
      next.added = today();
    }
    next.last_modified = today();
    setProfileDraft(next, profile.id);
  }

  function cloneProfile(profile: EditableProfile) {
    const next = structuredClone(profile);
    delete next.catalog_source;
    next.id = uniqueLocalId(profile.id, profiles);
    next.name = `${profile.name} (Copy)`;
    next.status = "local";
    next.profile_version = 1;
    next.added = today();
    next.last_modified = today();
    if (profile.catalog_source === "official") {
      next.base_profile_id = profile.id;
      next.base_profile_version = profile.profile_version;
    }
    setProfileDraft(next, next.id);
  }

  function profileFromDraft(): EditableProfile {
    if (!draft) {
      throw new Error("No profile is being edited");
    }
    return {
      ...draft,
      video: JSON.parse(capabilityDrafts.video),
      audio: JSON.parse(capabilityDrafts.audio),
      containers: JSON.parse(capabilityDrafts.containers),
      subtitles: JSON.parse(capabilityDrafts.subtitles),
      ...("developer" in draft ? { rules: JSON.parse(capabilityDrafts.rules) } : {}),
      sources: JSON.parse(capabilityDrafts.sources),
      last_modified: today(),
    } as EditableProfile;
  }

  async function saveProfile() {
    if (!draft) return;
    try {
      let parsed = profileFromDraft();
      if (parsed.id === "new-hardware-profile" || parsed.id === "new-software-profile") {
        parsed = {
          ...parsed,
          id: uniqueProfileId(
            profileIdFromName(parsed.name, tab === "hardware" ? "hardware-profile" : "software-profile"),
            profiles.map((profile) => profile.id),
          ),
        };
      }
      const existing = profiles.find((profile) => profile.id === parsed.id && profile.catalog_source === "local");
      if (existing) {
        parsed = {
          ...parsed,
          profile_version: existing.profile_version + 1,
        };
      }
      if (tab === "hardware") {
        existing
          ? await api.updateHardwareProfile(parsed.id, parsed as HardwareProfile)
          : await api.createHardwareProfile(parsed as HardwareProfile);
      } else {
        existing
          ? await api.updateSoftwareProfile(parsed.id, parsed as SoftwareProfile)
          : await api.createSoftwareProfile(parsed as SoftwareProfile);
      }
      setDraft(null);
      setDraftOriginId(null);
      setExpandedProfileId(parsed.id);
      setMessage(t("compatibilityProfiles.saved"));
      await load();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : t("compatibilityProfiles.saveFailed"));
    }
  }

  async function removeProfile(profile: EditableProfile) {
    if (!window.confirm(t("compatibilityProfiles.deleteConfirm", { name: profile.name }))) return;
    try {
      if ("manufacturer" in profile) await api.deleteHardwareProfile(profile.id);
      else await api.deleteSoftwareProfile(profile.id);
      await load();
    } catch (deleteError) {
      setMessage(deleteError instanceof Error ? deleteError.message : t("compatibilityProfiles.deleteFailed"));
    }
  }

  async function proposeProfile() {
    if (!draft) return;
    try {
      const parsed = profileFromDraft();
      const issue = buildProfileIssue(parsed, reason);
      if (issue.overflowBody) {
        await navigator.clipboard.writeText(issue.overflowBody);
        setMessage(t("compatibilityProfiles.issueCopied"));
      }
      await openExternalUrl(issue.url);
    } catch (issueError) {
      setMessage(issueError instanceof Error ? issueError.message : t("compatibilityProfiles.issueFailed"));
    }
  }

  function startCompatibility(profile?: CompatibilityProfile) {
    const date = today();
    const next: CompatibilityProfile = profile ? structuredClone(profile) : {
      schema_version: 1,
      profile_version: 1,
      id: "new-compatibility-profile",
      name: "New compatibility profile",
      status: "local",
      added: date,
      last_modified: date,
      sources: [],
      hardware_profile_id: hardware[0]?.id ?? "",
      software_profile_id: software[0]?.id ?? "",
    };
    setCompatibilityDraft(next);
    setExpandedProfileId(next.id);
    setMessage(null);
  }

  async function saveCompatibility() {
    if (!compatibilityDraft) return;
    try {
      let profileToSave = compatibilityDraft.id === "new-compatibility-profile"
        ? {
            ...compatibilityDraft,
            id: uniqueProfileId(
              profileIdFromName(compatibilityDraft.name, "compatibility-profile"),
              compatibility.map((profile) => profile.id),
            ),
          }
        : compatibilityDraft;
      const existing = compatibility.find((profile) => profile.id === profileToSave.id);
      if (existing) {
        profileToSave = {
          ...profileToSave,
          profile_version: existing.profile_version + 1,
        };
      }
      existing
        ? await api.updateCompatibilityProfile(profileToSave.id, profileToSave)
        : await api.createCompatibilityProfile(profileToSave);
      setCompatibilityDraft(null);
      setExpandedProfileId(profileToSave.id);
      setMessage(t("compatibilityProfiles.saved"));
      await load();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : t("compatibilityProfiles.saveFailed"));
    }
  }

  async function removeCompatibility(profile: CompatibilityProfile) {
    if (!window.confirm(t("compatibilityProfiles.deleteConfirm", { name: profile.name }))) return;
    await api.deleteCompatibilityProfile(profile.id);
    await load();
  }

  function updateDraft(patch: Partial<EditableProfile>) {
    setDraft((current) => current ? { ...current, ...patch } as EditableProfile : current);
  }

  function parsedCapabilityDraft<T>(section: CapabilitySection, fallback: T): T {
    try {
      return JSON.parse(capabilityDrafts[section]) as T;
    } catch {
      return fallback;
    }
  }

  function updateCapabilityDraft(section: CapabilitySection, value: unknown) {
    setCapabilityDrafts((current) => ({
      ...current,
      [section]: JSON.stringify(value, null, 2),
    }));
  }

  function uniqueCapabilityKey(
    section: Exclude<CapabilitySection, "sources" | "rules">,
    existing: Iterable<string>,
  ): string {
    const keys = new Set(existing);
    const suggested = CAPABILITY_KEYS[section].find((key) => !keys.has(key));
    if (suggested) return suggested;
    let suffix = 1;
    while (keys.has(`custom-${suffix}`)) suffix += 1;
    return `custom-${suffix}`;
  }

  function renameCapabilityEntry(
    section: Exclude<CapabilitySection, "sources">,
    oldKey: string,
    newKey: string,
    record: Record<string, unknown>,
  ) {
    const normalized = newKey.trim().toLocaleLowerCase().replace(/\s+/g, "_");
    if (!normalized || normalized === oldKey || Object.hasOwn(record, normalized)) return;
    const next = Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key === oldKey ? normalized : key, value]),
    );
    updateCapabilityDraft(section, next);
  }

  function renderSourcesEditor(active: EditableProfile, editable: boolean, editing: boolean) {
    const sources = editing
      ? parsedCapabilityDraft<ProfileSource[]>("sources", active.sources)
      : active.sources;
    return (
      <div className="compatibility-capability-editor">
        {sources.map((source, index) => (
          <div className="compatibility-capability-row compatibility-source-row" key={`${index}-${source.url}`}>
            <label>
              {t("compatibilityProfiles.fields.sourceLabel")}
              <input
                value={source.label}
                readOnly={!editable}
                onChange={(event) => updateCapabilityDraft("sources", sources.map((item, itemIndex) => (
                  itemIndex === index ? { ...item, label: event.target.value } : item
                )))}
              />
            </label>
            <label>
              {t("compatibilityProfiles.fields.sourceUrl")}
              <span className={`compatibility-source-url-control${editable ? "" : " is-readonly"}`}>
                <input
                  type="url"
                  value={source.url}
                  readOnly={!editable}
                  onChange={(event) => updateCapabilityDraft("sources", sources.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, url: event.target.value } : item
                  )))}
                />
                {!editable ? (
                  <button
                    type="button"
                    className="secondary icon-only-button compatibility-source-open-button"
                    aria-label={t("compatibilityProfiles.openSourceAria", { label: source.label })}
                    title={t("compatibilityProfiles.openSource")}
                    onClick={() => void openExternalUrl(source.url)}
                  >
                    <SquareArrowOutUpRight size={17} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </label>
            {editable ? (
              <button
                type="button"
                className="secondary icon-only-button compatibility-capability-remove"
                aria-label={t("compatibilityProfiles.removeSourceAria", { label: source.label || index + 1 })}
                onClick={() => updateCapabilityDraft("sources", sources.filter((_, itemIndex) => itemIndex !== index))}
              >
                <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
              </button>
            ) : null}
          </div>
        ))}
        {editable ? (
          <button
            type="button"
            className="secondary small settings-panel-header-action compatibility-capability-add"
            onClick={() => updateCapabilityDraft("sources", [...sources, { label: "", url: "https://" }])}
          >
            <Plus size={15} aria-hidden="true" />
            {t("compatibilityProfiles.addSource")}
          </button>
        ) : null}
      </div>
    );
  }

  function renderHardwareSupportEditor(
    section: "audio" | "subtitles",
    active: HardwareProfile,
    editable: boolean,
    editing: boolean,
  ) {
    const record = editing
      ? parsedCapabilityDraft<Record<string, HardwareSupport>>(section, active[section])
      : active[section];
    return (
      <div className="compatibility-capability-editor">
        {Object.entries(record).map(([key, support]) => (
          <div className="compatibility-capability-row" key={key}>
            <label>
              {t("compatibilityProfiles.fields.format")}
              {section === "audio" ? (
                <select
                  value={key}
                  disabled={!editable}
                  onChange={(event) => renameCapabilityEntry(section, key, event.target.value, record)}
                >
                  {!AUDIO_CODEC_OPTIONS.some((codec) => codec.value === key) ? (
                    <option value={key}>{key}</option>
                  ) : null}
                  {AUDIO_CODEC_OPTIONS.map((codec) => (
                    <option
                      value={codec.value}
                      disabled={codec.value !== key && Object.hasOwn(record, codec.value)}
                      key={codec.value}
                    >
                      {codec.label} ({codec.value})
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={key}
                  disabled={!editable}
                  onChange={(event) => renameCapabilityEntry(section, key, event.target.value, record)}
                >
                  {!SUBTITLE_FORMAT_OPTIONS.some((format) => format.value === key) ? (
                    <option value={key}>{key}</option>
                  ) : null}
                  {SUBTITLE_FORMAT_OPTIONS.map((format) => (
                    <option
                      value={format.value}
                      disabled={format.value !== key && Object.hasOwn(record, format.value)}
                      key={format.value}
                    >
                      {format.label} ({format.value})
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              {t("compatibilityProfiles.fields.support")}
              <select
                value={String(support)}
                disabled={!editable}
                onChange={(event) => {
                  const value = event.target.value;
                  updateCapabilityDraft(section, {
                    ...record,
                    [key]: value === "true" ? true : value === "false" ? false : value,
                  });
                }}
              >
                <option value="true">{t("compatibilityProfiles.supportLevels.supported")}</option>
                <option value="limited">{t("compatibilityProfiles.supportLevels.limited")}</option>
                <option value="passthrough_only">{t("compatibilityProfiles.supportLevels.passthroughOnly")}</option>
                <option value="false">{t("compatibilityProfiles.supportLevels.unsupported")}</option>
              </select>
            </label>
            {editable ? (
              <button
                type="button"
                className="secondary icon-only-button compatibility-capability-remove"
                aria-label={t("compatibilityProfiles.removeCapabilityAria", { value: key })}
                onClick={() => updateCapabilityDraft(section, Object.fromEntries(
                  Object.entries(record).filter(([entryKey]) => entryKey !== key),
                ))}
              >
                <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
              </button>
            ) : null}
          </div>
        ))}
        {editable ? (
          <button
            type="button"
            className="secondary small settings-panel-header-action compatibility-capability-add"
            onClick={() => {
              const key = uniqueCapabilityKey(section, Object.keys(record));
              updateCapabilityDraft(section, { ...record, [key]: false });
            }}
          >
            <Plus size={15} aria-hidden="true" />
            {t("compatibilityProfiles.addCapability")}
          </button>
        ) : null}
      </div>
    );
  }

  function renderHardwareVideoEditor(active: HardwareProfile, editable: boolean, editing: boolean) {
    const record = editing
      ? parsedCapabilityDraft<Record<string, HardwareVideoCapability>>("video", active.video)
      : active.video;
    const updateEntry = (key: string, patch: Partial<HardwareVideoCapability>) => {
      updateCapabilityDraft("video", { ...record, [key]: { ...record[key], ...patch } });
    };
    return (
      <div className="compatibility-capability-editor">
        {Object.entries(record).map(([key, capability]) => (
          <div className="compatibility-video-capability" key={key}>
            <div className="compatibility-capability-row">
              <label>
                {t("compatibilityProfiles.fields.codec")}
                <select
                  value={key}
                  disabled={!editable}
                  onChange={(event) => renameCapabilityEntry("video", key, event.target.value, record)}
                >
                  {!VIDEO_CODEC_OPTIONS.some((codec) => codec.value === key) ? (
                    <option value={key}>{key}</option>
                  ) : null}
                  {VIDEO_CODEC_OPTIONS.map((codec) => (
                    <option
                      value={codec.value}
                      disabled={codec.value !== key && Object.hasOwn(record, codec.value)}
                      key={codec.value}
                    >
                      {codec.label} ({codec.value})
                    </option>
                  ))}
                </select>
              </label>
              <label className="compatibility-hardware-decode-toggle">
                <span>{t("compatibilityProfiles.fields.hardwareDecode")}</span>
                <span className="compatibility-checkbox-field">
                  <input
                    type="checkbox"
                    checked={capability.hardware_decode}
                    disabled={!editable}
                    onChange={(event) => updateEntry(key, { hardware_decode: event.target.checked })}
                  />
                </span>
              </label>
              {editable ? (
                <button
                  type="button"
                  className="secondary icon-only-button compatibility-capability-remove"
                  aria-label={t("compatibilityProfiles.removeCapabilityAria", { value: key })}
                  onClick={() => updateCapabilityDraft("video", Object.fromEntries(
                    Object.entries(record).filter(([entryKey]) => entryKey !== key),
                  ))}
                >
                  <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
                </button>
              ) : null}
            </div>
            <div className="compatibility-capability-limits">
              <label>
                {t("compatibilityProfiles.fields.maxResolution")}
                <input
                  value={capability.max_resolution ?? ""}
                  readOnly={!editable}
                  placeholder={t("compatibilityProfiles.placeholders.maxResolution")}
                  onChange={(event) => updateEntry(key, { max_resolution: event.target.value || null })}
                />
              </label>
              <label>
                {t("compatibilityProfiles.fields.maxFps")}
                <input
                  type="number"
                  min={1}
                  value={capability.max_fps ?? ""}
                  readOnly={!editable}
                  placeholder={t("compatibilityProfiles.placeholders.maxFps")}
                  onChange={(event) => updateEntry(key, {
                    max_fps: event.target.value ? Number(event.target.value) : null,
                  })}
                />
              </label>
              <label>
                {t("compatibilityProfiles.fields.bitDepth")}
                <input
                  value={(capability.bit_depth ?? []).join(", ")}
                  readOnly={!editable}
                  placeholder={t("compatibilityProfiles.placeholders.bitDepth")}
                  onChange={(event) => updateEntry(key, {
                    bit_depth: event.target.value.split(",")
                      .map((value) => Number(value.trim()))
                      .filter((value) => Number.isFinite(value) && value > 0),
                  })}
                />
              </label>
              <label>
                {t("compatibilityProfiles.fields.hdr")}
                <input
                  value={(capability.hdr ?? []).join(", ")}
                  readOnly={!editable}
                  placeholder={t("compatibilityProfiles.placeholders.hdr")}
                  onChange={(event) => updateEntry(key, {
                    hdr: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                  })}
                />
              </label>
            </div>
          </div>
        ))}
        {editable ? (
          <button
            type="button"
            className="secondary small settings-panel-header-action compatibility-capability-add"
            onClick={() => {
              const key = uniqueCapabilityKey("video", Object.keys(record));
              updateCapabilityDraft("video", { ...record, [key]: { hardware_decode: false } });
            }}
          >
            <Plus size={15} aria-hidden="true" />
            {t("compatibilityProfiles.addCapability")}
          </button>
        ) : null}
      </div>
    );
  }

  function renderHardwareContainersEditor(active: HardwareProfile, editable: boolean, editing: boolean) {
    const containers = editing
      ? parsedCapabilityDraft<string[]>("containers", active.containers)
      : active.containers;
    return (
      <div className="compatibility-capability-editor">
        {containers.map((container, index) => (
          <div className="compatibility-capability-row compatibility-container-row" key={`${container}-${index}`}>
            <label>
              {t("compatibilityProfiles.fields.container")}
              <select
                value={container}
                disabled={!editable}
                onChange={(event) => updateCapabilityDraft("containers", containers.map((value, itemIndex) => (
                  itemIndex === index ? event.target.value : value
                )))}
              >
                {!CONTAINER_OPTIONS.some((option) => option.value === container) ? (
                  <option value={container}>{container}</option>
                ) : null}
                {CONTAINER_OPTIONS.map((option) => (
                  <option
                    value={option.value}
                    disabled={option.value !== container && containers.includes(option.value)}
                    key={option.value}
                  >
                    {option.label} ({option.value})
                  </option>
                ))}
              </select>
            </label>
            {editable ? (
              <button
                type="button"
                className="secondary icon-only-button compatibility-capability-remove"
                aria-label={t("compatibilityProfiles.removeCapabilityAria", { value: container })}
                onClick={() => updateCapabilityDraft("containers", containers.filter((_, itemIndex) => itemIndex !== index))}
              >
                <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
              </button>
            ) : null}
          </div>
        ))}
        {editable ? (
          <button
            type="button"
            className="secondary small settings-panel-header-action compatibility-capability-add"
            onClick={() => updateCapabilityDraft("containers", [
              ...containers,
              uniqueCapabilityKey("containers", containers),
            ])}
          >
            <Plus size={15} aria-hidden="true" />
            {t("compatibilityProfiles.addCapability")}
          </button>
        ) : null}
      </div>
    );
  }

  function renderSoftwareCapabilityEditor(
    section: "video" | "audio" | "containers" | "subtitles",
    active: SoftwareProfile,
    editable: boolean,
    editing: boolean,
  ) {
    const record = editing
      ? parsedCapabilityDraft<Record<string, SoftwareCapability>>(section, active[section])
      : active[section];
    const updateEntry = (key: string, patch: Partial<SoftwareCapability>) => {
      updateCapabilityDraft(section, { ...record, [key]: { ...record[key], ...patch } });
    };
    return (
      <div className="compatibility-capability-editor">
        {Object.entries(record).map(([key, capability]) => (
          <div className={section === "video" ? "compatibility-video-capability" : ""} key={key}>
            <div className="compatibility-capability-row">
              <label>
                {t(section === "video" ? "compatibilityProfiles.fields.codec" : "compatibilityProfiles.fields.format")}
                {section === "video" ? (
                  <select
                    value={key}
                    disabled={!editable}
                    onChange={(event) => renameCapabilityEntry(section, key, event.target.value, record)}
                  >
                    {!VIDEO_CODEC_OPTIONS.some((codec) => codec.value === key) ? (
                      <option value={key}>{key}</option>
                    ) : null}
                    {VIDEO_CODEC_OPTIONS.map((codec) => (
                      <option
                        value={codec.value}
                        disabled={codec.value !== key && Object.hasOwn(record, codec.value)}
                        key={codec.value}
                      >
                        {codec.label} ({codec.value})
                      </option>
                    ))}
                  </select>
                ) : section === "audio" ? (
                  <select
                    value={key}
                    disabled={!editable}
                    onChange={(event) => renameCapabilityEntry(section, key, event.target.value, record)}
                  >
                    {!AUDIO_CODEC_OPTIONS.some((codec) => codec.value === key) ? (
                      <option value={key}>{key}</option>
                    ) : null}
                    {AUDIO_CODEC_OPTIONS.map((codec) => (
                      <option
                        value={codec.value}
                        disabled={codec.value !== key && Object.hasOwn(record, codec.value)}
                        key={codec.value}
                      >
                        {codec.label} ({codec.value})
                      </option>
                    ))}
                  </select>
                ) : section === "containers" ? (
                  <select
                    value={key}
                    disabled={!editable}
                    onChange={(event) => renameCapabilityEntry(section, key, event.target.value, record)}
                  >
                    {!CONTAINER_OPTIONS.some((option) => option.value === key) ? (
                      <option value={key}>{key}</option>
                    ) : null}
                    {CONTAINER_OPTIONS.map((option) => (
                      <option
                        value={option.value}
                        disabled={option.value !== key && Object.hasOwn(record, option.value)}
                        key={option.value}
                      >
                        {option.label} ({option.value})
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={key}
                    disabled={!editable}
                    onChange={(event) => renameCapabilityEntry(section, key, event.target.value, record)}
                  >
                    {!SUBTITLE_FORMAT_OPTIONS.some((format) => format.value === key) ? (
                      <option value={key}>{key}</option>
                    ) : null}
                    {SUBTITLE_FORMAT_OPTIONS.map((format) => (
                      <option
                        value={format.value}
                        disabled={format.value !== key && Object.hasOwn(record, format.value)}
                        key={format.value}
                      >
                        {format.label} ({format.value})
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label>
                {t("compatibilityProfiles.fields.playbackMode")}
                <select
                  value={capability.mode}
                  disabled={!editable}
                  onChange={(event) => updateEntry(key, { mode: event.target.value as PlaybackMode })}
                >
                  <option value="direct">{t("compatibilityProfiles.playbackModes.direct")}</option>
                  <option value="direct_stream">{t("compatibilityProfiles.playbackModes.directStream")}</option>
                  <option value="transcode">{t("compatibilityProfiles.playbackModes.transcode")}</option>
                  <option value="video_transcode">{t("compatibilityProfiles.playbackModes.videoTranscode")}</option>
                  <option value="conditional">{t("compatibilityProfiles.playbackModes.conditional")}</option>
                  <option value="unsupported">{t("compatibilityProfiles.playbackModes.unsupported")}</option>
                </select>
              </label>
              {editable ? (
                <button
                  type="button"
                  className="secondary icon-only-button compatibility-capability-remove"
                  aria-label={t("compatibilityProfiles.removeCapabilityAria", { value: key })}
                  onClick={() => updateCapabilityDraft(section, Object.fromEntries(
                    Object.entries(record).filter(([entryKey]) => entryKey !== key),
                  ))}
                >
                  <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
                </button>
              ) : null}
            </div>
            {section === "video" ? (
              <div className="compatibility-capability-limits">
                <label>
                  {t("compatibilityProfiles.fields.maxResolution")}
                  <input
                    value={capability.max_resolution ?? ""}
                    readOnly={!editable}
                    placeholder={t("compatibilityProfiles.placeholders.maxResolution")}
                    onChange={(event) => updateEntry(key, { max_resolution: event.target.value || null })}
                  />
                </label>
                <label>
                  {t("compatibilityProfiles.fields.maxFps")}
                  <input
                    type="number"
                    min={1}
                    value={capability.max_fps ?? ""}
                    readOnly={!editable}
                    placeholder={t("compatibilityProfiles.placeholders.maxFps")}
                    onChange={(event) => updateEntry(key, {
                      max_fps: event.target.value ? Number(event.target.value) : null,
                    })}
                  />
                </label>
                <label>
                  {t("compatibilityProfiles.fields.bitDepth")}
                  <input
                    value={(capability.bit_depth ?? []).join(", ")}
                    readOnly={!editable}
                    placeholder={t("compatibilityProfiles.placeholders.bitDepth")}
                    onChange={(event) => updateEntry(key, {
                      bit_depth: event.target.value.split(",")
                        .map((value) => Number(value.trim()))
                        .filter((value) => Number.isFinite(value) && value > 0),
                    })}
                  />
                </label>
                <label>
                  {t("compatibilityProfiles.fields.hdr")}
                  <input
                    value={(capability.hdr ?? []).join(", ")}
                    readOnly={!editable}
                    placeholder={t("compatibilityProfiles.placeholders.hdr")}
                    onChange={(event) => updateEntry(key, {
                      hdr: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                    })}
                  />
                </label>
                <label>
                  {t("compatibilityProfiles.fields.codecProfiles")}
                  <input
                    value={(capability.profiles ?? []).join(", ")}
                    readOnly={!editable}
                    placeholder={t("compatibilityProfiles.placeholders.codecProfiles")}
                    onChange={(event) => updateEntry(key, {
                      profiles: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                    })}
                  />
                </label>
              </div>
            ) : null}
            {section === "audio" ? (
              <div className="compatibility-capability-limits">
                <label>
                  {t("compatibilityProfiles.fields.maxChannels")}
                  <input
                    type="number"
                    min={1}
                    value={capability.max_channels ?? ""}
                    readOnly={!editable}
                    onChange={(event) => updateEntry(key, {
                      max_channels: event.target.value ? Number(event.target.value) : null,
                    })}
                  />
                </label>
              </div>
            ) : null}
            <label className="compatibility-profile-reason">
              {t("compatibilityProfiles.fields.conditions")}
              <textarea
                key={`${key}-${JSON.stringify(capability.conditions ?? [])}`}
                rows={3}
                readOnly={!editable}
                defaultValue={JSON.stringify(capability.conditions ?? [], null, 2)}
                onBlur={(event) => {
                  if (!editable) return;
                  try {
                    updateEntry(key, { conditions: JSON.parse(event.target.value) });
                  } catch {
                    setMessage(t("compatibilityProfiles.invalidConditions"));
                  }
                }}
              />
            </label>
          </div>
        ))}
        {editable ? (
          <button
            type="button"
            className="secondary small settings-panel-header-action compatibility-capability-add"
            onClick={() => {
              const key = uniqueCapabilityKey(section, Object.keys(record));
              updateCapabilityDraft(section, { ...record, [key]: { mode: "unsupported" } });
            }}
          >
            <Plus size={15} aria-hidden="true" />
            {t("compatibilityProfiles.addCapability")}
          </button>
        ) : null}
      </div>
    );
  }

  function renderProfileDetails(profile: EditableProfile) {
    const editing = Boolean(draft && draftOriginId === profile.id);
    const editable = editing;
    const active = editing && draft ? draft : profile;
    const isHardware = "manufacturer" in active;
    const categoryOptions: readonly string[] = isHardware ? HARDWARE_CATEGORIES : SOFTWARE_CATEGORIES;
    const hasKnownCategory = categoryOptions.includes(active.category);
    const verificationMethod = active.verified_by ?? "";
    const hasKnownVerificationMethod = VERIFICATION_METHODS.includes(
      verificationMethod as (typeof VERIFICATION_METHODS)[number],
    );
    const verificationSelection = !verificationMethod
      ? "unverified"
      : hasKnownVerificationMethod
        ? verificationMethod
        : "other";

    return (
      <div className="compatibility-profile-details">
        <div className="compatibility-profile-form-grid">
          <label>
            {t("compatibilityProfiles.fields.name")}
            <input
              value={active.name}
              readOnly={!editable}
              onChange={(event) => updateDraft({ name: event.target.value })}
            />
          </label>
          <label>
            {t("compatibilityProfiles.fields.category")}
            <select
              value={active.category}
              disabled={!editable}
              onChange={(event) => updateDraft({ category: event.target.value })}
            >
              {!hasKnownCategory ? (
                <option value={active.category}>{active.category}</option>
              ) : null}
              {categoryOptions.map((category) => (
                <option value={category} key={category}>
                  {t(`compatibilityProfiles.categories.${category}`)}
                </option>
              ))}
            </select>
          </label>
          {isHardware ? (
            <>
              <label>
                {t("compatibilityProfiles.fields.manufacturer")}
                <input
                  value={(active as HardwareProfile).manufacturer}
                  readOnly={!editable}
                  onChange={(event) => updateDraft({ manufacturer: event.target.value } as Partial<HardwareProfile>)}
                />
              </label>
              <label>
                {t("compatibilityProfiles.fields.year")}
                <input
                  type="number"
                  value={(active as HardwareProfile).year ?? ""}
                  readOnly={!editable}
                  onChange={(event) => updateDraft({
                    year: event.target.value ? Number(event.target.value) : null,
                  } as Partial<HardwareProfile>)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                {t("compatibilityProfiles.fields.developer")}
                <input
                  value={(active as SoftwareProfile).developer}
                  readOnly={!editable}
                  onChange={(event) => updateDraft({ developer: event.target.value } as Partial<SoftwareProfile>)}
                />
              </label>
              <label>
                {t("compatibilityProfiles.fields.platforms")}
                <input
                  value={(active as SoftwareProfile).platforms.join(", ")}
                  readOnly={!editable}
                  onChange={(event) => updateDraft({
                    platforms: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                  } as Partial<SoftwareProfile>)}
                />
              </label>
              <label>
                {t("compatibilityProfiles.fields.serverFallback")}
                <select
                  value={(active as SoftwareProfile).server_fallback ?? "unsupported"}
                  disabled={!editable}
                  onChange={(event) => updateDraft({
                    server_fallback: event.target.value as SoftwareProfile["server_fallback"],
                  } as Partial<SoftwareProfile>)}
                >
                  <option value="unsupported">{t("compatibilityProfiles.serverFallback.unsupported")}</option>
                  <option value="transcode">{t("compatibilityProfiles.serverFallback.transcode")}</option>
                </select>
              </label>
            </>
          )}
          <label>
            {t("compatibilityProfiles.fields.verifiedBy")}
            <select
              value={verificationSelection}
              disabled={!editable}
              onChange={(event) => {
                const value = event.target.value;
                updateDraft({
                  verified_by: value === "unverified"
                    ? null
                    : value === "other"
                      ? "other"
                      : value,
                });
              }}
            >
              {VERIFICATION_METHODS.map((method) => (
                <option value={method} key={method}>
                  {t(`compatibilityProfiles.verificationMethods.${method.replaceAll(" ", "_")}`)}
                </option>
              ))}
              <option value="unverified">{t("compatibilityProfiles.verificationMethods.unverified")}</option>
              <option value="other">{t("compatibilityProfiles.verificationMethods.other")}</option>
            </select>
          </label>
          {verificationSelection === "other" ? (
            <label>
              {t("compatibilityProfiles.fields.otherVerification")}
              <input
                value={active.verified_by === "other" ? "" : active.verified_by ?? ""}
                readOnly={!editable}
                onChange={(event) => updateDraft({ verified_by: event.target.value || "other" })}
              />
            </label>
          ) : null}
          <label className="compatibility-profile-field-wide">
            {t("compatibilityProfiles.fields.notes")}
            <textarea
              rows={3}
              value={active.notes ?? ""}
              readOnly={!editable}
              onChange={(event) => updateDraft({ notes: event.target.value || null })}
            />
          </label>
        </div>

        <div className="compatibility-capability-sections">
          {([
            "video",
            "audio",
            "containers",
            "subtitles",
            ...(!isHardware ? ["rules" as const] : []),
            "sources",
          ] as CapabilitySection[]).map((section) => (
            <details className="compatibility-capability-section" key={section}>
              <summary>{t(`compatibilityProfiles.fields.${section}`)}</summary>
              <div className="compatibility-capability-section-body">
                {section === "sources"
                  ? renderSourcesEditor(active, editable, editing)
                  : section === "rules"
                    ? (
                      <textarea
                        className="compatibility-profile-json-editor"
                        rows={12}
                        readOnly={!editable}
                        value={editing ? capabilityDrafts.rules : JSON.stringify((active as SoftwareProfile).rules ?? [], null, 2)}
                        onChange={(event) => setCapabilityDrafts((current) => ({ ...current, rules: event.target.value }))}
                      />
                    )
                  : isHardware && section === "video"
                    ? renderHardwareVideoEditor(active as HardwareProfile, editable, editing)
                    : isHardware && section === "containers"
                      ? renderHardwareContainersEditor(active as HardwareProfile, editable, editing)
                      : isHardware
                        ? renderHardwareSupportEditor(
                            section as "audio" | "subtitles",
                            active as HardwareProfile,
                            editable,
                            editing,
                          )
                        : renderSoftwareCapabilityEditor(
                            section as "video" | "audio" | "containers" | "subtitles",
                            active as SoftwareProfile,
                            editable,
                            editing,
                          )}
              </div>
            </details>
          ))}
        </div>

        {editing ? (
          <>
            <label className="compatibility-profile-reason">
              {t("compatibilityProfiles.reason")}
              <textarea value={reason} rows={3} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div className="compatibility-profile-card-actions">
              <button type="button" className="compatibility-profile-action-button is-primary" onClick={() => void saveProfile()}>
                <Save size={16} />
                {profile.catalog_source === "official" ? t("compatibilityProfiles.saveCopy") : t("common.save")}
              </button>
              <button type="button" className="secondary compatibility-profile-action-button" onClick={() => void proposeProfile()}><Github size={16} />{t("compatibilityProfiles.propose")}</button>
              <button type="button" className="secondary compatibility-profile-action-button" onClick={() => {
                setDraft(null);
                setDraftOriginId(null);
              }}>{t("common.cancel")}</button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  function renderProfileQuickActions(profile: EditableProfile) {
    const isOfficial = profile.catalog_source === "official";
    const type = "manufacturer" in profile ? "hardware" : "software";
    return (
      <div className="compatibility-profile-quick-actions">
        {renderFavoriteAction(type, profile.id, profile.name)}
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={t("compatibilityProfiles.editAria", { name: profile.name })}
          title={t("compatibilityProfiles.edit")}
          onClick={() => editProfile(profile)}
        >
          <SquarePenIcon size={18} aria-hidden="true" className="nav-icon" />
        </button>
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={t("compatibilityProfiles.cloneAria", { name: profile.name })}
          title={t("compatibilityProfiles.clone")}
          onClick={() => cloneProfile(profile)}
        >
          <CopyIcon size={18} aria-hidden="true" className="nav-icon" />
        </button>
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={t("compatibilityProfiles.deleteAria", { name: profile.name })}
          title={isOfficial ? t("compatibilityProfiles.officialDeleteDisabled") : t("common.delete")}
          disabled={isOfficial}
          onClick={() => void removeProfile(profile)}
        >
          <DeleteIcon size={18} aria-hidden="true" className="nav-icon" />
        </button>
      </div>
    );
  }

  const createAction = tab === "compatibility" ? (
    <button
      type="button"
      className="secondary small settings-panel-header-action compatibility-profile-header-action"
      disabled={!hardware.length || !software.length}
      onClick={() => startCompatibility()}
    >
      <Plus size={16} aria-hidden="true" />
      {t("compatibilityProfiles.createCombination")}
    </button>
  ) : (
    <button
      type="button"
      className="secondary small settings-panel-header-action compatibility-profile-header-action"
      onClick={() => editProfile(tab === "hardware" ? hardwareTemplate() : softwareTemplate())}
    >
      <Plus size={16} aria-hidden="true" />
      {t("compatibilityProfiles.create")}
    </button>
  );

  return (
    <AsyncPanel
      title={t("compatibilityProfiles.title")}
      loading={loading}
      error={error}
      className="compatibility-profiles-async-panel"
      collapseActions={createAction}
    >
      <div className="compatibility-profile-panel">
        <p className="compatibility-profile-development-note">
          {t("compatibilityProfiles.developmentNote")}
        </p>
        <div
          className="quality-profile-segments"
          role="tablist"
          aria-label={t("compatibilityProfiles.title")}
        >
          <SlidingTogglePill activeKey={tab} className="nav-active-pill quality-profile-segment-pill" />
          {(["hardware", "software", "compatibility"] as ProfileTab[]).map((key) => (
            <button
              type="button"
              className={`quality-profile-segment${tab === key ? " is-active" : ""}`}
              data-toggle-key={key}
              aria-pressed={tab === key}
              key={key}
              onClick={() => {
                setTab(key);
                setDraft(null);
                setDraftOriginId(null);
                setExpandedProfileId(null);
                setCompatibilityDraft(null);
              }}
            >
              <span>{t(`compatibilityProfiles.tabs.${key}`)}</span>
            </button>
          ))}
        </div>

        {message ? <div className="alert">{message}</div> : null}

        {tab !== "compatibility" ? (
          <>
            <div className="compatibility-profile-list">
              {renderProfileSearch()}
              {filteredProfiles.map((profile) => (
                <article
                  className={`compatibility-profile-list-item${expandedProfileId === profile.id ? " is-expanded" : ""}`}
                  key={profile.id}
                >
                  <div className="compatibility-profile-list-row">
                    <button
                      type="button"
                      className="compatibility-profile-list-trigger"
                      aria-expanded={expandedProfileId === profile.id}
                      onClick={() => {
                        if (expandedProfileId === profile.id) {
                          setDraft(null);
                          setDraftOriginId(null);
                          setExpandedProfileId(null);
                          return;
                        }
                        setDraft(null);
                        setDraftOriginId(null);
                        setExpandedProfileId(profile.id);
                      }}
                    >
                      <span>{profile.name}</span>
                      <ChevronDown aria-hidden="true" />
                    </button>
                    {renderProfileQuickActions(profile)}
                  </div>
                  {expandedProfileId === profile.id ? renderProfileDetails(profile) : null}
                </article>
              ))}
              {draft && draftOriginId === draft.id && !profiles.some((profile) => profile.id === draft.id) ? (
                <article className="compatibility-profile-list-item is-expanded">
                  <div className="compatibility-profile-list-row">
                    <div className="compatibility-profile-list-trigger is-static">
                      <span>{draft.name}</span>
                      <ChevronDown aria-hidden="true" />
                    </div>
                  </div>
                  {renderProfileDetails(draft)}
                </article>
              ) : null}
              {!filteredProfiles.length && !(draft && draftOriginId === draft.id) ? (
                <p className="compatibility-profile-search-empty">{t("compatibilityProfiles.searchEmpty")}</p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="compatibility-profile-list">
              {renderProfileSearch()}
              {filteredCompatibility.map((profile) => (
                <article
                  className={`compatibility-profile-list-item${expandedProfileId === profile.id ? " is-expanded" : ""}`}
                  key={profile.id}
                >
                  <div className="compatibility-profile-list-row">
                    <button
                      type="button"
                      className="compatibility-profile-list-trigger"
                      aria-expanded={expandedProfileId === profile.id}
                      onClick={() => {
                        if (expandedProfileId === profile.id) {
                          setExpandedProfileId(null);
                          setCompatibilityDraft(null);
                        } else {
                          startCompatibility(profile);
                        }
                      }}
                    >
                      <span>{profile.name}</span>
                      <ChevronDown aria-hidden="true" />
                    </button>
                    <div className="compatibility-profile-quick-actions">
                      {renderFavoriteAction("compatibility", profile.id, profile.name)}
                    </div>
                  </div>
                  {expandedProfileId === profile.id && compatibilityDraft?.id === profile.id ? (
                    <div className="compatibility-profile-details">
                      <div className="compatibility-profile-form-grid">
                        <label>{t("compatibilityProfiles.fields.name")}<input value={compatibilityDraft.name} onChange={(event) => setCompatibilityDraft({ ...compatibilityDraft, name: event.target.value })} /></label>
                        <label>{t("compatibilityProfiles.tabs.hardware")}<select value={compatibilityDraft.hardware_profile_id} onChange={(event) => setCompatibilityDraft({ ...compatibilityDraft, hardware_profile_id: event.target.value })}>{hardware.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                        <label>{t("compatibilityProfiles.tabs.software")}<select value={compatibilityDraft.software_profile_id} onChange={(event) => setCompatibilityDraft({ ...compatibilityDraft, software_profile_id: event.target.value })}>{software.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                      </div>
                      <p>{profileNames.get(compatibilityDraft.hardware_profile_id)} + {profileNames.get(compatibilityDraft.software_profile_id)}</p>
                      <div className="compatibility-profile-card-actions">
                        <button type="button" className="compatibility-profile-action-button is-primary" onClick={() => void saveCompatibility()}><Save size={16} />{t("common.save")}</button>
                        <button type="button" className="secondary compatibility-profile-action-button" onClick={() => void removeCompatibility(profile)}><Trash2 size={16} />{t("common.delete")}</button>
                        <button type="button" className="secondary compatibility-profile-action-button" onClick={() => setCompatibilityDraft(null)}>{t("common.cancel")}</button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
              {compatibilityDraft && !compatibility.some((profile) => profile.id === compatibilityDraft.id) ? (
                <article className="compatibility-profile-list-item is-expanded">
                  <div className="compatibility-profile-list-trigger is-static">
                    <span>{compatibilityDraft.name}</span>
                    <ChevronDown aria-hidden="true" />
                  </div>
                  <div className="compatibility-profile-details">
                    <div className="compatibility-profile-form-grid">
                <label>{t("compatibilityProfiles.fields.name")}<input value={compatibilityDraft.name} onChange={(event) => setCompatibilityDraft({ ...compatibilityDraft, name: event.target.value })} /></label>
                <label>{t("compatibilityProfiles.tabs.hardware")}<select value={compatibilityDraft.hardware_profile_id} onChange={(event) => setCompatibilityDraft({ ...compatibilityDraft, hardware_profile_id: event.target.value })}>{hardware.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label>{t("compatibilityProfiles.tabs.software")}<select value={compatibilityDraft.software_profile_id} onChange={(event) => setCompatibilityDraft({ ...compatibilityDraft, software_profile_id: event.target.value })}>{software.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    </div>
                <div className="compatibility-profile-card-actions">
                  <button type="button" className="compatibility-profile-action-button is-primary" onClick={() => void saveCompatibility()}><Save size={16} />{t("common.save")}</button>
                  <button type="button" className="secondary compatibility-profile-action-button" onClick={() => setCompatibilityDraft(null)}>{t("common.cancel")}</button>
                </div>
                  </div>
                </article>
              ) : null}
              {!filteredCompatibility.length && !compatibilityDraft ? (
                <p className="compatibility-profile-search-empty">{t("compatibilityProfiles.searchEmpty")}</p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </AsyncPanel>
  );
}
