/**
 * Helpers monétaires : tous les calculs passent par des centimes (entiers)
 * pour éviter les erreurs d'arrondi des nombres flottants
 * (ex. 0.1 + 0.2 !== 0.3).
 */

/** Convertit un montant en euros vers des centimes entiers. */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

/** Convertit des centimes entiers vers un montant en euros. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Additionne des montants en euros sans erreur de flottants. */
export function addAmounts(...amounts: number[]): number {
  return fromCents(amounts.reduce((sum, a) => sum + toCents(a), 0));
}

/** Soustraction a − b en passant par les centimes. */
export function subtractAmounts(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b));
}

/** Multiplication quantité × prix unitaire, arrondie au centime. */
export function multiplyAmount(quantity: number, unitPrice: number): number {
  return fromCents(Math.round(quantity * toCents(unitPrice)));
}

/** Comparaison d'égalité au centime près. */
export function amountsEqual(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

/** true si a > b au centime près. */
export function amountGreaterThan(a: number, b: number): boolean {
  return toCents(a) > toCents(b);
}
