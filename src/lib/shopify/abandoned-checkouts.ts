import { shopifyGraphQL, gidToId } from "./admin-api";
import { moneyStringToCents } from "./mapping";

/**
 * Lecture des PANIERS ABANDONNÉS dans l'API Admin Shopify.
 *
 * Shopify n'émet AUCUN événement « panier abandonné » : l'abandon est une
 * absence d'événement. Les sujets `checkouts/create` et `checkouts/update`
 * livreraient chaque étape de tunnel, en grand volume, et nous laisseraient
 * décider nous-mêmes du moment où un panier est abandonné. On lit donc
 * périodiquement la liste que Shopify tient déjà.
 *
 * Le champ décisif est `abandonedCheckoutUrl` : il ne peut PAS être
 * reconstruit. Sans lui, une relance renverrait le client vers un panier
 * vide, et la relance ne servirait à rien.
 *
 * Données personnelles : l'adresse, le téléphone et le nom du client sont des
 * « protected customer data » chez Shopify. Sans l'approbation
 * correspondante sur l'application, Shopify renvoie ces champs vides. Le code
 * ne s'en plaint pas et ne devine rien : le panier est alors enregistré sans
 * contact, donc non relançable, et reste visible dans l'interface.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Une ligne de panier, réduite à ce qui sert à une relance. */
export interface AbandonedLine {
  title: string;
  variant_title?: string;
  quantity: number;
  unit_price_cents: number;
}

/** Un panier abandonné, prêt pour `upsert_abandoned_checkouts`. */
export interface AbandonedCheckoutRow {
  shopify_checkout_id: string;
  checkout_token?: string;
  abandoned_at: string;
  created_at_shopify?: string;
  total_cents: number;
  currency?: string;
  item_count: number;
  line_items: AbandonedLine[];
  recovery_url?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_name?: string;
  /** null quand Shopify ne dit rien : l'inconnu n'est pas un accord. */
  marketing_consent: boolean | null;
}

export const ABANDONED_QUERY = `
  query PaniersAbandonnes($first: Int!, $after: String, $query: String) {
    abandonedCheckouts(first: $first, after: $after, query: $query,
                       sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          abandonedCheckoutUrl
          createdAt
          updatedAt
          totalPriceSet { shopMoney { amount currencyCode } }
          customer {
            displayName
            email
            phone
            emailMarketingConsent { marketingState }
          }
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                variantTitle
                discountedUnitPriceSet { shopMoney { amount } }
                originalUnitPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Consentement marketing d'après l'état renvoyé par Shopify. Seul
 * « SUBSCRIBED » vaut accord ; un état absent ou inconnu reste `null`, et un
 * refus explicite vaut `false`. Cette distinction compte : la base refuse de
 * relancer tout ce qui n'est pas un accord franc.
 */
export function consentFromState(state: unknown): boolean | null {
  if (typeof state !== "string" || state.trim() === "") return null;
  const value = state.trim().toUpperCase();
  if (value === "SUBSCRIBED") return true;
  if (value === "NOT_SUBSCRIBED" || value === "UNSUBSCRIBED" || value === "REDACTED") {
    return false;
  }
  return null;
}

/**
 * Jeton de tunnel extrait de l'adresse de récupération. Shopify n'expose pas
 * le `checkout_token` sur l'objet GraphQL, mais l'adresse de récupération le
 * contient : `.../checkouts/<jeton>/recover?key=…`. C'est ce jeton que porte
 * ensuite la commande, et donc la seule clé d'attribution disponible.
 */
export function tokenFromRecoveryUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const match = url.match(/\/checkouts\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : undefined;
}

function textOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Transforme un nœud GraphQL en ligne prête à écrire. Fonction pure. */
export function mapAbandonedCheckoutNode(node: any): AbandonedCheckoutRow {
  const lineEdges: any[] = node?.lineItems?.edges ?? [];
  const lines: AbandonedLine[] = lineEdges.map((edge) => {
    const item = edge?.node ?? {};
    const unit =
      item.discountedUnitPriceSet?.shopMoney?.amount ??
      item.originalUnitPriceSet?.shopMoney?.amount;
    return {
      title: textOrUndefined(item.title) ?? "Article Shopify",
      variant_title: textOrUndefined(item.variantTitle),
      quantity: Number(item.quantity ?? 0) || 0,
      unit_price_cents: moneyStringToCents(unit),
    };
  });

  const recoveryUrl = textOrUndefined(node?.abandonedCheckoutUrl);
  const money = node?.totalPriceSet?.shopMoney ?? {};

  return {
    shopify_checkout_id: gidToId(node?.id) ?? String(node?.id ?? ""),
    checkout_token: tokenFromRecoveryUrl(recoveryUrl),
    // `updatedAt` est la dernière activité du tunnel : c'est le moment
    // d'abandon le plus juste dont on dispose. `createdAt` reste à part.
    abandoned_at: textOrUndefined(node?.updatedAt) ?? textOrUndefined(node?.createdAt) ?? "",
    created_at_shopify: textOrUndefined(node?.createdAt),
    total_cents: moneyStringToCents(money.amount),
    currency: textOrUndefined(money.currencyCode),
    item_count: lines.reduce((sum, l) => sum + l.quantity, 0),
    line_items: lines,
    recovery_url: recoveryUrl,
    contact_email: textOrUndefined(node?.customer?.email),
    contact_phone: textOrUndefined(node?.customer?.phone),
    contact_name: textOrUndefined(node?.customer?.displayName),
    marketing_consent: consentFromState(
      node?.customer?.emailMarketingConsent?.marketingState,
    ),
  };
}

/** Garde-fou : jamais plus de pages que cela en une seule lecture. */
export const MAX_PAGES = 10;
export const PAGE_SIZE = 50;

export interface FetchAbandonedOptions {
  /** Ne lire que les paniers abandonnés depuis cette date (incluse). */
  since?: Date;
  fetchImpl?: typeof fetch;
}

/**
 * Lit tous les paniers abandonnés, page par page. Un panier sans date
 * d'abandon exploitable est écarté ici plutôt que refusé par la base : une
 * lecture ne doit pas échouer en bloc à cause d'un panier bancal.
 */
export async function fetchAbandonedCheckouts(
  options: FetchAbandonedOptions = {},
): Promise<{ rows: AbandonedCheckoutRow[]; pages: number; truncated: boolean }> {
  const rows: AbandonedCheckoutRow[] = [];
  let after: string | null = null;
  let pages = 0;
  let hasNext = true;

  const query = options.since
    ? `created_at:>='${options.since.toISOString().slice(0, 10)}'`
    : null;

  while (hasNext && pages < MAX_PAGES) {
    const data: any = await shopifyGraphQL(
      ABANDONED_QUERY,
      { first: PAGE_SIZE, after, query },
      options.fetchImpl ?? fetch,
    );
    pages += 1;
    const connection = data?.abandonedCheckouts ?? {};
    for (const edge of connection.edges ?? []) {
      const row = mapAbandonedCheckoutNode(edge?.node);
      if (!row.shopify_checkout_id || !row.abandoned_at) continue;
      rows.push(row);
    }
    hasNext = Boolean(connection.pageInfo?.hasNextPage);
    after = connection.pageInfo?.endCursor ?? null;
    if (!after) hasNext = false;
  }

  return { rows, pages, truncated: hasNext };
}
