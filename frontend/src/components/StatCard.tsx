type StatCardProps = {
  label: string;
  value: string;
  tone?: "default" | "teal" | "blue";
};

export function StatCard({ label, value, tone = "default" }: StatCardProps) {
  return (
    <article className={`media-card metric-card stat-card metric-card-${tone}`}>
      <p className="eyebrow">{label}</p>
      <h3>{value}</h3>
    </article>
  );
}
