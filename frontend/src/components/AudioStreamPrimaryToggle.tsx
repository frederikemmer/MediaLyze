import { useTranslation } from "react-i18next";
import type { ComponentType } from "react";

import { AudioLinesIcon } from "./AudioLinesIcon";
import { LanguagesIcon } from "./LanguagesIcon";
import { SlidingTogglePill } from "./SlidingTogglePill";

export type AudioStreamPrimaryMode = "quality" | "language";

type AudioStreamPrimaryToggleProps = {
  mode: AudioStreamPrimaryMode;
  onChange: (mode: AudioStreamPrimaryMode) => void;
};

const OPTIONS: Array<{
  mode: AudioStreamPrimaryMode;
  labelKey: string;
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string; size?: number }>;
}> = [
  { mode: "quality", labelKey: "fileDetail.audioStreamPrimary.quality", icon: AudioLinesIcon },
  { mode: "language", labelKey: "fileDetail.audioStreamPrimary.language", icon: LanguagesIcon },
];

export function AudioStreamPrimaryToggle({ mode, onChange }: AudioStreamPrimaryToggleProps) {
  const { t } = useTranslation();

  return (
    <div
      className="distribution-chart-mode-toggle audio-stream-primary-toggle"
      role="group"
      aria-label={t("fileDetail.audioStreamPrimary.label")}
    >
      <SlidingTogglePill activeKey={mode} className="nav-active-pill distribution-chart-mode-pill audio-stream-primary-pill" />
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const label = t(option.labelKey);
        const selected = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            className={`distribution-chart-mode-button audio-stream-primary-button${selected ? " active" : ""}`}
            aria-label={label}
            aria-pressed={selected}
            data-tooltip={label}
            data-toggle-key={option.mode}
            onClick={() => onChange(option.mode)}
            title={label}
          >
            <span className="distribution-chart-mode-button-content">
              <Icon aria-hidden={true} className="distribution-chart-mode-icon" size={14} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
