/** Compact table score: only the numerator carries the quality color. */
export function TableQualityScore({ score, emptyLabel = "n/a" }: { score: number | null; emptyLabel?: string }) {
  if (score === null) return <strong>{emptyLabel}</strong>;
  const value = Math.round(score * 10) / 10;
  const tier = score <= 3 ? "low" : score <= 6 ? "medium" : "high";
  return (
    <div className="score-cell">
      <strong><span className={`table-quality-score-value table-quality-score-${tier}`}>{value}</span>/10</strong>
    </div>
  );
}
