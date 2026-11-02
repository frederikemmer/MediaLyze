import type { LucideIcon } from "lucide-react";

import { TooltipTrigger } from "./TooltipTrigger";

export type SummaryMetricItem = {
  id: string;
  label: string;
  value: string;
  description: string;
  detail?: string;
  Icon: LucideIcon;
};

type SummaryMetricsProps = {
  items: SummaryMetricItem[];
  className?: string;
  loading?: boolean;
};

export function SummaryMetrics({ items, className, loading = false }: SummaryMetricsProps) {
  return (
    <div className={`summary-metrics${className ? ` ${className}` : ""}`} aria-busy={loading || undefined}>
      {items.map(({ id, label, value, description, detail, Icon }) => (
        <TooltipTrigger
          key={id}
          as="span"
          ariaLabel={`${label}: ${value}`}
          className={`summary-metric summary-metric-${id}`}
          content={(
            <span className="summary-metric-tooltip">
              <strong>{label}</strong>
              <span>{description}</span>
              {detail ? <span className="summary-metric-tooltip-detail">{detail}</span> : null}
            </span>
          )}
          pinOnClick={false}
        >
          <Icon className="summary-metric-icon" size={14} aria-hidden="true" />
          <span className="summary-metric-value">
            {loading ? (
              <span className="summary-metric-loading" aria-hidden="true">
                <span>.</span><span>.</span><span>.</span>
              </span>
            ) : value}
          </span>
        </TooltipTrigger>
      ))}
    </div>
  );
}
