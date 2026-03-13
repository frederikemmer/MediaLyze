import type { DistributionItem } from "./api";

function isDolbyVisionLabel(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase().startsWith("dolby vision");
}

export function formatHdrType(value: string | null | undefined, showDolbyVisionProfiles: boolean): string | null {
  if (!value) {
    return null;
  }
  if (!showDolbyVisionProfiles && isDolbyVisionLabel(value)) {
    return "Dolby Vision";
  }
  return value;
}

export function collapseHdrDistribution(
  items: DistributionItem[],
  showDolbyVisionProfiles: boolean,
): DistributionItem[] {
  if (showDolbyVisionProfiles) {
    return items;
  }

  const counts = new Map<string, number>();
  for (const item of items) {
    const label = formatHdrType(item.label, false) ?? item.label;
    counts.set(label, (counts.get(label) ?? 0) + item.value);
  }

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}
