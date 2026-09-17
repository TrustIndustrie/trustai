import type { SupabaseClient } from "@supabase/supabase-js";
import { mapGraphQLProductNode, type MappedOrder, type MappedProduct } from "./mapping";
import { shopifyGraphQL } from "./admin-api";

/**
 * Écritures Shopify → Supabase (clé serveur), partagées entre la route
 * webhook et la synchronisation manuelle du catalogue. Tous les upserts
 * sont idempotents (identifiants Shopify uniques) : rejouer un événement
 * ne crée jamais de doublon, et le suivi d'approvisionnement saisi par
 * l'équipe n'est jamais écrasé.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function getOrganizationId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("organizations").select("id").limit(1).single();
  return (data as { id: string } | null)?.id ?? null;
}

export async function upsertOrder(
  supabase: SupabaseClient,
  organizationId: string,
  mapped: MappedOrder,
): Promise<void> {
  // 1. Client : réutilisé s'il est déjà connu via son identifiant Shopify.
  let customerId: string | null = null;
  if (mapped.customer.shopify_customer_id) {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("shopify_customer_id", mapped.customer.shopify_customer_id)
      .maybeSingle();
    customerId = (existing as { id: string } | null)?.id ?? null;
  }
  if (customerId) {
    await supabase
      .from("customers")
      .update({
        name: mapped.customer.name,
        phone: mapped.customer.phone ?? null,
        email: mapped.customer.email ?? null,
        address: mapped.customer.address ?? null,
        postal_code: mapped.customer.postal_code ?? null,
        city: mapped.customer.city ?? null,
      })
      .eq("id", customerId);
  } else {
    const { data: created, error } = await supabase
      .from("customers")
      .insert({
        organization_id: organizationId,
        shopify_customer_id: mapped.customer.shopify_customer_id ?? null,
        name: mapped.customer.name,
        phone: mapped.customer.phone ?? null,
        email: mapped.customer.email ?? null,
        address: mapped.customer.address ?? null,
        postal_code: mapped.customer.postal_code ?? null,
        city: mapped.customer.city ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(`customers: ${error.message}`);
    customerId = (created as { id: string }).id;
  }

  // 2. Commande : upsert par identifiant Shopify (idempotent).
  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("shopify_order_id", mapped.order.shopify_order_id)
    .maybeSingle();

  let orderId: string;
  if (existingOrder) {
    orderId = (existingOrder as { id: string }).id;
    const { error } = await supabase
      .from("orders")
      .update({
        delivery_fee_cents: mapped.order.delivery_fee_cents,
        discount_cents: mapped.order.discount_cents,
        notes: mapped.order.notes ?? null,
        shopify_updated_at: mapped.order.shopify_updated_at ?? null,
      })
      .eq("id", orderId);
    if (error) throw new Error(`orders: ${error.message}`);
  } else {
    const { data: created, error } = await supabase
      .from("orders")
      .insert({
        organization_id: organizationId,
        reference: mapped.order.reference,
        origin: "SHOPIFY",
        customer_id: customerId,
        ordered_at: mapped.order.ordered_at,
        fulfillment_mode: mapped.order.fulfillment_mode,
        delivery_status: "a_planifier",
        delivery_fee_cents: mapped.order.delivery_fee_cents,
        discount_cents: mapped.order.discount_cents,
        acquisition_source: mapped.order.acquisition_source ?? null,
        notes: mapped.order.notes ?? null,
        shopify_order_id: mapped.order.shopify_order_id,
        shopify_order_number: mapped.order.shopify_order_number,
        shopify_updated_at: mapped.order.shopify_updated_at ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(`orders: ${error.message}`);
    orderId = (created as { id: string }).id;
  }

  // 3. Lignes : upsert par shopify_line_id. Les champs de suivi
  //    d'approvisionnement (statut, fournisseur, dépôt) ne sont PAS touchés.
  for (const line of mapped.lines) {
    // Rattachement au catalogue si la variante Shopify est déjà connue.
    let productId: string | null = null;
    let variantId: string | null = null;
    if (line.shopify_variant_id) {
      const { data: variant } = await supabase
        .from("product_variants")
        .select("id, product_id")
        .eq("shopify_variant_id", line.shopify_variant_id)
        .maybeSingle();
      if (variant) {
        variantId = (variant as { id: string }).id;
        productId = (variant as { product_id: string }).product_id;
      }
    }
    const { data: existingLine } = await supabase
      .from("order_lines")
      .select("id")
      .eq("shopify_line_id", line.shopify_line_id)
      .maybeSingle();
    if (existingLine) {
      const { error } = await supabase
        .from("order_lines")
        .update({
          product_name: line.product_name,
          variant_label: line.variant_label ?? null,
          reference: line.reference ?? null,
          quantity: line.quantity,
          unit_price_cents: line.unit_price_cents,
          discount_cents: line.discount_cents,
        })
        .eq("id", (existingLine as { id: string }).id);
      if (error) throw new Error(`order_lines: ${error.message}`);
    } else {
      const { error } = await supabase.from("order_lines").insert({
        organization_id: organizationId,
        order_id: orderId,
        shopify_line_id: line.shopify_line_id,
        product_id: productId,
        variant_id: variantId,
        product_name: line.product_name,
        variant_label: line.variant_label ?? null,
        reference: line.reference ?? null,
        quantity: line.quantity,
        unit_price_cents: line.unit_price_cents,
        discount_cents: line.discount_cents,
        procurement_status: "a_verifier",
      });
      if (error) throw new Error(`order_lines: ${error.message}`);
    }
  }

  // 4. Annulation côté Shopify : la commande passe « Annulée » (l'historique
  //    financier et le total restent intacts, règle V1.2). Le suivi déjà
  //    saisi par l'équipe n'est pas modifié au-delà du statut d'annulation.
  if (mapped.cancelled) {
    const { data: current } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .single();
    if ((current as { status: string } | null)?.status !== "annulee") {
      await supabase
        .from("orders")
        .update({ status: "annulee", delivery_status: "annulee" })
        .eq("id", orderId);
      await supabase
        .from("order_lines")
        .update({ procurement_status: "annule" })
        .eq("order_id", orderId);
      await supabase.from("activity_logs").insert({
        organization_id: organizationId,
        actor_label: "Webhook Shopify",
        action: "Commande annulée côté Shopify",
        details: `${mapped.order.reference} — annulation reçue de Shopify.`,
        order_id: orderId,
      });
    }
  }

  // 5. Encaissement en ligne : UNE ligne de règlement « shopify » par
  //    commande, miroir du NET encaissé selon Shopify (idempotent). Aucune
  //    opération financière n'est inventée : si Shopify indique un
  //    remboursement total (net = 0), le miroir est retiré et l'événement
  //    est journalisé — jamais de faux règlement négatif.
  const { data: existingPayment } = await supabase
    .from("payments")
    .select("id, amount_cents")
    .eq("order_id", orderId)
    .eq("method", "shopify")
    .maybeSingle();
  if (mapped.paidCents > 0) {
    if (existingPayment) {
      if ((existingPayment as { amount_cents: number }).amount_cents !== mapped.paidCents) {
        await supabase
          .from("payments")
          .update({ amount_cents: mapped.paidCents })
          .eq("id", (existingPayment as { id: string }).id);
      }
    } else {
      const { error } = await supabase.from("payments").insert({
        organization_id: organizationId,
        order_id: orderId,
        amount_cents: mapped.paidCents,
        date: mapped.order.ordered_at,
        method: "shopify",
        comment: "Paiement Shopify en ligne (webhook).",
      });
      if (error) throw new Error(`payments: ${error.message}`);
    }
  } else if (existingPayment) {
    await supabase
      .from("payments")
      .delete()
      .eq("id", (existingPayment as { id: string }).id);
    await supabase.from("activity_logs").insert({
      organization_id: organizationId,
      actor_label: "Webhook Shopify",
      action: "Remboursement Shopify",
      details: `${mapped.order.reference} — Shopify indique un remboursement : l'encaissement en ligne a été retiré du suivi.`,
      order_id: orderId,
    });
  }

  // 6. Parcours d'acquisition (source MESURÉE) — unique par commande.
  if (mapped.journey.landing_page || mapped.journey.source) {
    await supabase.from("acquisition_journeys").upsert(
      {
        organization_id: organizationId,
        order_id: orderId,
        source: mapped.journey.source ?? "autre",
        landing_page: mapped.journey.landing_page ?? null,
        utm_source: mapped.journey.utmSource ?? null,
        utm_medium: mapped.journey.utmMedium ?? null,
        utm_campaign: mapped.journey.utmCampaign ?? null,
        utm_content: mapped.journey.utmContent ?? null,
        utm_term: mapped.journey.utmTerm ?? null,
      },
      { onConflict: "order_id" },
    );
  }

  // 7. Historique.
  await supabase.from("activity_logs").insert({
    organization_id: organizationId,
    actor_label: "Webhook Shopify",
    action: existingOrder ? "Commande Shopify mise à jour" : "Commande Shopify reçue",
    details: `${mapped.order.reference} — ${mapped.lines.length} article(s).`,
    order_id: orderId,
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/**
 * Upsert GROUPÉ de produits Shopify + variantes : une requête pour tous les
 * produits, puis une par lot de 500 variantes — au lieu de deux requêtes par
 * variante (qui dépassaient le temps maximal d'exécution serveur sur un vrai
 * catalogue). Repose sur les contraintes uniques de la migration 7
 * (organization_id + shopify_product_id ; shopify_variant_id).
 */
