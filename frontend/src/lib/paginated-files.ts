import type { MediaFileRow } from "./api";

export type FileLoadTransition = {
  clearExisting: boolean;
  showFullLoader: boolean;
  showInlineRefresh: boolean;
};

export function buildFilePageRequestKey(queryKey: string, offset: number) {
  return `${queryKey}:${offset}`;
}

export function mergeUniqueFiles(current: MediaFileRow[], next: MediaFileRow[]) {
  const seen = new Set<number>();
  const merged: MediaFileRow[] = [];

  for (const file of [...current, ...next]) {
    if (seen.has(file.id)) {
      continue;
    }
    seen.add(file.id);
    merged.push(file);
  }

  return merged;
}

export function resolveFileLoadTransition(options: {
  hasCachedFiles: boolean;
  currentFilesLength: number;
  isSameLibrary: boolean;
}): FileLoadTransition {
  const { hasCachedFiles, currentFilesLength, isSameLibrary } = options;

  if (hasCachedFiles) {
    return {
      clearExisting: false,
      showFullLoader: false,
      showInlineRefresh: false,
    };
  }

  if (!isSameLibrary) {
    return {
      clearExisting: true,
      showFullLoader: true,
      showInlineRefresh: false,
    };
  }

  if (currentFilesLength > 0) {
    return {
      clearExisting: false,
      showFullLoader: false,
      showInlineRefresh: true,
    };
  }

  return {
    clearExisting: false,
    showFullLoader: true,
    showInlineRefresh: false,
  };
}

export function shouldRequestNextPage(options: {
  hasMoreFiles: boolean;
  isFilesLoading: boolean;
  isLoadingMore: boolean;
}) {
  const { hasMoreFiles, isFilesLoading, isLoadingMore } = options;
  return hasMoreFiles && !isFilesLoading && !isLoadingMore;
}

export class InflightPageRequestGate {
  private activeRequestKey: string | null = null;

  begin(requestKey: string) {
    if (this.activeRequestKey === requestKey) {
      return false;
    }
    this.activeRequestKey = requestKey;
    return true;
  }

  end(requestKey: string) {
    if (this.activeRequestKey === requestKey) {
      this.activeRequestKey = null;
    }
  }

  reset() {
    this.activeRequestKey = null;
  }
}
