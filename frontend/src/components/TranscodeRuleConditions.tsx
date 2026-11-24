import type { InputHTMLAttributes } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ResolutionCategory, TranscodeCondition, TranscodeConditionGroup, TranscodeRuleTestTrace } from "../lib/api";
import { formatBitrate, formatBytes, formatDuration } from "../lib/format";
import { formatLanguageLabel, languageOptions } from "../lib/language";
import { DEFAULT_RESOLUTION_CATEGORIES } from "../lib/resolution-categories";
import { TooltipTrigger } from "./TooltipTrigger";
import { SettingsInlineLabelSelect } from "./SettingsInlineLabelSelect";

const equals = ["equals", "not_equals"];
const numeric = [...equals, ">", ">=", "<", "<="];
const text = [...equals, "contains", "not_contains", "starts_with", "ends_with"];
const metadata = ["exists", "missing"];
const fields: Record<string, { operators: string[]; choices?: string[] }> = {};
for (const field of ["size", "duration", "quality_score", "bitrate", "audio_bitrate", "bit_depth", "audio_channels", "sample_rate", "chapter_count"]) {
  fields[field] = { operators: numeric };
}
for (const field of ["path", "audio_title", "audio_artist", "audio_album", "audio_album_artist", "audio_genre", "audio_date", "audio_disc", "audio_composer", "track_number", "bit_rate_mode", "chapter_titles", "audio_codecs", "audio_spatial_profiles", "audio_languages", "subtitle_languages", "subtitle_codecs"]) {
  fields[field] = { operators: text };
}
Object.assign(fields, {
  resolution: { operators: equals },
  container: { operators: equals, choices: ["mkv", "mp4", "mov", "avi", "webm", "ts"] },
  video_codec: { operators: equals, choices: ["h264", "hevc", "av1", "vp9", "mpeg2video"] },
  hdr_type: { operators: text, choices: ["sdr", "hdr10", "hdr10+", "dolby vision", "hlg"] },
  has_embedded_cover: { operators: equals, choices: ["yes", "no"] },
  subtitle_sources: { operators: equals, choices: ["internal", "external"] },
});
const symbols: Record<string, [string, string]> = {
  equals: ["=", "equal"], not_equals: ["≠", "notEqual"], ">": [">", "greater"], ">=": ["≥", "atLeast"],
  "<": ["<", "less"], "<=": ["≤", "atMost"], contains: ["∋", "contains"], not_contains: ["∌", "notContains"],
  starts_with: ["^", "startsWith"], ends_with: ["$", "endsWith"], in: ["∈", "in"], not_in: ["∉", "notIn"],
  exists: ["✓", "exists"], missing: ["∅", "missing"],
};
const logicLabels = { and: "allConditions", or: "anyCondition", xor: "exactlyOne" };
const logicOptions = Object.keys(logicLabels) as Array<keyof typeof logicLabels>;
const key = "transcoding.automation.";
const empty: TranscodeConditionGroup = { type: "group", operator: "and", children: [] };

function blankCondition(): TranscodeCondition {
  return { type: "condition", field: "video_codec", operator: "equals", value: "" };
}

function fieldOptions(field: string) {
  return fields[field] ?? { operators: text };
}

