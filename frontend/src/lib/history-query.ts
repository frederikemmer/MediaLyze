import type { HistoryQuery } from "./api";
import type { HistoryRangeSelection } from "../components/LibraryHistoryPanel";

export function historyQuery(metric: string, selection: HistoryRangeSelection): HistoryQuery {
  if (selection.mode === "custom" && selection.startDate) {
    const dates = [selection.startDate, selection.endDate ?? selection.startDate].sort();
    return { metric, start: dates[0], end: dates[1] };
  }
  const days = selection.mode === "7d" ? 7 : selection.mode === "30d" ? 30 : selection.mode === "1y" ? 365 : undefined;
  return { metric, days };
}