export async function upsertProductsBulk(
  supabase: SupabaseClient,
  organizationId: string,
  mappedList: MappedProduct[],
): Promise<{ products: number; variants: number }> {
  if (mappedList.length === 0) return { products: 0, variants: 0 };
  const now = new Date().toISOString();

  // ON CONFLICT ne peut pas toucher deux fois la même ligne dans un même
  // ordre : dédoublonnage par identifiant Shopify (le dernier vu gagne).
  const productById = new Map<string, MappedProduct>();
  for (const mapped of mappedList) productById.set(mapped.product.shopify_product_id, mapped);
  const uniqueProducts = Array.from(productById.values());

  const { data, error } = await supabase
    .from("products")
    .upsert(
      uniqueProducts.map((mapped) => ({
        organization_id: organizationId,
        title: mapped.product.title,
        short_description: mapped.product.short_description ?? null,
        category: mapped.product.category,
        source: "shopify",
        shopify_product_id: mapped.product.shopify_product_id,
        shopify_handle: mapped.product.shopify_handle ?? null,
        image_url: mapped.product.image_url ?? null,
        active: mapped.product.active,
        shopify_updated_at: mapped.product.shopify_updated_at ?? null,
        last_synced_at: now,
      })),
      { onConflict: "organization_id,shopify_product_id" },
    )
    .select("id, shopify_product_id");
  if (error) throw new Error(`products: ${error.message}`);

  const idByShopifyId = new Map<string, string>(
    ((data ?? []) as { id: string; shopify_product_id: string }[]).map((row) => [
      row.shopify_product_id,
      row.id,
    ]),
  );

  const variantById = new Map<string, Record<string, unknown>>();
  for (const mapped of uniqueProducts) {
    const productId = idByShopifyId.get(mapped.product.shopify_product_id);
    if (!productId) throw new Error(`products: identifiant absent après upsert (${mapped.product.shopify_product_id})`);
    for (const variant of mapped.variants) {
      variantById.set(variant.shopify_variant_id, {
        product_id: productId,
        shopify_variant_id: variant.shopify_variant_id,
        name: variant.name,
        sku: variant.sku,
        barcode: variant.barcode ?? null,
        color: variant.color ?? null,
        dimensions: variant.dimensions ?? null,
        price_cents: variant.price_cents,
        shopify_updated_at: mapped.product.shopify_updated_at ?? null,
      });
    }
  }
  let variants = 0;
  for (const rows of chunk(Array.from(variantById.values()), 500)) {
    const { error: variantError } = await supabase
      .from("product_variants")
      .upsert(rows, { onConflict: "shopify_variant_id" });
    if (variantError) throw new Error(`product_variants: ${variantError.message}`);
    variants += rows.length;
  }

  return { products: uniqueProducts.length, variants };
}

