import { Check, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { passwordRequirementStatus } from "../lib/password-policy";

export function PasswordRequirements({ value, id }: { value: string; id: string }) {
  const { t } = useTranslation();
  const status = passwordRequirementStatus(value);

  return (
    <ul id={id} className="password-requirements field-hint" aria-live="polite">
      {(["length", "character"] as const).map((requirement) => {
        const satisfied = status[requirement];
        const Icon = satisfied ? Check : Circle;
        return (
          <li key={requirement} data-satisfied={satisfied}>
            <Icon aria-hidden="true" />
            <span>{t(`access.passwordChecks.${requirement}`)}</span>
            <span className="sr-only">
              {t(satisfied ? "access.passwordChecks.met" : "access.passwordChecks.missing")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
