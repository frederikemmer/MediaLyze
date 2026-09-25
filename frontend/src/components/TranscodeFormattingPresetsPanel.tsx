import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus, Save, Search, SquarePen, Star, Trash2, X } from "lucide-react";

import { api, type TranscodeFormattingDefinition, type TranscodeFormattingPreset } from "../lib/api";
import type { FormattingKind } from "../lib/transcode-formatting-presets";
import { PanelEmptyState } from "./PanelEmptyState";

const cleanupValues: TranscodeFormattingDefinition["cleanup_preset"][] = [
  "none", "square_brackets", "round_brackets", "square_and_round_brackets", "all_brackets", "custom",
];
const cleanupKeys = ["none", "squareBrackets", "roundBrackets", "squareAndRoundBrackets", "allBrackets", "custom"];

function emptyDefinition(kind: FormattingKind): TranscodeFormattingDefinition {
  return {
    enabled: kind === "filename",
    template: kind === "filename" ? "{sourceName} [{resolution}, {dynRange}, {codec}] [{audioLanguages}]" : "{folderName}",
    source_name_explicit: kind === "filename",
    metadata_separator: ", ",
    cleanup_preset: "none",
    cleanup_regex: null,
    include_subtitle_languages: false,
    language_code_format: "iso_639_1",
  };
}

function visibleTemplate(preset: TranscodeFormattingPreset): string {
  const template = preset.definition.template;
  return preset.kind === "filename" && !preset.definition.source_name_explicit && !template.includes("{sourceName}")
    ? `{sourceName} ${template}`
    : template;
}

