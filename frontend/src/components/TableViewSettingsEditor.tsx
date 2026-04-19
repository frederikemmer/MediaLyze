import { GripVertical } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getOrderedLibraryStatisticDefinitions,
  updateLibraryStatisticVisibility,
  moveLibraryStatistic,
  type LibraryStatisticId,
  type LibraryStatisticsSettings,
} from "../lib/library-statistics-settings";

type TableViewSettingsEditorProps = {
  settings: LibraryStatisticsSettings;
  onChange: (settings: LibraryStatisticsSettings) => void;
};

export function TableViewSettingsEditor({ settings, onChange }: TableViewSettingsEditorProps) {
  const { t } = useTranslation();
  const [draggedStatisticId, setDraggedStatisticId] = useState<LibraryStatisticId | null>(null);
  const [dropTargetStatisticId, setDropTargetStatisticId] = useState<LibraryStatisticId | null>(null);
  const orderedStatistics = getOrderedLibraryStatisticDefinitions(settings);

  function toggleStatisticVisibility(
    statisticId: LibraryStatisticId,
    area: "tableEnabled" | "tableTooltipEnabled",
  ) {
    onChange(
      updateLibraryStatisticVisibility(settings, statisticId, {
        [area]: !settings.visibility[statisticId][area],
      }),
    );
  }

  function handleStatisticDrop(targetId: LibraryStatisticId) {
    if (!draggedStatisticId) {
      return;
    }

    onChange(moveLibraryStatistic(settings, draggedStatisticId, targetId));
    setDraggedStatisticId(null);
    setDropTargetStatisticId(null);
  }

  return (
    <div className="settings-table-shell">
      <table className="settings-data-table library-statistics-table">
        <thead>
          <tr>
            <th scope="col">{t("libraryStatistics.name")}</th>
            <th scope="col">{t("libraryStatistics.table")}</th>
            <th scope="col">{t("libraryStatistics.tooltips")}</th>
          </tr>
        </thead>
        <tbody>
          {orderedStatistics
            .filter((statistic) => statistic.supportsTable || statistic.supportsTableTooltip)
            .map((statistic) => {
              const visibility = settings.visibility[statistic.id];
              return (
                <tr
                  key={statistic.id}
                  className={dropTargetStatisticId === statistic.id ? "is-drop-target" : undefined}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (draggedStatisticId && draggedStatisticId !== statistic.id) {
                      setDropTargetStatisticId(statistic.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleStatisticDrop(statistic.id);
                  }}
                >
                  <td>
                    <div className="statistic-name-cell">
                      <span
                        className={`statistics-drag-handle${draggedStatisticId === statistic.id ? " is-dragging" : ""}`}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", statistic.id);
                          setDraggedStatisticId(statistic.id);
                          setDropTargetStatisticId(statistic.id);
                        }}
                        onDragEnd={() => {
                          setDraggedStatisticId(null);
                          setDropTargetStatisticId(null);
                        }}
                        aria-hidden="true"
                      >
                        <GripVertical className="nav-icon" />
                      </span>
                      <span>{t(statistic.nameKey)}</span>
                    </div>
                  </td>
                  <td className="settings-checkbox-cell">
                    <input
                      type="checkbox"
                      checked={visibility.tableEnabled}
                      disabled={!statistic.supportsTable}
                      onChange={() => toggleStatisticVisibility(statistic.id, "tableEnabled")}
                    />
                  </td>
                  <td className="settings-checkbox-cell">
                    <input
                      type="checkbox"
                      checked={visibility.tableTooltipEnabled}
                      disabled={!statistic.supportsTableTooltip || !visibility.tableEnabled}
                      onChange={() => toggleStatisticVisibility(statistic.id, "tableTooltipEnabled")}
                    />
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