function displayValue(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

export function validRuleConditions(group: TranscodeConditionGroup | null): boolean {
  return group === null || (group.children.length > 0 && group.children.every(child => child.type === "group"
    ? validRuleConditions(child)
    : metadata.includes(child.operator) || displayValue(child.value).trim() !== ""));
}

export function RuleInput({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <span className="transcode-rule-inline-input">
    <input {...props} className="settings-choice-input" aria-label={label} />
    <span className="settings-inline-label-field-label" aria-hidden="true">{label}</span>
  </span>;
}

export function ConditionGroupEditor({ group, onChange, onRemove, depth = 0, resolutionCategories = DEFAULT_RESOLUTION_CATEGORIES }: {
  group: TranscodeConditionGroup | null;
  onChange: (group: TranscodeConditionGroup) => void;
  onRemove?: () => void;
  depth?: number;
  resolutionCategories?: ResolutionCategory[];
}) {
  const { t, i18n } = useTranslation();
  const node = group ?? empty;
  const update = (index: number, child: TranscodeCondition | TranscodeConditionGroup) =>
    onChange({ ...node, children: node.children.map((entry, i) => i === index ? child : entry) });
  const remove = (index: number) => onChange({ ...node, children: node.children.filter((_, i) => i !== index) });
  const renderRemove = (label: string, callback: () => void) =>
    <button type="button" className="secondary icon-only-button transcode-rule-remove" title={label} aria-label={label} onClick={callback}><X size={22} aria-hidden="true" /></button>;

  return <div className={`transcode-condition-group transcode-rule-layer${depth ? " is-nested" : ""}`}>
    <div className="transcode-rule-group-header">
      <SettingsInlineLabelSelect label={t(key + "logic")} value={node.operator}
        onChange={event => onChange({ ...node, operator: event.target.value as TranscodeConditionGroup["operator"] })}>
        {logicOptions.map(operator => <option key={operator} value={operator}>{t(key + logicLabels[operator])}</option>)}
      </SettingsInlineLabelSelect>
      {onRemove && renderRemove(t(key + "removeConditionGroup"), onRemove)}
    </div>
    <ul className="transcode-rule-layers">
      {node.children.map((child, index) => <li key={index} className="transcode-rule-branch">
        {child.type === "group" ? <ConditionGroupEditor group={child} onChange={next => update(index, next)} onRemove={() => remove(index)} depth={depth + 1} resolutionCategories={resolutionCategories} /> : (() => {
          const { operators, choices } = fieldOptions(child.field);
          const value = displayValue(child.value);
          const language = child.field === "audio_languages" || child.field === "subtitle_languages";
          const resolution = child.field === "resolution";
          const categories = resolutionCategories.length ? resolutionCategories : DEFAULT_RESOLUTION_CATEGORIES;
          const valueChoices = resolution ? categories.map(category => category.id)
            : language && [...equals, "contains", "not_contains"].includes(child.operator)
              ? languageOptions([], i18n.language) : choices;
          const operatorOptions = [...new Set([...operators, ...metadata, child.operator])];
          const fieldLabel = (field: string) => t(key + "fields." + field, { defaultValue: field });
          const opLabel = (op: string) => t(key + "operators." + symbols[op]?.[1], { defaultValue: op });
          const valueLabel = t(key + "conditionValue");
          const helpField = ["track_number", "audio_disc"].includes(child.field) ? "trackOrDiscNumber" : child.field;
          const help = t(key + "fieldHelp." + helpField, { defaultValue: "" });
          const fieldSelect = (
            <SettingsInlineLabelSelect label={t(key + "conditionField")} value={child.field} onChange={event => {
              const field = event.target.value;
              update(index, { ...child, field, operator: fieldOptions(field).operators[0], value: "" });
            }}>
              {[...new Set([...Object.keys(fields), child.field])].map(field => <option key={field} value={field}>{fieldLabel(field)}</option>)}
            </SettingsInlineLabelSelect>
          );
          return <div className="transcode-condition-row transcode-rule-condition-row">
            {help ? (
              <TooltipTrigger as="span" className="transcode-rule-field" tabIndex={-1}
                ariaLabel={t(key + "fieldHelpLabel", { field: fieldLabel(child.field) })}
                content={help} placement="auto" pinOnClick={false} ariaExpanded={null}>
                {fieldSelect}
              </TooltipTrigger>
            ) : fieldSelect}
            <select className="settings-choice-input transcode-rule-operator" value={child.operator}
              title={opLabel(child.operator)} aria-label={t(key + "conditionOperator")}
              onChange={event => update(index, { ...child, operator: event.target.value })}>
              {operatorOptions.map(op => <option key={op} value={op} title={opLabel(op)} aria-label={opLabel(op)}>{symbols[op]?.[0] ?? op}</option>)}
            </select>
            {!metadata.includes(child.operator) && (valueChoices && (resolution || !["in", "not_in"].includes(child.operator))
              ? <SettingsInlineLabelSelect label={valueLabel} value={value} onChange={event => update(index, { ...child, value: event.target.value })}>
                <option value="">{t(key + "selectValue")}</option>
                {[...new Set([...valueChoices, ...(value ? [value] : [])])].map(choice => <option key={choice} value={choice}>
                  {resolution ? categories.find(category => category.id === choice)?.label ?? choice
                    : language ? formatLanguageLabel(choice, i18n.language) : t(key + "values." + choice, { defaultValue: choice })}
                </option>)}
              </SettingsInlineLabelSelect>
              : <RuleInput label={valueLabel} value={value} placeholder={child.field === "size" ? "10 GB" : child.field === "duration" ? "90m" : undefined}
                onChange={event => update(index, { ...child, value: ["in", "not_in"].includes(child.operator) ? event.target.value.split(",") : event.target.value })} />)}
            {renderRemove(t(key + "removeCondition"), () => remove(index))}
          </div>;
        })()}
      </li>)}
    </ul>
    {!node.children.length && <p className="field-hint">{t(key + (depth ? "emptyGroup" : "allVideos"))}</p>}
    <div className="transcode-actions">
      <button type="button" className="secondary small settings-panel-header-action" disabled={node.children.length >= 128}
        onClick={() => onChange({ ...node, children: [...node.children, blankCondition()] })}><Plus size={14} aria-hidden="true" />{t(key + "addCondition")}</button>
      {depth < 3 && <button type="button" className="secondary small settings-panel-header-action" disabled={node.children.length >= 128}
        onClick={() => onChange({ ...node, children: [...node.children, { ...empty, operator: "or", children: [blankCondition()] }] })}><Plus size={14} aria-hidden="true" />{t(key + "addNestedGroup")}</button>}
    </div>
  </div>;
}

export function RuleConditionTrace({ node, trace, resolutionCategories = DEFAULT_RESOLUTION_CATEGORIES }: {
  node: TranscodeCondition | TranscodeConditionGroup | null;
  trace?: TranscodeRuleTestTrace;
  resolutionCategories?: ResolutionCategory[];
}) {
  const { t } = useTranslation();
  const status = trace && t(key + (trace.matched ? "traceMatch" : "traceMiss"));
  const tone = trace ? (trace.matched ? "is-match" : "is-miss") : "";
  if (!node || node.type === "group") {
    const hits = trace?.children.filter(child => child.matched).length;
    const label = node ? t(key + logicLabels[node.operator]) : t(key + "allVideos");
    return <li className={`transcode-rule-branch transcode-rule-test-group ${tone}`}>
      <strong>{label}{node && trace && ` · ${t(key + "traceCount", { hits, count: node.children.length })}`}</strong>
      {status && <span className="sr-only">{status}</span>}
      {node && <ul className="transcode-rule-layers">{node.children.map((child, index) => (!trace || trace.children[index]) && <RuleConditionTrace key={index} node={child} trace={trace?.children[index]} resolutionCategories={resolutionCategories} />)}</ul>}
    </li>;
  }
  const categories = resolutionCategories.length ? resolutionCategories : DEFAULT_RESOLUTION_CATEGORIES;
  const value = displayValue(node.value);
  const label = node.field === "resolution" ? categories.find(category => category.id === value)?.label ?? value : value;
  const operator = symbols[node.operator];
  const description = t(key + "operators." + operator?.[1], { defaultValue: node.operator });
  const actualValues = trace?.values.map(value => {
    if (typeof value !== "number") return String(value);
    if (["size", "size_bytes"].includes(node.field)) return formatBytes(value);
    if (["duration", "duration_seconds"].includes(node.field)) return formatDuration(value);
    if (["bitrate", "audio_bitrate", "video_bitrate"].includes(node.field)) return formatBitrate(value);
    return String(value);
  });
  return <li className="transcode-rule-branch"><div className={`transcode-rule-test-line ${tone}`}>
    <span className="jellyfin-status-badge is-rule-value">{t(key + "fields." + node.field, { defaultValue: node.field })}</span>
    <span className="jellyfin-status-badge" title={description}><span aria-hidden="true">{operator?.[0] ?? node.operator}</span><span className="sr-only">{description}</span></span>
    {!metadata.includes(node.operator) && <span className="jellyfin-status-badge is-rule-value">{label}</span>}
    {actualValues && <small>{actualValues.length ? t(key + "actualValue", { values: actualValues.join(", ") }) : t(key + "noActualValue")}</small>}
    {status && <span className="sr-only">{status}</span>}
  </div></li>;
}
