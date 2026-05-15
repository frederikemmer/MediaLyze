import { Wifi, WifiHigh, WifiOff, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { type TelemetryMode } from "../lib/api";
import { SlidingTogglePill } from "./SlidingTogglePill";

type SelectableTelemetryMode = "off" | "minimal" | "enabled";

type TelemetryModeToggleProps = {
  mode: TelemetryMode;
  pendingMode?: TelemetryMode | null;
  disabled?: boolean;
  undecided?: boolean;
  compact?: boolean;
  highlightEnabledOption?: boolean;
  onChange: (mode: SelectableTelemetryMode) => void;
  onConfirmedModeClick?: (mode: SelectableTelemetryMode) => void;
};

const OPTIONS: Array<{
  mode: SelectableTelemetryMode;
  icon: LucideIcon;
  className: string;
  labelKey: string;
  tooltipTitleKey: string;
  tooltipKey: string;
}> = [
  {
    mode: "off",
    icon: WifiOff,
    className: "telemetry-mode-off",
    labelKey: "telemetry.mode.off",
    tooltipTitleKey: "telemetry.modeTooltipTitles.off",
    tooltipKey: "telemetry.modeTooltips.off",
  },
  {
    mode: "minimal",
    icon: WifiHigh,
    className: "telemetry-mode-minimal",
    labelKey: "telemetry.mode.minimal",
    tooltipTitleKey: "telemetry.modeTooltipTitles.minimal",
    tooltipKey: "telemetry.modeTooltips.minimal",
  },
  {
    mode: "enabled",
    icon: Wifi,
    className: "telemetry-mode-enabled",
    labelKey: "telemetry.mode.enabled",
    tooltipTitleKey: "telemetry.modeTooltipTitles.enabled",
    tooltipKey: "telemetry.modeTooltips.enabled",
  },
];

export function TelemetryModeToggle({
  mode,
  pendingMode = null,
  disabled = false,
  undecided = false,
  compact = false,
  highlightEnabledOption = false,
  onChange,
  onConfirmedModeClick,
}: TelemetryModeToggleProps) {
  const { t } = useTranslation();
  const selectedMode = undecided || mode === "none" || mode === "initialized" ? null : mode;

  return (
    <div
      className={`telemetry-mode-toggle${compact ? " telemetry-mode-toggle-compact" : ""}`.trim()}
    >
      {selectedMode ? (
        <SlidingTogglePill
          activeKey={selectedMode}
          className={`nav-active-pill telemetry-mode-pill telemetry-mode-${selectedMode}`}
        />
      ) : null}
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = selectedMode === option.mode;
        const isPending = pendingMode === option.mode;
        const label = t(option.labelKey);
        return (
          <button
            key={option.mode}
            type="button"
            data-toggle-key={option.mode}
            className={`telemetry-mode-button ${option.className}${isSelected ? " is-selected" : ""}${isPending ? " is-pending" : ""}${highlightEnabledOption && option.mode === "enabled" ? " is-update-attention" : ""}`.trim()}
            aria-label={label}
            aria-pressed={isSelected}
            data-tooltip-title={t(option.tooltipTitleKey)}
            data-tooltip-body={t(option.tooltipKey)}
            disabled={disabled}
            onClick={() => {
              if (isSelected) {
                onConfirmedModeClick?.(option.mode);
                return;
              }
              onChange(option.mode);
            }}
          >
            <span className="telemetry-mode-button-content">
              <Icon aria-hidden="true" className="nav-icon" />
              {!compact ? <span>{label}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
