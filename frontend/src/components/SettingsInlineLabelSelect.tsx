import type { SelectHTMLAttributes } from "react";

type SettingsInlineLabelSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "aria-label"> & {
  label: string;
  ariaLabel?: string;
};

/** Native select with the compact inset label placed before its existing chevron. */
export function SettingsInlineLabelSelect({ label, ariaLabel, className, children, ...selectProps }: SettingsInlineLabelSelectProps) {
  const selectClasses = ["settings-choice-input", className].filter(Boolean).join(" ");
  return (
    <span className="settings-inline-label-select">
      <select {...selectProps} className={selectClasses} aria-label={ariaLabel ?? label}>
        {children}
      </select>
      <span className="settings-inline-label-select-label" aria-hidden="true">{label}</span>
    </span>
  );
}