/** Upsert d'UN produit (webhooks products/create | products/update). */
export async function upsertProduct(
  supabase: SupabaseClient,
  organizationId: string,
  mapped: MappedProduct,
): Promise<void> {
  await upsertProductsBulk(supabase, organizationId, [mapped]);
}

// ---------------------------------------------------------------------------
// Synchronisation complète du catalogue (API Admin GraphQL)
// ---------------------------------------------------------------------------

const PRODUCTS_QUERY = `
  query TrustAiProducts($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          description
          productType
          handle
          status
          updatedAt
          featuredImage { url }
          variants(first: 100) {
            edges {
              node { id title sku barcode price selectedOptions { name value } }
            }
          }
        }
      }
    }
  }
`;

const MAX_SYNC_PAGES = 100; // garde-fou : 10 000 produits par exécution

export interface CatalogueSyncResult {
  products: number;
  variants: number;
  deactivated: number;
}

export interface CatalogueSyncPage extends CatalogueSyncResult {
  /** Curseur de la page suivante — null quand tout le catalogue est parcouru. */
  nextCursor: string | null;
  /** Horodatage du DÉBUT du parcours, à repasser à chaque page. */
  startedAt: string;
}

/**
 * Récupère TOUTES les pages de produits (pagination par curseur) et les
 * mappe — séparé de l'écriture pour être testé avec un fetch simulé.
 */