export function TranscodeFormattingPresetsPanel({ kind, tabs }: { kind: FormattingKind; tabs: ReactNode }) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<TranscodeFormattingPreset[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draftId, setDraftId] = useState<number | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState<TranscodeFormattingDefinition>(() => emptyDefinition(kind));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.transcodeFormattingPresets()
      .then((all) => { if (active) { setPresets(all.filter((preset) => preset.kind === kind)); setError(null); } })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [kind]);

  function startNew() {
    setExpandedId(null);
    setDraftId(null);
    setName("");
    setDefinition(emptyDefinition(kind));
    setError(null);
  }

  function startEdit(preset: TranscodeFormattingPreset) {
    setExpandedId(preset.id);
    setDraftId(preset.id);
    setName(preset.name);
    setDefinition({ ...preset.definition, template: visibleTemplate(preset), source_name_explicit: kind === "filename" });
    setError(null);
  }

  async function save() {
    if (!name.trim() || !definition.template.trim()) return;
    setBusy(true);
    try {
      const saved = draftId === null
        ? await api.createTranscodeFormattingPreset({ kind, name: name.trim(), definition })
        : await api.updateTranscodeFormattingPreset(draftId as number, { name: name.trim(), definition });
      setPresets((current) => [...current.filter((preset) => preset.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setExpandedId(saved.id);
      setDraftId(undefined);
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(preset: TranscodeFormattingPreset) {
    setBusy(true);
    try {
      const saved = await api.updateTranscodeFormattingPreset(preset.id, { is_default: !preset.is_default });
      setPresets((current) => current.map((item) => ({ ...item, is_default: item.id === saved.id ? saved.is_default : saved.is_default ? false : item.is_default })));
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(preset: TranscodeFormattingPreset) {
    setBusy(true);
    try {
      await api.deleteTranscodeFormattingPreset(preset.id);
      setPresets((current) => current.filter((item) => item.id !== preset.id));
      if (expandedId === preset.id) setExpandedId(null);
      if (draftId === preset.id) setDraftId(undefined);
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const visible = presets.filter((preset) => preset.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const title = t(kind === "filename" ? "transcoding.presetSettingsTabs.filename" : "transcoding.presetSettingsTabs.folder");
  const editor = (
    <div className="compatibility-profile-details transcode-automation-details transcode-automation-editor">
      <div className="field-label-row"><strong>{draftId === null ? t("transcoding.formattingPresets.new") : t("transcoding.formattingPresets.edit")}</strong><button type="button" className="secondary icon-only-button" aria-label={t("common.close")} onClick={() => setDraftId(undefined)}><X size={14} aria-hidden="true" /></button></div>
      <div className="compatibility-profile-form-grid">
        <label><span>{t("transcoding.formattingPresets.name")}</span><input className="settings-choice-input" maxLength={255} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="compatibility-profile-field-wide"><span>{t(kind === "filename" ? "transcoding.filenameTemplate" : "transcoding.folderTemplate")}</span><input className="settings-choice-input" maxLength={512} value={definition.template} onChange={(event) => setDefinition({ ...definition, template: event.target.value, source_name_explicit: kind === "filename" })} /></label>
        <label><span>{t(kind === "filename" ? "transcoding.filenameMetadataSeparator" : "transcoding.folderMetadataSeparator")}</span><input className="settings-choice-input" maxLength={32} value={definition.metadata_separator} onChange={(event) => setDefinition({ ...definition, metadata_separator: event.target.value })} /></label>
        <label><span>{t(kind === "filename" ? "transcoding.filenameCleanupPreset" : "transcoding.folderCleanupPreset")}</span><select className="settings-choice-input" value={definition.cleanup_preset} onChange={(event) => setDefinition({ ...definition, cleanup_preset: event.target.value as TranscodeFormattingDefinition["cleanup_preset"] })}>{cleanupValues.map((value, index) => <option key={value} value={value}>{t(`transcoding.filenameCleanupOptions.${cleanupKeys[index]}`)}</option>)}</select></label>
        {definition.cleanup_preset === "custom" ? <label className="compatibility-profile-field-wide"><span>{t(kind === "filename" ? "transcoding.filenameCleanupRegex" : "transcoding.folderCleanupRegex")}</span><input className="settings-choice-input" maxLength={256} value={definition.cleanup_regex ?? ""} onChange={(event) => setDefinition({ ...definition, cleanup_regex: event.target.value })} /></label> : null}
        {kind === "filename" ? <label><span>{t("transcoding.languageCodeFormat")}</span><select className="settings-choice-input" value={definition.language_code_format} onChange={(event) => setDefinition({ ...definition, language_code_format: event.target.value as TranscodeFormattingDefinition["language_code_format"] })}><option value="iso_639_1">{t("transcoding.languageCodeFormats.iso_639_1")}</option><option value="iso_639_2">{t("transcoding.languageCodeFormats.iso_639_2")}</option></select></label> : null}
      </div>
      <div className="transcode-global-options">
        <label><input type="checkbox" checked={definition.enabled} onChange={(event) => setDefinition({ ...definition, enabled: event.target.checked })} /><span>{t(kind === "filename" ? "transcoding.filenameFormattingToggle" : "transcoding.folderFormattingToggle")}</span></label>
        {kind === "filename" ? <label><input type="checkbox" checked={definition.include_subtitle_languages} onChange={(event) => setDefinition({ ...definition, include_subtitle_languages: event.target.checked })} /><span>{t("transcoding.filenameIncludeSubtitleLanguages")}</span></label> : null}
      </div>
      <div className="compatibility-profile-card-actions transcode-automation-editor-actions"><button type="button" className="transcode-action-button" disabled={busy || !name.trim() || !definition.template.trim()} onClick={() => void save()}><Save size={16} aria-hidden="true" />{t("common.save")}</button></div>
    </div>
  );

  return <div className="compatibility-profile-list compatibility-profile-catalog-list" data-settings-search-target={`transcoding-presets-tab-${kind}`}>
    <div className="settings-profile-toggle-row transcode-automation-toggle-row"><div className="transcode-automation-tab-controls">{tabs}</div><div className="settings-profile-toggle-actions"><button type="button" className="secondary small settings-panel-header-action" onClick={startNew}><Plus size={16} aria-hidden="true" />{t("transcoding.formattingPresets.new")}</button></div></div>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {presets.length ? <div className="compatibility-profile-search"><Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" /><input type="search" value={search} aria-label={t("transcoding.automation.searchPresets")} placeholder={t("transcoding.automation.searchPresets")} onChange={(event) => setSearch(event.target.value)} /></div> : null}
    {visible.map((preset) => <article className={`compatibility-profile-list-item${expandedId === preset.id ? " is-expanded" : ""}`} key={preset.id}>
      <div className="compatibility-profile-list-row quality-profile-list-row">
        <button type="button" className="compatibility-profile-list-trigger" aria-expanded={expandedId === preset.id} onClick={() => { setExpandedId((current) => current === preset.id ? null : preset.id); setDraftId(undefined); }}><span className="transcode-automation-list-copy compatibility-profile-list-copy"><strong>{preset.name}</strong>{preset.is_default ? <small>{t("transcoding.formattingPresets.default")}</small> : null}</span><ChevronDown aria-hidden="true" /></button>
        <div className="compatibility-profile-quick-actions transcode-automation-quick-actions">
          <button type="button" className={`secondary icon-only-button compatibility-profile-quick-action${preset.is_default ? " is-favorite" : ""}`} aria-label={t(preset.is_default ? "transcoding.formattingPresets.removeDefault" : "transcoding.formattingPresets.makeDefault", { name: preset.name })} aria-pressed={preset.is_default} title={t(preset.is_default ? "transcoding.formattingPresets.removeDefault" : "transcoding.formattingPresets.makeDefault", { name: preset.name })} disabled={busy} onClick={() => void setDefault(preset)}><Star size={18} fill={preset.is_default ? "currentColor" : "none"} aria-hidden="true" /></button>
          <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label={`${t("transcoding.automation.edit")} ${preset.name}`} disabled={busy} onClick={() => startEdit(preset)}><SquarePen size={18} aria-hidden="true" /></button>
          <button type="button" className="secondary icon-only-button compatibility-profile-quick-action" aria-label={`${t("transcoding.automation.delete")} ${preset.name}`} disabled={busy} onClick={() => void remove(preset)}><Trash2 size={18} aria-hidden="true" /></button>
        </div>
      </div>
      {expandedId === preset.id ? draftId === preset.id ? editor : <div className="compatibility-profile-details transcode-automation-details"><div className="compatibility-profile-form-grid"><label className="compatibility-profile-field-wide"><span>{title}</span><input className="settings-choice-input" readOnly value={visibleTemplate(preset)} /></label><label><span>{t(kind === "filename" ? "transcoding.filenameMetadataSeparator" : "transcoding.folderMetadataSeparator")}</span><input className="settings-choice-input" readOnly value={preset.definition.metadata_separator} /></label><label><span>{t(kind === "filename" ? "transcoding.filenameCleanupPreset" : "transcoding.folderCleanupPreset")}</span><input className="settings-choice-input" readOnly value={t(`transcoding.filenameCleanupOptions.${cleanupKeys[cleanupValues.indexOf(preset.definition.cleanup_preset)]}`)} /></label></div></div> : null}
    </article>)}
    {draftId === null ? <article className="compatibility-profile-list-item is-expanded"><div className="compatibility-profile-list-row quality-profile-list-row"><div className="compatibility-profile-list-trigger is-static"><span className="transcode-automation-list-copy compatibility-profile-list-copy"><strong>{name || t("transcoding.formattingPresets.new")}</strong></span></div></div>{editor}</article> : null}
    {!presets.length && draftId === undefined ? <div className="transcode-preset-placeholder-body"><PanelEmptyState message={t(kind === "filename" ? "transcoding.presetSettingsTabs.filenameEmpty" : "transcoding.presetSettingsTabs.folderEmpty")} /></div> : null}
    {presets.length > 0 && !visible.length ? <p className="compatibility-profile-search-empty">{t("transcoding.automation.searchEmpty")}</p> : null}
  </div>;
}
