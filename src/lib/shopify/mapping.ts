import { createHmac, timingSafeEqual } from "node:crypto";
import type { AcquisitionSource, ProductCategory } from "../types";

/**
 * Mapping Shopify → TRUST AI (fonctions pures, testées par vitest).
 *
 * Ces fonctions transforment les payloads des webhooks Shopify
 * (orders/create, orders/updated, products/create, products/update) en
 * lignes prêtes à être écrites dans Supabase. Aucun appel réseau ici :
 * la route serveur s'occupe de la vérification HMAC + des écritures.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Payload = Record<string, any>;

// ---------------------------------------------------------------------------
// Sécurité : vérification de la signature HMAC des webhooks
// ---------------------------------------------------------------------------

/**
 * Vérifie l'en-tête X-Shopify-Hmac-Sha256 : HMAC-SHA256 du corps BRUT de la
 * requête (lu AVANT tout parsing JSON), encodé en base64, calculé avec le
 * Client Secret de l'application (les webhooks Shopify sont signés avec ce
 * secret ; l'ancienne clé « Notifications » est acceptée en repli legacy).
 * Comparaison en temps constant (timingSafeEqual).
 */
export function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string | null,
  secretOrSecrets: string | string[],
): boolean {
  const secrets = (Array.isArray(secretOrSecrets) ? secretOrSecrets : [secretOrSecrets])
    .filter(Boolean);
  if (!hmacHeader || secrets.length === 0) return false;
  let received: Buffer;
  try {
    received = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }
  // Chaque secret candidat est essayé (temps constant par comparaison).
  let valid = false;
  for (const secret of secrets) {
    const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
    if (received.length === digest.length && timingSafeEqual(digest, received)) {
      valid = true;
    }
  }
  return valid;
}

/**
 * Vérifie que le webhook provient bien de NOTRE boutique : l'en-tête
 * X-Shopify-Shop-Domain doit correspondre exactement à l'un des domaines
 * déclarés dans SHOPIFY_STORE_DOMAIN. Une boutique est joignable sous deux
 * formes (domaine canonique `wn02qe-0w.myshopify.com` et nom court
 * d'administration), d'où la liste — qui reste une liste BLANCHE explicite :
 * on ne fait jamais confiance aux données d'identité contenues dans le
 * payload lui-même.
 */
export function verifyShopDomain(
  headerDomain: string | null,
  expected: string | string[] | undefined,
): boolean {
  if (!headerDomain || !expected) return false;
  const allowed = (Array.isArray(expected) ? expected : [expected])
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(headerDomain.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Montants : Shopify envoie des chaînes ("1490.00") — conversion exacte en
// centimes sans passer par les flottants.
// ---------------------------------------------------------------------------

export function moneyStringToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const str = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(str)) return 0;
  const negative = str.startsWith("-");
  const [units, decimals = ""] = str.replace("-", "").split(".");
  const cents = parseInt(units, 10) * 100 + parseInt(decimals.padEnd(2, "0") || "0", 10);
  return negative ? -cents : cents;
}

// ---------------------------------------------------------------------------
// Acquisition : première page visitée + paramètres UTM + source
// ---------------------------------------------------------------------------

export interface UtmParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

/** Extrait les paramètres UTM de la landing page Shopify (chemin + query). */
export function parseUtm(landingSite: string | null | undefined): UtmParams {
  if (!landingSite) return {};
  const queryIndex = landingSite.indexOf("?");
  if (queryIndex === -1) return {};
  const params = new URLSearchParams(landingSite.slice(queryIndex + 1));
  const get = (key: string) => params.get(key) ?? undefined;
  return {
    utmSource: get("utm_source"),
    utmMedium: get("utm_medium"),
    utmCampaign: get("utm_campaign"),
    utmContent: get("utm_content"),
    utmTerm: get("utm_term"),
  };
}

