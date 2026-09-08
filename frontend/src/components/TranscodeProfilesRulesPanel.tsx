import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Power, RefreshCw, Save, Search, ShieldCheck, Trash2, Unplug, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  api,
  type LibrarySummary,
  type TranscodeCondition,
  type TranscodeConditionGroup,
  type TranscodeFederation,
  type TranscodeFederationMember,
  type TranscodeProfile,
  type TranscodeProfileDefinition,
  type TranscodeProfileStreamRule,
  type TranscodeRule,
} from "../lib/api";
import { LoaderPinwheelIcon } from "./LoaderPinwheelIcon";
import { CopyIcon } from "./CopyIcon";
import { SlidingTogglePill } from "./SlidingTogglePill";
import { SquarePenIcon } from "./SquarePenIcon";
import { TooltipTrigger } from "./TooltipTrigger";

type ProfileDraft = {
  id: number | null;
  name: string;
  description: string;
  definition: TranscodeProfileDefinition;
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

type AutomationTab = "profiles" | "rules" | "accelerators" | "members";

type TranscodeProfilesRulesPanelProps = {
  capabilityMatrix: ReactNode;
  acceleratorsTooltip: ReactNode;
  federation?: TranscodeFederation | null;
  onFederationData?: (data: TranscodeFederation) => void;
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

function emptyProfileDefinition(): TranscodeProfileDefinition {
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
    filename_template: "[{resolution}, {dynRange}, {codec}] [{audioLanguages}]",
    filename_template_override: false,
    include_subtitle_languages: false,
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

function profileDraftFrom(profile: TranscodeProfile): ProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    definition: clone(profile.definition),
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

type ProfileRuleListKey = "video_rules" | "audio_rules" | "subtitle_rules" | "external_subtitle_rules";
type ProfileRuleKind = "video" | "audio" | "subtitle" | "external";

function emptyStreamRule(kind: ProfileRuleKind): TranscodeProfileStreamRule {
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

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function StreamRuleEditor({
  kind,
  rule,
  index,
  ruleCount,
  onChange,
  onRemove,
  onMove,
}: {
  kind: ProfileRuleKind;
  rule: TranscodeProfileStreamRule;
  index: number;
  ruleCount: number;
  onChange: (patch: Partial<TranscodeProfileStreamRule>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="transcode-profile-rule">
      <div className="transcode-condition-row">
        <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.matchCodec")}</span><input className="settings-choice-input transcode-control" placeholder="h264, hevc" value={rule.match_codecs.join(", ")} onChange={(event) => onChange({ match_codecs: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
        <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.matchLanguage")}</span><input className="settings-choice-input transcode-control" placeholder="de, en" value={rule.match_languages.join(", ")} onChange={(event) => onChange({ match_languages: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
        <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.matchDefault")}</span><select className="settings-choice-input transcode-control" value={rule.match_default === null ? "any" : String(rule.match_default)} onChange={(event) => onChange({ match_default: event.target.value === "any" ? null : event.target.value === "true" })}><option value="any">{t("transcoding.automation.anyTrack")}</option><option value="true">{t("transcoding.automation.defaultTrack")}</option><option value="false">{t("transcoding.automation.nonDefaultTrack")}</option></select></label>
        <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.streamAction")}</span><select className="settings-choice-input transcode-control" value={rule.action} onChange={(event) => onChange({ action: event.target.value as TranscodeProfileStreamRule["action"] })}><option value="copy">{t("transcoding.actions.copy")}</option><option value="convert">{t("transcoding.actions.encode")}</option><option value="remove">{t("transcoding.actions.drop")}</option></select></label>
        <button type="button" className="secondary icon-only-button" title={t("transcoding.automation.moveUp")} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" size={14} /></button>
        <button type="button" className="secondary icon-only-button" title={t("transcoding.automation.moveDown")} disabled={index === ruleCount - 1} onClick={() => onMove(1)}><ArrowDown aria-hidden="true" size={14} /></button>
        <button type="button" className="secondary icon-only-button" title={t("transcoding.automation.removeStreamRule")} onClick={onRemove}><Trash2 aria-hidden="true" size={14} /></button>
      </div>
      {rule.action === "convert" ? (
        <div className="transcode-condition-row transcode-profile-rule-details">
          <label className="field transcode-profile-rule-field"><span>{t("transcoding.encoder")}</span><input className="settings-choice-input transcode-control" placeholder={kind === "video" ? "hevc" : kind === "audio" ? "aac" : "subrip"} value={rule.codec ?? ""} onChange={(event) => onChange({ codec: event.target.value || null })} /></label>
          <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.encoderOptional")}</span><input className="settings-choice-input transcode-control" placeholder="auto" value={rule.encoder ?? ""} onChange={(event) => onChange({ encoder: event.target.value || null })} /></label>
          <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.bitrate")}</span><input className="settings-choice-input transcode-control" type="number" min="1" value={rule.bitrate ?? ""} onChange={(event) => onChange({ bitrate: numberOrNull(event.target.value) })} /></label>
          {kind === "video" ? <>
            <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.quality")}</span><input className="settings-choice-input transcode-control" type="number" min="0" max="255" value={rule.crf ?? ""} onChange={(event) => onChange({ crf: numberOrNull(event.target.value) })} /></label>
            <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.width")}</span><input className="settings-choice-input transcode-control" type="number" min="16" value={rule.width ?? ""} onChange={(event) => onChange({ width: numberOrNull(event.target.value) })} /></label>
            <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.height")}</span><input className="settings-choice-input transcode-control" type="number" min="16" value={rule.height ?? ""} onChange={(event) => onChange({ height: numberOrNull(event.target.value) })} /></label>
            <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.frameRate")}</span><input className="settings-choice-input transcode-control" type="number" min="0.01" step="0.01" value={rule.frame_rate ?? ""} onChange={(event) => onChange({ frame_rate: numberOrNull(event.target.value) })} /></label>
            <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.preset")}</span><input className="settings-choice-input transcode-control" value={rule.preset ?? ""} onChange={(event) => onChange({ preset: event.target.value || null })} /></label>
          </> : null}
          <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.languageOverride")}</span><input className="settings-choice-input transcode-control" value={rule.language ?? ""} onChange={(event) => onChange({ language: event.target.value || null })} /></label>
          <label className="field transcode-profile-rule-field"><span>{t("transcoding.automation.titleOverride")}</span><input className="settings-choice-input transcode-control" value={rule.title ?? ""} onChange={(event) => onChange({ title: event.target.value || null })} /></label>
        </div>
      ) : null}
    </div>
  );
}

function ProfileDefinitionEditor({
  definition,
  onChange,
}: {
  definition: TranscodeProfileDefinition;
  onChange: (definition: TranscodeProfileDefinition) => void;
}) {
  const { t } = useTranslation();
  const sections: Array<{ key: ProfileRuleListKey; kind: ProfileRuleKind; label: string; hint?: string }> = [
    { key: "video_rules", kind: "video", label: t("transcoding.automation.videoRules") },
    { key: "audio_rules", kind: "audio", label: t("transcoding.automation.audioRules") },
    { key: "subtitle_rules", kind: "subtitle", label: t("transcoding.automation.subtitleRules") },
    { key: "external_subtitle_rules", kind: "external", label: t("transcoding.automation.externalSubtitleRules"), hint: t("transcoding.automation.externalSubtitlesHint") },
  ];
  const updateRule = (key: ProfileRuleListKey, index: number, patch: Partial<TranscodeProfileStreamRule>) => {
    const next = definition[key].map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule);
    onChange({ ...definition, [key]: next });
  };
  return (
    <div className="settings-sidebar-stack">
      <div className="compatibility-profile-form-grid">
        <label><span>{t("transcoding.container")}</span><select value={definition.container} onChange={(event) => onChange({ ...definition, container: event.target.value as TranscodeProfileDefinition["container"] })}>
          {(["source", "mkv", "mp4", "webm"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
        </select></label>
        <label><span>{t("transcoding.executionMode")}</span><select value={definition.execution_mode} onChange={(event) => onChange({ ...definition, execution_mode: event.target.value as TranscodeProfileDefinition["execution_mode"] })}>
          <option value="inherit">{t("transcoding.automation.inheritGlobal")}</option><option value="hardware_required">{t("transcoding.hardwareRequired")}</option><option value="cpu_only">{t("transcoding.cpuOnly")}</option>
        </select></label>
        <label><span>{t("transcoding.dynamicRange")}</span><select value={definition.dynamic_range} onChange={(event) => onChange({ ...definition, dynamic_range: event.target.value as TranscodeProfileDefinition["dynamic_range"] })}>
          {(["preserve", "sdr", "hdr10", "hlg", "dolby_vision"] as const).map((value) => <option key={value} value={value}>{t(`transcoding.dynamicRanges.${value}`)}</option>)}
        </select></label>
      </div>
      <div className="transcode-global-options">
        <label><input type="checkbox" checked={definition.filename_template_override} onChange={(event) => onChange({ ...definition, filename_template_override: event.target.checked })} /><span>{t("transcoding.filenameTemplateOverride")}</span></label>
        <label><input type="checkbox" checked={definition.include_subtitle_languages} onChange={(event) => onChange({ ...definition, include_subtitle_languages: event.target.checked })} /><span>{t("transcoding.filenameIncludeSubtitleLanguages")}</span></label>
      </div>
      <label className="compatibility-profile-field-wide"><span>{t("transcoding.filenameTemplate")}</span><input disabled={!definition.filename_template_override} value={definition.filename_template} onChange={(event) => onChange({ ...definition, filename_template: event.target.value, filename_template_override: true })} /></label>
      <div className="transcode-global-options">
        {(["metadata", "chapters", "cover", "attachments"] as const).map((option) => (
          <label key={option}><input type="checkbox" checked={definition[option] === "keep"} onChange={(event) => onChange({ ...definition, [option]: event.target.checked ? "keep" : "drop" })} /><span>{t(`transcoding.options.${option}`)}</span></label>
        ))}
      </div>
      {sections.map(({ key, kind, label, hint }) => (
        <details className="compatibility-capability-section transcode-profile-rule-section" key={key}>
          <summary className="transcode-automation-section-summary"><span>{label}</span><strong className="transcode-profile-section-count">{definition[key].length}</strong></summary>
          <div className="compatibility-capability-section-body">
            <div className="field-label-row"><strong>{label}</strong><button type="button" className="secondary small settings-panel-header-action" onClick={() => onChange({ ...definition, [key]: [...definition[key], emptyStreamRule(kind)] })}><Plus aria-hidden="true" size={14} />{t("transcoding.automation.addStreamRule")}</button></div>
            {definition[key].map((rule, index) => <StreamRuleEditor key={`${key}-${index}`} kind={kind} rule={rule} index={index} ruleCount={definition[key].length} onChange={(patch) => updateRule(key, index, patch)} onMove={(direction) => {
              const target = index + direction;
              if (target < 0 || target >= definition[key].length) return;
              const next = [...definition[key]];
              [next[index], next[target]] = [next[target], next[index]];
              onChange({ ...definition, [key]: next });
            }} onRemove={() => onChange({ ...definition, [key]: definition[key].filter((_entry, ruleIndex) => ruleIndex !== index) })} />)}
            {hint ? <p className="field-hint">{hint}</p> : null}
          </div>
        </details>
      ))}
      <p className="field-hint">{t("transcoding.automation.unmatchedStreamsCopied")}</p>
    </div>
  );
}

export function TranscodeProfilesRulesPanel({ capabilityMatrix, acceleratorsTooltip, federation = null, onFederationData }: TranscodeProfilesRulesPanelProps) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<TranscodeProfile[]>([]);
  const [rules, setRules] = useState<TranscodeRule[]>([]);
  const [libraries, setLibraries] = useState<LibrarySummary[]>([]);
  const [tab, setTab] = useState<AutomationTab>("profiles");
  const [searchQueries, setSearchQueries] = useState<Record<AutomationTab, string>>({ profiles: "", rules: "", accelerators: "", members: "" });
  const [expandedProfileId, setExpandedProfileId] = useState<number | null>(null);
  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [memberPending, setMemberPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProfiles, nextRules, nextLibraries] = await Promise.all([
        api.transcodeProfiles(),
        api.transcodeRules(),
        api.libraries(),
      ]);
      setProfiles(nextProfiles);
      setRules(nextRules);
      setLibraries(nextLibraries);
      setError(null);
      setLoaded(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  const startNewProfile = () => {
    setTab("profiles");
    setSearchQueries((current) => ({ ...current, profiles: "" }));
    setExpandedProfileId(null);
    setExpandedRuleId(null);
    setRuleDraft(null);
    setRuleEditorOpen(false);
    setProfileDraft({ id: null, name: "", description: "", definition: emptyProfileDefinition() });
    setProfileEditorOpen(true);
  };

  const editProfile = (profile: TranscodeProfile) => {
    if (profile.is_builtin) {
      void duplicateProfile(profile);
      return;
    }
    setProfileDraft(profileDraftFrom(profile));
    setProfileEditorOpen(true);
    setExpandedProfileId(profile.id);
  };

  const saveProfile = async () => {
    if (!profileDraft?.name.trim()) return;
    setBusy(true);
    try {
      const saved = profileDraft.id
        ? await api.updateTranscodeProfile(profileDraft.id, { name: profileDraft.name.trim(), description: profileDraft.description, definition: profileDraft.definition })
        : await api.createTranscodeProfile({ name: profileDraft.name.trim(), description: profileDraft.description, definition: profileDraft.definition });
      setProfiles((current) => profileDraft.id ? current.map((profile) => profile.id === saved.id ? saved : profile) : [...current, saved]);
      setProfileDraft(profileDraftFrom(saved));
      setTab("profiles");
      setExpandedProfileId(saved.id);
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const duplicateProfile = async (profile: TranscodeProfile) => {
    setBusy(true);
    try {
      const copy = await api.duplicateTranscodeProfile(profile.id);
      setProfiles((current) => [...current, copy]);
      setProfileDraft(profileDraftFrom(copy));
      setProfileEditorOpen(true);
      setTab("profiles");
      setExpandedProfileId(copy.id);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeProfile = async (profile: TranscodeProfile) => {
    if (profile.is_builtin || profile.used_by_rule_count) return;
    setBusy(true);
    try {
      await api.deleteTranscodeProfile(profile.id);
      setProfiles((current) => current.filter((entry) => entry.id !== profile.id));
      if (profileDraft?.id === profile.id) {
        setProfileDraft(null);
        setProfileEditorOpen(false);
      }
      if (expandedProfileId === profile.id) setExpandedProfileId(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startNewRule = () => {
    setTab("rules");
    setSearchQueries((current) => ({ ...current, rules: "" }));
    setExpandedProfileId(null);
    setExpandedRuleId(null);
    setProfileDraft(null);
    setProfileEditorOpen(false);
    const defaultProfile = profiles[0];
    const defaultLibrary = libraries[0];
    setRuleDraft({ id: null, name: "", enabled: false, priority: rules.length, library_ids: defaultLibrary ? [defaultLibrary.id] : [], conditions: null, profile_id: defaultProfile?.id ?? 0, output_mode: "transcode_output", output_subfolder: "", replacement_approved: false });
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
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (rule: TranscodeRule) => {
    try {
      const saved = await api.updateTranscodeRule(rule.id, { enabled: !rule.enabled });
      setRules((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      if (ruleDraft?.id === saved.id) setRuleDraft(ruleDraftFrom(saved));
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const editRule = (rule: TranscodeRule) => {
    setTab("rules");
    setProfileDraft(null);
    setProfileEditorOpen(false);
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
    } catch (reason) {
      setError((reason as Error).message);
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
      const saved = await api.reorderTranscodeRules(reordered.map((rule) => rule.id));
      setRules(saved);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const approveReplacement = async (rule: TranscodeRule) => {
    try {
      const saved = await api.approveTranscodeRuleReplacement(rule.id, true);
      setRules((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      if (ruleDraft?.id === saved.id) setRuleDraft(ruleDraftFrom(saved));
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const libraryNames = useMemo(() => new Map(libraries.map((library) => [library.id, library.name])), [libraries]);
  const federationMembers = federation?.members ?? [];
  const normalizedSearchQuery = searchQueries[tab].trim().toLocaleLowerCase();
  const filteredProfiles = profiles.filter((profile) => {
    if (!normalizedSearchQuery) return true;
    return `${profile.name} ${profile.description} ${profile.version}`.toLocaleLowerCase().includes(normalizedSearchQuery);
  });
  const filteredRules = rules.filter((rule) => {
    if (!normalizedSearchQuery) return true;
    return [
      rule.name,
      rule.profile_name,
      rule.output_mode,
      rule.output_subfolder,
      ...rule.library_ids.map((libraryId) => libraryNames.get(libraryId) ?? ""),
    ].join(" ").toLocaleLowerCase().includes(normalizedSearchQuery);
  });
  const filteredMembers = federationMembers.filter((member) => {
    if (!normalizedSearchQuery) return true;
    return [
      member.display_name,
      member.installation_id,
      member.status,
      member.connection_status,
      ...member.endpoint_urls,
    ].join(" ").toLocaleLowerCase().includes(normalizedSearchQuery);
  });
  const activeRuleProfile = useMemo(() => profiles.find((profile) => profile.id === ruleDraft?.profile_id), [profiles, ruleDraft?.profile_id]);

  const closeProfileEditor = () => {
    if (profileDraft?.id === null) setExpandedProfileId(null);
    setProfileDraft(null);
    setProfileEditorOpen(false);
  };

  const closeRuleEditor = () => {
    if (ruleDraft?.id === null) setExpandedRuleId(null);
    setRuleDraft(null);
    setRuleEditorOpen(false);
  };

  const selectTab = (nextTab: AutomationTab) => {
    setTab(nextTab);
    setProfileDraft(null);
    setRuleDraft(null);
    setProfileEditorOpen(false);
    setRuleEditorOpen(false);
    setExpandedProfileId(null);
    setExpandedRuleId(null);
    setExpandedMemberId(null);
  };

  const toggleProfileRow = (profile: TranscodeProfile) => {
    if (expandedProfileId === profile.id) {
      setExpandedProfileId(null);
      setProfileDraft(null);
      setProfileEditorOpen(false);
      return;
    }
    setExpandedProfileId(profile.id);
    setProfileDraft(null);
    setProfileEditorOpen(false);
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

  const excludeMember = async (member: TranscodeFederationMember) => {
    if (!window.confirm(t("transcoding.federation.excludeConfirm", { name: member.display_name }))) return;
    setMemberPending(member.installation_id);
    setError(null);
    try {
      await api.excludeTranscodeFederationMember(member.installation_id);
      if (federation) {
        onFederationData?.({ ...federation, members: federation.members.filter((item) => item.installation_id !== member.installation_id) });
      }
      if (expandedMemberId === member.installation_id) setExpandedMemberId(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMemberPending(null);
    }
  };

  const renderSearch = () => (
    <div className="compatibility-profile-search transcode-automation-search">
      <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
      <input
        type="search"
        value={searchQueries[tab]}
        aria-label={t(tab === "profiles" ? "transcoding.automation.searchProfiles" : tab === "rules" ? "transcoding.automation.searchRules" : "transcoding.automation.searchMembers")}
        placeholder={t(tab === "members" ? "transcoding.automation.membersSearchPlaceholder" : "transcoding.automation.searchPlaceholder")}
        onChange={(event) => setSearchQueries((current) => ({ ...current, [tab]: event.target.value }))}
      />
      {searchQueries[tab] ? (
        <button
          type="button"
          className="compatibility-profile-search-clear"
          aria-label={t("transcoding.automation.clearSearch")}
          onClick={() => setSearchQueries((current) => ({ ...current, [tab]: "" }))}
        >
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );

  const renderProfileSummary = (profile: TranscodeProfile) => {
    const definition = profile.definition;
    const executionLabel = definition.execution_mode === "hardware_required"
      ? t("transcoding.hardwareRequired")
      : definition.execution_mode === "cpu_only"
        ? t("transcoding.cpuOnly")
        : t("transcoding.automation.inheritGlobal");
    const dynamicRangeLabel = t(`transcoding.dynamicRanges.${definition.dynamic_range}`, { defaultValue: definition.dynamic_range });
    const ruleSections: Array<{ key: ProfileRuleListKey; label: string; rules: TranscodeProfileStreamRule[] }> = [
      { key: "video_rules", label: t("transcoding.automation.videoRules"), rules: definition.video_rules },
      { key: "audio_rules", label: t("transcoding.automation.audioRules"), rules: definition.audio_rules },
      { key: "subtitle_rules", label: t("transcoding.automation.subtitleRules"), rules: definition.subtitle_rules },
      { key: "external_subtitle_rules", label: t("transcoding.automation.externalSubtitleRules"), rules: definition.external_subtitle_rules },
    ];
    const valueOrDash = (value: string | number | null | undefined) => value === null || value === undefined || value === "" ? "—" : String(value);
    const matchDefaultLabel = (value: boolean | null) => value === null
      ? t("transcoding.automation.anyTrack")
      : value
        ? t("transcoding.automation.defaultTrack")
        : t("transcoding.automation.nonDefaultTrack");
    const actionLabel = (action: TranscodeProfileStreamRule["action"]) => action === "convert"
      ? t("transcoding.actions.encode")
      : action === "remove"
        ? t("transcoding.actions.drop")
        : t("transcoding.actions.copy");
    const renderRuleSummary = (rule: TranscodeProfileStreamRule, index: number) => {
      const values: Array<[string, string]> = [
        [t("transcoding.automation.matchCodec"), valueOrDash(rule.match_codecs.join(", "))],
        [t("transcoding.automation.matchLanguage"), valueOrDash(rule.match_languages.join(", "))],
        [t("transcoding.automation.matchDefault"), matchDefaultLabel(rule.match_default)],
        [t("transcoding.automation.streamAction"), actionLabel(rule.action)],
      ];
      if (rule.action === "convert") {
        values.push(
          [t("transcoding.encoder"), valueOrDash(rule.codec)],
          [t("transcoding.automation.encoderOptional"), valueOrDash(rule.encoder)],
          [t("transcoding.automation.bitrate"), valueOrDash(rule.bitrate)],
          [t("transcoding.automation.languageOverride"), valueOrDash(rule.language)],
          [t("transcoding.automation.titleOverride"), valueOrDash(rule.title)],
        );
      }
      return (
        <div className="transcode-profile-rule transcode-profile-rule-summary" key={`${rule.action}-${index}`}>
          <strong>{actionLabel(rule.action)}</strong>
          <div className="transcode-profile-rule-summary-grid">
            {values.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
        </div>
      );
    };
    return (
      <div className="compatibility-profile-details transcode-automation-details">
        <div className="compatibility-profile-form-grid transcode-automation-summary-form-grid">
          <label><span>{t("transcoding.container")}</span><select disabled value={definition.container} onChange={() => undefined}>{(["source", "mkv", "mp4", "webm"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
          <label><span>{t("transcoding.executionMode")}</span><select disabled value={definition.execution_mode} onChange={() => undefined}>
            <option value="inherit">{t("transcoding.automation.inheritGlobal")}</option><option value="hardware_required">{t("transcoding.hardwareRequired")}</option><option value="cpu_only">{t("transcoding.cpuOnly")}</option>
          </select></label>
          <label><span>{t("transcoding.dynamicRange")}</span><select disabled value={definition.dynamic_range} onChange={() => undefined}>{(["preserve", "sdr", "hdr10", "hlg", "dolby_vision"] as const).map((value) => <option key={value} value={value}>{t(`transcoding.dynamicRanges.${value}`)}</option>)}</select></label>
          <label><span>{t("transcoding.automation.usedByRules")}</span><input readOnly value={profile.used_by_rule_count} /></label>
        </div>
        <div className="compatibility-capability-sections transcode-automation-rule-sections">
          {ruleSections.map(({ key, label, rules }) => (
            <details className="compatibility-capability-section" key={key}>
              <summary className="transcode-automation-section-summary"><span>{label}</span><strong className="transcode-profile-section-count">{rules.length}</strong></summary>
              <div className="compatibility-capability-section-body">
                {rules.length ? rules.map((rule, index) => renderRuleSummary(rule, index)) : <p className="field-hint">—</p>}
              </div>
            </details>
          ))}
        </div>
        {profile.description ? <p className="field-hint">{profile.description}</p> : null}
      </div>
    );
  };

  const renderProfileEditor = () => {
    if (!profileDraft) return null;
    return (
      <div className="compatibility-profile-details transcode-automation-details transcode-automation-editor">
        <div className="field-label-row">
          <strong>{profileDraft.id ? t("transcoding.automation.editProfile") : t("transcoding.automation.newProfile")}</strong>
          <button type="button" className="secondary icon-only-button" title={t("common.close")} onClick={closeProfileEditor}><X aria-hidden="true" size={14} /></button>
        </div>
        <div className="compatibility-profile-form-grid">
          <label><span>{t("transcoding.automation.profileName")}</span><input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} /></label>
          <label className="compatibility-profile-field-wide"><span>{t("transcoding.automation.profileDescription")}</span><textarea rows={3} value={profileDraft.description} onChange={(event) => setProfileDraft({ ...profileDraft, description: event.target.value })} /></label>
        </div>
        <ProfileDefinitionEditor definition={profileDraft.definition} onChange={(definition) => setProfileDraft({ ...profileDraft, definition })} />
        <div className="compatibility-profile-card-actions transcode-automation-editor-actions">
          <button type="button" className="transcode-action-button" onClick={() => void saveProfile()} disabled={busy || !profileDraft.name.trim()}><Save aria-hidden="true" />{t("common.save")}</button>
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
          <div><span>{t("transcoding.automation.profile")}</span><strong>{rule.profile_name} · v{rule.profile_version}</strong></div>
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
        <div className="compatibility-profile-form-grid"><label><span>{t("transcoding.automation.ruleName")}</span><input value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} /></label><label><span>{t("transcoding.automation.rulePriority")}</span><input type="number" min={0} value={ruleDraft.priority} onChange={(event) => setRuleDraft({ ...ruleDraft, priority: Math.max(0, Number(event.target.value) || 0) })} /></label><label><span>{t("transcoding.automation.profile")}</span><select value={ruleDraft.profile_id} onChange={(event) => setRuleDraft({ ...ruleDraft, profile_id: Number(event.target.value) })}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · v{profile.version}</option>)}</select></label></div>
        <label className="compatibility-profile-field-wide"><span>{t("transcoding.automation.libraries")}</span><select multiple value={ruleDraft.library_ids.map(String)} onChange={(event) => setRuleDraft({ ...ruleDraft, library_ids: [...event.target.selectedOptions].map((option) => Number(option.value)) })}>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
        <div className="compatibility-profile-form-grid"><label><span>{t("transcoding.outputMode")}</span><select value={ruleDraft.output_mode} onChange={(event) => setRuleDraft({ ...ruleDraft, output_mode: event.target.value as RuleDraft["output_mode"], replacement_approved: false })}><option value="transcode_output">{t("transcoding.transcodeOutput")}</option><option value="same_directory">{t("transcoding.sameDirectory")}</option><option value="replace_original">{t("transcoding.replaceOriginal")}</option></select></label><label><span>{t("transcoding.automation.outputSubfolder")}</span><input value={ruleDraft.output_subfolder} disabled={ruleDraft.output_mode !== "transcode_output"} placeholder="anime/optimized" onChange={(event) => setRuleDraft({ ...ruleDraft, output_subfolder: event.target.value })} /></label></div>
        {ruleDraft.output_mode === "replace_original" ? <p className="field-hint">{t("transcoding.replacementWarning")}</p> : null}
        <label className="transcode-filename-option"><input type="checkbox" checked={ruleDraft.enabled} disabled={ruleDraft.output_mode === "replace_original" && !ruleDraft.replacement_approved} onChange={(event) => setRuleDraft({ ...ruleDraft, enabled: event.target.checked })} /><span>{t("transcoding.automation.enabled")}</span></label>
        {ruleDraft.conditions ? <ConditionGroupEditor group={ruleDraft.conditions} onChange={(conditions) => setRuleDraft({ ...ruleDraft, conditions })} /> : <button type="button" className="secondary small settings-panel-header-action" onClick={() => setRuleDraft({ ...ruleDraft, conditions: { type: "group", operator: "and", children: [blankCondition()] } })}><Plus aria-hidden="true" size={14} />{t("transcoding.automation.addCondition")}</button>}
        {activeRuleProfile ? <p className="field-hint">{t("transcoding.automation.profileVersionHint", { version: activeRuleProfile.version })}</p> : null}
        <div className="compatibility-profile-card-actions transcode-automation-editor-actions">
          <button type="button" className="transcode-action-button" onClick={() => void saveRule()} disabled={busy || !ruleDraft.name.trim() || !ruleDraft.profile_id || !ruleDraft.library_ids.length}><Save aria-hidden="true" />{t("common.save")}</button>
        </div>
      </div>
    );
  };

  const renderProfileActions = (profile: TranscodeProfile) => (
    <div className="compatibility-profile-quick-actions transcode-automation-quick-actions">
      <button
        type="button"
        className="secondary icon-only-button compatibility-profile-quick-action"
        aria-label={`${profile.is_builtin ? t("transcoding.automation.customize") : t("transcoding.automation.edit")} ${profile.name}`}
        title={profile.is_builtin ? t("transcoding.automation.customizeBuiltIn") : t("transcoding.automation.edit")}
        disabled={busy}
        onClick={() => editProfile(profile)}
      >
        <SquarePenIcon aria-hidden="true" className="nav-icon" size={18} />
      </button>
      {!profile.is_builtin ? (
        <button
          type="button"
          className="secondary icon-only-button compatibility-profile-quick-action"
          aria-label={`${t("transcoding.automation.duplicate")} ${profile.name}`}
          title={t("transcoding.automation.duplicate")}
          disabled={busy}
          onClick={() => void duplicateProfile(profile)}
        >
          <CopyIcon aria-hidden="true" className="nav-icon" size={18} />
        </button>
      ) : null}
      <button
        type="button"
        className="secondary icon-only-button compatibility-profile-quick-action"
        aria-label={`${t("transcoding.automation.delete")} ${profile.name}`}
        title={profile.is_builtin ? t("transcoding.automation.builtInCannotDelete") : profile.used_by_rule_count ? t("transcoding.automation.profileInUse") : t("transcoding.automation.delete")}
        disabled={profile.is_builtin || Boolean(profile.used_by_rule_count) || busy}
        onClick={() => void removeProfile(profile)}
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

  const renderProfileList = () => (
    <div className="compatibility-profile-list">
      {renderSearch()}
      {filteredProfiles.map((profile) => {
        const expanded = expandedProfileId === profile.id;
        const editing = expanded && profileEditorOpen && profileDraft?.id === profile.id;
        return (
          <article className={`compatibility-profile-list-item${expanded ? " is-expanded" : ""}`} key={profile.id}>
            <div className="compatibility-profile-list-row">
              <button type="button" className="compatibility-profile-list-trigger" aria-expanded={expanded} onClick={() => toggleProfileRow(profile)}>
                <span className="transcode-automation-list-copy"><strong>{profile.name}</strong></span>
                <ChevronDown aria-hidden="true" />
              </button>
              {renderProfileActions(profile)}
            </div>
            {expanded ? (editing ? renderProfileEditor() : renderProfileSummary(profile)) : null}
          </article>
        );
      })}
      {profileDraft?.id === null && profileEditorOpen ? (
        <article className="compatibility-profile-list-item is-expanded">
          <div className="compatibility-profile-list-row">
            <div className="compatibility-profile-list-trigger is-static">
              <span className="transcode-automation-list-copy"><strong>{profileDraft.name || t("transcoding.automation.newProfile")}</strong><small>{t("transcoding.automation.newProfile")}</small></span>
              <ChevronDown aria-hidden="true" />
            </div>
          </div>
          {renderProfileEditor()}
        </article>
      ) : null}
      {!filteredProfiles.length && !(profileDraft?.id === null && profileEditorOpen) ? <p className="compatibility-profile-search-empty">{t("transcoding.automation.searchEmpty")}</p> : null}
    </div>
  );

  const renderRuleList = () => (
    <div className="transcode-automation-tab-content">
      <div className="compatibility-profile-list">
        {renderSearch()}
        {filteredRules.map((rule) => {
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
        {!filteredRules.length && !(ruleDraft?.id === null && ruleEditorOpen) ? <p className="compatibility-profile-search-empty">{t("transcoding.automation.searchEmpty")}</p> : null}
      </div>
    </div>
  );

  const renderMemberList = () => (
    <div className="transcode-automation-tab-content">
      <div className="compatibility-profile-list">
        {renderSearch()}
        {federation === null ? <p className="compatibility-profile-search-empty">{t("transcoding.federation.loading")}</p> : filteredMembers.map((member) => {
          const expanded = expandedMemberId === member.installation_id;
          const memberBusy = busy || memberPending !== null;
          const syncing = memberPending === member.installation_id;
          return (
            <article className={`compatibility-profile-list-item${expanded ? " is-expanded" : ""}`} key={member.installation_id}>
              <div className="compatibility-profile-list-row">
                <button type="button" className="compatibility-profile-list-trigger" aria-expanded={expanded} onClick={() => setExpandedMemberId(expanded ? null : member.installation_id)}>
                  <span className="transcode-automation-list-copy transcode-federation-member-list-copy">
                    <strong><span className={`status-dot ${member.reachable ? "is-online" : "is-offline"}`} aria-hidden="true" />{member.display_name}</strong>
                    <small>{member.connection_status} · {memberResourceSummary(member, t)}</small>
                  </span>
                  <ChevronDown aria-hidden="true" />
                </button>
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
                  <div className="compatibility-profile-form-grid transcode-automation-summary-form-grid">
                    <label><span>{t("transcoding.federation.memberEndpoint")}</span><input readOnly value={member.endpoint_urls[0] ?? member.installation_id} /></label>
                    <label><span>{t("transcoding.federation.memberStatus")}</span><input readOnly value={member.connection_status} /></label>
                  </div>
                  <label className="app-settings-flag-toggle"><input type="checkbox" checked={member.accept_jobs} readOnly /><span>{t("transcoding.federation.acceptingJobs")}</span></label>
                  {member.last_error ? <div className="notice error" role="alert">{member.last_error}</div> : null}
                </div>
              ) : null}
            </article>
          );
        })}
        {federation !== null && !filteredMembers.length ? <p className="compatibility-profile-search-empty">{federationMembers.length ? t("transcoding.automation.membersSearchEmpty") : t("transcoding.federation.noMembers")}</p> : null}
      </div>
    </div>
  );

  const panelAction = tab === "profiles" ? (
    <button type="button" className="secondary small settings-panel-header-action" onClick={startNewProfile} disabled={busy}>
      <Plus aria-hidden="true" size={14} />{t("transcoding.automation.newProfile")}
    </button>
  ) : tab === "rules" ? (
    <button type="button" className="secondary small settings-panel-header-action" onClick={startNewRule} disabled={busy || !profiles.length || !libraries.length}>
      <Plus aria-hidden="true" size={14} />{t("transcoding.automation.newRule")}
    </button>
  ) : null;

  const automationTooltip = tab === "profiles" ? (
    <div className="transcode-automation-description-tooltip">
      <p>{t("transcoding.automation.profilesDescription")}</p>
      <p>{t("transcoding.automation.securityHint")}</p>
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
      <p>{t("transcoding.federation.directOnly")}</p>
    </div>
  );
  const automationTooltipAriaLabel = tab === "profiles"
    ? t("transcoding.automation.profilesHelpAria")
    : tab === "rules"
      ? t("transcoding.automation.rulesHelpAria")
      : tab === "accelerators"
        ? t("transcoding.automation.acceleratorsHelpAria")
        : t("transcoding.automation.membersHelpAria");

  return (
    <section className="app-settings-section transcode-automation-section">
      {loading ? (
        <div className="panel-loader" role="status" aria-live="polite">
          <LoaderPinwheelIcon className="panel-loader-icon" size={24} />
          <span>{t("panel.loading")}</span>
        </div>
      ) : error ? <div className="alert">{error}</div> : (
        <div className="compatibility-profile-panel transcode-automation-content">
          <div className="settings-profile-toggle-row">
            <div className="transcode-automation-tab-controls">
              <div className="library-history-range-toggle" role="tablist" aria-label={t("transcoding.automation.managementTitle")}>
                <SlidingTogglePill activeKey={tab} className="nav-active-pill library-history-range-pill" />
                {(["profiles", "rules", "accelerators", "members"] as AutomationTab[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    data-toggle-key={key}
                    className={`library-history-range-button${tab === key ? " active" : ""}`}
                    aria-pressed={tab === key}
                    onClick={() => selectTab(key)}
                  >
                    <span className="library-history-range-button-content"><span>{t(`transcoding.automation.tabs.${key}`)}</span></span>
                  </button>
                ))}
              </div>
              <TooltipTrigger
                ariaLabel={automationTooltipAriaLabel}
                tooltipClassName="transcode-automation-description-tooltip-portal"
                maxWidth={tab === "accelerators" ? 460 : 380}
                placement="auto"
                content={automationTooltip}
              >?
              </TooltipTrigger>
            </div>
            {panelAction ? <div className="settings-profile-toggle-actions">{panelAction}</div> : null}
          </div>
          {tab === "profiles" ? renderProfileList() : tab === "rules" ? renderRuleList() : tab === "accelerators" ? capabilityMatrix : renderMemberList()}
        </div>
      )}
    </section>
  );
}
