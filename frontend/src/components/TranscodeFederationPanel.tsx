import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight, History, LoaderCircle, X } from "lucide-react";

import { api, type TranscodeFederation } from "../lib/api";
import { CopyIcon } from "./CopyIcon";
import { SquarePenIcon } from "./SquarePenIcon";
import { TooltipTrigger } from "./TooltipTrigger";

type PendingAction = "save" | "reset" | string | null;

const PAIRING_CODE_ROTATION_SECONDS = 30;
const PAIRING_CODE_ROTATION_MS = PAIRING_CODE_ROTATION_SECONDS * 1000;

type TranscodeFederationPanelProps = {
  onData?: (data: TranscodeFederation) => void;
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function TranscodeFederationPanel({ onData }: TranscodeFederationPanelProps = {}) {
  const { t } = useTranslation();
  const federationBodyId = useId();
  const [data, setData] = useState<TranscodeFederation | null>(null);
  const dataRef = useRef<TranscodeFederation | null>(null);
  const installationNameInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const publishData = useCallback((next: TranscodeFederation) => {
    dataRef.current = next;
    setData(next);
    onData?.(next);
  }, [onData]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const load = useCallback(async () => {
    try {
      const initial = await api.transcodeFederation();
      publishData(initial);
      if (initial.settings.enabled && initial.settings.discovery_enabled) {
        try {
          publishData(await api.discoverTranscodeFederation());
        } catch {
          // Discovery is best-effort; manual endpoints and the last known
          // member snapshot remain useful when UDP is unavailable.
          publishData(initial);
        }
      }
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [publishData]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshPairingCode = useCallback(async () => {
    try {
      const latest = await api.transcodeFederation();
      const current = dataRef.current;
      publishData(current ? { ...current, settings: latest.settings, members: latest.members } : latest);
      return true;
    } catch {
      // Keep the last visible code when a single refresh crosses a transient
      // network failure; the next rotation will retry automatically.
      return false;
    }
  }, [publishData]);

  useEffect(() => {
    if (!data) return undefined;
    const expiresAt = Number(data.settings.pairing_code_expires_at || 0);
    if (!expiresAt) {
      const interval = window.setInterval(() => void refreshPairingCode(), PAIRING_CODE_ROTATION_MS);
      return () => window.clearInterval(interval);
    }
    const delay = Math.max(100, expiresAt * 1000 - Date.now() + 50);
    let retryTimeout: number | undefined;
    const refreshAtRotation = async () => {
      const refreshed = await refreshPairingCode();
      if (!refreshed) {
        retryTimeout = window.setTimeout(() => void refreshAtRotation(), 1000);
      }
    };
    const timeout = window.setTimeout(() => void refreshAtRotation(), delay);
    return () => {
      window.clearTimeout(timeout);
      if (retryTimeout !== undefined) window.clearTimeout(retryTimeout);
    };
  }, [data, refreshPairingCode]);

  async function saveSettings(payload: Parameters<typeof api.updateTranscodeFederation>[0]) {
    setPending("save");
    setError(null);
    setNotice(null);
    try {
      const settings = await api.updateTranscodeFederation(payload);
      const current = dataRef.current;
      if (current) publishData({ ...current, settings });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  function startEditingDisplayName() {
    const current = dataRef.current;
    setDisplayNameDraft(current?.settings.display_name ?? "");
    setEditingDisplayName(true);
    setError(null);
    setNotice(null);
    window.requestAnimationFrame(() => {
      installationNameInputRef.current?.focus();
      installationNameInputRef.current?.select();
    });
  }

  function cancelEditingDisplayName() {
    setEditingDisplayName(false);
    setDisplayNameDraft("");
    setError(null);
  }

  async function saveDisplayName() {
    const nextDisplayName = displayNameDraft.trim();
    if (!nextDisplayName) {
      installationNameInputRef.current?.focus();
      return;
    }
    const current = dataRef.current;
    if (!current || nextDisplayName === current.settings.display_name) {
      cancelEditingDisplayName();
      return;
    }

    setPending("display-name");
    setError(null);
    setNotice(null);
    try {
      const settings = await api.updateTranscodeFederation({ display_name: nextDisplayName });
      const latest = dataRef.current;
      if (latest) publishData({ ...latest, settings });
      setEditingDisplayName(false);
      setDisplayNameDraft("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  function handleDisplayNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingDisplayName();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void saveDisplayName();
    }
  }

  async function resetCode() {
    setPending("reset");
    setError(null);
    try {
      const result = await api.resetTranscodeFederationPasscode();
      const current = dataRef.current;
      if (current) {
        publishData({
          ...current,
          settings: {
            ...current.settings,
            pairing_code: result.pairing_code,
            pairing_code_from_environment: result.pairing_code_from_environment,
            pairing_code_expires_at: result.pairing_code_expires_at,
          },
        });
      }
      setNotice(t("transcoding.federation.codeReset"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  async function copyCode() {
    if (!data?.settings.pairing_code) return;
    try {
      await navigator.clipboard.writeText(data.settings.pairing_code);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  if (!data) {
    return <div className="transcode-federation-panel"><LoaderCircle className="spin" aria-hidden="true" />{t("transcoding.federation.loading")}</div>;
  }

  const settings = data.settings;
  const disabled = pending !== null;
  const listenerError = settings.listener_status === "error"
    ? settings.listener_error?.trim() || t("transcoding.federation.listenerUnavailableHint")
    : null;
  const hostnameUrls = settings.hostname_urls ?? [];
  const ipUrls = settings.ip_urls ?? [];
  const reachableUrls = Array.from(new Set([...hostnameUrls, ...ipUrls]));
  const pairingCodeExpiresAt = Number(settings.pairing_code_expires_at || 0);
  const pairingCodeRemainingMs = pairingCodeExpiresAt
    ? Math.max(1, pairingCodeExpiresAt * 1000 - Date.now())
    : PAIRING_CODE_ROTATION_MS;
  const pairingCodeProgressStart = pairingCodeExpiresAt
    ? Math.min(1, Math.max(0, 1 - pairingCodeRemainingMs / PAIRING_CODE_ROTATION_MS))
    : 0;
  return (
    <section
      className="transcode-federation-panel"
      aria-labelledby="transcode-federation-title"
      data-settings-search-target="transcoding-federation"
    >
      <div className="transcode-federation-heading">
        <div className="transcode-federation-heading-main">
          <button
            type="button"
            className="transcode-federation-section-chevron"
            aria-label={t(expanded ? "panel.collapseAria" : "panel.expandAria", { title: t("transcoding.federation.title") })}
            title={t(expanded ? "panel.collapseAria" : "panel.expandAria", { title: t("transcoding.federation.title") })}
            aria-expanded={expanded}
            aria-controls={federationBodyId}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <ChevronDown aria-hidden="true" className="nav-icon" /> : <ChevronRight aria-hidden="true" className="nav-icon" />}
          </button>
          <label className="toggle-switch transcode-federation-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={settings.enabled}
              disabled={disabled}
              aria-checked={settings.enabled}
              aria-label={t("transcoding.federation.enableLabel")}
              onChange={(event) => void saveSettings({ enabled: event.target.checked })}
            />
            <span className="toggle-switch-track" aria-hidden="true">
              <span className="toggle-switch-thumb" />
            </span>
          </label>
          <h3 id="transcode-federation-title">{t("transcoding.federation.title")}</h3>
          {editingDisplayName ? (
            <div className="transcode-federation-installation-editor">
              <input
                ref={installationNameInputRef}
                type="text"
                className="settings-choice-input transcode-federation-installation-input"
                value={displayNameDraft}
                aria-label={`${t("transcoding.automation.edit")}: ${t("transcoding.federation.displayName")}`}
                required
                disabled={disabled}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
                onKeyDown={handleDisplayNameKeyDown}
              />
              <button
                type="button"
                className="secondary icon-only-button transcode-federation-name-action"
                aria-label={`${t("common.save")}: ${t("transcoding.federation.displayName")}`}
                title={`${t("common.save")}: ${t("transcoding.federation.displayName")}`}
                disabled={disabled}
                onClick={() => void saveDisplayName()}
              >
                <Check aria-hidden="true" className="nav-icon" size={16} />
              </button>
              <button
                type="button"
                className="secondary icon-only-button transcode-federation-name-action"
                aria-label={`${t("common.cancel")}: ${t("transcoding.federation.displayName")}`}
                title={`${t("common.cancel")}: ${t("transcoding.federation.displayName")}`}
                disabled={disabled}
                onClick={cancelEditingDisplayName}
              >
                <X aria-hidden="true" className="nav-icon" size={16} />
              </button>
            </div>
          ) : (
            <div className="transcode-federation-installation">
              <span className="transcode-federation-installation-name" title={settings.display_name}>{settings.display_name}</span>
              <button
                type="button"
                className="secondary icon-only-button transcode-federation-name-action"
                aria-label={`${t("transcoding.automation.edit")}: ${t("transcoding.federation.displayName")}`}
                title={`${t("transcoding.automation.edit")}: ${t("transcoding.federation.displayName")}`}
                disabled={disabled}
                onClick={startEditingDisplayName}
              >
                <SquarePenIcon aria-hidden="true" className="nav-icon" size={16} />
              </button>
            </div>
          )}
        </div>
        <div className="transcode-federation-heading-actions">
          <div className="transcode-federation-code-summary">
            <span className="transcode-federation-code-summary-label">{t("transcoding.federation.pairingCode")}</span>
            <div className="transcode-federation-address-item transcode-federation-code transcode-federation-header-code">
              <code title={settings.pairing_code} aria-label={t("transcoding.federation.pairingCode")}>
                {settings.pairing_code}
              </code>
              <TooltipTrigger
                ariaLabel={t("transcoding.federation.copyCode")}
                content={t("transcoding.federation.copyCode")}
                className="secondary icon-only-button transcode-federation-address-copy"
                disabled={disabled}
                pinOnClick={false}
                onClick={() => void copyCode()}
              >
                <CopyIcon aria-hidden="true" className="nav-icon" size={15} />
              </TooltipTrigger>
              <span className="transcode-federation-code-progress" aria-hidden="true">
                <span
                  key={settings.pairing_code}
                  style={{
                    "--pairing-code-progress-start": pairingCodeProgressStart,
                    "--pairing-code-progress-duration": `${pairingCodeRemainingMs}ms`,
                  } as CSSProperties}
                />
              </span>
            </div>
            <TooltipTrigger
              ariaLabel={t("transcoding.federation.resetCode")}
              content={t("transcoding.federation.resetCode")}
              className="secondary icon-only-button transcode-federation-code-action"
              disabled={disabled || settings.pairing_code_from_environment}
              pinOnClick={false}
              onClick={() => void resetCode()}
            >
              <History aria-hidden="true" className="nav-icon" size={16} />
            </TooltipTrigger>
          </div>
        </div>
      </div>

      {listenerError ? (
        <div className="alert transcode-federation-listener-error" role="alert">
          <strong>{t("transcoding.federation.listenerUnavailable")}</strong>
          <span>{listenerError}</span>
        </div>
      ) : null}
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {notice ? <div className="notice compact" role="status">{notice}</div> : null}

      {expanded ? <div id={federationBodyId} className="transcode-federation-content">
        {settings.pairing_code_from_environment ? <p className="field-hint">{t("transcoding.federation.environmentCode")}</p> : null}
        <div className="transcode-federation-addresses" aria-labelledby="transcode-federation-addresses-title">
          <div className="transcode-federation-subheading">
            <strong id="transcode-federation-addresses-title">{t("transcoding.federation.reachableAddresses")}</strong>
          </div>
          <div className="transcode-federation-address-list">
            {reachableUrls.length ? reachableUrls.map((url) => (
              <div className="transcode-federation-address-item" key={url}>
                <code>{url}</code>
                <TooltipTrigger
                  ariaLabel={t("transcoding.federation.copyAddress")}
                  content={t("transcoding.federation.copyAddress")}
                  className="secondary icon-only-button transcode-federation-address-copy"
                  disabled={disabled}
                  pinOnClick={false}
                  onClick={() => void copyAddress(url)}
                >
                  <CopyIcon aria-hidden="true" className="nav-icon" size={15} />
                </TooltipTrigger>
              </div>
            )) : <span className="field-hint">{t("transcoding.federation.noAddresses")}</span>}
          </div>
        </div>
      </div> : null}
    </section>
  );
}
