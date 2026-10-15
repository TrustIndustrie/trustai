export function LoadingState({ label = "Chargement des données…" }: { label?: string }) {
  return (
    <div
      className="card flex items-center justify-center gap-3 px-6 py-16 text-sm"
      style={{ color: "var(--muted)" }}
      role="status"
      aria-live="polite"
    >
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden
      />
      {label}
    </div>
  );
}
