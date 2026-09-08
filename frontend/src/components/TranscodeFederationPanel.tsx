import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { History, LoaderCircle, Network, RefreshCw } from "lucide-react";

import { api, type TranscodeFederation } from "../lib/api";
import { AnimatedConnectIcon } from "./AnimatedConnectIcon";
import { CopyIcon } from "./CopyIcon";
import { TooltipTrigger } from "./TooltipTrigger";

type PendingAction = "save" | "pair" | "reset" | string | null;

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
  const [data, setData] = useState<TranscodeFederation | null>(null);
  const dataRef = useRef<TranscodeFederation | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discoveredPairingCodes, setDiscoveredPairingCodes] = useState<Record<string, string>>({});
  const [invalidDiscoveredPairingCode, setInvalidDiscoveredPairingCode] = useState<string | null>(null);
  const invalidDiscoveredPairingCodeTimeoutRef = useRef<number | null>(null);

  const publishData = useCallback((next: TranscodeFederation) => {
    dataRef.current = next;
    setData(next);
    onData?.(next);
  }, [onData]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => () => {
    if (invalidDiscoveredPairingCodeTimeoutRef.current !== null) {
      window.clearTimeout(invalidDiscoveredPairingCodeTimeoutRef.current);
    }
  }, []);

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
      setData((current) => current ? { ...current, settings } : current);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  async function discover() {
    setPending("discover");
    setError(null);
    setNotice(null);
    try {
      publishData(await api.discoverTranscodeFederation());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  async function pair(peerEndpoint = endpoint, code = pairingCode) {
    if (!peerEndpoint.trim() || code.trim().length !== 6) return;
    setPending("pair");
    setError(null);
    setNotice(null);
    try {
      publishData(await api.pairTranscodeFederation({ endpoint: peerEndpoint.trim(), pairing_code: code.trim() }));
      setEndpoint("");
      setPairingCode("");
      setNotice(t("transcoding.federation.paired"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  function flashMissingDiscoveredPairingCode(installationId: string) {
    setError(null);
    setNotice(null);
    setInvalidDiscoveredPairingCode(installationId);
    if (invalidDiscoveredPairingCodeTimeoutRef.current !== null) {
      window.clearTimeout(invalidDiscoveredPairingCodeTimeoutRef.current);
    }
    invalidDiscoveredPairingCodeTimeoutRef.current = window.setTimeout(() => {
      setInvalidDiscoveredPairingCode((current) => current === installationId ? null : current);
      invalidDiscoveredPairingCodeTimeoutRef.current = null;
    }, 1200);
  }

  async function pairDiscovered(installationId: string, peerEndpoint: string) {
    const code = discoveredPairingCodes[installationId]?.trim() ?? "";
    if (code.length !== 6) {
      flashMissingDiscoveredPairingCode(installationId);
      return;
    }
    await pair(peerEndpoint, code);
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
    <section className="transcode-federation-panel" aria-labelledby="transcode-federation-title">
      <div className="transcode-federation-heading">
        <div>
          <div className="panel-title-row">
            <h3 id="transcode-federation-title"><Network aria-hidden="true" />{t("transcoding.federation.title")}</h3>
          </div>
        </div>
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
      </div>

      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {notice ? <div className="notice compact" role="status">{notice}</div> : null}

      <div className="app-settings-performance-grid transcode-federation-fields">
        <label className="field"><span>{t("transcoding.federation.networkName")}</span><input className="settings-choice-input" value={settings.federation_name} disabled={disabled} onChange={(event) => setData({ ...data, settings: { ...settings, federation_name: event.target.value } })} onBlur={() => void saveSettings({ federation_name: settings.federation_name })} /></label>
        <label className="field"><span>{t("transcoding.federation.displayName")}</span><input className="settings-choice-input" value={settings.display_name} disabled={disabled} onChange={(event) => setData({ ...data, settings: { ...settings, display_name: event.target.value } })} onBlur={() => void saveSettings({ display_name: settings.display_name })} /></label>
        <div className="transcode-federation-code-group">
          <div className="transcode-federation-code-heading">
            <span className="field-label">{t("transcoding.federation.pairingCode")}</span>
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
          <div className="transcode-federation-address-item transcode-federation-code">
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
        </div>
      </div>
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

      <div className="transcode-federation-pairing">
        {data.discovered.length ? (
          <div className="transcode-federation-discovered">
            <div className="transcode-federation-discovered-heading">
              <strong>{t("transcoding.federation.foundInNetwork")}</strong>
              <TooltipTrigger
                ariaLabel={t("transcoding.federation.refreshDiscovery")}
                content={t("transcoding.federation.refreshDiscovery")}
                className="secondary icon-only-button compatibility-profile-quick-action transcode-federation-discovered-refresh"
                disabled={disabled}
                pinOnClick={false}
                onClick={() => void discover()}
              >
                <RefreshCw aria-hidden="true" className={pending === "discover" ? "is-spinning" : undefined} size={16} />
              </TooltipTrigger>
            </div>
            <div className="transcode-federation-discovered-list">
              {data.discovered.map((peer) => {
                const peerEndpoint = peer.endpoint_urls[0] ?? peer.installation_id;
                const peerName = peer.display_name?.trim() || peerEndpoint;
                const endpointIsName = peerName.replace(/\/+$/, "").toLocaleLowerCase() === peerEndpoint.replace(/\/+$/, "").toLocaleLowerCase();
                const codeIsInvalid = invalidDiscoveredPairingCode === peer.installation_id;
                return <div className="transcode-federation-peer" key={peer.installation_id}>
                  <span><strong>{peerName}</strong>{endpointIsName ? null : <small>{peerEndpoint}</small>}</span>
                  <div className="transcode-federation-peer-connect-control">
                    <input
                      className={`settings-choice-input transcode-federation-peer-code-input${codeIsInvalid ? " is-invalid" : ""}`}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      placeholder={t("transcoding.federation.pairingCode")}
                      aria-label={t("transcoding.federation.pairingCode")}
                      aria-invalid={codeIsInvalid}
                      value={discoveredPairingCodes[peer.installation_id] ?? ""}
                      disabled={disabled}
                      onChange={(event) => {
                        const value = event.target.value.replace(/[^0-9]/g, "").slice(0, 6);
                        setDiscoveredPairingCodes((current) => ({ ...current, [peer.installation_id]: value }));
                        if (value.length === 6 && codeIsInvalid) setInvalidDiscoveredPairingCode(null);
                      }}
                    />
                    <button type="button" className="secondary small settings-panel-header-action transcode-federation-connect-button" disabled={disabled} onClick={() => void pairDiscovered(peer.installation_id, peerEndpoint)}><AnimatedConnectIcon className="transcode-federation-action-icon" size={16} aria-hidden="true" />{t("transcoding.federation.connect")}</button>
                  </div>
                </div>;
              })}
            </div>
          </div>
        ) : null}
        <div className="transcode-federation-pair-form">
          <input className="settings-choice-input" type="url" placeholder={t("transcoding.federation.endpointPlaceholder")} value={endpoint} disabled={disabled} onChange={(event) => setEndpoint(event.target.value)} />
          <input className="settings-choice-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder={t("transcoding.federation.codePlaceholder")} value={pairingCode} disabled={disabled} onChange={(event) => setPairingCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))} />
          <button type="button" className="secondary small settings-panel-header-action transcode-federation-connect-button" disabled={disabled || !endpoint.trim() || pairingCode.trim().length !== 6} onClick={() => void pair()}><AnimatedConnectIcon className="transcode-federation-action-icon" size={16} aria-hidden="true" />{t("transcoding.federation.connect")}</button>
        </div>
      </div>

    </section>
  );
}
