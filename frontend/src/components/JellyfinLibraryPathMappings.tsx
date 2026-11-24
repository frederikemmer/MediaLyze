import { LoaderCircle, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { identityGeneration } from "../lib/access-session";
import { useOptionalNotifications } from "../lib/notifications";
import { useAutosaveNotifications } from "../lib/notification-actions";
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
  const notifications = useOptionalNotifications();
  const generation = identityGeneration();
  const source = { area: "connectors" as const, href: "/settings?section=jellyfin", label: t("connectors.title") };
  const emit = (type: "success" | "error", key: string, fallback: string) => generation === identityGeneration() && notifications?.notify({ type, message: t(`notifications.actions.connectors.${key}`, { defaultValue: fallback }), topicKey: `jellyfin-mapping:${jellyfinLibrary.id}`, source });
  const [target, setTarget] = useState(mapping?.medialyze_path_prefix ?? suggestedTarget);
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);

  useEffect(() => {
    setTarget(mapping?.medialyze_path_prefix ?? suggestedTarget);
  }, [mapping?.enabled, mapping?.id, mapping?.medialyze_path_prefix, suggestedTarget]);

  async function saveMapping() {
    const nextTarget = target.trim();
    if (!nextTarget) return;
    setPendingAction("save");
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
      emit("success", "pathSaved", "Path mapping saved.");
      try { onChanged(savedMapping); } catch { if (generation === identityGeneration()) notifications?.notify({ type: "warning", message: t("notifications.actions.connectors.refreshFailed", { defaultValue: "The change was saved, but the view could not be refreshed." }), topicKey: `jellyfin-mapping:${jellyfinLibrary.id}`, source }); }
    } catch {
      emit("error", "pathFailed", "Could not save the path mapping.");
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteMapping() {
    if (!mapping) return;
    setPendingAction("delete");
    try {
      await api.deleteJellyfinPathMapping(mapping.id);
      emit("success", "pathDeleted", "Path mapping removed.");
      try { onChanged(null, mapping.id); setTarget(""); } catch { if (generation === identityGeneration()) notifications?.notify({ type: "warning", message: t("notifications.actions.connectors.refreshFailed", { defaultValue: "The change was saved, but the view could not be refreshed." }), topicKey: `jellyfin-mapping:${jellyfinLibrary.id}`, source }); }
    } catch {
      emit("error", "pathDeleteFailed", "Could not remove the path mapping.");
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
      </div>
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
  const notifications = useOptionalNotifications();
  const generation = identityGeneration();
  const source = { area: "connectors" as const, href: "/settings?section=jellyfin", label: t("connectors.title") };
  const autosave = useAutosaveNotifications({ scopeKey: `jellyfin-mapping:${jellyfinLibrary.id}`, topicKey: `jellyfin-mapping:${jellyfinLibrary.id}`, source, successMessage: t("notifications.actions.connectors.pathSaved", { defaultValue: "Path mapping saved." }), errorMessage: t("notifications.actions.connectors.pathFailed", { defaultValue: "Could not save the path mapping." }), partialMessage: t("notifications.actions.connectors.partial", { defaultValue: "Some changes were saved; others failed." }) });
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
        const updated = await autosave.trackSave(api.updateJellyfinPathMappingsBatch(batch));
        try { await onBatchChanged(updated); } catch { if (generation === identityGeneration()) notifications?.notify({ type: "warning", message: t("notifications.actions.connectors.refreshFailed", { defaultValue: "The change was saved, but the view could not be refreshed." }), topicKey: `jellyfin-mapping:${jellyfinLibrary.id}`, source }); }
      }
    } catch (reason) {
      if ((reason as Error).message === t("libraries.sections.jellyfin.pathMappingTargetRequired")) setToggleError(t("libraries.sections.jellyfin.pathMappingTargetRequired"));
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
            className="settings-heading-tooltip"
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
