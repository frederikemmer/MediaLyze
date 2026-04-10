import type { DistributionItem } from "./api";

export function formatHdrType(value: string | null | undefined): string | null {
  return value || null;
}

export function collapseHdrDistribution(items: DistributionItem[]): DistributionItem[] {
  return items;
}
