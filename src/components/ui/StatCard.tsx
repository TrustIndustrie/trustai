import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const accent =
    tone === "success"
      ? "var(--success)"
      : tone === "warning"
        ? "var(--warning)"
        : tone === "danger"
          ? "var(--danger)"
          : "var(--primary)";
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium" style={{ color: "var(--muted)" }}>
          {label}
        </p>
        {Icon ? <Icon size={18} style={{ color: accent }} aria-hidden /> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold" style={{ color: "var(--foreground)" }}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
