import { Check, LoaderCircle, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type JellyfinLibrary, type JellyfinPathMapping } from "../lib/api";
import { TooltipTrigger } from "./TooltipTrigger";

function normalizedPath(path: string) {
  return path.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function JellyfinLibraryPathMappingRow({
  jellyfinLibrary,
  location,
  mapping,
  suggestedTarget,
  disabled,
  onChanged,
}: {
  jellyfinLibrary: JellyfinLibrary;
  location: string;
  mapping?: JellyfinPathMapping;
  suggestedTarget: string;
  disabled: boolean;
  onChanged: (mapping: JellyfinPathMapping | null, removedId?: number) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(mapping?.medialyze_path_prefix ?? suggestedTarget);
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTarget(mapping?.medialyze_path_prefix ?? suggestedTarget);
    setError(null);
    setSaved(false);
  }, [mapping?.enabled, mapping?.id, mapping?.medialyze_path_prefix, suggestedTarget]);

  async function saveMapping() {
    const nextTarget = target.trim();
    if (!nextTarget) return;
    setPendingAction("save");
    setError(null);
    setSaved(false);
    try {
      const savedMapping = mapping
        ? await api.updateJellyfinPathMapping(mapping.id, {
            jellyfin_path_prefix: location,
            medialyze_path_prefix: nextTarget,
            enabled: true,
          })
        : await api.createJellyfinPathMapping({
            jellyfin_path_prefix: location,
            medialyze_path_prefix: nextTarget,
            enabled: true,
          });
      onChanged(savedMapping);
      setSaved(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteMapping() {
    if (!mapping) return;
    setPendingAction("delete");
    setError(null);
    setSaved(false);
    try {
      await api.deleteJellyfinPathMapping(mapping.id);
      onChanged(null, mapping.id);
      setTarget("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPendingAction(null);
    }
  }

  const normalizedTarget = target.trim();
  const hasChanges = Boolean(
    normalizedTarget
      && (
        !mapping
        || !mapping.enabled
        || normalizedPath(mapping.jellyfin_path_prefix) !== normalizedPath(location)
        || normalizedPath(mapping.medialyze_path_prefix) !== normalizedPath(normalizedTarget)
      ),
  );

  return (
    <div className="library-jellyfin-path-mapping-row">
      <div className="field library-jellyfin-path-source">
        <span className="field-label">{t("jellyfin.jellyfinPath")}</span>
        <code>{location}</code>
      </div>
      <span className="library-jellyfin-path-arrow" aria-hidden="true">→</span>
      <div className="field library-jellyfin-path-target">
        <label htmlFor={`jellyfin-path-target-${jellyfinLibrary.id}-${encodeURIComponent(location)}`}>
          {t("jellyfin.medialyzePath")}
        </label>
        <input
          id={`jellyfin-path-target-${jellyfinLibrary.id}-${encodeURIComponent(location)}`}
          className="settings-choice-input"
          value={target}
          placeholder={suggestedTarget || t("jellyfin.medialyzePathPlaceholder")}
          disabled={disabled || pendingAction !== null}
          onChange={(event) => {
            setTarget(event.target.value);
            setSaved(false);
            setError(null);
          }}
        />
      </div>
      <div className="library-jellyfin-path-mapping-actions">
        <button
          type="button"
          className={`secondary icon-only-button library-jellyfin-path-save-button${hasChanges ? " is-dirty" : ""}`}
          aria-label={t("libraries.sections.jellyfin.savePathMapping")}
          title={t("libraries.sections.jellyfin.savePathMapping")}
          disabled={disabled || pendingAction !== null || !hasChanges}
          onClick={() => void saveMapping()}
        >
          {pendingAction === "save" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Save aria-hidden="true" />}
        </button>
        {mapping ? (
          <button
            type="button"
            className="secondary icon-only-button danger"
            aria-label={t("libraries.sections.jellyfin.removePathMapping")}
            title={t("libraries.sections.jellyfin.removePathMapping")}
            disabled={disabled || pendingAction !== null}
            onClick={() => void deleteMapping()}
          >
            {pendingAction === "delete" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
          </button>
        ) : null}
        {saved ? (
          <span
            className="library-jellyfin-path-mapping-status"
            role="status"
            aria-label={t("jellyfin.autoSave.saved")}
            title={t("jellyfin.autoSave.saved")}
          >
            <Check aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {error ? <div className="alert jellyfin-inline-error" role="alert">{error}</div> : null}
    </div>
  );
}

export function JellyfinLibraryPathMappings({
  jellyfinLibrary,
  mappings,
  suggestedTargets,
  disabled = false,
  loadError,
  onChanged,
  onBatchChanged,
  sectionId,
  focused = false,
}: {
  jellyfinLibrary: JellyfinLibrary;
  mappings: JellyfinPathMapping[];
  suggestedTargets: string[];
  disabled?: boolean;
  loadError?: string | null;
  onChanged: (mapping: JellyfinPathMapping | null, removedId?: number) => void;
  onBatchChanged: (mappings: JellyfinPathMapping[]) => Promise<void>;
  sectionId?: string;
  focused?: boolean;
}) {
  const { t } = useTranslation();
  const [togglePending, setTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const switchRef = useRef<HTMLInputElement | null>(null);
  const locationMappings = jellyfinLibrary.locations.map((location) => mappings.find(
    (candidate) => normalizedPath(candidate.jellyfin_path_prefix) === normalizedPath(location),
  ));
  const enabledMappingCount = locationMappings.filter((mapping) => mapping?.enabled).length;
  const isFullyEnabled = Boolean(
    jellyfinLibrary.locations.length
      && locationMappings.every((mapping) => mapping?.enabled),
  );
  const isPartiallyEnabled = enabledMappingCount > 0 && !isFullyEnabled;

  useEffect(() => {
    if (switchRef.current) switchRef.current.indeterminate = isPartiallyEnabled;
  }, [isPartiallyEnabled]);

  async function togglePathMapping(nextEnabled: boolean) {
    if (nextEnabled === isFullyEnabled && !isPartiallyEnabled) return;
    setTogglePending(true);
    setToggleError(null);
    try {
      const batch = jellyfinLibrary.locations.flatMap((location, index) => {
        const mapping = locationMappings[index];
        if (mapping) {
          return [{
            id: mapping.id,
            jellyfin_path_prefix: mapping.jellyfin_path_prefix,
            medialyze_path_prefix: mapping.medialyze_path_prefix,
            enabled: nextEnabled,
          }];
        }
        if (!nextEnabled) return [];
        const target = (suggestedTargets[index] ?? suggestedTargets[0] ?? "").trim();
        if (!target) throw new Error(t("libraries.sections.jellyfin.pathMappingTargetRequired"));
        return [{
          jellyfin_path_prefix: location,
          medialyze_path_prefix: target,
          enabled: true,
        }];
      });
      if (batch.length) {
        const updated = await api.updateJellyfinPathMappingsBatch(batch);
        await onBatchChanged(updated);
      }
    } catch (reason) {
      setToggleError((reason as Error).message);
    } finally {
      setTogglePending(false);
    }
  }

  return (
    <div
      id={sectionId}
      className={`library-jellyfin-path-mappings${focused ? " is-focused" : ""}`}
    >
      <div className="library-jellyfin-path-mappings-heading">
        <div className="library-jellyfin-path-mappings-title">
          <h5>{t("libraries.sections.jellyfin.pathMappingTitle")}</h5>
          <TooltipTrigger
            ariaLabel={t("libraries.sections.jellyfin.pathMappingDescriptionAria")}
            content={t("libraries.sections.jellyfin.pathMappingDescription")}
          >
            ?
          </TooltipTrigger>
        </div>
        <label
          className="toggle-switch library-jellyfin-path-mapping-switch"
          title={t(isFullyEnabled
            ? "libraries.sections.jellyfin.disablePathMapping"
            : "libraries.sections.jellyfin.enablePathMapping")}
        >
          <span className={`library-jellyfin-path-mapping-state${isPartiallyEnabled ? " is-partial" : ""}`}>
            {t(isPartiallyEnabled
              ? "libraries.sections.jellyfin.pathMappingStatePartial"
              : isFullyEnabled
                ? "libraries.sections.jellyfin.pathMappingStateEnabled"
                : "libraries.sections.jellyfin.pathMappingStateDisabled")}
          </span>
          <input
            ref={switchRef}
            type="checkbox"
            role="switch"
            checked={isFullyEnabled}
            disabled={disabled || togglePending || !jellyfinLibrary.locations.length}
            aria-checked={isPartiallyEnabled ? "mixed" : isFullyEnabled}
            aria-label={t(isFullyEnabled
              ? "libraries.sections.jellyfin.disablePathMapping"
              : "libraries.sections.jellyfin.enablePathMapping")}
            aria-busy={togglePending}
            onChange={(event) => void togglePathMapping(event.target.checked)}
          />
          <span className="toggle-switch-track library-jellyfin-path-mapping-switch-track" aria-hidden="true">
            <span className="toggle-switch-thumb library-jellyfin-path-mapping-switch-thumb" />
          </span>
        </label>
      </div>
      {loadError || toggleError ? (
        <div className="alert jellyfin-inline-error" role="alert">{loadError ?? toggleError}</div>
      ) : null}
      {!jellyfinLibrary.locations.length ? (
        <div className="notice">{t("libraries.sections.jellyfin.noJellyfinPaths")}</div>
      ) : isFullyEnabled || isPartiallyEnabled ? (
        <div className="library-jellyfin-path-mapping-list">
          {jellyfinLibrary.locations.map((location, index) => {
            const mapping = mappings.find(
              (candidate) => normalizedPath(candidate.jellyfin_path_prefix) === normalizedPath(location),
            );
            return (
              <JellyfinLibraryPathMappingRow
                key={`${jellyfinLibrary.id}:${location}`}
                jellyfinLibrary={jellyfinLibrary}
                location={location}
                mapping={mapping}
                suggestedTarget={suggestedTargets[index] ?? suggestedTargets[0] ?? ""}
                disabled={disabled || togglePending}
                onChanged={onChanged}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
