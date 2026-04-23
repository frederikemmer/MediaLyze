import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  getStatisticPanelLayoutPanelNameKey,
  type StatisticPanelLayoutMigrationIssue,
  type StatisticPanelLayoutScope,
} from "../lib/statistic-panel-layout";

type StatisticPanelLayoutMigrationNoticeProps = {
  scope: StatisticPanelLayoutScope;
  issues: StatisticPanelLayoutMigrationIssue[];
};

function formatPanelName(
  scope: StatisticPanelLayoutScope,
  statisticId: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const nameKey = getStatisticPanelLayoutPanelNameKey(scope, statisticId);
  return nameKey ? t(nameKey) : statisticId;
}

function formatIssue(
  scope: StatisticPanelLayoutScope,
  issue: StatisticPanelLayoutMigrationIssue,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (issue.kind) {
    case "invalid_json":
      return t("panelLayout.migration.invalidJson");
    case "invalid_layout":
      return t("panelLayout.migration.invalidLayout");
    case "invalid_item":
      return t("panelLayout.migration.invalidItem", { position: issue.index + 1 });
    case "unsupported_panel":
      return t("panelLayout.migration.unsupportedPanel", {
        panel: issue.statisticId,
        position: issue.index + 1,
      });
    case "duplicate_panel":
      return t("panelLayout.migration.duplicatePanel", {
        panel: formatPanelName(scope, issue.statisticId, t),
      });
    case "duplicate_instance":
      return t("panelLayout.migration.duplicateInstance", {
        panel: formatPanelName(scope, issue.statisticId, t),
        instanceId: issue.instanceId,
      });
    case "resized_panel":
      return t("panelLayout.migration.resizedPanel", {
        panel: formatPanelName(scope, issue.statisticId, t),
        axis: t(`panelLayout.migration.axes.${issue.axis}`),
        requested: issue.requested,
        applied: issue.applied,
      });
    case "comparison_selection_adjusted":
      return t("panelLayout.migration.comparisonSelectionAdjusted", {
        instanceId: issue.instanceId,
        previousSelection: issue.previousSelection,
        appliedSelection: issue.appliedSelection,
      });
  }
}

export function StatisticPanelLayoutMigrationNotice({
  scope,
  issues,
}: StatisticPanelLayoutMigrationNoticeProps) {
  const { t } = useTranslation();

  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="notice statistic-layout-migration-notice" role="status" aria-live="polite">
      <div className="statistic-layout-migration-title">
        <AlertTriangle className="statistic-layout-migration-icon" aria-hidden="true" />
        <strong>{t("panelLayout.migration.title")}</strong>
      </div>
      <p>{t("panelLayout.migration.description")}</p>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.kind}-${index}`}>{formatIssue(scope, issue, t)}</li>
        ))}
      </ul>
    </div>
  );
}
