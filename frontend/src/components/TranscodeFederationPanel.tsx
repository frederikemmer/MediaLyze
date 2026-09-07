import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Copy, LoaderCircle, Network, PlugZap, RefreshCw, RotateCcw, Unplug } from "lucide-react";

import { api, type TranscodeCapabilities, type TranscodeFederation, type TranscodeFederationMember } from "../lib/api";

type PendingAction = "save" | "discover" | "pair" | "reset" | string | null;

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function memberResourceSummary(member: TranscodeFederationMember, t: (key: string, options?: Record<string, unknown>) => string): string {
  const resources = member.resources;
  const cpuThreads = typeof resources.cpu_threads === "number" ? `${resources.cpu_threads} CPU` : null;
  const freeBytes = typeof resources.temp_free_bytes === "number" ? `${Math.round(resources.temp_free_bytes / 1024 / 1024 / 1024)} GB free` : null;
  const parts = [cpuThreads, freeBytes, `${member.active_jobs} ${t("transcoding.federation.activeJobs")}`].filter(Boolean);
  return parts.join(" · ") || t("transcoding.federation.resourcesUnknown");
}

export function TranscodeFederationPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<TranscodeFederation | null>(null);
  const [capabilities, setCapabilities] = useState<TranscodeCapabilities | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const initial = await api.transcodeFederation();
      setData(initial);
      try {
        setCapabilities(await api.transcodeCapabilities());
      } catch {
        setCapabilities(null);
      }
      if (initial.settings.enabled && initial.settings.discovery_enabled) {
        try {
          setData(await api.discoverTranscodeFederation());
        } catch {
          // Discovery is best-effort; manual endpoints and the last known
          // member snapshot remain useful when UDP is unavailable.
          setData(initial);
        }
      }
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings(payload: Parameters<typeof api.updateTranscodeFederation>[0]) {
    setPending("save");
    setError(null);
    setNotice(null);
    try {
      const settings = await api.updateTranscodeFederation(payload);
      setData((current) => current ? { ...current, settings } : current);
      setNotice(t("transcoding.federation.saved"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  async function discover() {
    setPending("discover");
    setError(null);
    try {
      setData(await api.discoverTranscodeFederation());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  async function pair(peerEndpoint = endpoint, code = pairingCode) {
    if (!peerEndpoint.trim() || !code.trim()) return;
    setPending("pair");
    setError(null);
    setNotice(null);
    try {
      setData(await api.pairTranscodeFederation({ endpoint: peerEndpoint.trim(), pairing_code: code.trim() }));
      setEndpoint("");
      setPairingCode("");
      setNotice(t("transcoding.federation.paired"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  async function resetCode() {
    setPending("reset");
    setError(null);
    try {
      const result = await api.resetTranscodeFederationPasscode();
      setData((current) => current ? {
        ...current,
        settings: {
          ...current.settings,
          pairing_code: result.pairing_code,
          pairing_code_from_environment: result.pairing_code_from_environment,
        },
      } : current);
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
      setNotice(t("transcoding.federation.codeCopied"));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function syncMember(member: TranscodeFederationMember) {
    setPending(member.installation_id);
    setError(null);
    try {
      setData(await api.syncTranscodeFederationMember(member.installation_id));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  async function excludeMember(member: TranscodeFederationMember) {
    if (!window.confirm(t("transcoding.federation.excludeConfirm", { name: member.display_name }))) return;
    setPending(member.installation_id);
    setError(null);
    try {
      await api.excludeTranscodeFederationMember(member.installation_id);
      setData((current) => current ? { ...current, members: current.members.filter((item) => item.installation_id !== member.installation_id) } : current);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  if (!data) {
    return <div className="transcode-federation-panel"><LoaderCircle className="spin" aria-hidden="true" />{t("transcoding.federation.loading")}</div>;
  }

  const settings = data.settings;
  const disabled = pending !== null;
  const resourcePolicy = settings.resource_policy && typeof settings.resource_policy === "object"
    ? settings.resource_policy
    : {};
  const gpuPolicy = resourcePolicy.gpu && typeof resourcePolicy.gpu === "object"
    ? resourcePolicy.gpu as Record<string, unknown>
    : {};
  const hardwareDevices = capabilities?.devices?.filter((device) => device.status === "available") ?? [];
  const saveResourcePolicy = (next: Record<string, unknown>) => void saveSettings({ resource_policy: next });
  return (
    <section className="transcode-federation-panel" aria-labelledby="transcode-federation-title">
      <div className="transcode-federation-heading">
        <div>
          <h3 id="transcode-federation-title"><Network aria-hidden="true" />{t("transcoding.federation.title")}</h3>
          <p className="field-hint">{t("transcoding.federation.description")}</p>
        </div>
        <span className={`badge ${settings.enabled ? "is-success" : "is-muted"}`}>
          {settings.enabled ? t("transcoding.federation.enabled") : t("transcoding.federation.disabled")}
        </span>
      </div>

      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {notice ? <div className="notice compact" role="status">{notice}</div> : null}

      <label className="app-settings-flag-toggle transcode-federation-toggle">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={disabled}
          onChange={(event) => void saveSettings({ enabled: event.target.checked })}
        />
        <span>{t("transcoding.federation.enableLabel")}</span>
      </label>

      <div className="app-settings-performance-grid transcode-federation-fields">
        <label className="field"><span>{t("transcoding.federation.networkName")}</span><input className="settings-choice-input" value={settings.federation_name} disabled={disabled} onChange={(event) => setData({ ...data, settings: { ...settings, federation_name: event.target.value } })} onBlur={() => void saveSettings({ federation_name: settings.federation_name })} /></label>
        <label className="field"><span>{t("transcoding.federation.displayName")}</span><input className="settings-choice-input" value={settings.display_name} disabled={disabled} onChange={(event) => setData({ ...data, settings: { ...settings, display_name: event.target.value } })} onBlur={() => void saveSettings({ display_name: settings.display_name })} /></label>
      </div>

      <div className="transcode-federation-code-row">
        <label className="field"><span>{t("transcoding.federation.pairingCode")}</span><input className="settings-choice-input" value={settings.pairing_code} readOnly aria-label={t("transcoding.federation.pairingCode")} /></label>
        <button type="button" className="secondary small" onClick={() => void copyCode()} disabled={disabled}><Copy aria-hidden="true" />{t("transcoding.federation.copyCode")}</button>
        <button type="button" className="secondary small" onClick={() => void resetCode()} disabled={disabled || settings.pairing_code_from_environment}><RotateCcw aria-hidden="true" />{t("transcoding.federation.resetCode")}</button>
      </div>
      {settings.pairing_code_from_environment ? <p className="field-hint">{t("transcoding.federation.environmentCode")}</p> : null}

      <div className="transcode-federation-pairing">
        <div className="transcode-federation-subheading"><strong>{t("transcoding.federation.addMember")}</strong><span className="field-hint">{t("transcoding.federation.directOnly")}</span></div>
        <div className="transcode-federation-pair-form">
          <input className="settings-choice-input" type="url" placeholder={t("transcoding.federation.endpointPlaceholder")} value={endpoint} disabled={disabled} onChange={(event) => setEndpoint(event.target.value)} />
          <input className="settings-choice-input" type="text" autoComplete="off" placeholder={t("transcoding.federation.codePlaceholder")} value={pairingCode} disabled={disabled} onChange={(event) => setPairingCode(event.target.value)} />
          <button type="button" className="secondary small" disabled={disabled || !endpoint.trim() || !pairingCode.trim()} onClick={() => void pair()}><PlugZap aria-hidden="true" />{t("transcoding.federation.pair")}</button>
          <button type="button" className="secondary small" disabled={disabled} onClick={() => void discover()}><RefreshCw className={pending === "discover" ? "spin" : undefined} aria-hidden="true" />{t("transcoding.federation.discover")}</button>
        </div>
        {data.discovered.length ? <div className="transcode-federation-discovered"><span className="field-hint">{t("transcoding.federation.discovered")}</span>{data.discovered.map((peer) => <div className="transcode-federation-peer" key={peer.installation_id}><span><strong>{peer.display_name}</strong><small>{peer.endpoint_urls[0] ?? peer.installation_id}</small></span><button type="button" className="secondary small" disabled={disabled || !settings.pairing_code} onClick={() => void pair(peer.endpoint_urls[0] ?? "", settings.pairing_code)}><PlugZap aria-hidden="true" />{t("transcoding.federation.pair")}</button></div>)}</div> : null}
      </div>

      <div className="transcode-federation-members">
        <div className="transcode-federation-subheading"><strong>{t("transcoding.federation.members")}</strong><span className="field-hint">{data.members.length}</span></div>
        {data.members.length ? data.members.map((member) => (
          <details className="transcode-federation-member" key={member.installation_id}>
            <summary><span className="transcode-federation-member-main"><span className={`status-dot ${member.reachable ? "is-online" : "is-offline"}`} aria-hidden="true" /><strong>{member.display_name}</strong><small>{member.connection_status} · {memberResourceSummary(member, t)}</small></span><ChevronDown aria-hidden="true" /></summary>
            <div className="transcode-federation-member-details">
              <div className="transcode-federation-member-actions"><span className="field-hint">{member.endpoint_urls[0] ?? member.installation_id}</span><button type="button" className="secondary small" disabled={disabled} onClick={() => void syncMember(member)}><RefreshCw className={pending === member.installation_id ? "spin" : undefined} aria-hidden="true" />{t("transcoding.federation.sync")}</button><button type="button" className="secondary small danger" disabled={disabled} onClick={() => void excludeMember(member)}><Unplug aria-hidden="true" />{t("transcoding.federation.exclude")}</button></div>
              <label className="app-settings-flag-toggle"><input type="checkbox" checked={member.accept_jobs} readOnly /><span>{t("transcoding.federation.acceptingJobs")}</span></label>
              <details className="transcode-federation-matrix"><summary>{t("transcoding.federation.hardwareMatrix")} ({member.capability_matrix?.matrices.length ?? 0})</summary><div className="transcode-federation-matrix-list">{member.capability_matrix?.matrices.length ? member.capability_matrix.matrices.map((matrix) => <div key={matrix.device_id}><strong>{matrix.device_name}</strong><small>{matrix.backend} · {matrix.encode_codecs.join(", ") || t("transcoding.federation.noMatrixData")}</small></div>) : <span className="field-hint">{t("transcoding.federation.noMatrixData")}</span>}</div></details>
            </div>
          </details>
        )) : <p className="field-hint">{t("transcoding.federation.noMembers")}</p>}
      </div>

      <label className="app-settings-flag-toggle transcode-federation-toggle"><input type="checkbox" checked={settings.discovery_enabled} disabled={disabled} onChange={(event) => void saveSettings({ discovery_enabled: event.target.checked })} /><span>{t("transcoding.federation.discoveryToggle")}</span></label>
      <label className="app-settings-flag-toggle transcode-federation-toggle"><input type="checkbox" checked={settings.accept_jobs} disabled={disabled} onChange={(event) => void saveSettings({ accept_jobs: event.target.checked })} /><span>{t("transcoding.federation.acceptToggle")}</span></label>
      <div className="transcode-federation-resources">
        <div className="transcode-federation-subheading"><strong>{t("transcoding.federation.resourcesTitle")}</strong><span className="field-hint">{t("transcoding.federation.resourcesHint")}</span></div>
        <label className="app-settings-flag-toggle"><input type="checkbox" checked={resourcePolicy.cpu !== false} disabled={disabled} onChange={(event) => saveResourcePolicy({ ...resourcePolicy, cpu: event.target.checked, gpu: gpuPolicy })} /><span>{t("transcoding.federation.cpuResource")}</span></label>
        {hardwareDevices.map((device) => <label className="app-settings-flag-toggle" key={device.id}><input type="checkbox" checked={gpuPolicy[device.id] !== false} disabled={disabled} onChange={(event) => saveResourcePolicy({ ...resourcePolicy, cpu: resourcePolicy.cpu !== false, gpu: { ...gpuPolicy, [device.id]: event.target.checked } })} /><span>{t("transcoding.federation.gpuResource", { name: device.name })}</span></label>)}
      </div>
      <p className="field-hint transcode-federation-identity"><Check aria-hidden="true" />{t("transcoding.federation.identity", { id: settings.installation_id.slice(0, 12) })}</p>
    </section>
  );
}
