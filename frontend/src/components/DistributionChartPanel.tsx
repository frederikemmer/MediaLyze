import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";

import type { NumericDistribution, NumericDistributionBin, NumericDistributionMetricId } from "../lib/api";
import { type NumericDistributionDisplayMode } from "../lib/numeric-distributions";

const LazyDistributionChart = lazy(async () => {
  const module = await import("./DistributionChart");
  return { default: module.DistributionChart };
});

type DistributionChartPanelProps = {
  distribution: NumericDistribution | null;
  metricId: NumericDistributionMetricId;
  interactive?: boolean;
  onSelectBin?: (bin: NumericDistributionBin) => void;
};

export function DistributionChartPanel({
  distribution,
  metricId,
  interactive = false,
  onSelectBin,
}: DistributionChartPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<NumericDistributionDisplayMode>("count");

  if (!distribution || distribution.total <= 0) {
    return <div className="notice">{t("distributionChart.empty")}</div>;
  }

  return (
    <div className="stack">
      <div className="distribution-chart-toolbar">
        <div className="tabs distribution-chart-mode-toggle" aria-label={t("distributionChart.displayMode")}>
          <button
            type="button"
            className={`tab-button${mode === "count" ? " active" : ""}`}
            onClick={() => setMode("count")}
          >
            {t("distributionChart.countMode")}
          </button>
          <button
            type="button"
            className={`tab-button${mode === "percentage" ? " active" : ""}`}
            onClick={() => setMode("percentage")}
          >
            {t("distributionChart.percentMode")}
          </button>
        </div>
        <span className="distribution-chart-total">
          {t("distributionChart.total", {
            total: distribution.total,
            metric: t(`distributionChart.metrics.${metricId}`),
          })}
        </span>
      </div>
      <Suspense fallback={<div className="notice">{t("distributionChart.loading")}</div>}>
        <LazyDistributionChart
          distribution={distribution}
          metricId={metricId}
          mode={mode}
          interactive={interactive}
          onSelectBin={onSelectBin}
        />
      </Suspense>
    </div>
  );
}
