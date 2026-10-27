import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordField(props: PasswordFieldProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <span className="password-field-control">
      <input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="icon-button icon-button-borderless password-visibility-toggle"
        aria-label={t(visible ? "access.hidePassword" : "access.showPassword")}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff aria-hidden="true" className="nav-icon" /> : <Eye aria-hidden="true" className="nav-icon" />}
      </button>
    </span>
  );
}
