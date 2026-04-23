import type { DistributionItem } from "./api";

export type HdrDisplayOptions = {
  inDepthDolbyVisionProfiles?: boolean;
};

function isDolbyVisionLabel(value: string): boolean {
  return /\b(dolby vision|dovi|dvhe|dvh1)\b/i.test(value);
}

export function formatHdrType(
  value: string | null | undefined,
  options?: HdrDisplayOptions,
): string | null {
  if (!value) {
    return null;
  }
  if (!options?.inDepthDolbyVisionProfiles && isDolbyVisionLabel(value)) {
    return "Dolby Vision";
  }
  return value;
}

export function collapseHdrDistribution(
  items: DistributionItem[],
  options?: HdrDisplayOptions,
): DistributionItem[] {
  if (options?.inDepthDolbyVisionProfiles) {
    return items;
  }

  const collapsed = new Map<string, DistributionItem>();
  for (const item of items) {
    const label = formatHdrType(item.label, options) ?? item.label;
    const key = label.toLowerCase();
    const current = collapsed.get(key);
    if (current) {
      current.value += item.value;
      continue;
    }
    collapsed.set(key, {
      ...item,
      label,
      filter_value: label === "Dolby Vision" ? "dv" : item.filter_value,
    });
  }
  return [...collapsed.values()];
}
