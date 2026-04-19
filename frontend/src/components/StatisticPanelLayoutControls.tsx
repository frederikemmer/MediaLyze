import { Grid2x2Plus, History, Save, SaveOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { StatisticPanelLayoutId, StatisticPanelLayoutMenuDefinition } from "../lib/statistic-panel-layout";
import { LayoutPanelTopIcon } from "./LayoutPanelTopIcon";

type StatisticPanelLayoutControlsProps = {
  availableDefinitions: StatisticPanelLayoutMenuDefinition[];
  isEditing: boolean;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onRestoreDefault: () => void;
  onSaveEditing: () => void;
  onAddPanel: (statisticId: StatisticPanelLayoutId) => void;
};

export function StatisticPanelLayoutControls({
  availableDefinitions,
  isEditing,
  onStartEditing,
  onCancelEditing,
  onRestoreDefault,
  onSaveEditing,
  onAddPanel,
}: StatisticPanelLayoutControlsProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  if (!isEditing) {
    return (
      <div className="statistic-layout-controls">
        <button
          type="button"
          className="statistic-layout-action-button"
          aria-label={t("panelLayout.edit")}
          title={t("panelLayout.edit")}
          onClick={onStartEditing}
        >
          <LayoutPanelTopIcon className="statistic-layout-action-icon" size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="statistic-layout-controls is-editing" ref={menuRef}>
      <button
        type="button"
        className="statistic-layout-action-button"
        aria-label={t("panelLayout.add")}
        title={t("panelLayout.add")}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}
        disabled={availableDefinitions.length === 0}
      >
        <Grid2x2Plus className="nav-icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="statistic-layout-action-button"
        aria-label={t("panelLayout.restoreDefault")}
        title={t("panelLayout.restoreDefault")}
        onClick={() => {
          setMenuOpen(false);
          onRestoreDefault();
        }}
      >
        <History className="nav-icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="statistic-layout-action-button"
        aria-label={t("panelLayout.cancel")}
        title={t("panelLayout.cancel")}
        onClick={() => {
          setMenuOpen(false);
          onCancelEditing();
        }}
      >
        <SaveOff className="nav-icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="statistic-layout-action-button"
        aria-label={t("panelLayout.save")}
        title={t("panelLayout.save")}
        onClick={() => {
          setMenuOpen(false);
          onSaveEditing();
        }}
      >
        <Save className="nav-icon" aria-hidden="true" />
      </button>
      {menuOpen ? (
        <div className="statistic-layout-menu" role="menu">
          {availableDefinitions.length > 0 ? (
            availableDefinitions.map((definition) => (
              <button
                key={definition.id}
                type="button"
                role="menuitem"
                className="statistic-layout-menu-item"
                onClick={() => {
                  onAddPanel(definition.id);
                  setMenuOpen(false);
                }}
              >
                {t(definition.nameKey)}
              </button>
            ))
          ) : (
            <div className="statistic-layout-menu-empty">{t("panelLayout.noMorePanels")}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
