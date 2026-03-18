import type { CSSProperties } from "react";
import type { DistributionItem } from "../lib/api";

export type DistributionListEntry = DistributionItem & {
  key?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onClick?: () => void;
};

type DistributionListProps = {
  items: DistributionListEntry[];
  maxVisibleRows?: number;
  scrollable?: boolean;
};

export function DistributionList({
  items,
  maxVisibleRows = 0,
  scrollable = false,
}: DistributionListProps) {
  const max = Math.max(...items.map((item) => item.value), 1);
  const style =
    maxVisibleRows > 0
      ? ({ ["--visible-rows" as string]: maxVisibleRows } as CSSProperties)
      : undefined;

  return (
    <div
      className={`stack distribution-list ${scrollable ? "distribution-list-scroll" : ""}`.trim()}
      style={style}
    >
      {items.length === 0 ? <div className="notice">No analyzed data yet.</div> : null}
      {items.map((item) => (
        <div className="distribution-row" key={item.key ?? item.label}>
          <div className="distribution-copy">
            <strong>{item.label}</strong>
            {item.onClick ? (
              <button
                type="button"
                className={`distribution-value-button${item.disabled ? " is-disabled" : ""}`}
                aria-label={item.ariaLabel}
                disabled={item.disabled}
                onClick={item.onClick}
              >
                {item.value}
              </button>
            ) : (
              <span>{item.value}</span>
            )}
          </div>
          <div className="progress">
            <span style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
