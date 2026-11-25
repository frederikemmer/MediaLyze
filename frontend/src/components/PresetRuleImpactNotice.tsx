import { useTranslation } from "react-i18next";
import { type TranscodePresetRuleImpact } from "../lib/api";

export function PresetRuleImpactNotice({ impact, confirmed, onConfirm }: {
  impact?: TranscodePresetRuleImpact | null;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  const { t } = useTranslation();
  if (!impact) return <div className="notice">{t("transcoding.presetRuleImpact.none")}</div>;

  const hidden = impact.total - impact.rules.length;
  return (
    <div className="notice">
      <strong>{t("transcoding.presetRuleImpact.title")}</strong>
      {impact.rules.length > 0 && (
        <ul>
          {impact.rules.map((rule) => (
            <li key={rule.id}>
              {rule.name} · {t(rule.enabled ? "transcoding.automation.enabled" : "transcoding.automation.disabled")}
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && <p>{t("transcoding.presetRuleImpact.hidden", { count: hidden })}</p>}
      <label className="transcode-filename-option">
        <input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} />
        {t("transcoding.presetRuleImpact.confirm")}
      </label>
    </div>
  );
}
