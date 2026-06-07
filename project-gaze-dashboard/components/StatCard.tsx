type Accent = "default" | "accent" | "peak";

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  accent?: Accent;
}

export default function StatCard({
  label,
  value,
  sub,
  accent = "default",
}: Props) {
  return (
    <div className={`card stat-card stat-${accent}`}>
      <div className="card-label">{label}</div>
      <div className="stat-value mono">{value}</div>
      {sub && <div className="stat-sub mono">{sub}</div>}
    </div>
  );
}
