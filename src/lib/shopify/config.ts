/**
 * Configuration Shopify (variables SERVEUR uniquement — aucun préfixe
 * NEXT_PUBLIC_, jamais envoyées au navigateur, jamais écrites en dur).
 *
 * Méthode principale (apps Dev Dashboard, parcours Shopify actuel) :
 *   SHOPIFY_STORE_DOMAIN + SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET
 *   → « Client Credentials Grant » : l'application obtient elle-même un
 *   access token de 24 h auprès de Shopify et le renouvelle automatiquement.
 *   Le même Client Secret sert à vérifier la signature HMAC des webhooks.
 *
 * Fallback LEGACY (anciennes applications personnalisées créées dans
 * l'admin de la boutique) — à n'utiliser que si l'app existe déjà :
 *   SHOPIFY_ADMIN_ACCESS_TOKEN (token permanent shpat_…)
 *   SHOPIFY_WEBHOOK_SECRET (clé de signature de la section Notifications)
 */

function normalizeDomain(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/**
 * Domaines de boutique autorisés. SHOPIFY_STORE_DOMAIN accepte PLUSIEURS
 * valeurs séparées par des virgules : une même boutique est en effet
 * joignable par son domaine canonique (`wn02qe-0w.myshopify.com`, celui que
 * Shopify met dans l'en-tête `X-Shopify-Shop-Domain` des webhooks) et par
 * son nom court d'administration (`ma-boutique.myshopify.com`, celui qu'on
 * lit dans l'URL de l'admin). Déclarer les deux évite de rejeter des
 * webhooks légitimes, tout en restant une liste blanche stricte : rien
 * n'est déduit du contenu du webhook.
 */
export function getAllowedShopDomains(): string[] {
  return (process.env.SHOPIFY_STORE_DOMAIN ?? "")
    .split(",")
    .map(normalizeDomain)
    .filter(Boolean);
}

/** Domaine utilisé pour APPELER l'API Admin (le premier déclaré). */
export function getShopifyStoreDomain(): string | undefined {
  return getAllowedShopDomains()[0];
}

export function getShopifyClientId(): string | undefined {
  return process.env.SHOPIFY_CLIENT_ID || undefined;
}

export function getShopifyClientSecret(): string | undefined {
  return process.env.SHOPIFY_CLIENT_SECRET || undefined;
}

/** Fallback legacy : token permanent d'une ancienne app personnalisée. */
export function getLegacyAdminToken(): string | undefined {
  return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || undefined;
}

/** Version d'API Admin (format YYYY-MM), configurable sans redéployer le code. */
export function getShopifyApiVersion(): string {
  const version = process.env.SHOPIFY_API_VERSION?.trim();
  return version && /^\d{4}-\d{2}$/.test(version) ? version : "2026-01";
}

/**
 * Secrets acceptés pour la signature HMAC des webhooks, par ordre de
 * priorité : Client Secret (méthode actuelle), puis l'ancienne clé de
 * signature « Notifications » (legacy, dépréciée).
 */
export function getWebhookSigningSecrets(): string[] {
  return [
    getShopifyClientSecret(),
    process.env.SHOPIFY_WEBHOOK_SECRET || undefined,
  ].filter((s): s is string => Boolean(s));
}

/** true si l'API Admin est utilisable (moderne OU legacy). */
export function isShopifyAdminConfigured(): boolean {
  const domain = getShopifyStoreDomain();
  if (!domain) return false;
  return Boolean(
    (getShopifyClientId() && getShopifyClientSecret()) || getLegacyAdminToken(),
  );
}

/** true si les webhooks peuvent être vérifiés. */
export function isShopifyWebhookConfigured(): boolean {
  return Boolean(getShopifyStoreDomain()) && getWebhookSigningSecrets().length > 0;
}