/**
 * Source d'acquisition MESURÉE, déduite des données de visite Shopify
 * (UTM, referrer, gclid). Heuristique documentée — jamais présentée comme
 * une déclaration client.
 */
export function acquisitionSourceFromJourney(
  landingSite: string | null | undefined,
  referringSite: string | null | undefined,
): AcquisitionSource | undefined {
  const utm = parseUtm(landingSite);
  const source = (utm.utmSource ?? "").toLowerCase();
  const medium = (utm.utmMedium ?? "").toLowerCase();
  const referrer = (referringSite ?? "").toLowerCase();
  const landing = (landingSite ?? "").toLowerCase();

  if (source.includes("google") && (medium === "cpc" || medium === "paid")) {
    return "google_ads";
  }
  if (landing.includes("gclid=")) return "google_ads";
  if (source.includes("instagram") || referrer.includes("instagram.")) return "instagram";
  if (source.includes("facebook") || source === "fb" || referrer.includes("facebook.")) {
    return "facebook";
  }
  if (source.includes("tiktok") || referrer.includes("tiktok.")) return "tiktok";
  if (source.includes("google") || referrer.includes("google.")) return "google_naturel";
  if (source || referrer) return "autre";
  return undefined;
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

export interface MappedOrder {
  customer: {
    shopify_customer_id?: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    postal_code?: string;
    city?: string;
  };
  order: {
    shopify_order_id: string;
    shopify_order_number: string;
    reference: string;
    ordered_at: string;
    fulfillment_mode: "livraison" | "retrait_magasin" | "retrait_depot";
    delivery_fee_cents: number;
    discount_cents: number;
    notes?: string;
    shopify_updated_at?: string;
    financial_status?: string;
    acquisition_source?: AcquisitionSource;
  };
  lines: {
    shopify_line_id: string;
    shopify_variant_id?: string;
    product_name: string;
    variant_label?: string;
    reference?: string;
    quantity: number;
    unit_price_cents: number;
    discount_cents: number;
  }[];
  /**
   * Montant NET réellement encaissé en ligne, en centimes, d'après
   * financial_status (0 si en attente, annulé, remboursé ou voided).
   * Aucune opération financière n'est inventée : ce montant reflète l'état
   * Shopify.
   */
  paidCents: number;
  /** true si la commande a été annulée côté Shopify (cancelled_at). */
  cancelled: boolean;
  journey: {
    landing_page?: string;
    referring_site?: string;
    source?: AcquisitionSource;
  } & UtmParams;
}

/** Transforme un payload de webhook orders/create | orders/updated. */
export function mapOrderPayload(payload: Payload): MappedOrder {
  const customerPayload = payload.customer ?? {};
  const address = payload.shipping_address ?? payload.billing_address ?? {};
  const name =
    [customerPayload.first_name, customerPayload.last_name].filter(Boolean).join(" ") ||
    address.name ||
    "Client Shopify";

  const shippingCents = (payload.shipping_lines ?? []).reduce(
    (sum: number, line: Payload) => sum + moneyStringToCents(line.price),
    0,
  );

  const utm = parseUtm(payload.landing_site);
  const source = acquisitionSourceFromJourney(payload.landing_site, payload.referring_site);

  const financial = payload.financial_status as string | undefined;
  // Net encaissé selon Shopify : après remboursement partiel, Shopify
  // expose le total courant (current_total_price). « refunded » et
  // « voided » → plus rien d'encaissé.
  let paidCents = 0;
  if (financial === "paid") {
    paidCents = moneyStringToCents(payload.current_total_price ?? payload.total_price);
  } else if (financial === "partially_refunded" || financial === "partially_paid") {
    paidCents = moneyStringToCents(payload.current_total_price ?? payload.total_price);
  }
  const cancelled = Boolean(payload.cancelled_at);
  if (cancelled && (financial === "refunded" || financial === "voided")) {
    paidCents = 0;
  }

  return {
    customer: {
      shopify_customer_id:
        customerPayload.id !== undefined ? String(customerPayload.id) : undefined,
      name,
      phone: customerPayload.phone ?? address.phone ?? undefined,
      email: payload.email ?? customerPayload.email ?? undefined,
      address: address.address1 ?? undefined,
      postal_code: address.zip ?? undefined,
      city: address.city ?? undefined,
    },
    order: {
      shopify_order_id: String(payload.id),
      shopify_order_number: payload.name ?? String(payload.order_number ?? payload.id),
      reference: payload.name ?? `#${payload.order_number ?? payload.id}`,
      ordered_at: payload.created_at ?? new Date().toISOString(),
      fulfillment_mode: "livraison",
      delivery_fee_cents: shippingCents,
      discount_cents: moneyStringToCents(payload.total_discounts),
      notes: payload.note ?? undefined,
      shopify_updated_at: payload.updated_at ?? undefined,
      financial_status: financial,
      acquisition_source: source,
    },
    lines: (payload.line_items ?? []).map((item: Payload) => ({
      shopify_line_id: String(item.id),
      shopify_variant_id:
        item.variant_id !== null && item.variant_id !== undefined
          ? String(item.variant_id)
          : undefined,
      product_name: item.title ?? "Article Shopify",
      variant_label:
        item.variant_title && item.variant_title !== "Default Title"
          ? item.variant_title
          : undefined,
      reference: item.sku || undefined,
      quantity: item.quantity ?? 1,
      unit_price_cents: moneyStringToCents(item.price),
      discount_cents: moneyStringToCents(item.total_discount),
    })),
    paidCents,
    cancelled,
    journey: {
      landing_page: payload.landing_site ?? undefined,
      referring_site: payload.referring_site ?? undefined,
      source,
      ...utm,
    },
  };
}

// ---------------------------------------------------------------------------
// Produits
// ---------------------------------------------------------------------------

/** Catégorie TRUST AI déduite du product_type Shopify (heuristique). */
export function categoryFromProductType(
  productType: string | null | undefined,
  title?: string,
): ProductCategory {
  const haystack = `${productType ?? ""} ${title ?? ""}`.toLowerCase();
  if (haystack.includes("canap")) return "canapes";
  if (haystack.includes("matelas")) return "matelas";
  if (haystack.includes("fauteuil")) return "fauteuils";
  if (haystack.includes("chaise")) return "chaises";
  if (haystack.includes("lit")) return "lits";
  if (haystack.includes("table")) return "tables";
  if (
    haystack.includes("lumi") ||
    haystack.includes("lampe") ||
    haystack.includes("suspension")
  ) {
    return "luminaires";
  }
  return "decoration";
}

export interface MappedProduct {
  product: {
    shopify_product_id: string;
    title: string;
    short_description?: string;
    category: ProductCategory;
    shopify_handle?: string;
    image_url?: string;
    source: "shopify";
    active: boolean;
    shopify_updated_at?: string;
  };
  variants: {
    shopify_variant_id: string;
    name: string;
    sku: string;
    barcode?: string;
    price_cents: number;
    color?: string;
    dimensions?: string;
  }[];
}

/**
 * Extrait la couleur et les dimensions depuis les OPTIONS structurées de la
 * variante Shopify (« Couleur : Caramel », « Dimensions : L. 250 x l. 170 »).
 * Reconnaissance par nom d'option (français/anglais) — jamais d'invention :
 * une option non reconnue est simplement ignorée.
 */
export function structuredVariantOptions(
  options: { name?: string | null; value?: string | null }[] | null | undefined,
): { color?: string; dimensions?: string } {
  let color: string | undefined;
  let dimensions: string | undefined;
  for (const option of options ?? []) {
    const name = (option.name ?? "").toLowerCase();
    const value = option.value?.trim();
    if (!value || value === "Default Title") continue;
    if (!color && /couleur|coloris|color|tissu|finition|mati[eè]re/.test(name)) {
      color = value;
    } else if (!dimensions && /dimension|taille|size|longueur|largeur|format/.test(name)) {
      dimensions = value;
    }
  }
  return { color, dimensions };
}

/** Transforme un payload de webhook products/create | products/update. */
export function mapProductPayload(payload: Payload): MappedProduct {
  // Noms d'options du produit, dans l'ordre des positions (option1..3).
  const optionNames: string[] = ((payload.options ?? []) as Payload[])
    .slice()
    .sort((a: Payload, b: Payload) => (a.position ?? 0) - (b.position ?? 0))
    .map((o: Payload) => String(o.name ?? ""));
  return {
    product: {
      shopify_product_id: String(payload.id),
      title: payload.title ?? "Produit Shopify",
      short_description: payload.body_html
        ? String(payload.body_html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || undefined
        : undefined,
      category: categoryFromProductType(payload.product_type, payload.title),
      shopify_handle: payload.handle ?? undefined,
      image_url: payload.image?.src ?? payload.images?.[0]?.src ?? undefined,
      source: "shopify",
      active: payload.status ? payload.status === "active" : true,
      shopify_updated_at: payload.updated_at ?? undefined,
    },
    variants: (payload.variants ?? []).map((variant: Payload) => {
      const { color, dimensions } = structuredVariantOptions(
        [variant.option1, variant.option2, variant.option3].map((value, index) => ({
          name: optionNames[index],
          value: value ?? null,
        })),
      );
      return {
        shopify_variant_id: String(variant.id),
        name:
          variant.title && variant.title !== "Default Title"
            ? variant.title
            : "Standard",
        sku: variant.sku || `SHOPIFY-${variant.id}`,
        barcode: variant.barcode || undefined,
        price_cents: moneyStringToCents(variant.price),
        color,
        dimensions,
      };
    }),
  };
}

/**
 * Transforme un nœud produit de l'API Admin GRAPHQL (utilisé par la
 * synchronisation complète du catalogue — les endpoints REST produits sont
 * dépréciés pour les nouvelles applications). Les identifiants GID
 * (« gid://shopify/Product/123 ») sont normalisés vers leur partie
 * numérique, identique à celle des payloads de webhooks.
 */
export function mapGraphQLProductNode(node: Payload): MappedProduct {
  const numericId = (gid: string | null | undefined): string | undefined => {
    if (!gid) return undefined;
    const match = String(gid).match(/\/(\d+)$/);
    return match ? match[1] : String(gid);
  };
  const productId = numericId(node.id) ?? String(node.id);
  const variants: Payload[] = (node.variants?.edges ?? []).map((e: Payload) => e.node);
  return {
    product: {
      shopify_product_id: productId,
      title: node.title ?? "Produit Shopify",
      short_description: node.description
        ? String(node.description).replace(/\s+/g, " ").trim().slice(0, 200) || undefined
        : undefined,
      category: categoryFromProductType(node.productType, node.title),
      shopify_handle: node.handle ?? undefined,
      image_url: node.featuredImage?.url ?? undefined,
      source: "shopify",
      // ACTIVE → actif ; ARCHIVED / DRAFT → inactif (archivage maîtrisé).
      active: node.status ? node.status === "ACTIVE" : true,
      shopify_updated_at: node.updatedAt ?? undefined,
    },
    variants: variants.map((variant) => {
      const variantId = numericId(variant.id) ?? String(variant.id);
      const { color, dimensions } = structuredVariantOptions(variant.selectedOptions);
      return {
        shopify_variant_id: variantId,
        name:
          variant.title && variant.title !== "Default Title"
            ? variant.title
            : "Standard",
        sku: variant.sku || `SHOPIFY-${variantId}`,
        barcode: variant.barcode || undefined,
        price_cents: moneyStringToCents(variant.price),
        color,
        dimensions,
      };
    }),
  };
}
