import type { BadgeTone } from "@/lib/labels";

const toneStyles: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--surface-muted)", fg: "var(--muted)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)" },
  success: { bg: "var(--success-soft)", fg: "var(--success)" },
  warning: { bg: "var(--warning-soft)", fg: "var(--warning)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  violet: { bg: "var(--violet-soft)", fg: "var(--violet)" },
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
}) {
  const style = toneStyles[tone];
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: style.bg, color: style.fg }}
    >
      {children}
    </span>
  );
}
