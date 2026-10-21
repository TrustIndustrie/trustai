"use client";

/**
 * Onglets de vue réutilisables (À traiter / En cours / …) avec compteur
 * facultatif. Utilisés pour organiser les grandes listes.
 */
export function ViewTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="flex w-fit max-w-full flex-wrap rounded-md border p-0.5"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={value === tab.key}
          onClick={() => onChange(tab.key)}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition"
          style={
            value === tab.key
              ? { background: "var(--primary-soft)", color: "var(--primary-strong)" }
              : { color: "var(--muted)" }
          }
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span
              className="rounded-full px-1.5 text-xs font-semibold"
              style={{
                background: value === tab.key ? "var(--surface)" : "var(--surface-muted)",
              }}
            >
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
