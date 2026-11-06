import { identityGeneration } from "../lib/access-session";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Ban, Clock3, Copy, Gauge, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Power, RefreshCw, Save, Search, ShieldCheck, Star, Trash2, Unplug, X } from "lucide-react";
import { useAutosaveNotifications } from "../lib/notification-actions";
import { useNotifications } from "../lib/notifications";
import { useTranslation } from "react-i18next";
import { releaseVisibility } from "../lib/release-visibility";
import { formatLanguageName, languageOptions, normalizeLanguageTag, sharedStreamLanguageCodeFormat, streamLanguageCodeFormats } from "../lib/language";

import {
  api,
  type LibrarySummary,
  type TranscodeCondition,
  type TranscodeConditionGroup,
  type TranscodeFederation,
  type TranscodeFederationMember,
  type TranscodePreset,
  type TranscodePresetDefinition,
  type TranscodePresetStreamRule,
  type TranscodeRule,
} from "../lib/api";
import { type TranscodingMatrixFocus } from "../lib/transcoding-matrix-state";
import { LoaderPinwheelIcon } from "./LoaderPinwheelIcon";
import { AnimatedConnectIcon } from "./AnimatedConnectIcon";
import { CopyIcon } from "./CopyIcon";
import { PanelEmptyState } from "./PanelEmptyState";
import { SquarePenIcon } from "./SquarePenIcon";
import { TooltipTrigger } from "./TooltipTrigger";
import { LanguageCodeFormatField } from "./LanguageCodeFormatField";

type PresetDraft = {
  id: number | null;
  name: string;
  description: string;
  definition: TranscodePresetDefinition;
};

type RuleDraft = {
  id: number | null;
  name: string;
  enabled: boolean;
  priority: number;
  library_ids: number[];
  conditions: TranscodeConditionGroup | null;
  profile_id: number;
  output_mode: TranscodeRule["output_mode"];
  output_subfolder: string;
  replacement_approved: boolean;
};

type AutomationTab = "presets" | "rules" | "accelerators" | "members";

const AUTOMATION_TABS: AutomationTab[] = ["presets", "rules", "accelerators", "members"];

function visibleAutomationTabs(): AutomationTab[] {
  return AUTOMATION_TABS.filter((tab) => (
    (releaseVisibility.automationRules || tab !== "rules")
    && (releaseVisibility.federation || tab !== "members")
  ));
}

function automationTabFromSearchFocus(searchFocus: string | null | undefined): AutomationTab | null {
  if (searchFocus?.startsWith("transcoding-tab-")) {
    const value = searchFocus.slice("transcoding-tab-".length);
    return visibleAutomationTabs().includes(value as AutomationTab) ? value as AutomationTab : null;
  }
  if (releaseVisibility.automationRules && searchFocus === "transcoding-automation-rules") return "rules";
  if (searchFocus === "transcoding-accelerators") return "accelerators";
  if (releaseVisibility.federation && searchFocus === "transcoding-federation-members") return "members";
  return null;
}

type TranscodePresetsRulesPanelProps = {
  capabilityMatrix: (tabControls: ReactNode) => ReactNode;
  acceleratorsTooltip: ReactNode;
  standaloneTab?: AutomationTab;
  standalonePresetTabs?: ReactNode;
  standaloneCollapsed?: boolean;
  onStandaloneToggle?: () => void;
  standaloneHeaderAction?: ReactNode;
  federation?: TranscodeFederation | null;
  onFederationData?: (data: TranscodeFederation) => void;
  onAcceleratorMatrixFocus?: (focus: TranscodingMatrixFocus | null) => void;
  searchFocus?: string | null;
};

const CONDITION_FIELDS = [
  "path",
  "container",
  "size",
  "duration",
  "quality_score",
  "bitrate",
  "audio_bitrate",
  "bit_depth",
  "audio_channels",
  "sample_rate",
  "chapter_count",
  "video_codec",
  "resolution",
  "hdr_type",
  "audio_codecs",
  "audio_spatial_profiles",
  "audio_languages",
  "audio_title",
  "audio_artist",
  "audio_album",
  "audio_album_artist",
  "audio_genre",
  "audio_date",
  "audio_disc",
  "audio_composer",
  "track_number",
  "bit_rate_mode",
  "has_embedded_cover",
  "chapter_titles",
  "subtitle_languages",
  "subtitle_codecs",
  "subtitle_sources",
];

const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  ">",
  ">=",
  "<",
  "<=",
  "exists",
  "missing",
];

function emptyPresetDefinition(): TranscodePresetDefinition {
  return {
    version: 1,
    container: "source",
    video_rules: [],
    audio_rules: [],
    subtitle_rules: [],
    external_subtitle_rules: [],
    default_video_action: "copy",
    default_audio_action: "copy",
    default_subtitle_action: "copy",
    default_external_subtitle_action: "remove",
    dynamic_range: "preserve",
    chapters: "keep",
    metadata: "keep",
    cover: "keep",
    attachments: "keep",
    filename_template: "{sourceName} [{resolution}, {dynRange}, {codec}] [{audioLanguages}]",
    filename_template_override: false,
    include_subtitle_languages: false,
    filename_language_code_format: "iso_639_1",
    execution_mode: "inherit",
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function memberResourceSummary(member: TranscodeFederationMember, t: (key: string, options?: Record<string, unknown>) => string): string {
  const resources = member.resources;
  const cpuThreads = typeof resources.cpu_threads === "number" ? `${resources.cpu_threads} CPU` : null;
  const freeBytes = typeof resources.temp_free_bytes === "number" ? `${Math.round(resources.temp_free_bytes / 1024 / 1024 / 1024)} GB free` : null;
  const parts = [cpuThreads, freeBytes, `${member.active_jobs} ${t("transcoding.federation.activeJobs")}`].filter(Boolean);
  return parts.join(" · ") || t("transcoding.federation.resourcesUnknown");
}

function memberListSummary(member: TranscodeFederationMember, t: (key: string, options?: Record<string, unknown>) => string): string {
  const version = member.application_version?.trim().replace(/^v/i, "");
  return [
    memberResourceSummary(member, t),
    version ? t("transcoding.federation.version", { version }) : null,
  ].filter(Boolean).join(" · ");
}

function normalizedEndpointKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "").toLocaleLowerCase();
}

function memberEndpointMetric(member: TranscodeFederationMember, endpoint: string): Record<string, unknown> {
  const metrics = member.endpoint_metrics ?? {};
  const exact = metrics[endpoint];
  if (exact) return exact;
  const key = normalizedEndpointKey(endpoint);
  return Object.entries(metrics).find(([candidate]) => normalizedEndpointKey(candidate) === key)?.[1] ?? {};
}

