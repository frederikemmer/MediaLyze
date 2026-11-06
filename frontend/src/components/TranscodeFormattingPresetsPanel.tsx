import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useAutosaveNotifications } from "../lib/notification-actions";
import { useNotifications } from "../lib/notifications";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus, Save, Search, SquarePen, Star, Trash2 } from "lucide-react";

import { api, type TranscodeFormattingDefinition, type TranscodeFormattingPreset } from "../lib/api";
import type { FormattingKind } from "../lib/transcode-formatting-presets";
import { FILENAME_METADATA_TOKENS, type FilenameMetadataToken, type FilenameMetadataTokenEntry } from "../lib/transcode-formatting-metadata";
import { filenameTemplateEditorMarkup, filenameTemplateFromEditor, filenameTemplateSelectionFromEditor, restoreFilenameTemplateCaret } from "../lib/filename-template-editor";
import { formatFilenameLanguageCode } from "../lib/language";
import { PanelEmptyState } from "./PanelEmptyState";
import { TranscodeFormattingMetadataMenu } from "./TranscodeFormattingMetadataMenu";
import { TooltipTrigger } from "./TooltipTrigger";
import { LanguageCodeFormatField } from "./LanguageCodeFormatField";

const cleanupValues: TranscodeFormattingDefinition["cleanup_preset"][] = [
  "none", "square_brackets", "round_brackets", "square_and_round_brackets", "all_brackets", "custom",
];
const cleanupKeys = ["none", "squareBrackets", "roundBrackets", "squareAndRoundBrackets", "allBrackets", "custom"];
const connectorMetadataTokens = new Set<FilenameMetadataToken>([
  "movieTitle", "releaseYear", "seriesName", "seasonNumber", "episodeNumber", "episodeTitle",
]);
const exampleMetadataValues: Record<FilenameMetadataToken, string> = {
  sourceName: "Arrival (2016)",
  movieTitle: "Arrival",
  releaseYear: "2016",
  resolution: "1920x1080",
  resolutionCategory: "1080p",
  dynRange: "HDR10",
  codec: "HEVC",
  audioLanguages: "English, German",
  audioCodecs: "AAC",
  audioProfiles: "Dolby Atmos",
  audioChannels: "5.1",
  frameRate: "23.976 fps",
  bitDepth: "10-bit",
  subtitleLanguages: "English, German",
  subtitleFormats: "SRT",
  seriesName: "The Expanse",
  seasonNumber: "2",
  episodeNumber: "5",
  episodeTitle: "Home",
  contentCategory: "Movie",
  container: "MKV",
  videoBitrate: "12 Mbps",
  folderName: "Movies",
};

