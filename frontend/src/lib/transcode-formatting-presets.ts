import type { TranscodeFormattingDefinition, TranscodeFormattingPreset, TranscodePlan } from "./api";

export type FormattingKind = "filename" | "folder";

export function formattingDefinitionFromPlan(plan: TranscodePlan, kind: FormattingKind): TranscodeFormattingDefinition {
  if (kind === "filename") return {
    enabled: plan.filename_format_enabled ?? true,
    template: plan.filename_template,
    source_name_explicit: plan.filename_template_explicit_source ?? false,
    metadata_separator: plan.filename_metadata_separator ?? ", ",
    cleanup_preset: plan.filename_cleanup_preset ?? "none",
    cleanup_regex: plan.filename_cleanup_regex ?? null,
    include_subtitle_languages: plan.include_subtitle_languages ?? false,
    language_code_format: plan.filename_language_code_format ?? "iso_639_1",
  };
  return {
    enabled: plan.folder_format_enabled ?? false,
    template: plan.folder_template ?? "{folderName}",
    source_name_explicit: false,
    metadata_separator: plan.folder_metadata_separator ?? ", ",
    cleanup_preset: plan.folder_cleanup_preset ?? "none",
    cleanup_regex: plan.folder_cleanup_regex ?? null,
    include_subtitle_languages: false,
    language_code_format: plan.folder_language_code_format ?? "iso_639_1",
  };
}

export function applyFormattingPreset(plan: TranscodePlan, preset: TranscodeFormattingPreset): TranscodePlan {
  const value = preset.definition;
  if (preset.kind === "filename") return {
    ...plan,
    profile: "expert",
    filename_format_enabled: value.enabled,
    filename_template: value.template,
    filename_template_override: true,
    filename_template_explicit_source: value.source_name_explicit ?? false,
    filename_metadata_separator: value.metadata_separator,
    filename_cleanup_preset: value.cleanup_preset,
    filename_cleanup_regex: value.cleanup_regex,
    include_subtitle_languages: value.include_subtitle_languages,
    filename_language_code_format: value.language_code_format,
  };
  return {
    ...plan,
    profile: "expert",
    folder_format_enabled: value.enabled,
    folder_template: value.template,
    folder_template_override: true,
    folder_metadata_separator: value.metadata_separator,
    folder_cleanup_preset: value.cleanup_preset,
    folder_cleanup_regex: value.cleanup_regex,
    folder_language_code_format: value.language_code_format,
  };
}

export function matchingFormattingPresetId(plan: TranscodePlan, presets: TranscodeFormattingPreset[], kind: FormattingKind, selectedId: number | null): number | null {
  const preset = presets.find((item) => item.id === selectedId && item.kind === kind);
  if (!preset) return null;
  const current = formattingDefinitionFromPlan(plan, kind);
  return Object.entries(current).every(([key, value]) => {
    const saved = preset.definition[key as keyof TranscodeFormattingDefinition];
    return (key === "source_name_explicit" ? saved ?? false : saved) === value;
  }) ? preset.id : null;
}