function finiteEndpointMetric(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function formatEndpointMetric(value: unknown, unit: string): string {
  const number = finiteEndpointMetric(value);
  return number === null ? "—" : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(number)} ${unit}`;
}

function installationVersionLabel(version: string | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  const normalizedVersion = version?.trim().replace(/^v/i, "");
  return normalizedVersion ? t("transcoding.federation.version", { version: normalizedVersion }) : null;
}

type FederationMemberStatus = "online" | "warning" | "offline";

const OFFLINE_MEMBER_CONNECTION_STATUSES = new Set(["offline", "unreachable", "disconnected"]);

function federationMemberStatus(member: TranscodeFederationMember): FederationMemberStatus {
  const connectionStatus = member.connection_status.trim().toLocaleLowerCase();
  if (!member.reachable || OFFLINE_MEMBER_CONNECTION_STATUSES.has(connectionStatus)) {
    return "offline";
  }
  if (Boolean(member.last_error?.trim()) || connectionStatus !== "connected" || member.status !== "active") {
    return "warning";
  }
  return "online";
}

function federationMemberStatusLabel(
  status: FederationMemberStatus,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const keys: Record<FederationMemberStatus, string> = {
    online: "transcoding.federation.statusHealthy",
    warning: "transcoding.federation.statusWarning",
    offline: "transcoding.federation.statusOffline",
  };
  return t(keys[status]);
}

function formatFederationMemberLastSeen(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function federationMemberStatusTooltip(
  member: TranscodeFederationMember,
  t: (key: string, options?: Record<string, unknown>) => string,
): ReactNode {
  const status = federationMemberStatus(member);
  const connectionStatus = member.connection_status.trim();
  const lastError = member.last_error?.trim();
  const lastSeen = formatFederationMemberLastSeen(member.last_seen_at);
  return (
    <div className="transcode-federation-status-tooltip">
      <strong className={`transcode-federation-status-tooltip-heading is-${status}`}>
        {federationMemberStatusLabel(status, t)}
      </strong>
      {status === "online" ? <p className="transcode-federation-status-tooltip-hint">{t("transcoding.federation.statusHealthyHint")}</p> : null}
      {lastError ? (
        <div className="transcode-federation-status-tooltip-item is-error">
          <span>{t("transcoding.federation.lastError")}</span>
          <p>{lastError}</p>
        </div>
      ) : null}
      {connectionStatus && connectionStatus.toLocaleLowerCase() !== "connected" ? (
        <div className="transcode-federation-status-tooltip-item">
          <span>{t("transcoding.federation.connectionStatus")}</span>
          <p>{connectionStatus}</p>
        </div>
      ) : null}
      {member.status !== "active" ? (
        <div className="transcode-federation-status-tooltip-item">
          <span>{t("transcoding.federation.memberState")}</span>
          <p>{member.status}</p>
        </div>
      ) : null}
      {lastSeen && status !== "online" ? (
        <div className="transcode-federation-status-tooltip-item">
          <span>{t("transcoding.federation.lastSeen")}</span>
          <p>{lastSeen}</p>
        </div>
      ) : null}
    </div>
  );
}

function presetDraftFrom(preset: TranscodePreset): PresetDraft {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    definition: clone(preset.definition),
  };
}

function ruleDraftFrom(rule: TranscodeRule): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    library_ids: [...rule.library_ids],
    conditions: clone(rule.conditions),
    profile_id: rule.profile_id,
    output_mode: rule.output_mode,
    output_subfolder: rule.output_subfolder,
    replacement_approved: rule.replacement_approved,
  };
}

function blankCondition(): TranscodeCondition {
  return { type: "condition", field: "video_codec", operator: "equals", value: "" };
}

function ConditionGroupEditor({
  group,
  onChange,
  onRemove,
  nested = false,
}: {
  group: TranscodeConditionGroup;
  onChange: (group: TranscodeConditionGroup) => void;
  onRemove?: () => void;
  nested?: boolean;
}) {
  const { t } = useTranslation();
  const updateChild = (index: number, child: TranscodeCondition | TranscodeConditionGroup) => {
    const children = [...group.children];
    children[index] = child;
    onChange({ ...group, children });
  };
  return (
    <div className={`transcode-condition-group ${nested ? "is-nested" : ""}`}>
      <div className="field-label-row">
        <strong>{nested ? t("transcoding.automation.nestedGroup") : t("transcoding.automation.conditions")}</strong>
        {onRemove ? (
          <button type="button" className="secondary icon-only-button" title={t("transcoding.automation.removeConditionGroup")} onClick={onRemove}>
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
      </div>
      <select
        className="settings-choice-input transcode-control"
        aria-label={t("transcoding.automation.conditionLogic")}
        value={group.operator}
        onChange={(event) => onChange({ ...group, operator: event.target.value as "and" | "or" })}
      >
        <option value="and">{t("transcoding.automation.allConditions")}</option>
        <option value="or">{t("transcoding.automation.anyCondition")}</option>
      </select>
      <div className="transcode-condition-list">
        {group.children.map((child, index) => child.type === "group" ? (
          <ConditionGroupEditor
            key={`group-${index}`}
            group={child}
            nested
            onChange={(next) => updateChild(index, next)}
            onRemove={() => onChange({ ...group, children: group.children.filter((_entry, childIndex) => childIndex !== index) })}
          />
        ) : (
          <div className="transcode-condition-row" key={`condition-${index}`}>
            <select
              className="settings-choice-input transcode-control"
              aria-label={t("transcoding.automation.conditionField")}
              value={child.field}
              onChange={(event) => updateChild(index, { ...child, field: event.target.value })}
            >
              {CONDITION_FIELDS.map((field) => <option key={field} value={field}>{field}</option>)}
            </select>
            <select
              className="settings-choice-input transcode-control"
              aria-label={t("transcoding.automation.conditionOperator")}
              value={child.operator}
              onChange={(event) => updateChild(index, { ...child, operator: event.target.value })}
            >
              {CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
            </select>
            {!(["exists", "missing"].includes(child.operator)) ? (
              <input
                className="settings-choice-input transcode-control"
                aria-label={t("transcoding.automation.conditionValue")}
                value={String(child.value ?? "")}
                onChange={(event) => updateChild(index, { ...child, value: event.target.value })}
              />
            ) : null}
            <button type="button" className="secondary icon-only-button" title={t("transcoding.automation.removeCondition")} onClick={() => onChange({ ...group, children: group.children.filter((_entry, childIndex) => childIndex !== index) })}>
              <Trash2 aria-hidden="true" size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="transcode-actions">
        <button type="button" className="secondary small settings-panel-header-action" onClick={() => onChange({ ...group, children: [...group.children, blankCondition()] })}>
          <Plus aria-hidden="true" size={14} />{t("transcoding.automation.addCondition")}
        </button>
        {!nested ? (
          <button type="button" className="secondary small settings-panel-header-action" onClick={() => onChange({ ...group, children: [...group.children, { type: "group", operator: "or", children: [blankCondition()] }] })}>
            <Plus aria-hidden="true" size={14} />{t("transcoding.automation.addNestedGroup")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

type PresetRuleListKey = "video_rules" | "audio_rules" | "subtitle_rules" | "external_subtitle_rules";
type PresetRuleKind = "video" | "audio" | "subtitle" | "external";

function emptyStreamRule(kind: PresetRuleKind): TranscodePresetStreamRule {
  return {
    match_codecs: [],
    match_languages: [],
    match_default: null,
    action: kind === "external" ? "copy" : "convert",
    codec: kind === "video" ? "hevc" : kind === "audio" ? "aac" : kind === "subtitle" ? "subrip" : null,
    encoder: null,
    bitrate: null,
    crf: kind === "video" ? 22 : null,
    cq: null,
    width: null,
    height: null,
    frame_rate: null,
    pixel_format: null,
    profile: null,
    level: null,
    preset: kind === "video" ? "medium" : null,
    gop_size: null,
    language: null,
    title: null,
  };
}

const presetRuleActionFields: Record<PresetRuleListKey, keyof Pick<
  TranscodePresetDefinition,
  "default_video_action" | "default_audio_action" | "default_subtitle_action" | "default_external_subtitle_action"
>> = {
  video_rules: "default_video_action",
  audio_rules: "default_audio_action",
  subtitle_rules: "default_subtitle_action",
  external_subtitle_rules: "default_external_subtitle_action",
};

const presetCodecOptions: Record<PresetRuleKind, string[]> = {
  video: ["h264", "hevc", "av1", "vp8", "vp9", "mpeg2video", "mjpeg"],
  audio: ["aac", "opus", "vorbis", "ac3", "eac3", "flac", "mp3"],
  subtitle: ["subrip", "ass", "webvtt", "mov_text"],
  external: ["subrip", "ass", "webvtt", "mov_text"],
};

const presetCodecLabels: Record<string, string> = {
  h264: "H.264", hevc: "HEVC", av1: "AV1", vp8: "VP8", vp9: "VP9", mpeg2video: "MPEG-2", mjpeg: "MJPEG",
  aac: "AAC", opus: "Opus", vorbis: "Vorbis", ac3: "AC-3", eac3: "E-AC-3", flac: "FLAC", mp3: "MP3",
  subrip: "SRT", ass: "ASS/SSA", webvtt: "WebVTT", mov_text: "MOV text",
};

const presetAudioBitrates: Record<string, number[]> = {
  aac: [64_000, 96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
  opus: [48_000, 64_000, 96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
  vorbis: [64_000, 96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
  ac3: [192_000, 256_000, 384_000, 448_000, 640_000],
  eac3: [192_000, 256_000, 384_000, 448_000, 640_000],
  flac: [0],
  mp3: [96_000, 128_000, 160_000, 192_000, 256_000, 320_000],
};

const presetVideoResolutions = [
  { value: "original", width: null, height: null },
  { value: "640x360", width: 640, height: 360 },
  { value: "854x480", width: 854, height: 480 },
  { value: "1280x720", width: 1280, height: 720 },
  { value: "1920x1080", width: 1920, height: 1080 },
  { value: "2560x1440", width: 2560, height: 1440 },
  { value: "3840x2160", width: 3840, height: 2160 },
];

function isCatchAllPresetRule(rule: TranscodePresetStreamRule): boolean {
  return !rule.match_codecs.length && !rule.match_languages.length && rule.match_default === null;
}

function defaultPresetRule(
  definition: TranscodePresetDefinition,
  key: PresetRuleListKey,
  kind: PresetRuleKind,
): TranscodePresetStreamRule {
  const catchAll = [...definition[key]].reverse().find(isCatchAllPresetRule);
  return catchAll ?? { ...emptyStreamRule(kind), action: definition[presetRuleActionFields[key]] };
}

function replaceDefaultPresetRule(
  definition: TranscodePresetDefinition,
  key: PresetRuleListKey,
  kind: PresetRuleKind,
  patch: Partial<TranscodePresetStreamRule>,
): TranscodePresetDefinition {
  const rules = [...definition[key]];
  let index = -1;
  for (let i = rules.length - 1; i >= 0; i -= 1) {
    if (isCatchAllPresetRule(rules[i])) {
      index = i;
      break;
    }
  }
  const current = index >= 0 ? rules[index] : { ...emptyStreamRule(kind), action: definition[presetRuleActionFields[key]] };
  const next = { ...current, ...patch, match_codecs: [], match_languages: [], match_default: null };
  if (index >= 0) rules[index] = next;
  else rules.push(next);
  return { ...definition, [key]: rules, [presetRuleActionFields[key]]: next.action };
}

function compatiblePresetCodecs(kind: PresetRuleKind, container: TranscodePresetDefinition["container"]): string[] {
  const allowedByContainer: Partial<Record<TranscodePresetDefinition["container"], Partial<Record<PresetRuleKind, string[]>>>> = {
    mp4: {
      video: ["h264", "hevc", "av1", "mjpeg"],
      audio: ["aac", "ac3", "eac3", "mp3"],
      subtitle: ["mov_text"],
      external: ["mov_text"],
    },
    webm: {
      video: ["vp8", "vp9", "av1"],
      audio: ["opus", "vorbis"],
      subtitle: ["webvtt"],
      external: ["webvtt"],
    },
  };
  const allowed = allowedByContainer[container]?.[kind];
  return allowed ? presetCodecOptions[kind].filter((codec) => allowed.includes(codec)) : presetCodecOptions[kind];
}

function PresetDefinitionEditor({
  definition,
  onChange,
}: {
  definition: TranscodePresetDefinition;
  onChange: (definition: TranscodePresetDefinition) => void;
}) {
  const { t, i18n } = useTranslation();
  const [activeStreamTab, setActiveStreamTab] = useState<PresetRuleListKey>("video_rules");
  const [metadataSettingsOpen, setMetadataSettingsOpen] = useState(false);
  const [customLanguageDrafts, setCustomLanguageDrafts] = useState<Record<string, string>>({});
  const [addingLanguageRuleFor, setAddingLanguageRuleFor] = useState<PresetRuleListKey | null>(null);
  const [newRuleLanguageCode, setNewRuleLanguageCode] = useState("");
  const metadataSettingsId = useId();
  const sections: Array<{ key: PresetRuleListKey; kind: PresetRuleKind; label: string }> = [
    { key: "video_rules", kind: "video", label: t("transcoding.streamTabs.video") },
    { key: "audio_rules", kind: "audio", label: t("transcoding.streamTabs.audio") },
    { key: "subtitle_rules", kind: "subtitle", label: t("transcoding.streamTabs.subtitles") },
    { key: "external_subtitle_rules", kind: "external", label: t("transcoding.externalSubtitles") },
  ];
  const updateRule = (key: PresetRuleListKey, kind: PresetRuleKind, patch: Partial<TranscodePresetStreamRule>) => onChange(replaceDefaultPresetRule(definition, key, kind, patch));
  const actionForUi = (action: TranscodePresetStreamRule["action"]) => action === "convert" ? "encode" : action === "remove" ? "drop" : "copy";
  const renderCodecSelect = (kind: PresetRuleKind, rule: TranscodePresetStreamRule, patchRule: (patch: Partial<TranscodePresetStreamRule>) => void) => {
    const codecs = compatiblePresetCodecs(kind, definition.container);
    const fallback = kind === "video" ? "hevc" : kind === "subtitle" || kind === "external" ? "subrip" : "aac";
    return (
      <select className="settings-choice-input transcode-control" value={rule.codec ?? fallback} aria-label={t("transcoding.targetCodec")} onChange={(event) => patchRule({ codec: event.target.value })}>
        {codecs.map((codec) => <option key={codec} value={codec}>{presetCodecLabels[codec] ?? codec}</option>)}
      </select>
    );
  };
  const renderStreamSection = (
    { key, kind, label }: (typeof sections)[number],
    rule: TranscodePresetStreamRule,
    patchRule: (patch: Partial<TranscodePresetStreamRule>) => void,
    rowKey: string,
    languageSpecific = false,
    onRemove?: () => void,
    usedLanguages?: Set<string>,
  ) => {
    const action = actionForUi(rule.action);
    const ActionIcon = rule.action === "convert" ? RefreshCw : rule.action === "remove" ? Ban : Copy;
    const customLanguage = normalizeLanguageTag(customLanguageDrafts[rowKey] ?? "");
    const canAddCustomLanguage = Boolean(customLanguage && !usedLanguages?.has(customLanguage));
    return (
      <article className={"transcode-stream-list-item transcode-preset-stream-item" + (action === "drop" ? " is-dropped" : "")} key={rowKey}>
        <div className={"transcode-stream-list-row" + (languageSpecific ? " has-language-controls" : "")}>
          {languageSpecific ? (
            <div className="transcode-preset-language-controls">
              <label className="transcode-control-field"><span className="transcode-field-label">{t("transcoding.presetLanguageRules.languages")}</span>
                <select className="settings-choice-input transcode-control" value="" aria-label={t("transcoding.presetLanguageRules.addLanguage")} onChange={(event) => patchRule({ match_languages: [...rule.match_languages, event.target.value] })}>
                  <option value="" disabled>{t("transcoding.presetLanguageRules.addLanguage")}</option>
                  {languageOptions(rule.match_languages, i18n.language).filter((language) => !usedLanguages?.has(language)).map((language) => <option key={language} value={language}>{formatLanguageName(language, i18n.language)}</option>)}
                </select>
              </label>
              <div className="transcode-preset-custom-language"><input className="settings-choice-input transcode-control" aria-label={t("transcoding.presetLanguageRules.customCode")} placeholder="en-US" value={customLanguageDrafts[rowKey] ?? ""} onChange={(event) => setCustomLanguageDrafts((current) => ({ ...current, [rowKey]: event.target.value }))} /><button type="button" className="secondary small settings-panel-header-action" disabled={!canAddCustomLanguage} onClick={() => { patchRule({ match_languages: [...rule.match_languages, customLanguage] }); setCustomLanguageDrafts((current) => ({ ...current, [rowKey]: "" })); }}><Plus size={14} aria-hidden="true" />{t("transcoding.presetLanguageRules.addCode")}</button></div>
            </div>
          ) : <div className="transcode-stream-row-copy"><span className="transcode-stream-format">{t("transcoding.presetLanguageRules.remaining")}</span></div>}
          <div className="transcode-stream-row-actions">
            <div className="transcode-action-field is-expanded" data-action={action}>
              <ActionIcon aria-hidden="true" className="transcode-stream-action-icon" size={14} />
              <select className="settings-choice-input transcode-control transcode-action-select" value={rule.action} aria-label={t("transcoding.streamAction", { index: label })} onChange={(event) => patchRule({ action: event.target.value as TranscodePresetStreamRule["action"] })}>
                <option value="copy">{t("transcoding.actions.copy")}</option><option value="convert">{t("transcoding.actions.encode")}</option><option value="remove">{t("transcoding.actions.drop")}</option>
              </select>
            </div>
            {onRemove ? <button type="button" className="secondary icon-only-button" aria-label={t("transcoding.presetLanguageRules.removeRule", { kind: label })} onClick={onRemove}><Trash2 size={15} aria-hidden="true" /></button> : null}
          </div>
        </div>
        {languageSpecific ? (
          <div className="transcode-preset-rule-languages">
            <div className="transcode-preset-language-chips">
              {rule.match_languages.map((language) => <button type="button" className="secondary small transcode-preset-language-chip" key={language} disabled={rule.match_languages.length === 1} aria-label={t("transcoding.presetLanguageRules.removeLanguage", { language: formatLanguageName(language, i18n.language) })} onClick={() => patchRule({ match_languages: rule.match_languages.filter((entry) => entry !== language) })}>{formatLanguageName(language, i18n.language)}<X size={13} aria-hidden="true" /></button>)}
            </div>
          </div>
        ) : null}
        {rule.action === "convert" ? (
          <div className="transcode-stream-details">
            {kind === "video" ? (
              <div className="transcode-stream-encode-fields transcode-video-encode-fields">
                <label className="transcode-control-field transcode-dynamic-range-field">
                  <span className="transcode-field-label">{t("transcoding.dynamicRange")}</span>
                  <select className="settings-choice-input transcode-control" value={definition.dynamic_range} onChange={(event) => onChange({ ...definition, dynamic_range: event.target.value as TranscodePresetDefinition["dynamic_range"] })}>
                    {(["preserve", "sdr", "hdr10", "hlg"] as const).map((value) => <option key={value} value={value}>{t("transcoding.dynamicRanges." + value)}</option>)}
                  </select>
                </label>
                <label className="transcode-control-field transcode-codec-field"><span className="transcode-field-label">{t("transcoding.targetCodec")}</span>{renderCodecSelect(kind, rule, patchRule)}</label>
                <label className="transcode-control-field transcode-range-field">
                  <span className="transcode-field-label">{t("transcoding.quality", { mode: "CRF/CQ" })}</span>
                  <span className="transcode-range-row">
                    <input className="settings-choice-input transcode-control transcode-quality-range" type="range" min={0} max={rule.codec === "av1" ? 63 : 51} step={1} value={rule.crf ?? rule.cq ?? 23} aria-valuetext={String(rule.crf ?? rule.cq ?? 23)} onChange={(event) => patchRule({ crf: Number(event.target.value), cq: Number(event.target.value) })} />
                    <input className="settings-choice-input transcode-control transcode-range-value" type="number" min={0} max={rule.codec === "av1" ? 63 : 51} step={1} value={rule.crf ?? rule.cq ?? 23} aria-label={t("transcoding.quality", { mode: "CRF/CQ" })} onChange={(event) => { if (event.target.value !== "") patchRule({ crf: Number(event.target.value), cq: Number(event.target.value) }); }} />
                  </span>
                </label>
                <label className="transcode-control-field transcode-preset-field">
                  <span className="transcode-field-label">{t("transcoding.speedPreset")}</span>
                  <select className="settings-choice-input transcode-control" value={rule.preset ?? "medium"} onChange={(event) => patchRule({ preset: event.target.value })}>
                    {["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="transcode-control-field transcode-resolution-field">
                  <span className="transcode-field-label">{t("transcoding.resolution")}</span>
                  <select className="settings-choice-input transcode-control" value={rule.width && rule.height ? rule.width + "x" + rule.height : "original"} onChange={(event) => {
                    const selected = presetVideoResolutions.find((option) => option.value === event.target.value);
                    patchRule({ width: selected?.width ?? null, height: selected?.height ?? null });
                  }}>
                    {presetVideoResolutions.map((option) => <option key={option.value} value={option.value}>{option.value === "original" ? t("transcoding.original") : t("transcoding.resolutionPreset", { height: option.height, width: option.width })}</option>)}
                    {rule.width && rule.height && !presetVideoResolutions.some((option) => option.value === rule.width + "x" + rule.height) ? <option value={rule.width + "x" + rule.height}>{rule.width}×{rule.height}</option> : null}
                  </select>
                </label>
              </div>
            ) : kind === "audio" ? (
              <div className="transcode-stream-encode-fields">
                <label className="transcode-control-field transcode-codec-field"><span className="transcode-field-label">{t("transcoding.targetCodec")}</span>{renderCodecSelect(kind, rule, patchRule)}</label>
                <label className="transcode-control-field transcode-range-field">
                  <span className="transcode-field-label">{t("transcoding.bitrate")}</span>
                  <select className="settings-choice-input transcode-control" value={rule.bitrate ?? 192_000} onChange={(event) => patchRule({ bitrate: Number(event.target.value) })}>
                    {(presetAudioBitrates[rule.codec ?? "aac"] ?? presetAudioBitrates.aac).map((value) => <option key={value} value={value}>{value === 0 ? t("transcoding.lossless") : Math.round(value / 1000) + " kb/s"}</option>)}
                  </select>
                </label>
              </div>
            ) : (
              <div className="transcode-stream-encode-fields">
                <label className="transcode-control-field transcode-codec-field"><span className="transcode-field-label">{t("transcoding.targetCodec")}</span>{renderCodecSelect(kind, rule, patchRule)}</label>
              </div>
            )}
          </div>
        ) : null}
      </article>
    );
  };
  const renderRuleGroup = (section: (typeof sections)[number]) => {
    const { key, kind, label } = section;
    const explicitRules = definition[key].map((rule, index) => ({ rule, index })).filter(({ rule }) => !isCatchAllPresetRule(rule));
    const usedLanguages = new Set(explicitRules.flatMap(({ rule }) => rule.match_languages));
    const addRule = (language: string) => {
      onChange({ ...definition, [key]: [...definition[key], { ...emptyStreamRule(kind), action: "copy", match_languages: [language] }] });
      setAddingLanguageRuleFor(null);
      setNewRuleLanguageCode("");
    };
    const normalizedNewRuleCode = normalizeLanguageTag(newRuleLanguageCode);
    return (
      <div className="transcode-preset-rule-group" key={key}>
        {kind === "external" ? <h4>{label}</h4> : null}
        {explicitRules.map(({ rule, index }) => renderStreamSection(
          section,
          rule,
          (patch) => onChange({ ...definition, [key]: definition[key].map((entry, ruleIndex) => ruleIndex === index ? { ...entry, ...patch } : entry) }),
          `${key}-${index}`,
          true,
          () => onChange({ ...definition, [key]: definition[key].filter((_entry, ruleIndex) => ruleIndex !== index) }),
          usedLanguages,
        ))}
        {renderStreamSection(section, defaultPresetRule(definition, key, kind), (patch) => updateRule(key, kind, patch), `${key}-remaining`)}
        {addingLanguageRuleFor === key ? <div className="transcode-preset-new-language-rule"><select className="settings-choice-input transcode-control" value="" aria-label={t("transcoding.presetLanguageRules.chooseLanguage")} onChange={(event) => addRule(event.target.value)}><option value="" disabled>{t("transcoding.presetLanguageRules.chooseLanguage")}</option>{languageOptions([], i18n.language).filter((language) => !usedLanguages.has(language)).map((language) => <option key={language} value={language}>{formatLanguageName(language, i18n.language)}</option>)}</select><input className="settings-choice-input transcode-control" aria-label={t("transcoding.presetLanguageRules.customCode")} placeholder="en-US" value={newRuleLanguageCode} onChange={(event) => setNewRuleLanguageCode(event.target.value)} /><button type="button" className="secondary small settings-panel-header-action" disabled={!normalizedNewRuleCode || usedLanguages.has(normalizedNewRuleCode)} onClick={() => addRule(normalizedNewRuleCode)}>{t("transcoding.presetLanguageRules.addCode")}</button><button type="button" className="secondary icon-only-button" aria-label={t("common.cancel")} onClick={() => setAddingLanguageRuleFor(null)}><X size={15} aria-hidden="true" /></button></div> : <button type="button" className="secondary small settings-panel-header-action transcode-preset-add-language-rule" disabled={definition[key].length >= 128} onClick={() => setAddingLanguageRuleFor(key)}><Plus size={14} aria-hidden="true" />{t("transcoding.presetLanguageRules.addRule")}</button>}
      </div>
    );
  };
  return (
    <div className="settings-sidebar-stack transcode-preset-definition">
      <div className="transcode-configuration-grid transcode-preset-container-row">
        <label className="transcode-control-field"><span className="transcode-field-label">{t("transcoding.container")}</span><select className="settings-choice-input transcode-control" value={definition.container} onChange={(event) => {
          const container = event.target.value as TranscodePresetDefinition["container"];
          const allowed = streamLanguageCodeFormats(container);
          onChange({
            ...definition, container,
            video_language_code_format: allowed.includes(definition.video_language_code_format ?? "container_default") ? definition.video_language_code_format : "container_default",
            audio_language_code_format: allowed.includes(definition.audio_language_code_format ?? "container_default") ? definition.audio_language_code_format : "container_default",
            subtitle_language_code_format: allowed.includes(definition.subtitle_language_code_format ?? "container_default") ? definition.subtitle_language_code_format : "container_default",
          });
        }}>
          {(["source", "mkv", "mp4", "webm"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
        </select></label>
      </div>
      <section className="transcode-streams">
        <div className="compatibility-profile-list transcode-stream-catalog">
          <div className="transcode-automation-tab-controls transcode-stream-tabs">
            <div className="transcode-automation-tab-list" role="tablist" aria-label={t("transcoding.streamTabs.ariaLabel")} aria-orientation="horizontal">
              {sections.slice(0, 3).map(({ key, label }, index) => <button key={key} type="button" id={`preset-stream-tab-${key}`} role="tab" className={`transcode-automation-tab-button transcode-stream-tab${activeStreamTab === key ? " active" : ""}`} aria-selected={activeStreamTab === key} aria-controls={`preset-stream-panel-${key}`} tabIndex={activeStreamTab === key ? 0 : -1} onClick={() => setActiveStreamTab(key)} onKeyDown={(event) => {
                const keys = sections.slice(0, 3).map((section) => section.key);
                const nextIndex = event.key === "ArrowRight" ? (index + 1) % keys.length : event.key === "ArrowLeft" ? (index - 1 + keys.length) % keys.length : event.key === "Home" ? 0 : event.key === "End" ? keys.length - 1 : null;
                if (nextIndex === null) return;
                event.preventDefault();
                setActiveStreamTab(keys[nextIndex]);
                window.requestAnimationFrame(() => document.getElementById(`preset-stream-tab-${keys[nextIndex]}`)?.focus());
              }}><span className="transcode-automation-tab-label">{label}</span></button>)}
            </div>
          </div>
          <div id={`preset-stream-panel-${activeStreamTab}`} className="transcode-stream-tabpanel" role="tabpanel" aria-labelledby={`preset-stream-tab-${activeStreamTab}`} tabIndex={0}>
            <div className="transcode-stream-list transcode-preset-stream-list">
              {renderRuleGroup(sections.find((section) => section.key === activeStreamTab)!)}
              {activeStreamTab === "subtitle_rules" ? renderRuleGroup(sections[3]) : null}
            </div>
          </div>
        </div>
      </section>
      <section className={`media-card library-settings-card transcode-filename-section transcode-metadata-settings${metadataSettingsOpen ? " is-expanded" : " is-collapsed"}`}>
        <header className="transcode-filename-header"><button type="button" className="transcode-filename-toggle" aria-expanded={metadataSettingsOpen} aria-controls={metadataSettingsId} onClick={() => setMetadataSettingsOpen((open) => !open)}><span className="transcode-filename-chevron" aria-hidden="true">{metadataSettingsOpen ? <ChevronDown className="nav-icon" /> : <ChevronRight className="nav-icon" />}</span><span className="transcode-filename-heading"><h3>{t("transcoding.metadataSettings")}</h3></span></button></header>
        {metadataSettingsOpen ? <div className="transcode-filename-body" id={metadataSettingsId}><div className="transcode-global-options transcode-metadata-option-list" role="group" aria-label={t("transcoding.metadataSettings")}>{(["chapters", "metadata", "cover", "attachments"] as const).map((option) => <label className="transcode-global-option" key={option}><input type="checkbox" aria-label={t(`transcoding.options.${option}`)} checked={definition[option] === "keep"} onChange={(event) => onChange({ ...definition, [option]: event.target.checked ? "keep" : "drop" })} /><span className="transcode-global-option-label">{t(`transcoding.options.${option}`)}</span><TooltipTrigger ariaLabel={t(`transcoding.optionHelpAria.${option}`)} content={t(`transcoding.optionHelp.${option}`)} pinOnClick={false} /></label>)}
          <LanguageCodeFormatField
            className="transcode-global-option transcode-metadata-language-option"
            container={definition.container}
            ariaLabel={`${t("transcoding.languageCodeFormat")} (${t("transcoding.metadataSettings")})`}
            value={sharedStreamLanguageCodeFormat(definition)}
            onChange={(format) => onChange({ ...definition, video_language_code_format: format, audio_language_code_format: format, subtitle_language_code_format: format })}
          />
        </div></div> : null}
      </section>
    </div>
  );
}

export function TranscodePresetsRulesPanel({
  capabilityMatrix,
  acceleratorsTooltip,
  standaloneTab,
  standalonePresetTabs,
  standaloneCollapsed,
  onStandaloneToggle,
  standaloneHeaderAction,
  federation = null,
  onFederationData,
  onAcceleratorMatrixFocus,
  searchFocus = null,
}: TranscodePresetsRulesPanelProps) {
  const { t } = useTranslation();
  const notifications = useNotifications();
  const notificationIdentity = identityGeneration();
  const { trackSave } = useAutosaveNotifications({
    scopeKey: "settings:transcoding", topicKey: "transcode:rules", source: { area: "transcoding", href: "/settings?section=transcoding", label: t("notifications.actions.transcoding.openPresets", { defaultValue: "Open transcoding presets" }) },
    successMessage: t("notifications.actions.transcoding.presetsAutosaved", { defaultValue: "Transcoding preset settings saved." }),
    errorMessage: t("notifications.actions.transcoding.presetsAutosaveFailed", { defaultValue: "Could not save transcoding preset settings." }),
    partialMessage: t("notifications.actions.transcoding.presetsPartiallySaved", { defaultValue: "Some transcoding preset settings could not be saved." }),
  });
  function feedback(type: "success" | "error", key: string, fallback: string, area: "presets" | "rules") {
    if (notificationIdentity !== identityGeneration()) return;
    notifications.notify({ type, message: t(`notifications.actions.${["replacementApproved"].includes(key) ? "integration" : "transcoding"}.${key}`, { defaultValue: fallback }), topicKey: `transcode:${area}`, source: { area: "transcoding", href: area === "rules" ? "/settings?section=transcoding" : "/settings?section=transcoding-presets&settingsFocus=transcoding-presets-tab-presets", label: t("notifications.actions.transcoding.openPresets", { defaultValue: "Open transcoding presets" }) } });
  }
  const standaloneBodyId = useId();
  const standalonePanelTitleId = useId();
  const [presets, setPresets] = useState<TranscodePreset[]>([]);
  const [rules, setRules] = useState<TranscodeRule[]>([]);
  const [libraries, setLibraries] = useState<LibrarySummary[]>([]);
  const [tab, setTab] = useState<AutomationTab>(() => standaloneTab ?? automationTabFromSearchFocus(searchFocus) ?? "presets");
  const [expandedPresetId, setExpandedPresetId] = useState<number | null>(null);
  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [presetDraft, setPresetDraft] = useState<PresetDraft | null>(null);
  const [presetSearch, setPresetSearch] = useState("");
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [memberPending, setMemberPending] = useState<string | null>(null);
  const [discoveredPairingCodes, setDiscoveredPairingCodes] = useState<Record<string, string>>({});
  const [manualEndpoint, setManualEndpoint] = useState("");
  const [manualPairingCode, setManualPairingCode] = useState("");
  const [invalidDiscoveredPairingCode, setInvalidDiscoveredPairingCode] = useState<string | null>(null);
  const invalidDiscoveredPairingCodeTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (invalidDiscoveredPairingCodeTimeoutRef.current !== null) {
      window.clearTimeout(invalidDiscoveredPairingCodeTimeoutRef.current);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (standaloneTab === "members" || standaloneTab === "accelerators") {
        setLoaded(true);
        return;
      }
      const nextPresets = await api.transcodePresets();
      setPresets(nextPresets);
      if (standaloneTab !== "presets") {
        const [nextRules, nextLibraries] = await Promise.all([
          api.transcodeRules(),
          api.libraries(),
        ]);
        setRules(nextRules);
        setLibraries(nextLibraries);
      }
      setError(null);
      setLoaded(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [standaloneTab]);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  const startNewPreset = () => {
    setTab("presets");
    setExpandedPresetId(null);
    setExpandedRuleId(null);
    setRuleDraft(null);
    setRuleEditorOpen(false);
    setPresetDraft({ id: null, name: "", description: "", definition: emptyPresetDefinition() });
    setPresetEditorOpen(true);
  };

  const editPreset = (preset: TranscodePreset) => {
    if (preset.is_builtin) {
      void duplicatePreset(preset);
      return;
    }
    setPresetDraft(presetDraftFrom(preset));
    setPresetEditorOpen(true);
    setExpandedPresetId(preset.id);
  };

  const savePreset = async () => {
    if (!presetDraft?.name.trim()) return;
    setBusy(true);
    try {
      const definition = { ...presetDraft.definition, filename_template_override: false };
      const saved = presetDraft.id
        ? await api.updateTranscodePreset(presetDraft.id, { name: presetDraft.name.trim(), description: presetDraft.description, definition })
        : await api.createTranscodePreset({ name: presetDraft.name.trim(), description: presetDraft.description, definition });
      setPresets((current) => presetDraft.id ? current.map((preset) => preset.id === saved.id ? saved : preset) : [...current, saved]);
      setPresetDraft(presetDraftFrom(saved));
      setTab("presets");
      setExpandedPresetId(saved.id);
      setError(null);
      feedback("success", "savePresetSuccess", "Preset saved.", "presets");
    } catch {
      feedback("error", "savePresetFailed", "Could not save the preset.", "presets");
    } finally {
      setBusy(false);
    }
  };

  const duplicatePreset = async (preset: TranscodePreset) => {
    setBusy(true);
    try {
      const copy = await api.duplicateTranscodePreset(preset.id);
      setPresets((current) => [...current, copy]);
      setPresetDraft(presetDraftFrom(copy));
      setPresetEditorOpen(true);
      setTab("presets");
      setExpandedPresetId(copy.id);
      feedback("success", "duplicatePresetSuccess", "Preset duplicated.", "presets");
    } catch {
      feedback("error", "duplicatePresetFailed", "Could not duplicate the preset.", "presets");
    } finally {
      setBusy(false);
    }
  };

  const removePreset = async (preset: TranscodePreset) => {
    if (preset.is_builtin || preset.used_by_rule_count) return;
    setBusy(true);
    try {
      await api.deleteTranscodePreset(preset.id);
      setPresets((current) => current.filter((entry) => entry.id !== preset.id));
      if (presetDraft?.id === preset.id) {
        setPresetDraft(null);
        setPresetEditorOpen(false);
      }
      if (expandedPresetId === preset.id) setExpandedPresetId(null);
      feedback("success", "removePresetSuccess", "Preset deleted.", "presets");
    } catch {
      feedback("error", "removePresetFailed", "Could not delete the preset.", "presets");
    } finally {
      setBusy(false);
    }
  };

  const startNewRule = () => {
    setTab("rules");
    setExpandedPresetId(null);
    setExpandedRuleId(null);
    setPresetDraft(null);
    setPresetEditorOpen(false);
    const defaultPreset = presets[0];
    const defaultLibrary = libraries[0];
    setRuleDraft({ id: null, name: "", enabled: false, priority: rules.length, library_ids: defaultLibrary ? [defaultLibrary.id] : [], conditions: null, profile_id: defaultPreset?.id ?? 0, output_mode: "transcode_output", output_subfolder: "", replacement_approved: false });
    setRuleEditorOpen(true);
  };

  const saveRule = async () => {
    if (!ruleDraft?.name.trim() || !ruleDraft.profile_id || !ruleDraft.library_ids.length) return;
    setBusy(true);
    try {
      const payload = { name: ruleDraft.name.trim(), enabled: ruleDraft.enabled, priority: ruleDraft.priority, library_ids: ruleDraft.library_ids, conditions: ruleDraft.conditions, profile_id: ruleDraft.profile_id, output_mode: ruleDraft.output_mode, output_subfolder: ruleDraft.output_subfolder };
      const saved = ruleDraft.id ? await api.updateTranscodeRule(ruleDraft.id, payload) : await api.createTranscodeRule(payload);
      setRules((current) => ruleDraft.id ? current.map((rule) => rule.id === saved.id ? saved : rule) : [...current, saved].sort((a, b) => a.priority - b.priority || a.id - b.id));
      setRuleDraft(ruleDraftFrom(saved));
      setError(null);
      feedback("success", "saveRuleSuccess", "Rule saved.", "rules");
    } catch {
      feedback("error", "saveRuleFailed", "Could not save the rule.", "rules");
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (rule: TranscodeRule) => {
    try {
      const saved = await trackSave(api.updateTranscodeRule(rule.id, { enabled: !rule.enabled }));
      setRules((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      if (ruleDraft?.id === saved.id) setRuleDraft(ruleDraftFrom(saved));
    } catch {
      // trackSave reports the failed autosave.
    }
  };

  const editRule = (rule: TranscodeRule) => {
    setTab("rules");
    setPresetDraft(null);
    setPresetEditorOpen(false);
    setRuleDraft(ruleDraftFrom(rule));
    setRuleEditorOpen(true);
    setExpandedRuleId(rule.id);
  };

  const deleteRule = async (rule: TranscodeRule) => {
    setBusy(true);
    try {
      await api.deleteTranscodeRule(rule.id);
      setRules((current) => current.filter((entry) => entry.id !== rule.id));
      if (ruleDraft?.id === rule.id) {
        setRuleDraft(null);
        setRuleEditorOpen(false);
      }
      if (expandedRuleId === rule.id) setExpandedRuleId(null);
      feedback("success", "deleteRuleSuccess", "Rule deleted.", "rules");
    } catch {
      feedback("error", "deleteRuleFailed", "Could not delete the rule.", "rules");
    } finally {
      setBusy(false);
    }
  };

  const moveRule = async (rule: TranscodeRule, direction: -1 | 1) => {
    const index = rules.findIndex((entry) => entry.id === rule.id);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const reordered = [...rules];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      const saved = await trackSave(api.reorderTranscodeRules(reordered.map((rule) => rule.id)));
      setRules(saved);
    } catch {
      // trackSave reports the failed autosave.
    }
  };

  const approveReplacement = async (rule: TranscodeRule) => {
    try {
      const saved = await api.approveTranscodeRuleReplacement(rule.id, true);
      setRules((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      if (ruleDraft?.id === saved.id) setRuleDraft(ruleDraftFrom(saved));
      feedback("success", "replacementApproved", "Replacement approved.", "rules");
    } catch {
      feedback("error", "approveReplacementFailed", "Could not approve replacement.", "rules");
    }
  };

  const libraryNames = useMemo(() => new Map(libraries.map((library) => [library.id, library.name])), [libraries]);
  const federationMembers = federation?.members ?? [];
  const activeRulePreset = useMemo(() => presets.find((preset) => preset.id === ruleDraft?.profile_id), [presets, ruleDraft?.profile_id]);
  const filteredPresets = useMemo(() => {
    const query = presetSearch.trim().toLocaleLowerCase();
    if (!query) return presets;
    return presets.filter((preset) => `${preset.name} ${preset.description}`.toLocaleLowerCase().includes(query));
  }, [presetSearch, presets]);

  const closePresetEditor = () => {
    if (presetDraft?.id === null) setExpandedPresetId(null);
    setPresetDraft(null);
    setPresetEditorOpen(false);
  };

  const closeRuleEditor = () => {
    if (ruleDraft?.id === null) setExpandedRuleId(null);
    setRuleDraft(null);
    setRuleEditorOpen(false);
  };

  const selectTab = (nextTab: AutomationTab, nextMatrixFocus: TranscodingMatrixFocus | null = null) => {
    setTab(nextTab);
    setPresetDraft(null);
    setRuleDraft(null);
    setPresetEditorOpen(false);
    setRuleEditorOpen(false);
    setExpandedPresetId(null);
    setExpandedRuleId(null);
    setExpandedMemberId(null);
    onAcceleratorMatrixFocus?.(nextTab === "accelerators" ? nextMatrixFocus : null);
  };

  useEffect(() => {
    if (standaloneTab) {
      setTab(standaloneTab);
      return;
    }
    const nextTab = automationTabFromSearchFocus(searchFocus);
    if (!nextTab || nextTab === tab) return;
    setTab(nextTab);
    setPresetDraft(null);
    setRuleDraft(null);
    setPresetEditorOpen(false);
    setRuleEditorOpen(false);
    setExpandedPresetId(null);
    setExpandedRuleId(null);
    setExpandedMemberId(null);
    onAcceleratorMatrixFocus?.(null);
  }, [onAcceleratorMatrixFocus, searchFocus, standaloneTab, tab]);

  const togglePresetRow = (preset: TranscodePreset) => {
    if (expandedPresetId === preset.id) {
      setExpandedPresetId(null);
      setPresetDraft(null);
      setPresetEditorOpen(false);
      return;
    }
    setExpandedPresetId(preset.id);
    setPresetDraft(null);
    setPresetEditorOpen(false);
  };

  const toggleRuleRow = (rule: TranscodeRule) => {
    if (expandedRuleId === rule.id) {
      setExpandedRuleId(null);
      setRuleDraft(null);
      setRuleEditorOpen(false);
      return;
    }
    setExpandedRuleId(rule.id);
    setRuleDraft(null);
    setRuleEditorOpen(false);
  };

  const syncMember = async (member: TranscodeFederationMember) => {
    setMemberPending(member.installation_id);
    setError(null);
    try {
      const next = await api.syncTranscodeFederationMember(member.installation_id);
      onFederationData?.(next);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMemberPending(null);
    }
  };

  const updateMemberEndpoint = async (
    member: TranscodeFederationMember,
    endpoint: string,
    update: { favorite?: boolean; blocked?: boolean },
  ) => {
    const actionKey = `${member.installation_id}:${endpoint}`;
    setMemberPending(actionKey);
    setError(null);
    try {
      onFederationData?.(
        await api.updateTranscodeFederationMemberEndpoint(member.installation_id, {
          endpoint,
          ...update,
        }),
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMemberPending(null);
    }
  };

  const excludeMember = async (member: TranscodeFederationMember) => {
    if (!window.confirm(t("transcoding.federation.excludeConfirm", { name: member.display_name }))) return;
    setMemberPending(member.installation_id);
    setError(null);
    setNotice(null);
    try {
      await api.excludeTranscodeFederationMember(member.installation_id);
      if (federation) {
        onFederationData?.({ ...federation, members: federation.members.filter((item) => item.installation_id !== member.installation_id) });
      }
      if (expandedMemberId === member.installation_id) setExpandedMemberId(null);
      setNotice(t("transcoding.federation.excludeSucceeded", { name: member.display_name }));
      // Refresh discovery after disconnecting so an installation that is
      // still reachable moves into the pairing list immediately.
      onFederationData?.(await api.discoverTranscodeFederation());
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMemberPending(null);
    }
  };

  const flashMissingDiscoveredPairingCode = (installationId: string) => {
    setError(null);
    setInvalidDiscoveredPairingCode(installationId);
    if (invalidDiscoveredPairingCodeTimeoutRef.current !== null) {
      window.clearTimeout(invalidDiscoveredPairingCodeTimeoutRef.current);
    }
    invalidDiscoveredPairingCodeTimeoutRef.current = window.setTimeout(() => {
      setInvalidDiscoveredPairingCode((current) => current === installationId ? null : current);
      invalidDiscoveredPairingCodeTimeoutRef.current = null;
    }, 1200);
  };

  const discoverMembers = async () => {
    setMemberPending("discover");
    setError(null);
    try {
      onFederationData?.(await api.discoverTranscodeFederation());
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMemberPending(null);
    }
  };

  const pairDiscovered = async (peer: TranscodeFederation["discovered"][number]) => {
    const peerEndpoint = peer.endpoint_urls[0] ?? peer.installation_id;
    const code = discoveredPairingCodes[peer.installation_id]?.trim() ?? "";
    if (code.length !== 6) {
      flashMissingDiscoveredPairingCode(peer.installation_id);
      return;
    }
    setMemberPending(peer.installation_id);
    setError(null);
    try {
      onFederationData?.(await api.pairTranscodeFederation({ endpoint: peerEndpoint, pairing_code: code }));
      setDiscoveredPairingCodes((current) => {
        const next = { ...current };
        delete next[peer.installation_id];
        return next;
      });
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMemberPending(null);
    }
  };

  const pairManual = async () => {
    const endpoint = manualEndpoint.trim();
    const code = manualPairingCode.trim();
    if (!endpoint || code.length !== 6) {
      if (endpoint) flashMissingDiscoveredPairingCode("manual");
      return;
    }
    setMemberPending("manual");
    setError(null);
    try {
      onFederationData?.(await api.pairTranscodeFederation({ endpoint, pairing_code: code }));
      setManualEndpoint("");
      setManualPairingCode("");
      setInvalidDiscoveredPairingCode(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMemberPending(null);
    }
  };

  const renderPresetSummary = (preset: TranscodePreset) => {
    const definition = preset.definition;
    const sections: Array<{ key: PresetRuleListKey; kind: PresetRuleKind; label: string }> = [
      { key: "video_rules", kind: "video", label: t("transcoding.streamTabs.video") },
      { key: "audio_rules", kind: "audio", label: t("transcoding.streamTabs.audio") },
      { key: "subtitle_rules", kind: "subtitle", label: t("transcoding.streamTabs.subtitles") },
    ];
    const actionLabel = (action: TranscodePresetStreamRule["action"]) => action === "convert"
      ? t("transcoding.actions.encode")
      : action === "remove"
        ? t("transcoding.actions.drop")
        : t("transcoding.actions.copy");
    const summaryFor = (key: PresetRuleListKey, kind: PresetRuleKind) => {
      const rule = defaultPresetRule(definition, key, kind);
      if (rule.action !== "convert") return actionLabel(rule.action);
      const codec = presetCodecLabels[rule.codec ?? ""] ?? rule.codec ?? "—";
      if (kind === "video") {
        const resolution = rule.width && rule.height ? rule.width + "×" + rule.height : t("transcoding.original");
        return [actionLabel(rule.action), codec, String(rule.crf ?? rule.cq ?? "—"), rule.preset ?? "—", resolution, t("transcoding.dynamicRanges." + definition.dynamic_range)].join(" · ");
      }
      if (kind === "audio") return [actionLabel(rule.action), codec, rule.bitrate ? Math.round(rule.bitrate / 1000) + " kb/s" : "—"].join(" · ");
      return [actionLabel(rule.action), codec].join(" · ");
    };
    const externalRule = defaultPresetRule(definition, "external_subtitle_rules", "external");
    return (
      <div className="compatibility-profile-details transcode-automation-details">
        <div className="compatibility-profile-form-grid transcode-automation-summary-form-grid">
          <div><span>{t("transcoding.container")}</span><strong>{definition.container.toUpperCase()}</strong></div>
          {releaseVisibility.automationRules ? <div><span>{t("transcoding.automation.usedByRules")}</span><strong>{preset.used_by_rule_count}</strong></div> : null}
          {sections.map(({ key, kind, label }) => <div key={key}><span>{label}</span><strong>{summaryFor(key, kind)}</strong></div>)}
          <div><span>{t("transcoding.externalSubtitles")}</span><strong>{externalRule.action === "remove" ? t("transcoding.actions.drop") : t("transcoding.actions.encode")}</strong></div>
        </div>
        {preset.description ? <p className="field-hint">{preset.description}</p> : null}
      </div>
    );
  };

  const renderPresetEditor = () => {
    if (!presetDraft) return null;
    return (
      <div className="compatibility-profile-details transcode-automation-details transcode-automation-editor transcode-preset-editor">
        <div className="compatibility-profile-form-grid">
          <label className="transcode-control-field"><span className="transcode-field-label">{t("transcoding.automation.presetName")}</span><input className="settings-choice-input transcode-control" value={presetDraft.name} onChange={(event) => setPresetDraft({ ...presetDraft, name: event.target.value })} /></label>
          <label className="compatibility-profile-field-wide transcode-control-field"><span className="transcode-field-label">{t("transcoding.automation.presetDescription")}</span><textarea className="settings-choice-input transcode-control" rows={3} value={presetDraft.description} onChange={(event) => setPresetDraft({ ...presetDraft, description: event.target.value })} /></label>
        </div>
        <PresetDefinitionEditor definition={presetDraft.definition} onChange={(definition) => setPresetDraft({ ...presetDraft, definition })} />
        <div className="compatibility-profile-card-actions transcode-automation-editor-actions">
          <button type="button" className="transcode-action-button" onClick={() => void savePreset()} disabled={busy || !presetDraft.name.trim()}><Save aria-hidden="true" />{t("common.save")}</button>
          <button type="button" className="secondary transcode-action-button" onClick={closePresetEditor} disabled={busy}>{t("common.cancel")}</button>
        </div>
      </div>
    );
  };

  const renderRuleSummary = (rule: TranscodeRule) => {
    const outputLabel = rule.output_mode === "transcode_output"
      ? t("transcoding.transcodeOutput")
      : rule.output_mode === "same_directory"
        ? t("transcoding.sameDirectory")
        : t("transcoding.replaceOriginal");
    const selectedLibraries = rule.library_ids.map((libraryId) => libraryNames.get(libraryId)).filter(Boolean).join(", ");
    return (
      <div className="compatibility-profile-details transcode-automation-details">
        <div className="compatibility-profile-form-grid transcode-automation-summary-form-grid">
          <div><span>{t("transcoding.automation.preset")}</span><strong>{rule.profile_name} · v{rule.profile_version}</strong></div>
          <div><span>{t("transcoding.automation.libraries")}</span><strong>{selectedLibraries || "—"}</strong></div>
          <div><span>{t("transcoding.outputMode")}</span><strong>{outputLabel}</strong></div>
          <div><span>{t("transcoding.automation.rulePriority")}</span><strong>{rule.priority}</strong></div>
        </div>
        <p className="field-hint">{rule.conditions ? t("transcoding.automation.conditions") : "—"}{rule.output_subfolder ? ` · ${rule.output_subfolder}` : ""}</p>
        {rule.output_mode === "replace_original" ? <p className="field-hint">{t("transcoding.automation.replaceNeedsApproval")}</p> : null}
      </div>
    );
  };

  const renderRuleEditor = () => {
    if (!ruleDraft) return null;
    return (
      <div className="compatibility-profile-details transcode-automation-details transcode-automation-editor">
        <div className="field-label-row">
          <strong>{ruleDraft.id ? t("transcoding.automation.editRule") : t("transcoding.automation.newRule")}</strong>
          <button type="button" className="secondary icon-only-button" title={t("common.close")} onClick={closeRuleEditor}><X aria-hidden="true" size={14} /></button>
        </div>
        <div className="compatibility-profile-form-grid"><label><span>{t("transcoding.automation.ruleName")}</span><input className="settings-choice-input" value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} /></label><label><span>{t("transcoding.automation.rulePriority")}</span><input className="settings-choice-input" type="number" min={0} value={ruleDraft.priority} onChange={(event) => setRuleDraft({ ...ruleDraft, priority: Math.max(0, Number(event.target.value) || 0) })} /></label><label><span>{t("transcoding.automation.preset")}</span><select className="settings-choice-input" value={ruleDraft.profile_id} onChange={(event) => setRuleDraft({ ...ruleDraft, profile_id: Number(event.target.value) })}>{presets.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · v{profile.version}</option>)}</select></label></div>
        <label className="compatibility-profile-field-wide"><span>{t("transcoding.automation.libraries")}</span><select className="settings-choice-input" multiple value={ruleDraft.library_ids.map(String)} onChange={(event) => setRuleDraft({ ...ruleDraft, library_ids: [...event.target.selectedOptions].map((option) => Number(option.value)) })}>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
        <div className="compatibility-profile-form-grid"><label><span>{t("transcoding.outputMode")}</span><select className="settings-choice-input" value={ruleDraft.output_mode} onChange={(event) => setRuleDraft({ ...ruleDraft, output_mode: event.target.value as RuleDraft["output_mode"], replacement_approved: false })}><option value="transcode_output">{t("transcoding.transcodeOutput")}</option><option value="same_directory">{t("transcoding.sameDirectory")}</option><option value="replace_original">{t("transcoding.replaceOriginal")}</option></select></label><label><span>{t("transcoding.automation.outputSubfolder")}</span><input className="settings-choice-input" value={ruleDraft.output_subfolder} disabled={ruleDraft.output_mode !== "transcode_output"} placeholder="anime/optimized" onChange={(event) => setRuleDraft({ ...ruleDraft, output_subfolder: event.target.value })} /></label></div>
        {ruleDraft.output_mode === "replace_original" ? <p className="field-hint">{t("transcoding.replacementWarning")}</p> : null}
        <label className="transcode-filename-option"><input type="checkbox" checked={ruleDraft.enabled} disabled={ruleDraft.output_mode === "replace_original" && !ruleDraft.replacement_approved} onChange={(event) => setRuleDraft({ ...ruleDraft, enabled: event.target.checked })} /><span>{t("transcoding.automation.enabled")}</span></label>
        {ruleDraft.conditions ? <ConditionGroupEditor group={ruleDraft.conditions} onChange={(conditions) => setRuleDraft({ ...ruleDraft, conditions })} /> : <button type="button" className="secondary small settings-panel-header-action" onClick={() => setRuleDraft({ ...ruleDraft, conditions: { type: "group", operator: "and", children: [blankCondition()] } })}><Plus aria-hidden="true" size={14} />{t("transcoding.automation.addCondition")}</button>}
        {activeRulePreset ? <p className="field-hint">{t("transcoding.automation.presetVersionHint", { version: activeRulePreset.version })}</p> : null}
        <div className="compatibility-profile-card-actions transcode-automation-editor-actions">
          <button type="button" className="transcode-action-button" onClick={() => void saveRule()} disabled={busy || !ruleDraft.name.trim() || !ruleDraft.profile_id || !ruleDraft.library_ids.length}><Save aria-hidden="true" />{t("common.save")}</button>
        </div>
      </div>
    );
  };

  const renderPresetActions = (preset: TranscodePreset) => (
    <div className="compatibility-profile-quick-actions transcode-automation-quick-actions">
      <button
        type="button"
        className="secondary icon-only-button compatibility-profile-quick-action"
        aria-label={`${preset.is_builtin ? t("transcoding.automation.customize") : t("transcoding.automation.edit")} ${preset.name}`}
        title={preset.is_builtin ? t("transcoding.automation.customizeBuiltIn") : t("transcoding.automation.edit")}
        disabled={busy}
        onClick={() => editPreset(preset)}
      >
        <SquarePenIcon aria-hidden="true" className="nav-icon" size={18} />
      </button>
      {!preset.is_builtin ? (
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={`${t("transcoding.automation.duplicate")} ${preset.name}`}
          title={t("transcoding.automation.duplicate")}
          disabled={busy}
          onClick={() => void duplicatePreset(preset)}
        >
          <CopyIcon aria-hidden="true" className="nav-icon" size={18} />
        </button>
      ) : null}
      <button
        type="button"
        className="secondary icon-only-button compatibility-profile-quick-action"
        aria-label={`${t("transcoding.automation.delete")} ${preset.name}`}
        title={preset.is_builtin ? t("transcoding.automation.builtInCannotDelete") : preset.used_by_rule_count ? t(releaseVisibility.automationRules ? "transcoding.automation.presetInUse" : "transcoding.unavailable") : t("transcoding.automation.delete")}
        disabled={preset.is_builtin || Boolean(preset.used_by_rule_count) || busy}
        onClick={() => void removePreset(preset)}
      >
        <Trash2 aria-hidden="true" className="nav-icon" size={18} />
      </button>
    </div>
  );

  const renderRuleActions = (rule: TranscodeRule) => {
    const ruleIndex = rules.findIndex((entry) => entry.id === rule.id);
    return (
      <div className="compatibility-profile-quick-actions transcode-automation-quick-actions">
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={`${rule.enabled ? t("transcoding.automation.disable") : t("transcoding.automation.enable")} ${rule.name}`}
          title={rule.enabled ? t("transcoding.automation.disable") : t("transcoding.automation.enable")}
          disabled={busy}
          onClick={() => void toggleRule(rule)}
        >
          <Power aria-hidden="true" className="nav-icon" size={18} />
        </button>
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={`${t("transcoding.automation.edit")} ${rule.name}`}
          title={t("transcoding.automation.edit")}
          disabled={busy}
          onClick={() => editRule(rule)}
        >
          <SquarePenIcon aria-hidden="true" className="nav-icon" size={18} />
        </button>
        {rule.output_mode === "replace_original" && !rule.replacement_approved ? (
          <button
            type="button"
            className="secondary icon-only-button compatibility-profile-quick-action"
            aria-label={`${t("transcoding.automation.approveReplacement")} ${rule.name}`}
            title={t("transcoding.automation.approveReplacement")}
            disabled={busy}
            onClick={() => void approveReplacement(rule)}
          >
            <ShieldCheck aria-hidden="true" className="nav-icon" size={18} />
          </button>
        ) : null}
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={t("transcoding.automation.moveUp")}
          title={t("transcoding.automation.moveUp")}
          disabled={busy || ruleIndex <= 0}
          onClick={() => void moveRule(rule, -1)}
        >
          <ArrowUp aria-hidden="true" className="nav-icon" size={18} />
        </button>
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={t("transcoding.automation.moveDown")}
          title={t("transcoding.automation.moveDown")}
          disabled={busy || ruleIndex < 0 || ruleIndex >= rules.length - 1}
          onClick={() => void moveRule(rule, 1)}
        >
          <ArrowDown aria-hidden="true" className="nav-icon" size={18} />
        </button>
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={`${t("transcoding.automation.delete")} ${rule.name}`}
          title={t("transcoding.automation.delete")}
          disabled={busy}
          onClick={() => void deleteRule(rule)}
        >
          <Trash2 aria-hidden="true" className="nav-icon" size={18} />
        </button>
      </div>
    );
  };

  const renderPresetSearch = () => {
    if (standaloneTab !== "presets") return null;
    return (
      <div className="compatibility-profile-search">
        <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
        <input
          type="search"
          value={presetSearch}
          aria-label={t("transcoding.automation.searchPresets")}
          placeholder={t("transcoding.automation.searchPresets")}
          onChange={(event) => setPresetSearch(event.target.value)}
        />
        {presetSearch ? (
          <button
            type="button"
            className="compatibility-profile-search-clear"
            aria-label={t("transcoding.automation.clearSearch")}
            onClick={() => setPresetSearch("")}
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  };

  const renderPresetList = () => {
    const isPresetCatalog = (standaloneTab ?? tab) === "presets";
    const availablePresets = isPresetCatalog
      ? presets.filter((preset) => !preset.is_builtin)
      : presets;
    const visiblePresets = isPresetCatalog
      ? filteredPresets.filter((preset) => !preset.is_builtin)
      : presets;
    const list = (
      <div className={`compatibility-profile-list${standaloneTab === "presets" ? " compatibility-profile-catalog-list" : ""}`}>
        {standalonePresetTabs ? (
          <div className="settings-profile-toggle-row transcode-automation-toggle-row">
            <div className="transcode-automation-tab-controls">{standalonePresetTabs}</div>
            <div className="settings-profile-toggle-actions">{panelAction}</div>
          </div>
        ) : standaloneTab ? renderStandaloneHeader(panelAction) : renderAutomationToggleRow(panelAction)}
        {renderPresetSearch()}
        {visiblePresets.map((preset) => {
          const expanded = expandedPresetId === preset.id;
          const editing = expanded && presetEditorOpen && presetDraft?.id === preset.id;
          return (
            <article className={`compatibility-profile-list-item${expanded ? " is-expanded" : ""}`} key={preset.id}>
              <div className="compatibility-profile-list-row quality-profile-list-row">
                <button type="button" className="compatibility-profile-list-trigger" aria-expanded={expanded} onClick={() => togglePresetRow(preset)}>
                  <span className="transcode-automation-list-copy compatibility-profile-list-copy"><strong>{preset.name}</strong></span>
                  <ChevronDown aria-hidden="true" />
                </button>
                {renderPresetActions(preset)}
              </div>
              {expanded ? (editing ? renderPresetEditor() : renderPresetSummary(preset)) : null}
            </article>
          );
        })}
        {presetDraft?.id === null && presetEditorOpen ? (
          <article className="compatibility-profile-list-item is-expanded">
            <div className="compatibility-profile-list-row quality-profile-list-row">
              <div className="compatibility-profile-list-trigger is-static">
                <span className="transcode-automation-list-copy compatibility-profile-list-copy"><strong>{presetDraft.name || t("transcoding.automation.newPreset")}</strong><small>{t("transcoding.automation.newPreset")}</small></span>
                <ChevronDown aria-hidden="true" />
              </div>
            </div>
            {renderPresetEditor()}
          </article>
        ) : null}
        {!visiblePresets.length && !(presetDraft?.id === null && presetEditorOpen) ? (
          availablePresets.length ? (
            <p className="compatibility-profile-search-empty">{t("transcoding.automation.searchEmpty")}</p>
          ) : (
            <div className="transcode-preset-placeholder-body">
              <PanelEmptyState message={t("transcoding.presetSettingsTabs.transcodingEmpty")} />
            </div>
          )
        ) : null}
      </div>
    );
    return standalonePresetTabs ? list : <section className="transcode-automation-tab-content">{list}</section>;
  };

  const renderRuleList = () => (
    <section className="transcode-automation-tab-content">
      <div className="compatibility-profile-list">
        {standaloneTab && !hasStandaloneCollapse ? renderStandaloneHeader(panelAction) : !standaloneTab ? renderAutomationToggleRow(panelAction) : null}
        {rules.map((rule) => {
          const expanded = expandedRuleId === rule.id;
          const editing = expanded && ruleEditorOpen && ruleDraft?.id === rule.id;
          return (
            <article className={`compatibility-profile-list-item${expanded ? " is-expanded" : ""}`} key={rule.id}>
              <div className="compatibility-profile-list-row">
                <button type="button" className="compatibility-profile-list-trigger" aria-expanded={expanded} onClick={() => toggleRuleRow(rule)}>
                  <span className="transcode-automation-list-copy"><strong>{rule.priority + 1}. {rule.name}</strong><small><span className={`badge ${rule.enabled ? "transcode-status-completed" : "transcode-status-canceled"}`}>{rule.enabled ? t("transcoding.automation.enabled") : t("transcoding.automation.disabled")}</span> · {rule.profile_name} · v{rule.profile_version}</small></span>
                  <ChevronDown aria-hidden="true" />
                </button>
                {renderRuleActions(rule)}
              </div>
              {expanded ? (editing ? renderRuleEditor() : renderRuleSummary(rule)) : null}
            </article>
          );
        })}
        {ruleDraft?.id === null && ruleEditorOpen ? (
          <article className="compatibility-profile-list-item is-expanded">
            <div className="compatibility-profile-list-row">
              <div className="compatibility-profile-list-trigger is-static">
                <span className="transcode-automation-list-copy"><strong>{ruleDraft.name || t("transcoding.automation.newRule")}</strong><small>{t("transcoding.automation.newRule")}</small></span>
                <ChevronDown aria-hidden="true" />
              </div>
            </div>
            {renderRuleEditor()}
          </article>
        ) : null}
        {!rules.length && !(ruleDraft?.id === null && ruleEditorOpen) ? <p className="compatibility-profile-search-empty">{t("transcoding.automation.searchEmpty")}</p> : null}
      </div>
    </section>
  );

  const renderMemberList = () => (
    <section className="transcode-automation-tab-content">
      <div className="compatibility-profile-list">
        {standaloneTab ? renderStandaloneHeader(
          <TooltipTrigger
            ariaLabel={t("transcoding.federation.refreshDiscovery")}
            content={t("transcoding.federation.refreshDiscovery")}
            className="secondary icon-only-button compatibility-profile-quick-action transcode-federation-discovered-refresh"
            disabled={busy || memberPending !== null}
            pinOnClick={false}
            onClick={() => void discoverMembers()}
          >
            <RefreshCw aria-hidden="true" className={memberPending === "discover" ? "is-spinning" : undefined} size={16} />
          </TooltipTrigger>,
        ) : renderAutomationToggleRow(
          <TooltipTrigger
            ariaLabel={t("transcoding.federation.refreshDiscovery")}
            content={t("transcoding.federation.refreshDiscovery")}
            className="secondary icon-only-button compatibility-profile-quick-action transcode-federation-discovered-refresh"
            disabled={busy || memberPending !== null}
            pinOnClick={false}
            onClick={() => void discoverMembers()}
          >
            <RefreshCw aria-hidden="true" className={memberPending === "discover" ? "is-spinning" : undefined} size={16} />
          </TooltipTrigger>,
        )}
        {federation === null ? <p className="compatibility-profile-search-empty">{t("transcoding.federation.loading")}</p> : null}
        {federation !== null ? federationMembers.map((member) => {
          const expanded = expandedMemberId === member.installation_id;
          const memberBusy = busy || memberPending !== null;
          const syncing = memberPending === member.installation_id;
          const memberStatus = federationMemberStatus(member);
          const memberStatusLabel = federationMemberStatusLabel(memberStatus, t);
          const favoriteEndpointKey = normalizedEndpointKey(member.favorite_endpoint_url);
          return (
            <article className={`compatibility-profile-list-item${expanded ? " is-expanded" : ""}`} key={member.installation_id}>
              <div className="compatibility-profile-list-row transcode-federation-member-row">
                <div className="transcode-federation-member-trigger-shell">
                  <TooltipTrigger
                    ariaLabel={`${member.display_name}: ${memberStatusLabel}`}
                    content={federationMemberStatusTooltip(member, t)}
                    className="transcode-federation-status-trigger"
                    align="start"
                    placement="auto"
                    maxWidth={360}
                    pinOnClick={false}
                  >
                    <span className="transcode-federation-entry-marker transcode-federation-status-marker">
                      <span className={`status-dot is-${memberStatus}`} aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <button type="button" className="compatibility-profile-list-trigger transcode-federation-member-trigger" aria-expanded={expanded} onClick={() => setExpandedMemberId(expanded ? null : member.installation_id)}>
                    <span className="transcode-automation-list-copy transcode-federation-member-list-copy">
                      <strong><span className="transcode-federation-member-name">{member.display_name}</span></strong>
                      <small>{memberListSummary(member, t)}</small>
                    </span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                </div>
                <div className="compatibility-profile-quick-actions transcode-automation-quick-actions">
                  <button
                    type="button"
                    className="secondary icon-only-button compatibility-profile-quick-action"
                    aria-label={`${t("transcoding.federation.sync")} ${member.display_name}`}
                    title={t("transcoding.federation.sync")}
                    disabled={memberBusy}
                    onClick={() => void syncMember(member)}
                  >
                    <RefreshCw className={syncing ? "spin" : undefined} aria-hidden="true" size={18} />
                  </button>
                  <button
                    type="button"
                    className="secondary icon-only-button compatibility-profile-quick-action danger"
                    aria-label={`${t("transcoding.federation.exclude")} ${member.display_name}`}
                    title={t("transcoding.federation.exclude")}
                    disabled={memberBusy}
                    onClick={() => void excludeMember(member)}
                  >
                    <Unplug aria-hidden="true" size={18} />
                  </button>
                </div>
              </div>
              {expanded ? (
                <div className="compatibility-profile-details transcode-automation-details transcode-federation-member-tab-details">
                  <div className="transcode-federation-member-connections">
                    <span className="transcode-federation-member-detail-label">{t("transcoding.federation.availableConnections")}</span>
                    <p className="field-hint">{t("transcoding.federation.favoriteFallbackHint")}</p>
                    {member.endpoint_urls.length ? (
                      <ul className="transcode-federation-member-endpoint-list">
                        {member.endpoint_urls.map((endpoint) => {
                          const metric = memberEndpointMetric(member, endpoint);
                          const hasObservation = Object.prototype.hasOwnProperty.call(metric, "reachable") || typeof metric.last_checked_at === "string";
                          const isReachable = metric.reachable === true;
                          const isBlocked = metric.blocked === true;
                          const isFavorite = normalizedEndpointKey(endpoint) === favoriteEndpointKey;
                          const endpointStatus = isBlocked
                            ? "blocked"
                            : !hasObservation
                              ? "notTested"
                              : isReachable
                                ? "reachable"
                                : "unreachable";
                          const statusKey = endpointStatus === "blocked"
                            ? "transcoding.federation.endpointBlocked"
                            : endpointStatus === "notTested"
                              ? "transcoding.federation.endpointNotTested"
                              : endpointStatus === "reachable"
                                ? "transcoding.federation.endpointReachable"
                                : "transcoding.federation.endpointUnreachable";
                          const checkedAt = typeof metric.last_checked_at === "string" && metric.last_checked_at.trim()
                            ? new Date(metric.last_checked_at)
                            : null;
                          const checkedAtLabel = checkedAt && !Number.isNaN(checkedAt.valueOf())
                            ? t("transcoding.federation.testedAt", { time: checkedAt.toLocaleString() })
                            : null;
                          const actionKey = `${member.installation_id}:${endpoint}`;
                          const endpointPending = memberPending === actionKey;
                          return (
                            <li className={`transcode-federation-member-endpoint is-${endpointStatus.toLocaleLowerCase()}${isFavorite ? " is-favorite" : ""}${isBlocked ? " is-blocked" : ""}`} key={endpoint}>
                              <div className="transcode-federation-member-endpoint-main">
                                <span className={`status-dot ${endpointStatus === "reachable" ? "is-online" : endpointStatus === "notTested" ? "is-warning" : "is-offline"}`} aria-hidden="true" />
                                <code title={endpoint}>{endpoint}</code>
                                {isFavorite ? <span className="badge transcode-federation-endpoint-favorite">{t("transcoding.federation.favorite")}</span> : null}
                              </div>
                              <div className="transcode-federation-member-endpoint-metrics">
                                <span title={t("transcoding.federation.ping")}><Clock3 aria-hidden="true" size={13} />{t("transcoding.federation.ping")} <strong>{formatEndpointMetric(metric.latency_ms, "ms")}</strong></span>
                                <span title={t("transcoding.federation.throughput")}><Gauge aria-hidden="true" size={13} />{t("transcoding.federation.throughput")} <strong>{formatEndpointMetric(metric.throughput_mbps, "Mbit/s")}</strong></span>
                                <span className={`transcode-federation-endpoint-status is-${endpointStatus.toLocaleLowerCase()}`}>{t(statusKey)}</span>
                                {checkedAtLabel ? <small>{checkedAtLabel}</small> : null}
                              </div>
                              <div className="transcode-federation-member-endpoint-actions">
                                <button
                                  type="button"
                                  className={`secondary icon-only-button compatibility-profile-quick-action transcode-federation-member-endpoint-action${isFavorite ? " is-favorite" : ""}${endpointPending ? " is-pending" : ""}`}
                                  aria-label={`${isFavorite ? t("transcoding.federation.removeFavoriteEndpoint") : t("transcoding.federation.setFavoriteEndpoint")}: ${endpoint}`}
                                  aria-pressed={isFavorite}
                                  title={isFavorite ? t("transcoding.federation.removeFavoriteEndpoint") : t("transcoding.federation.setFavoriteEndpoint")}
                                  disabled={memberBusy || (isBlocked && !isFavorite)}
                                  onClick={() => void updateMemberEndpoint(member, endpoint, { favorite: !isFavorite })}
                                >
                                  <Star aria-hidden="true" size={16} fill={isFavorite ? "currentColor" : "none"} />
                                </button>
                                <button
                                  type="button"
                                  className={`secondary icon-only-button compatibility-profile-quick-action transcode-federation-member-endpoint-action${isBlocked ? " is-blocked" : ""}${endpointPending ? " is-pending" : ""}`}
                                  aria-label={`${isBlocked ? t("transcoding.federation.unblockEndpoint") : t("transcoding.federation.blockEndpoint")}: ${endpoint}`}
                                  aria-pressed={isBlocked}
                                  title={isBlocked ? t("transcoding.federation.unblockEndpoint") : t("transcoding.federation.blockEndpoint")}
                                  disabled={memberBusy}
                                  onClick={() => void updateMemberEndpoint(member, endpoint, { blocked: !isBlocked })}
                                >
                                  <Ban aria-hidden="true" size={16} />
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : <p className="field-hint">{t("transcoding.federation.noConnections")}</p>}
                  </div>
                </div>
              ) : null}
            </article>
          );
        }) : null}
        {federation?.discovered.map((peer) => {
          const peerEndpoint = peer.endpoint_urls[0] ?? peer.installation_id;
          const peerName = peer.display_name?.trim() || peerEndpoint;
          const endpointIsName = peerName.replace(/\/+$/, "").toLocaleLowerCase() === peerEndpoint.replace(/\/+$/, "").toLocaleLowerCase();
          const codeIsInvalid = invalidDiscoveredPairingCode === peer.installation_id;
          const memberBusy = busy || memberPending !== null;
          const peerVersion = installationVersionLabel(peer.application_version, t);
          return (
            <article className="compatibility-profile-list-item transcode-federation-peer" key={peer.installation_id}>
              <span><strong><Plus aria-hidden="true" className="transcode-federation-entry-marker transcode-federation-add-icon" size={16} /><span className="transcode-federation-peer-name">{peerName}</span></strong>{!endpointIsName || peerVersion ? <small>{[endpointIsName ? null : peerEndpoint, peerVersion].filter(Boolean).join(" · ")}</small> : null}</span>
              <div className="transcode-federation-peer-connect-control">
                <input
                  className={`settings-choice-input transcode-federation-segment-input transcode-federation-peer-code-input${codeIsInvalid ? " is-invalid" : ""}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder={t("transcoding.federation.pairingCode")}
                  aria-label={t("transcoding.federation.pairingCode")}
                  aria-invalid={codeIsInvalid}
                  value={discoveredPairingCodes[peer.installation_id] ?? ""}
                  disabled={memberBusy}
                  onChange={(event) => {
                    const value = event.target.value.replace(/[^0-9]/g, "").slice(0, 6);
                    setDiscoveredPairingCodes((current) => ({ ...current, [peer.installation_id]: value }));
                    if (value.length === 6 && codeIsInvalid) setInvalidDiscoveredPairingCode(null);
                  }}
                />
                <button type="button" className="secondary small settings-panel-header-action transcode-federation-connect-button" disabled={memberBusy} onClick={() => void pairDiscovered(peer)}><AnimatedConnectIcon className="transcode-federation-action-icon" size={16} aria-hidden="true" />{t("transcoding.federation.connect")}</button>
              </div>
            </article>
          );
        })}
        {federation !== null && !federationMembers.length && !federation.discovered.length ? <p className="compatibility-profile-search-empty">{t("transcoding.federation.noMembers")}</p> : null}
        {federation !== null ? (
          <article className="compatibility-profile-list-item transcode-federation-manual-item">
            <Plus aria-hidden="true" className="transcode-federation-entry-marker transcode-federation-add-icon" size={16} />
            <div className="transcode-federation-peer-connect-control transcode-federation-manual-connect-control">
              <input
                className="settings-choice-input transcode-federation-segment-input transcode-federation-manual-address-input"
                type="url"
                placeholder={t("transcoding.federation.endpointPlaceholder")}
                aria-label={t("transcoding.federation.endpointPlaceholder")}
                value={manualEndpoint}
                disabled={busy || memberPending !== null}
                onChange={(event) => setManualEndpoint(event.target.value)}
              />
              <input
                className={`settings-choice-input transcode-federation-segment-input transcode-federation-peer-code-input transcode-federation-manual-code-input${invalidDiscoveredPairingCode === "manual" ? " is-invalid" : ""}`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder={t("transcoding.federation.pairingCode")}
                aria-label={t("transcoding.federation.pairingCode")}
                aria-invalid={invalidDiscoveredPairingCode === "manual"}
                value={manualPairingCode}
                disabled={busy || memberPending !== null}
                onChange={(event) => {
                  const value = event.target.value.replace(/[^0-9]/g, "").slice(0, 6);
                  setManualPairingCode(value);
                  if (value.length === 6 && invalidDiscoveredPairingCode === "manual") setInvalidDiscoveredPairingCode(null);
                }}
              />
              <button
                type="button"
                className="secondary small settings-panel-header-action transcode-federation-connect-button"
                disabled={busy || memberPending !== null || !manualEndpoint.trim()}
                onClick={() => void pairManual()}
              >
                <AnimatedConnectIcon className="transcode-federation-action-icon" size={16} aria-hidden="true" />{t("transcoding.federation.connect")}
              </button>
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );

  const panelAction = tab === "presets" ? (
    <button type="button" className="secondary small settings-panel-header-action" onClick={startNewPreset} disabled={busy}>
      <Plus aria-hidden="true" size={14} />{t("transcoding.automation.newPreset")}
    </button>
  ) : tab === "rules" ? (
    <button type="button" className="secondary small settings-panel-header-action" onClick={startNewRule} disabled={busy || !presets.length || !libraries.length}>
      <Plus aria-hidden="true" size={14} />{t("transcoding.automation.newRule")}
    </button>
  ) : null;

  const hasStandaloneCollapse = (
    standaloneTab === "rules" || standaloneTab === "accelerators"
  ) && typeof standaloneCollapsed === "boolean" && Boolean(onStandaloneToggle);

  const automationTooltip = tab === "presets" ? (
    <div className="transcode-automation-description-tooltip">
      <p>{t("transcoding.automation.presetsDescription")}</p>
      {releaseVisibility.automationRules ? <p>{t("transcoding.automation.securityHint")}</p> : null}
    </div>
  ) : tab === "rules" ? (
    <div className="transcode-automation-description-tooltip">
      <p>{t("transcoding.automation.rulesDescription")}</p>
      <p>{t("transcoding.automation.priorityHint")}</p>
      <p>{t("transcoding.automation.securityHint")}</p>
    </div>
  ) : tab === "accelerators" ? acceleratorsTooltip : (
    <div className="transcode-automation-description-tooltip">
      <p>{t("transcoding.automation.membersDescription")}</p>
    </div>
  );
  const automationTooltipAriaLabel = tab === "presets"
    ? t("transcoding.automation.presetsHelpAria")
    : tab === "rules"
      ? t("transcoding.automation.rulesHelpAria")
      : tab === "accelerators"
        ? t("transcoding.automation.acceleratorsHelpAria")
        : t("transcoding.automation.membersHelpAria");
  const automationTooltipClassName = tab === "accelerators"
    ? "transcode-automation-description-tooltip-portal"
    : "transcode-automation-description-tooltip-portal transcode-automation-description-tooltip-portal-compact";

  const renderStandaloneHeader = (trailingAction?: ReactNode) => {
    const titleKey = tab === "presets"
      ? "transcoding.automation.presetsTitle"
      : tab === "rules"
        ? "transcoding.automation.rulesTitle"
        : tab === "accelerators"
          ? "transcoding.automation.tabs.accelerators"
          : "transcoding.automation.tabs.members";
    const focusTarget = tab === "presets"
      ? "transcoding-presets-tab-presets"
      : tab === "rules"
        ? "transcoding-automation-rules"
        : tab === "accelerators"
          ? "transcoding-accelerators"
          : "transcoding-federation-members";
    const title = t(titleKey);
    const headerClassName = hasStandaloneCollapse
      ? "transcode-federation-heading"
      : "settings-profile-toggle-row transcode-automation-toggle-row transcode-automation-standalone-header";

    return (
      <div className={headerClassName} data-settings-search-target={focusTarget}>
        <div className={hasStandaloneCollapse ? "transcode-federation-heading-main" : "transcode-automation-standalone-heading"}>
          {hasStandaloneCollapse ? (
            <button
              type="button"
              className="transcode-federation-section-chevron"
              aria-label={t(standaloneCollapsed ? "panel.expandAria" : "panel.collapseAria", { title })}
              title={t(standaloneCollapsed ? "panel.expandAria" : "panel.collapseAria", { title })}
              aria-expanded={!standaloneCollapsed}
              aria-controls={standaloneBodyId}
              onClick={onStandaloneToggle}
            >
              {standaloneCollapsed ? <ChevronRight aria-hidden="true" className="nav-icon" /> : <ChevronDown aria-hidden="true" className="nav-icon" />}
            </button>
          ) : null}
          {hasStandaloneCollapse
            ? <h3 id={standalonePanelTitleId}>{title}</h3>
            : <strong>{title}</strong>}
          <TooltipTrigger
            ariaLabel={automationTooltipAriaLabel}
            tooltipClassName={automationTooltipClassName}
            maxWidth={tab === "accelerators" ? 460 : 300}
            align={tab === "accelerators" ? "center" : "start"}
            placement={tab === "accelerators" ? "auto" : "center"}
            content={automationTooltip}
          >
            ?
          </TooltipTrigger>
        </div>
        {trailingAction ? <div className={hasStandaloneCollapse ? "transcode-federation-heading-actions" : "settings-profile-toggle-actions"}>{trailingAction}</div> : null}
      </div>
    );
  };

  const renderTabControls = () => (
    <div className="transcode-automation-tab-controls">
      <div className="transcode-automation-tab-list" role="tablist" aria-label={t(releaseVisibility.automationRules ? "transcoding.automation.managementTitle" : "transcoding.presetsSettingsTitle")} aria-orientation="horizontal">
        {visibleAutomationTabs().map((key, index, tabs) => (
          <button
            key={key}
            type="button"
            id={`transcode-automation-tab-${key}`}
            data-settings-search-target={`transcoding-tab-${key}`}
            role="tab"
            className={`transcode-automation-tab-button${tab === key ? " active" : ""}`}
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => selectTab(key)}
            onKeyDown={(event) => {
              let nextIndex: number | null = null;
              if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
              if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
              if (event.key === "Home") nextIndex = 0;
              if (event.key === "End") nextIndex = tabs.length - 1;
              if (nextIndex === null) return;
              event.preventDefault();
              const nextTab = tabs[nextIndex];
              selectTab(nextTab);
              window.requestAnimationFrame(() => document.getElementById(`transcode-automation-tab-${nextTab}`)?.focus());
            }}
          >
            <span className="transcode-automation-tab-label">{t(`transcoding.automation.tabs.${key}`)}</span>
          </button>
        ))}
      </div>
      <TooltipTrigger
        ariaLabel={automationTooltipAriaLabel}
        tooltipClassName={automationTooltipClassName}
        maxWidth={tab === "accelerators" ? 460 : 300}
        align={tab === "accelerators" ? "center" : "start"}
        placement={tab === "accelerators" ? "auto" : "center"}
        content={automationTooltip}
      >?
      </TooltipTrigger>
    </div>
  );

  const renderAutomationToggleRow = (trailingAction?: ReactNode) => (
    <div className="settings-profile-toggle-row transcode-automation-toggle-row">
      {renderTabControls()}
      {trailingAction ? <div className="settings-profile-toggle-actions">{trailingAction}</div> : null}
    </div>
  );

  return (
    <section
      className={`app-settings-section transcode-automation-section${standaloneTab === "members" ? " transcode-federation-members" : ""}${hasStandaloneCollapse ? " transcode-federation-panel" : ""}`}
      aria-labelledby={hasStandaloneCollapse ? standalonePanelTitleId : undefined}
    >
      {loading ? (
        <div className="panel-loader" role="status" aria-live="polite">
          <LoaderPinwheelIcon className="panel-loader-icon" size={24} />
          <span>{t("panel.loading")}</span>
        </div>
      ) : error ? <div className="alert">{error}</div> : (
        <div className="compatibility-profile-panel transcode-automation-content">
          {hasStandaloneCollapse ? renderStandaloneHeader(standaloneTab === "accelerators" ? standaloneHeaderAction : panelAction) : null}
          <div
            id={hasStandaloneCollapse ? standaloneBodyId : undefined}
            className={hasStandaloneCollapse ? "transcode-automation-panel-body" : undefined}
            hidden={hasStandaloneCollapse ? standaloneCollapsed : undefined}
          >
            {notice ? <div className="notice success" role="status">{notice}</div> : null}
            {tab === "presets"
              ? renderPresetList()
              : tab === "rules"
                ? renderRuleList()
                : tab === "accelerators"
                  ? <>
                      {standaloneTab && !hasStandaloneCollapse ? renderStandaloneHeader(standaloneHeaderAction) : null}
                      {capabilityMatrix(standaloneTab ? null : renderAutomationToggleRow())}
                    </>
                  : renderMemberList()}
          </div>
        </div>
      )}
    </section>
  );
}
