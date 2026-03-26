import type { ResolutionCategory } from "./api";

export const DEFAULT_RESOLUTION_CATEGORIES: ResolutionCategory[] = [
  { id: "8k", label: "8k", min_width: 7296, min_height: 3040 },
  { id: "4k", label: "4k", min_width: 3648, min_height: 1520 },
  { id: "1080p", label: "1080p", min_width: 1824, min_height: 760 },
  { id: "720p", label: "720p", min_width: 1216, min_height: 506 },
  { id: "sd", label: "sd", min_width: 0, min_height: 0 },
];

export function sortResolutionCategories(categories: ResolutionCategory[]): ResolutionCategory[] {
  return [...categories].sort(
    (left, right) =>
      (right.min_width * right.min_height) - (left.min_width * left.min_height) ||
      right.min_height - left.min_height ||
      right.min_width - left.min_width ||
      left.id.localeCompare(right.id),
  );
}

export function normalizeResolutionCategories(categories: ResolutionCategory[] | null | undefined): ResolutionCategory[] {
  if (!categories || categories.length === 0) {
    return DEFAULT_RESOLUTION_CATEGORIES.map((category) => ({ ...category }));
  }
  return sortResolutionCategories(
    categories.map((category) => ({
      ...category,
      label: category.label.trim() || category.id,
      min_width: Math.max(0, Number(category.min_width) || 0),
      min_height: Math.max(0, Number(category.min_height) || 0),
    })),
  );
}

export function resolutionCategoryChangeSummary(
  previousCategories: ResolutionCategory[],
  nextCategories: ResolutionCategory[],
): "none" | "labels" | "logic" {
  const previousById = new Map(previousCategories.map((category) => [category.id, category]));
  const nextById = new Map(nextCategories.map((category) => [category.id, category]));
  const previousIds = previousCategories.map((category) => category.id);
  const nextIds = nextCategories.map((category) => category.id);

  if (previousIds.length !== nextIds.length || previousIds.some((id, index) => nextIds[index] !== id)) {
    return "logic";
  }

  let labelsChanged = false;
  for (const [id, previousCategory] of previousById) {
    const nextCategory = nextById.get(id);
    if (!nextCategory) {
      return "logic";
    }
    if (
      previousCategory.min_width !== nextCategory.min_width ||
      previousCategory.min_height !== nextCategory.min_height
    ) {
      return "logic";
    }
    if (previousCategory.label !== nextCategory.label) {
      labelsChanged = true;
    }
  }

  return labelsChanged ? "labels" : "none";
}