function exampleSourceName(definition: TranscodeFormattingDefinition): string {
  const patterns: Partial<Record<TranscodeFormattingDefinition["cleanup_preset"], string>> = {
    square_brackets: "\\[[^\\[\\]]*\\]",
    round_brackets: "\\([^()]*\\)",
    square_and_round_brackets: "\\[[^\\[\\]]*\\]|\\([^()]*\\)",
    all_brackets: "\\[[^\\[\\]]*\\]|\\([^()]*\\)|\\{[^{}]*\\}",
    custom: definition.cleanup_regex ?? undefined,
  };
  const pattern = patterns[definition.cleanup_preset];
  if (!pattern) return exampleMetadataValues.sourceName;
  try {
    return exampleMetadataValues.sourceName
      .replace(new RegExp(pattern, "g"), "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[ ._-]+|[ ._-]+$/g, "");
  } catch {
    return exampleMetadataValues.sourceName;
  }
}

function formattingExampleOutput(definition: TranscodeFormattingDefinition, kind: FormattingKind): string {
  const separator = definition.metadata_separator || ", ";
  const exampleLanguages = ["en", "de"].map((language) => formatFilenameLanguageCode(language, definition.language_code_format)).join(separator);
  const values = {
    ...exampleMetadataValues,
    sourceName: exampleSourceName(definition),
    audioLanguages: exampleLanguages,
    subtitleLanguages: exampleLanguages,
  };
  let template = definition.template;
  if (kind === "filename" && !definition.source_name_explicit && !template.includes("{sourceName}")) {
    template = `{sourceName} ${template}`;
  }
  const rendered = template
    .replace(/\{([^{}]+)\}/g, (token, name: string) => name in values ? values[name as FilenameMetadataToken] : token)
    .replace(/\[\s*[,;|+\-]*\s*\]/g, "")
    .replace(/([\[,;|+])\s*([,;|+])/g, "$1")
    .replace(/\s*,\s*(?=\])/g, "")
    .replace(/\[\s*,\s*/g, "[")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  const output = rendered || (kind === "filename" ? "Example" : "Movies");
  return kind === "filename" ? `${output}.mkv` : output;
}

function emptyDefinition(kind: FormattingKind): TranscodeFormattingDefinition {
  return {
    enabled: true,
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
  const notifications = useNotifications();
  const { trackSave } = useAutosaveNotifications({
    scopeKey: "settings:transcoding-presets", topicKey: "transcode:formatting", source: { area: "transcoding", href: "/settings?section=transcoding-presets", label: t("notifications.actions.transcoding.openPresets", { defaultValue: "Open formatting presets" }) },
    successMessage: t("notifications.actions.transcoding.presetsAutosaved", { defaultValue: "Transcoding preset settings saved." }),
    errorMessage: t("notifications.actions.transcoding.presetsAutosaveFailed", { defaultValue: "Could not save transcoding preset settings." }),
    partialMessage: t("notifications.actions.transcoding.presetsPartiallySaved", { defaultValue: "Some transcoding preset settings could not be saved." }),
  });
  function feedback(type: "success" | "error", key: string, fallback: string) {
    notifications.notify({ type, message: t(`notifications.actions.transcoding.${key}`, { defaultValue: fallback }), topicKey: `transcode:formatting:${kind}`, source: { area: "transcoding", href: `/settings?section=transcoding-presets&settingsFocus=transcoding-presets-tab-${kind}`, label: t("notifications.actions.transcoding.openFormatting", { defaultValue: "Open formatting presets" }) } });
  }
  const metadataMenuId = `formatting-metadata-${useId()}`;
  const templateInputId = `formatting-template-${kind}-${useId()}`;
  const templateInputRef = useRef<HTMLDivElement>(null);
  const templateSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [presets, setPresets] = useState<TranscodeFormattingPreset[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draftId, setDraftId] = useState<number | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState<TranscodeFormattingDefinition>(() => emptyDefinition(kind));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadataMenuOpen, setMetadataMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setPresets([]);
    setExpandedId(null);
    setDraftId(undefined);
    setName("");
    setDefinition(emptyDefinition(kind));
    setSearch("");
    setError(null);
    setMetadataMenuOpen(false);
    templateSelectionRef.current = null;
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
    setMetadataMenuOpen(false);
    templateSelectionRef.current = null;
  }

  function startEdit(preset: TranscodeFormattingPreset) {
    setExpandedId(preset.id);
    setDraftId(preset.id);
    setName(preset.name);
    setDefinition({ ...preset.definition, template: visibleTemplate(preset), source_name_explicit: kind === "filename", enabled: true, include_subtitle_languages: false });
    setError(null);
    setMetadataMenuOpen(false);
    templateSelectionRef.current = null;
  }

  function cancelEditing() {
    setDraftId(undefined);
    setMetadataMenuOpen(false);
    setError(null);
  }

  function insertMetadataToken(token: FilenameMetadataToken) {
    const input = templateInputRef.current;
    const currentTemplate = definition.template;
    const selection = input ? filenameTemplateSelectionFromEditor(input) ?? templateSelectionRef.current : templateSelectionRef.current;
    const selectionStart = selection?.start ?? currentTemplate.length;
    const selectionEnd = selection?.end ?? selectionStart;
    const insertion = `{${token}}`;
    const nextTemplate = `${currentTemplate.slice(0, selectionStart)}${insertion}${currentTemplate.slice(selectionEnd)}`;
    templateSelectionRef.current = { start: selectionStart + insertion.length, end: selectionStart + insertion.length };
    setDefinition((current) => ({ ...current, template: nextTemplate, source_name_explicit: kind === "filename" }));
    if (input) {
      window.requestAnimationFrame(() => {
        restoreFilenameTemplateCaret(input, selectionStart + insertion.length);
      });
    }
  }

  useLayoutEffect(() => {
    const editor = templateInputRef.current;
    const selection = templateSelectionRef.current;
    if (editor && selection && document.activeElement === editor) restoreFilenameTemplateCaret(editor, selection.end);
  }, [definition.template]);

  function handleTemplateKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      return;
    }
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const selection = filenameTemplateSelectionFromEditor(event.currentTarget);
    if (!selection || selection.start !== selection.end) return;
    const currentTemplate = filenameTemplateFromEditor(event.currentTarget);
    const tokenText = FILENAME_METADATA_TOKENS.map(({ token }) => `{${token}}`).find((candidate) => event.key === "Backspace"
      ? currentTemplate.slice(0, selection.start).endsWith(candidate)
      : currentTemplate.slice(selection.start).startsWith(candidate));
    if (!tokenText) return;
    event.preventDefault();
    const start = event.key === "Backspace" ? selection.start - tokenText.length : selection.start;
    const end = event.key === "Backspace" ? selection.start : selection.start + tokenText.length;
    templateSelectionRef.current = { start, end: start };
    setDefinition((current) => ({ ...current, template: `${currentTemplate.slice(0, start)}${currentTemplate.slice(end)}`, source_name_explicit: kind === "filename" }));
    window.setTimeout(() => {
      const editor = templateInputRef.current;
      if (editor) restoreFilenameTemplateCaret(editor, start);
    }, 0);
  }

  async function save() {
    if (!name.trim() || !definition.template.trim()) return;
    setBusy(true);
    try {
      const savedDefinition = { ...definition, enabled: true, include_subtitle_languages: false };
      const saved = draftId === null
        ? await api.createTranscodeFormattingPreset({ kind, name: name.trim(), definition: savedDefinition })
        : await api.updateTranscodeFormattingPreset(draftId as number, { name: name.trim(), definition: savedDefinition });
      setPresets((current) => [...current.filter((preset) => preset.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setExpandedId(saved.id);
      setDraftId(undefined);
      setError(null);
      setMetadataMenuOpen(false);
      feedback("success", "formatSaved", "Formatting preset saved.");
    } catch {
      feedback("error", "formatSaveFailed", "Could not save the formatting preset.");
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(preset: TranscodeFormattingPreset) {
    setBusy(true);
    try {
      const saved = await trackSave(api.updateTranscodeFormattingPreset(preset.id, { is_default: !preset.is_default }));
      setPresets((current) => current.map((item) => ({ ...item, is_default: item.id === saved.id ? saved.is_default : saved.is_default ? false : item.is_default })));
      setError(null);
    } catch {
      // trackSave reports the failed autosave.
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
      setMetadataMenuOpen(false);
      setError(null);
      feedback("success", "formatDeleted", "Formatting preset deleted.");
    } catch {
      feedback("error", "formatDeleteFailed", "Could not delete the formatting preset.");
    } finally {
      setBusy(false);
    }
  }

  const visible = presets.filter((preset) => preset.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const title = t(kind === "filename" ? "transcoding.presetSettingsTabs.filename" : "transcoding.presetSettingsTabs.folder");
  const metadataEntries = FILENAME_METADATA_TOKENS.filter((entry) => kind !== "filename" || entry.token !== "folderName");
  const metadataGroups = [
    { name: "MediaLyze", entries: metadataEntries.filter((entry) => !connectorMetadataTokens.has(entry.token)) },
    { name: "Connector", entries: metadataEntries.filter((entry) => connectorMetadataTokens.has(entry.token)) },
  ].filter((group) => group.entries.length);
  const exampleOutput = formattingExampleOutput(definition, kind);
  const editor = (
    <div className="compatibility-profile-details transcode-automation-details transcode-automation-editor transcode-preset-editor">
      <div className="compatibility-profile-form-grid">
        <label className="transcode-control-field">
          <span className="transcode-field-label">{t("transcoding.formattingPresets.name")}</span>
          <input className="settings-choice-input transcode-control" maxLength={255} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
      </div>
      <div className="transcode-filename-body transcode-formatting-preset-body">
        <div className="transcode-control-field">
          <span className="transcode-field-label">{t(kind === "filename" ? "transcoding.filenameTemplate" : "transcoding.folderTemplate")}</span>
          <div ref={templateInputRef} id={templateInputId} className="settings-choice-input transcode-control transcode-filename-template-input transcode-filename-template-editor" contentEditable suppressContentEditableWarning role="textbox" aria-label={t(kind === "filename" ? "transcoding.filenameTemplate" : "transcoding.folderTemplate")} aria-multiline="false" aria-valuetext={definition.template} onInput={(event) => { const nextTemplate = filenameTemplateFromEditor(event.currentTarget); const selection = filenameTemplateSelectionFromEditor(event.currentTarget); if (selection) templateSelectionRef.current = selection; setDefinition({ ...definition, template: nextTemplate.slice(0, 512), source_name_explicit: kind === "filename" }); }} onKeyDown={handleTemplateKeyDown} onSelect={(event) => { const selection = filenameTemplateSelectionFromEditor(event.currentTarget); if (selection) templateSelectionRef.current = selection; }} onKeyUp={(event) => { const selection = filenameTemplateSelectionFromEditor(event.currentTarget); if (selection) templateSelectionRef.current = selection; }} onMouseUp={(event) => { const selection = filenameTemplateSelectionFromEditor(event.currentTarget); if (selection) templateSelectionRef.current = selection; }} onBlur={(event) => { const selection = filenameTemplateSelectionFromEditor(event.currentTarget); if (selection) templateSelectionRef.current = selection; }} dangerouslySetInnerHTML={{ __html: filenameTemplateEditorMarkup(definition.template) }} />
        </div>
        <TranscodeFormattingMetadataMenu kind={kind} id={metadataMenuId} open={metadataMenuOpen} onToggle={() => setMetadataMenuOpen((current) => !current)}>
          {metadataGroups.map((group) => (
            <div className="transcode-filename-token-group" key={group.name}>
              <strong>{group.name}</strong>
              <div className="transcode-filename-token-group-items">
                {group.entries.map((entry: FilenameMetadataTokenEntry) => {
                  const label = t("transcoding.filenameMetadataTokenOptions." + entry.labelKey);
                  const tokenText = "{" + entry.token + "}";
                  const description = t("transcoding.filenameMetadataTooltipDescription", { token: tokenText, label })
                    .replaceAll("{token}", tokenText)
                    .replaceAll("{label}", label);
                  const exampleValue = entry.token === "audioLanguages" || entry.token === "subtitleLanguages"
                    ? ["en", "de"].map((language) => formatFilenameLanguageCode(language, definition.language_code_format)).join(definition.metadata_separator || ", ")
                    : entry.token === "sourceName" ? exampleSourceName(definition) : exampleMetadataValues[entry.token];
                  return (
                    <TooltipTrigger
                      key={entry.token}
                      className="secondary small transcode-filename-token-pill"
                      ariaLabel={label}
                      tooltipClassName="transcode-filename-token-tooltip-portal"
                      align="start"
                      placement="auto"
                      maxWidth={360}
                      pinOnClick={false}
                      disabled={busy}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertMetadataToken(entry.token)}
                      content={(
                        <div className="transcode-filename-token-tooltip">
                          <div className="transcode-filename-token-tooltip-heading"><code>{tokenText}</code><strong>{label}</strong></div>
                          <p>{description}</p>
                          <div className="transcode-filename-token-tooltip-example"><span>{t("transcoding.filenameMetadataTooltipExample")}</span><code>{tokenText} → {exampleValue}</code></div>
                        </div>
                      )}
                    >
                      {tokenText}
                    </TooltipTrigger>
                  );
                })}
              </div>
            </div>
          ))}
        </TranscodeFormattingMetadataMenu>
        <div className={"transcode-filename-options-row transcode-formatting-preset-options" + (kind === "folder" ? " is-folder" : "")}>
          <label className="transcode-filename-field transcode-filename-divider-field">
            <span className="transcode-field-label">{t(kind === "filename" ? "transcoding.filenameMetadataSeparator" : "transcoding.folderMetadataSeparator")}</span>
            <input className="settings-choice-input transcode-control" maxLength={32} value={definition.metadata_separator} onChange={(event) => setDefinition({ ...definition, metadata_separator: event.target.value })} />
          </label>
          <div className="transcode-filename-cleanup">
            <span className="transcode-field-label">{t(kind === "filename" ? "transcoding.filenameCleanup" : "transcoding.folderCleanup")}</span>
            <label className="transcode-filename-field transcode-filename-cleanup-control">
              <span className="sr-only">{t(kind === "filename" ? "transcoding.filenameCleanupPreset" : "transcoding.folderCleanupPreset")}</span>
              <select className="settings-choice-input transcode-control" value={definition.cleanup_preset} onChange={(event) => setDefinition({ ...definition, cleanup_preset: event.target.value as TranscodeFormattingDefinition["cleanup_preset"] })}>
                {cleanupValues.map((value, index) => <option key={value} value={value}>{t("transcoding.filenameCleanupOptions." + cleanupKeys[index])}</option>)}
              </select>
            </label>
            {definition.cleanup_preset === "custom" ? (
              <label className="transcode-filename-field transcode-filename-cleanup-control">
                <span className="transcode-field-label">{t(kind === "filename" ? "transcoding.filenameCleanupRegex" : "transcoding.folderCleanupRegex")}</span>
                <input className="settings-choice-input transcode-control" maxLength={256} value={definition.cleanup_regex ?? ""} onChange={(event) => setDefinition({ ...definition, cleanup_regex: event.target.value })} />
              </label>
            ) : null}
          </div>
          <LanguageCodeFormatField
            className="transcode-filename-field transcode-language-code-field"
            kind={kind}
            value={definition.language_code_format}
            onChange={(language_code_format) => setDefinition({ ...definition, language_code_format })}
          />
        </div>
        <div className="transcode-filename-preview is-prominent">
          <span>{t("transcoding.formattingPresets.exampleOutput")}</span>
          <code aria-live="polite">{exampleOutput}</code>
        </div>
      </div>
      <div className="compatibility-profile-card-actions transcode-automation-editor-actions"><button type="button" className="transcode-action-button" disabled={busy || !name.trim() || !definition.template.trim()} onClick={() => void save()}><Save size={16} aria-hidden="true" />{t("common.save")}</button><button type="button" className="secondary transcode-action-button" disabled={busy} onClick={cancelEditing}>{t("common.cancel")}</button></div>
    </div>
  );

  return <div className="compatibility-profile-list compatibility-profile-catalog-list" data-settings-search-target={`transcoding-presets-tab-${kind}`}>
    <div className="settings-profile-toggle-row transcode-automation-toggle-row"><div className="transcode-automation-tab-controls">{tabs}</div><div className="settings-profile-toggle-actions"><button type="button" className="secondary small settings-panel-header-action" onClick={startNew} disabled={busy}><Plus size={16} aria-hidden="true" />{t("transcoding.formattingPresets.new")}</button></div></div>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    <div className="compatibility-profile-search"><Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" /><input type="search" value={search} aria-label={t("transcoding.automation.searchPresets")} placeholder={t("transcoding.automation.searchPresets")} onChange={(event) => setSearch(event.target.value)} /></div>
    {visible.map((preset) => <article className={`compatibility-profile-list-item${expandedId === preset.id ? " is-expanded" : ""}`} key={preset.id}>
      <div className="compatibility-profile-list-row quality-profile-list-row">
        <button type="button" className="compatibility-profile-list-trigger" aria-expanded={expandedId === preset.id} onClick={() => { setExpandedId((current) => current === preset.id ? null : preset.id); setDraftId(undefined); setMetadataMenuOpen(false); }}><span className="transcode-automation-list-copy compatibility-profile-list-copy"><strong>{preset.name}</strong>{preset.is_default ? <small>{t("transcoding.formattingPresets.default")}</small> : null}</span><ChevronDown aria-hidden="true" /></button>
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
