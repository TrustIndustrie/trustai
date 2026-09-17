/**
 * Marque Trust Industrie — reproduction vectorielle du logo officiel
 * (rectangles noirs en escalier sur fond beige). Le tracé est dessiné en
 * `currentColor` pour hériter de la couleur du contexte ; le fond beige est
 * apporté par le conteneur (`TrustLogoTile`) pour rester fidèle à la marque.
 */
export function TrustLogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 1200 1200"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <rect x="190" y="192" width="588" height="173" />
      <rect x="605" y="365" width="173" height="232" />
      <rect x="778" y="420" width="230" height="177" />
      <rect x="832" y="597" width="176" height="408" />
      <rect x="190" y="447" width="345" height="216" />
      <rect x="190" y="663" width="565" height="342" />
    </svg>
  );
}

/** Pastille logo : fond beige de la marque + tracé noir, comme l'original. */
export function TrustLogoTile({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border"
      style={{
        width: size,
        height: size,
        background: "var(--logo-beige)",
        borderColor: "var(--border)",
        color: "#141414",
      }}
      aria-hidden
    >
      <TrustLogoMark size={Math.round(size * 0.62)} />
    </div>
  );
}
