import type { InputHTMLAttributes } from "react";

type SettingsInlineLabelInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "aria-label"> & {
  label: string;
  ariaLabel?: string;
  wrapperClassName?: string;
};

/** Single-line input with the compact, inset label treatment used by Resolution Categories. */
export function SettingsInlineLabelInput({
  label,
  ariaLabel,
  wrapperClassName,
  className,
  ...inputProps
}: SettingsInlineLabelInputProps) {
  const wrapperClasses = [
    "settings-inline-label-field",
    inputProps.type === "number" ? "has-stepper" : "",
    wrapperClassName,
  ].filter(Boolean).join(" ");
  const inputClasses = ["settings-choice-input", className].filter(Boolean).join(" ");

  return (
    <div className={wrapperClasses}>
      <input {...inputProps} className={inputClasses} aria-label={ariaLabel ?? label} />
      <span className="settings-inline-label-field-label" aria-hidden="true">{label}</span>
    </div>
  );
}
