import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AsyncPanel } from "./AsyncPanel";
import { PanelEmptyState } from "./PanelEmptyState";
import { TranscodePresetsRulesPanel } from "./TranscodePresetsRulesPanel";
import { TooltipTrigger } from "./TooltipTrigger";

type PresetSettingsTab = "presets" | "filename" | "folder";

type TranscodingPresetsSettingsPanelProps = {
  searchFocus?: string | null;
};

function tabFromSearchFocus(searchFocus: string | null | undefined): PresetSettingsTab | null {
  if (searchFocus === "transcoding-presets-tab-filename") return "filename";
  if (searchFocus === "transcoding-presets-tab-folder") return "folder";
  if (searchFocus === "transcoding-presets-tab-presets") return "presets";
  return null;
}

export function TranscodingPresetsSettingsPanel({ searchFocus = null }: TranscodingPresetsSettingsPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PresetSettingsTab>(() => tabFromSearchFocus(searchFocus) ?? "presets");

  useEffect(() => {
    const nextTab = tabFromSearchFocus(searchFocus);
    if (nextTab) setTab(nextTab);
  }, [searchFocus]);

  const tabs: Array<{ id: PresetSettingsTab; label: string; focus: string }> = [
    { id: "presets", label: t("transcoding.automation.tabs.presets"), focus: "transcoding-presets-tab-presets" },
    { id: "filename", label: t("transcoding.presetSettingsTabs.filename"), focus: "transcoding-presets-tab-filename" },
    { id: "folder", label: t("transcoding.presetSettingsTabs.folder"), focus: "transcoding-presets-tab-folder" },
  ];

  const renderPresetTabs = () => (
    <div className="transcode-automation-tab-list" role="tablist" aria-label={t("transcoding.presetSettingsTabs.ariaLabel")} aria-orientation="horizontal">
      {tabs.map((entry, index) => (
        <button
          key={entry.id}
          id={entry.focus}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          tabIndex={tab === entry.id ? 0 : -1}
          data-settings-search-target={entry.focus}
          className={`transcode-automation-tab-button${tab === entry.id ? " active" : ""}`}
          onClick={() => setTab(entry.id)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            const nextIndex = event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            const nextTab = tabs[nextIndex];
            setTab(nextTab.id);
            window.requestAnimationFrame(() => document.getElementById(nextTab.focus)?.focus());
          }}
        >
          <span className="transcode-automation-tab-label">{entry.label}</span>
        </button>
      ))}
    </div>
  );

  const renderPresetTabRow = () => (
    <div className="settings-profile-toggle-row transcode-automation-toggle-row">
      <div className="transcode-automation-tab-controls">{renderPresetTabs()}</div>
    </div>
  );

  return (
    <AsyncPanel
      title={t("transcoding.presetsSettingsTitle")}
      titleAddon={(
        <TooltipTrigger
          ariaLabel={t("transcoding.presetsSettingsDescriptionAria")}
          content={t("transcoding.presetsSettingsDescription")}
          preserveLineBreaks
        >
          ?
        </TooltipTrigger>
      )}
    >
      <div className="settings-sidebar-stack transcode-presets-settings-panel" data-settings-search-target="settings-panel-transcodingPresets">
        {tab === "presets" ? (
          <TranscodePresetsRulesPanel
            capabilityMatrix={() => null}
            acceleratorsTooltip={null}
            standaloneTab="presets"
            standalonePresetTabs={renderPresetTabs()}
            searchFocus={searchFocus}
          />
        ) : (
          <div className="compatibility-profile-list compatibility-profile-catalog-list transcode-preset-placeholder" data-settings-search-target={tabs.find((entry) => entry.id === tab)?.focus}>
            {renderPresetTabRow()}
            <div className="transcode-preset-placeholder-body">
              <PanelEmptyState
                message={tab === "filename" ? t("transcoding.presetSettingsTabs.filenameEmpty") : t("transcoding.presetSettingsTabs.folderEmpty")}
              />
            </div>
          </div>
        )}
      </div>
    </AsyncPanel>
  );
}
