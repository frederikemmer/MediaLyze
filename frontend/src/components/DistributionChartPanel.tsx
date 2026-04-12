import { lazy, Suspense, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Hash, Percent } from "lucide-react";
import { motion } from "motion/react";

import type { NumericDistribution, NumericDistributionBin, NumericDistributionMetricId } from "../lib/api";
import { type NumericDistributionDisplayMode } from "../lib/numeric-distributions";
import { AsyncPanel } from "./AsyncPanel";

const LazyDistributionChart = lazy(async () => {
  const module = await import("./DistributionChart");
  return { default: module.DistributionChart };
});

type DistributionChartPanelProps = {
  title: string;
  distribution: NumericDistribution | null;
  metricId: NumericDistributionMetricId;
  loading?: boolean;
  error?: string | null;
  interactive?: boolean;
  onSelectBin?: (bin: NumericDistributionBin) => void;
};

export function DistributionChartPanel({
  title,
  distribution,
  metricId,
  loading = false,
  error = null,
  interactive = false,
  onSelectBin,
}: DistributionChartPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<NumericDistributionDisplayMode>("count");
  const toggleId = useId();

  return (
    <AsyncPanel
      title={title}
      loading={loading}
      error={error}
      bodyClassName="async-panel-body-scroll"
      headerAddon={
        distribution && distribution.total > 0 ? (
          <div className="distribution-chart-header-addon">
            <div
              className="distribution-chart-mode-toggle"
              role="group"
              aria-label={t("distributionChart.displayMode")}
            >
              <button
                type="button"
                className={`distribution-chart-mode-button${mode === "count" ? " active" : ""}`}
                onClick={() => setMode("count")}
                aria-label={t("distributionChart.countMode")}
                title={t("distributionChart.countMode")}
              >
                {mode === "count" ? (
                  <motion.span
                    layoutId={`distribution-chart-mode-pill-${toggleId}`}
                    className="nav-active-pill distribution-chart-mode-pill"
                  />
                ) : null}
                <span className="distribution-chart-mode-button-content">
                  <Hash aria-hidden="true" className="distribution-chart-mode-icon" />
                </span>
              </button>
              <button
                type="button"
                className={`distribution-chart-mode-button${mode === "percentage" ? " active" : ""}`}
                onClick={() => setMode("percentage")}
                aria-label={t("distributionChart.percentMode")}
                title={t("distributionChart.percentMode")}
              >
                {mode === "percentage" ? (
                  <motion.span
                    layoutId={`distribution-chart-mode-pill-${toggleId}`}
                    className="nav-active-pill distribution-chart-mode-pill"
                  />
                ) : null}
                <span className="distribution-chart-mode-button-content">
                  <Percent aria-hidden="true" className="distribution-chart-mode-icon" />
                </span>
              </button>
            </div>
          </div>
        ) : null
      }
    >
      {!distribution || distribution.total <= 0 ? (
        <div className="notice">{t("distributionChart.empty")}</div>
      ) : (
        <div className="stack">
          <span className="distribution-chart-total">
            {t("distributionChart.total", {
              total: distribution.total,
              metric: t(`distributionChart.metrics.${metricId}`),
            })}
          </span>
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
      )}
    </AsyncPanel>
  );
}
