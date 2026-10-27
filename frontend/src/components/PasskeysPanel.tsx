import { useEffect, useId, useRef, useState } from "react";
import { KeyRound, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { accessRequest } from "../lib/access-session";
import { passkeyCanceled, registerPasskey, supportsPasskeys, type Passkey, type PasskeyList } from "../lib/passkeys";
import { PasswordField } from "./PasswordField";
import { SettingsSection } from "./LogsSection";
import { TooltipTrigger } from "./TooltipTrigger";

export function PasskeysPanel({ fixture }: { fixture?: PasskeyList }) {
  const { t, i18n } = useTranslation();
  const { identity, refresh } = useAuth();
  const id = useId();
  const [data, setData] = useState<PasskeyList>(fixture ?? { enabled: false, reason: "not_configured", items: [] });
  const [loading, setLoading] = useState(!fixture);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const ceremony = useRef<AbortController | null>(null);
  useEffect(() => () => ceremony.current?.abort(), []);
  useEffect(() => {
    if (fixture || identity?.kind !== "account") return;
    let active = true;
    void accessRequest<PasskeyList>("/me/passkeys")
      .then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setError(t("passkeys.loadError")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identity?.id, fixture]);
  const supported = fixture ? true : supportsPasskeys();
  const enabled = data.enabled && supported;
  const hint = error && !data.enabled ? t("passkeys.loadError") : !data.enabled
    ? t(data.reason === "wrong_origin" ? "passkeys.wrongOrigin" : "passkeys.configure")
    : !supported ? t("passkeys.unsupported") : t("passkeys.help");
  const disabled = !enabled || busy || loading || Boolean(fixture);
  const date = (value: number | null) => value ? new Date(value * 1000).toLocaleDateString(i18n.language) : t("passkeys.neverUsed");
  function replace(item: Passkey) { setData((current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? item : entry) })); }
  async function add() {
    if (disabled) return;
    setBusy(true); setError("");
    try {
      ceremony.current = new AbortController();
      const item = await registerPasskey(name.trim(), password, () => setPassword(""), ceremony.current.signal);
      setData((current) => ({ ...current, items: [...current.items, item] }));
      setAdding(false); setName("");
    } catch (reason) {
      if (!passkeyCanceled(reason)) setError(t("passkeys.addError"));
    } finally { ceremony.current = null; setPassword(""); setBusy(false); }
  }
  async function rename(item: Passkey) {
    if (disabled) return;
    setBusy(true); setError("");
    try {
      replace(await accessRequest<Passkey>(`/me/passkeys/${item.id}`, { method: "PATCH", body: JSON.stringify({ name: editName.trim() }) }));
      setEditing(null);
    } catch { setError(t("passkeys.renameError")); }
    finally { setBusy(false); }
  }
  async function remove(item: Passkey) {
    if (disabled || !window.confirm(t("passkeys.confirmDelete", { name: item.name }))) return;
    setBusy(true); setError("");
    try {
      await accessRequest(`/me/passkeys/${item.id}`, { method: "DELETE" });
      setData((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id) }));
      await refresh();
    } catch { setError(t("passkeys.deleteError")); }
    finally { setBusy(false); }
  }
  return (
    <div className={`passkeys-panel${enabled ? "" : " is-disabled"}`}>
      <SettingsSection id={id} title={t("passkeys.title")} loading={loading}
        actions={<>
          <TooltipTrigger ariaLabel={t("passkeys.helpAria")} content={hint} placement="auto" />
          <button type="button" className="secondary small settings-panel-header-action" disabled={disabled}
            onClick={() => { setAdding(true); setError(""); document.getElementById(id)?.focus(); }}>
            <Plus aria-hidden="true" className="nav-icon" />{t("passkeys.add")}
          </button>
        </>}>
        {error && <p role="alert" className="alert">{error}</p>}
        {adding && <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void add(); }}>
          <label>{t("passkeys.name")}<input autoFocus required maxLength={64} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t("access.currentPassword")}<PasswordField required aria-label={t("access.currentPassword")} autoComplete="current-password" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
          <div className="button-row">
            <button type="submit" disabled={disabled || !name.trim() || !password}><KeyRound aria-hidden="true" size={16} />{t("passkeys.create")}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { setAdding(false); setPassword(""); }}>{t("common.cancel")}</button>
          </div>
        </form>}
        <div className="compatibility-profile-list passkey-list">
          {!data.items.length && <p className="field-hint compatibility-profile-catalog-message">{t("passkeys.empty")}</p>}
          {data.items.map((item) => <article key={item.id} className="compatibility-profile-list-item compatibility-profile-list-trigger is-static passkey-row">
            <KeyRound aria-hidden="true" size={18} />
            {editing === item.id ? <form className="passkey-rename" onSubmit={(event) => { event.preventDefault(); void rename(item); }}>
              <input autoFocus aria-label={t("passkeys.name")} required maxLength={64} value={editName} disabled={busy} onChange={(event) => setEditName(event.target.value)} />
              <button type="submit" className="icon-button icon-button-borderless icon-button-static" disabled={disabled || !editName.trim()} aria-label={t("common.save")}><Save aria-hidden="true" className="nav-icon" /></button>
              <button type="button" className="icon-button icon-button-borderless icon-button-static" disabled={busy} onClick={() => setEditing(null)} aria-label={t("common.cancel")}><X aria-hidden="true" className="nav-icon" /></button>
            </form> : <>
              <span className="passkey-identity"><strong>{item.name}</strong><small>{t("passkeys.created", { date: date(item.created_at) })} · {t("passkeys.lastUsed", { date: date(item.last_used_at) })}</small></span>
              <button type="button" className="icon-button icon-button-borderless icon-button-static" disabled={disabled} aria-label={t("passkeys.rename", { name: item.name })} data-tooltip={t("passkeys.rename", { name: item.name })} onClick={() => { setEditing(item.id); setEditName(item.name); }}><Pencil aria-hidden="true" className="nav-icon" /></button>
              <button type="button" className="icon-button icon-button-borderless icon-button-static" disabled={disabled} aria-label={t("passkeys.delete", { name: item.name })} data-tooltip={t("passkeys.delete", { name: item.name })} onClick={() => void remove(item)}><Trash2 aria-hidden="true" className="nav-icon" /></button>
            </>}
          </article>)}
        </div>
      </SettingsSection>
    </div>
  );
}
