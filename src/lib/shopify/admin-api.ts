import { getShopifyAccessToken, ShopifyConfigError } from "./auth";
import { getShopifyApiVersion, getShopifyStoreDomain } from "./config";

/**
 * Client GraphQL Admin Shopify (serveur uniquement).
 * Les endpoints REST produits étant dépréciés pour les nouvelles
 * applications, toutes les lectures passent par GraphQL.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function shopifyGraphQL<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const domain = getShopifyStoreDomain();
  if (!domain) {
    throw new ShopifyConfigError("SHOPIFY_STORE_DOMAIN est absent.");
  }
  const token = await getShopifyAccessToken(fetchImpl);
  const response = await fetchImpl(
    `https://${domain}/admin/api/${getShopifyApiVersion()}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`API Shopify GraphQL : HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new Error(`API Shopify GraphQL : ${body.errors.map((e) => e.message).join(" ; ")}`);
  }
  if (!body.data) {
    throw new Error("API Shopify GraphQL : réponse sans données.");
  }
  return body.data;
}

/** « gid://shopify/Product/8100001 » → « 8100001 » (aligné sur les webhooks). */
export function gidToId(gid: string | null | undefined): string | undefined {
  if (!gid) return undefined;
  const match = String(gid).match(/\/(\d+)$/);
  return match ? match[1] : String(gid);
}