export async function fetchAllProductNodes(
  fetchImpl: typeof fetch = fetch,
): Promise<MappedProduct[]> {
  const result: MappedProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_SYNC_PAGES; page++) {
    const data: any = await shopifyGraphQL(PRODUCTS_QUERY, { cursor }, fetchImpl);
    const connection = data.products;
    for (const edge of connection?.edges ?? []) {
      result.push(mapGraphQLProductNode(edge.node));
    }
    if (!connection?.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return result;
}

/**
 * Synchronise UNE page du catalogue Shopify (100 produits max) : la requête
 * serveur reste courte quel que soit le volume — le navigateur enchaîne les
 * pages tant que `nextCursor` n'est pas null. Idempotent : les produits
 * existants sont mis à jour, jamais dupliqués, et les données métier
 * internes (associations fournisseurs, produits manuels) ne sont pas
 * touchées.
 *
 * En FIN de parcours (dernière page), les produits Shopify connus en base
 * mais non revus pendant ce parcours (supprimés de la boutique) sont
 * DÉSACTIVÉS — jamais effacés. Le repère est `last_synced_at < startedAt`,
 * d'où l'horodatage de début repassé de page en page.
 */
export async function syncProductsPage(
  supabase: SupabaseClient,
  organizationId: string,
  options: { cursor?: string | null; startedAt?: string | null } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogueSyncPage> {
  const startedAt = options.startedAt ?? new Date().toISOString();
  const data: any = await shopifyGraphQL(
    PRODUCTS_QUERY,
    { cursor: options.cursor ?? null },
    fetchImpl,
  );
  const connection = data.products;
  const mapped: MappedProduct[] = (connection?.edges ?? []).map((edge: any) =>
    mapGraphQLProductNode(edge.node),
  );
  const counts = await upsertProductsBulk(supabase, organizationId, mapped);
  const nextCursor: string | null = connection?.pageInfo?.hasNextPage
    ? (connection.pageInfo.endCursor as string)
    : null;

  let deactivated = 0;
  if (!nextCursor) {
    const { data: rows, error } = await supabase
      .from("products")
      .update({ active: false })
      .eq("organization_id", organizationId)
      .eq("source", "shopify")
      .eq("active", true)
      .or(`last_synced_at.is.null,last_synced_at.lt.${startedAt}`)
      .select("id");
    if (error) throw new Error(`products: ${error.message}`);
    deactivated = ((rows ?? []) as { id: string }[]).length;
  }

  return { ...counts, nextCursor, startedAt, deactivated };
}

/** Parcours complet (toutes les pages) — utilisé par les tests. */
export async function syncAllProducts(
  supabase: SupabaseClient,
  organizationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogueSyncResult> {
  let products = 0;
  let variants = 0;
  let deactivated = 0;
  let cursor: string | null = null;
  let startedAt: string | null = null;
  for (let page = 0; page < MAX_SYNC_PAGES; page++) {
    const result: CatalogueSyncPage = await syncProductsPage(
      supabase,
      organizationId,
      { cursor, startedAt },
      fetchImpl,
    );
    products += result.products;
    variants += result.variants;
    deactivated = result.deactivated;
    startedAt = result.startedAt;
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return { products, variants, deactivated };
}
