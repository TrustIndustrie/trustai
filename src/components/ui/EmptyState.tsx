import { Inbox, type LucideIcon } from "lucide-react";

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Icon size={32} style={{ color: "var(--muted)" }} aria-hidden />
      <p className="text-sm font-semibold">{title}</p>
      {description ? (
        <p className="max-w-md text-sm" style={{ color: "var(--muted)" }}>
          {description}
        </p>
      ) : null}
      {action}
    </div>
  );
}
