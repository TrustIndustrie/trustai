import {
  getLegacyAdminToken,
  getShopifyClientId,
  getShopifyClientSecret,
  getShopifyStoreDomain,
} from "./config";

/**
 * Fournisseur d'access token Shopify — « Client Credentials Grant »
 * (parcours officiel pour une application Dev Dashboard installée sur une
 * boutique de la même organisation) :
 *
 *   POST https://{boutique}.myshopify.com/admin/oauth/access_token
 *   { grant_type: "client_credentials", client_id, client_secret }
 *   → { access_token, expires_in ≈ 86399 s (24 h) }
 *
 * Le token est conservé en mémoire du processus serveur jusqu'à son
 * expiration (marge de 5 minutes) puis renouvelé automatiquement. Dans
 * l'environnement serverless Vercel, le cache survit aux invocations
 * « chaudes » d'une même instance ; un démarrage à froid redemande
 * simplement un token — comportement correct et sans état partagé.
 *
 * Sécurité : le Client Secret ne quitte jamais le serveur, et ni le token
 * ni le secret ne sont écrits dans les logs ou les messages d'erreur.
 *
 * Fallback LEGACY : si SHOPIFY_ADMIN_ACCESS_TOKEN (token permanent shpat_
 * d'une ancienne app personnalisée) est défini SANS client_id/secret, il est
 * utilisé tel quel. Méthode dépréciée, documentée dans docs/SHOPIFY_SETUP.md.
 */

interface CachedToken {
  token: string;
  /** Timestamp (ms) après lequel le token doit être renouvelé. */
  refreshAfter: number;
}

const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

let cache: CachedToken | null = null;

/** Réservé aux tests : vide le cache mémoire. */
export function _clearTokenCache(): void {
  cache = null;
}

export class ShopifyConfigError extends Error {}

export async function getShopifyAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const domain = getShopifyStoreDomain();
  if (!domain) {
    throw new ShopifyConfigError(
      "Shopify non configuré : SHOPIFY_STORE_DOMAIN est absent.",
    );
  }

  const clientId = getShopifyClientId();
  const clientSecret = getShopifyClientSecret();

  if (!clientId || !clientSecret) {
    // Fallback legacy : token permanent d'une ancienne app personnalisée.
    const legacy = getLegacyAdminToken();
    if (legacy) return legacy;
    throw new ShopifyConfigError(
      "Shopify non configuré : renseignez SHOPIFY_CLIENT_ID et SHOPIFY_CLIENT_SECRET (ou, pour une ancienne app, SHOPIFY_ADMIN_ACCESS_TOKEN).",
    );
  }

  if (cache && Date.now() < cache.refreshAfter) {
    return cache.token;
  }

  const response = await fetchImpl(
    `https://${domain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    // Ne jamais inclure le corps de la réponse tel quel : il pourrait être
    // journalisé. On expose uniquement le statut HTTP.
    throw new ShopifyConfigError(
      `Échec de l'authentification Shopify (HTTP ${response.status}). Vérifiez SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET et que l'application est installée sur la boutique.`,
    );
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new ShopifyConfigError(
      "Réponse d'authentification Shopify invalide (access_token absent).",
    );
  }

  const lifetimeMs = Math.max(60, data.expires_in ?? 86399) * 1000;
  cache = {
    token: data.access_token,
    refreshAfter: Date.now() + lifetimeMs - EXPIRY_MARGIN_MS,
  };
  return data.access_token;
}
