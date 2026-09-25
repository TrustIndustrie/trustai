import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _clearTokenCache, getShopifyAccessToken, ShopifyConfigError } from "./auth";
import { fetchAllProductNodes, syncProductsPage, upsertProductsBulk } from "./sync";
import { ensureSubscriptions, listSubscriptionStatus } from "./webhooks";
import {
  acquisitionSourceFromJourney,
  mapGraphQLProductNode,
  mapOrderPayload,
  verifyShopDomain,
  verifyShopifyHmac,
} from "./mapping";
import {
  getAllowedShopDomains,
  getShopifyStoreDomain,
  getWebhookSigningSecrets,
  isShopifyAdminConfigured,
} from "./config";
import { createHmac } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ENV_KEYS = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_WEBHOOK_SECRET",
  "SHOPIFY_API_VERSION",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  _clearTokenCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  _clearTokenCache();
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

// ---------------------------------------------------------------------------
// Client Credentials Grant : cache + renouvellement + fallback legacy
// ---------------------------------------------------------------------------

describe("Fournisseur de token Shopify (Client Credentials Grant 2026)", () => {
  it("obtient un token, le met en cache, puis le renouvelle à l'expiration", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_CLIENT_ID = "id-test";
    process.env.SHOPIFY_CLIENT_SECRET = "secret-test";

    let calls = 0;
    const mockFetch = vi.fn(async (url: any, init: any) => {
      calls += 1;
      expect(String(url)).toBe(
        "https://test-boutique.myshopify.com/admin/oauth/access_token",
      );
      const body = JSON.parse(init.body);
      expect(body.grant_type).toBe("client_credentials");
      expect(body.client_id).toBe("id-test");
      // expires_in très court à la 1re réponse pour tester le renouvellement.
      return jsonResponse({
        access_token: `token-${calls}`,
        expires_in: calls === 1 ? 1 : 86399,
      });
    }) as unknown as typeof fetch;

    const first = await getShopifyAccessToken(mockFetch);
    expect(first).toBe("token-1");
    // expires_in=1s (< marge de 5 min) → le prochain appel renouvelle.
    const second = await getShopifyAccessToken(mockFetch);
    expect(second).toBe("token-2");
    // Token de 24 h en cache → aucun nouvel appel réseau.
    const third = await getShopifyAccessToken(mockFetch);
    expect(third).toBe("token-2");
    expect(calls).toBe(2);
  });

  it("utilise le token legacy shpat_ en fallback documenté, sans appel réseau", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_legacy_exemple";
    const mockFetch = vi.fn() as unknown as typeof fetch;
    expect(await getShopifyAccessToken(mockFetch)).toBe("shpat_legacy_exemple");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("échoue proprement sans exposer de secret dans le message", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_CLIENT_ID = "id-test";
    process.env.SHOPIFY_CLIENT_SECRET = "secret-ultra-confidentiel";
    const mockFetch = vi.fn(async () =>
      jsonResponse({ error: "invalid_client" }, { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(getShopifyAccessToken(mockFetch)).rejects.toThrow(ShopifyConfigError);
    try {
      await getShopifyAccessToken(mockFetch);
    } catch (e) {
      expect((e as Error).message).not.toContain("secret-ultra-confidentiel");
      expect((e as Error).message).toContain("401");
    }
  });

  it("sans aucune variable : erreur de configuration claire (fonctions désactivées)", async () => {
    await expect(getShopifyAccessToken(vi.fn() as any)).rejects.toThrow(
      /SHOPIFY_STORE_DOMAIN/,
    );
    expect(isShopifyAdminConfigured()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Webhooks : signature avec le Client Secret + domaine + secrets multiples
// ---------------------------------------------------------------------------

describe("Vérification des webhooks 2026", () => {
  it("signe avec le Client Secret et accepte l'ancienne clé en repli", () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_CLIENT_SECRET = "client-secret";
    process.env.SHOPIFY_WEBHOOK_SECRET = "ancienne-cle";
    const secrets = getWebhookSigningSecrets();
    expect(secrets).toEqual(["client-secret", "ancienne-cle"]);

    const body = '{"id":1}';
    const signWith = (secret: string) =>
      createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(verifyShopifyHmac(body, signWith("client-secret"), secrets)).toBe(true);
    expect(verifyShopifyHmac(body, signWith("ancienne-cle"), secrets)).toBe(true);
    expect(verifyShopifyHmac(body, signWith("intrus"), secrets)).toBe(false);
    expect(verifyShopifyHmac(body, null, secrets)).toBe(false);
  });

  it("vérifie strictement le domaine de la boutique émettrice", () => {
    expect(
      verifyShopDomain("ma-boutique.myshopify.com", "ma-boutique.myshopify.com"),
    ).toBe(true);
    expect(
      verifyShopDomain("MA-BOUTIQUE.MYSHOPIFY.COM", "ma-boutique.myshopify.com"),
    ).toBe(true);
    expect(
      verifyShopDomain("autre-boutique.myshopify.com", "ma-boutique.myshopify.com"),
    ).toBe(false);
    expect(verifyShopDomain(null, "ma-boutique.myshopify.com")).toBe(false);
    expect(verifyShopDomain("ma-boutique.myshopify.com", undefined)).toBe(false);
  });

  it("accepte plusieurs domaines déclarés pour la MÊME boutique", () => {
    // Une boutique répond sous son domaine canonique (celui des webhooks)
    // ET sous son nom court d'administration : les deux sont déclarables.
    process.env.SHOPIFY_STORE_DOMAIN =
      "ma-boutique.myshopify.com, wn02qe-0w.myshopify.com";
    const allowed = getAllowedShopDomains();
    expect(allowed).toEqual(["ma-boutique.myshopify.com", "wn02qe-0w.myshopify.com"]);
    // Le premier domaine déclaré sert aux appels API.
    expect(getShopifyStoreDomain()).toBe("ma-boutique.myshopify.com");
    expect(verifyShopDomain("wn02qe-0w.myshopify.com", allowed)).toBe(true);
    expect(verifyShopDomain("ma-boutique.myshopify.com", allowed)).toBe(true);
    // La liste reste une liste BLANCHE : rien d'autre ne passe.
    expect(verifyShopDomain("boutique-pirate.myshopify.com", allowed)).toBe(false);
    expect(verifyShopDomain("wn02qe-0w.myshopify.com", [])).toBe(false);
  });

  it("normalise les domaines déclarés (protocole, chemin, espaces)", () => {
    process.env.SHOPIFY_STORE_DOMAIN =
      " https://ma-boutique.myshopify.com/admin , wn02qe-0w.myshopify.com ";
    expect(getAllowedShopDomains()).toEqual([
      "ma-boutique.myshopify.com",
      "wn02qe-0w.myshopify.com",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Import complet du catalogue : pagination GraphQL multi-pages
// ---------------------------------------------------------------------------

function productNode(id: number, variantCount: number) {
  return {
    id: `gid://shopify/Product/${id}`,
    title: `Produit ${id}`,
    description: `Description ${id}`,
    productType: "Tables",
    handle: `produit-${id}`,
    status: id % 2 === 0 ? "ARCHIVED" : "ACTIVE",
    updatedAt: "2026-08-14T08:00:00Z",
    featuredImage: { url: `https://cdn.exemple/img-${id}.jpg` },
    variants: {
      edges: Array.from({ length: variantCount }, (_, i) => ({
        node: {
          id: `gid://shopify/ProductVariant/${id * 10 + i}`,
          title: `Variante ${i + 1}`,
          sku: `SKU-${id}-${i + 1}`,
          barcode: null,
          price: "199.00",
          selectedOptions: [
            { name: "Couleur", value: `Teinte ${i + 1}` },
            { name: "Dimensions", value: "L. 250 x l. 170 cm" },
          ],
        },
      })),
    },
  };
}

describe("Import complet du catalogue (GraphQL, pagination)", () => {
  it("parcourt TOUTES les pages et toutes les variantes", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";

    let page = 0;
    const mockFetch = vi.fn(async (url: any, init: any) => {
      const request = JSON.parse(init.body);
      if (page === 0) {
        expect(request.variables.cursor).toBeNull();
        page += 1;
        return jsonResponse({
          data: {
            products: {
              pageInfo: { hasNextPage: true, endCursor: "curseur-page-1" },
              edges: [
                { node: productNode(1, 2) },
                { node: productNode(2, 1) },
              ],
            },
          },
        });
      }
      // La 2e requête reprend au curseur de la 1re page.
      expect(request.variables.cursor).toBe("curseur-page-1");
      return jsonResponse({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [{ node: productNode(3, 3) }],
          },
        },
      });
    }) as unknown as typeof fetch;

    const products = await fetchAllProductNodes(mockFetch);
    expect(products).toHaveLength(3);
    expect(products.flatMap((p) => p.variants)).toHaveLength(6);
    // Identifiants GID normalisés vers la partie numérique (= webhooks).
    expect(products[0].product.shopify_product_id).toBe("1");
    expect(products[0].variants[0].shopify_variant_id).toBe("10");
    expect(products[0].variants[0].sku).toBe("SKU-1-1");
    expect(products[0].variants[0].price_cents).toBe(19900);
    // Options structurées Shopify → colonnes couleur/dimensions.
    expect(products[0].variants[0].color).toBe("Teinte 1");
    expect(products[0].variants[0].dimensions).toBe("L. 250 x l. 170 cm");
    // Statut ARCHIVED → inactif (archivage maîtrisé, jamais supprimé).
    expect(products[0].product.active).toBe(true);
    expect(products[1].product.active).toBe(false);
    expect(products[0].product.image_url).toBe("https://cdn.exemple/img-1.jpg");
    expect(products[0].product.shopify_updated_at).toBe("2026-08-14T08:00:00Z");
  });

  it("mappe un nœud GraphQL isolé (catégorie, description nettoyée)", () => {
    const mapped = mapGraphQLProductNode(productNode(7, 1));
    expect(mapped.product.category).toBe("tables");
    expect(mapped.product.shopify_handle).toBe("produit-7");
    expect(mapped.variants[0].name).toBe("Variante 1");
  });
});

// ---------------------------------------------------------------------------
// Écritures groupées + synchronisation page par page
// ---------------------------------------------------------------------------

/**
 * Client Supabase simulé : enregistre les upserts / updates et rend des
 * identifiants déterministes (`id-{shopify_product_id}`) pour vérifier le
 * rattachement des variantes à leur produit.
 */
function fakeSupabase() {
  const upserts: { table: string; rows: any[]; options: any }[] = [];
  const updates: { table: string; values: any; filters: string[] }[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(rows: any[], options: any) {
          upserts.push({ table, rows, options });
          const outcome = { error: null as null };
          return {
            select: async () => ({
              data: rows.map((row: any) => ({
                id: `id-${row.shopify_product_id}`,
                shopify_product_id: row.shopify_product_id,
              })),
              error: null,
            }),
            then: (resolve: (value: typeof outcome) => void) => resolve(outcome),
          };
        },
        update(values: any) {
          const entry = { table, values, filters: [] as string[] };
          updates.push(entry);
          const builder: any = {
            eq: (column: string, value: unknown) => {
              entry.filters.push(`${column}=${String(value)}`);
              return builder;
            },
            or: (clause: string) => {
              entry.filters.push(`or(${clause})`);
              return builder;
            },
            select: async () => ({ data: [{ id: "id-obsolete" }], error: null }),
          };
          return builder;
        },
      };
    },
  };
  return { client: client as any, upserts, updates };
}

describe("Écritures groupées (upsertProductsBulk)", () => {
  it("un seul upsert produits + variantes rattachées et dédoublonnées", async () => {
    const { client, upserts } = fakeSupabase();
    const mapped = [
      mapGraphQLProductNode(productNode(1, 2)),
      mapGraphQLProductNode(productNode(2, 1)),
      // Doublon volontaire du produit 1 : le dernier vu doit gagner, sans
      // faire échouer l'ordre SQL (ON CONFLICT n'accepte pas deux fois la
      // même ligne).
      mapGraphQLProductNode(productNode(1, 2)),
    ];
    const result = await upsertProductsBulk(client, "org-1", mapped);

    expect(result).toEqual({ products: 2, variants: 3 });
    const productUpserts = upserts.filter((u) => u.table === "products");
    const variantUpserts = upserts.filter((u) => u.table === "product_variants");
    expect(productUpserts).toHaveLength(1);
    expect(productUpserts[0].options.onConflict).toBe("organization_id,shopify_product_id");
    expect(productUpserts[0].rows).toHaveLength(2);
    expect(variantUpserts).toHaveLength(1);
    expect(variantUpserts[0].options.onConflict).toBe("shopify_variant_id");
    // Chaque variante est rattachée à l'identifiant BASE de son produit.
    const byVariant = Object.fromEntries(
      variantUpserts[0].rows.map((row: any) => [row.shopify_variant_id, row.product_id]),
    );
    expect(byVariant["10"]).toBe("id-1");
    expect(byVariant["11"]).toBe("id-1");
    expect(byVariant["20"]).toBe("id-2");
  });

  it("accepte deux variantes du même produit partageant le même SKU", async () => {
    const { client, upserts } = fakeSupabase();
    const node = productNode(5, 2);
    node.variants.edges[0].node.sku = "SKU-COMMUN";
    node.variants.edges[1].node.sku = "SKU-COMMUN";
    await upsertProductsBulk(client, "org-1", [mapGraphQLProductNode(node)]);
    const rows = upserts.find((u) => u.table === "product_variants")!.rows;
    expect(rows.map((r: any) => r.sku)).toEqual(["SKU-COMMUN", "SKU-COMMUN"]);
    expect(new Set(rows.map((r: any) => r.shopify_variant_id)).size).toBe(2);
  });
});

describe("Synchronisation page par page (syncProductsPage)", () => {
  it("page intermédiaire : renvoie le curseur, aucune désactivation", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
    const { client, updates } = fakeSupabase();
    const mockFetch = vi.fn(async () =>
      jsonResponse({
        data: {
          products: {
            pageInfo: { hasNextPage: true, endCursor: "curseur-suivant" },
            edges: [{ node: productNode(1, 2) }],
          },
        },
      }),
    ) as unknown as typeof fetch;

    const page = await syncProductsPage(client, "org-1", {}, mockFetch);
    expect(page.nextCursor).toBe("curseur-suivant");
    expect(page.products).toBe(1);
    expect(page.variants).toBe(2);
    expect(page.startedAt).toBeTruthy();
    expect(page.deactivated).toBe(0);
    expect(updates).toHaveLength(0); // pas de désactivation en cours de parcours
  });

  it("dernière page : désactive les produits non revus depuis le début du parcours", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
    const { client, updates } = fakeSupabase();
    const mockFetch = vi.fn(async () =>
      jsonResponse({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [{ node: productNode(3, 1) }],
          },
        },
      }),
    ) as unknown as typeof fetch;

    const startedAt = "2026-08-13T10:00:00.000Z";
    const page = await syncProductsPage(
      client,
      "org-1",
      { cursor: "curseur-page-2", startedAt },
      mockFetch,
    );
    expect(page.nextCursor).toBeNull();
    expect(page.startedAt).toBe(startedAt); // conservé de page en page
    expect(page.deactivated).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ active: false });
    // Ciblage : produits Shopify actifs de l'organisation, non revus.
    expect(updates[0].filters).toContain("organization_id=org-1");
    expect(updates[0].filters).toContain("source=shopify");
    expect(updates[0].filters).toContain("active=true");
    expect(updates[0].filters).toContain(
      `or(last_synced_at.is.null,last_synced_at.lt.${startedAt})`,
    );
  });
});

// ---------------------------------------------------------------------------
// Abonnements webhooks : état + création sans doublon
// ---------------------------------------------------------------------------

describe("Abonnements webhooks (GraphQL Admin)", () => {
  const CALLBACK = "https://exemple.vercel.app/api/webhooks/shopify";

  function subscriptionList(topics: string[]) {
    return {
      data: {
        webhookSubscriptions: {
          edges: topics.map((topic, i) => ({
            node: {
              id: `gid://shopify/WebhookSubscription/${i + 1}`,
              topic,
              endpoint: {
                __typename: "WebhookHttpEndpoint",
                callbackUrl: CALLBACK,
              },
            },
          })),
        },
      },
    };
  }

  it("liste les abonnements existants et manquants", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
    const mockFetch = vi.fn(async () =>
      jsonResponse(subscriptionList(["ORDERS_CREATE", "PRODUCTS_UPDATE"])),
    ) as unknown as typeof fetch;

    const statuses = await listSubscriptionStatus(CALLBACK, mockFetch);
    expect(statuses.find((s) => s.topic === "ORDERS_CREATE")?.subscribed).toBe(true);
    expect(statuses.find((s) => s.topic === "ORDERS_UPDATED")?.subscribed).toBe(false);
    expect(statuses.find((s) => s.topic === "PRODUCTS_CREATE")?.subscribed).toBe(false);
    expect(statuses.find((s) => s.topic === "PRODUCTS_UPDATE")?.subscribed).toBe(true);
  });

  it("ne crée QUE les abonnements manquants (aucun doublon)", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
    const createdTopics: string[] = [];
    const mockFetch = vi.fn(async (url: any, init: any) => {
      const request = JSON.parse(init.body);
      if (String(request.query).includes("webhookSubscriptions(")) {
        return jsonResponse(subscriptionList(["ORDERS_CREATE", "ORDERS_UPDATED"]));
      }
      createdTopics.push(request.variables.topic);
      expect(request.variables.webhookSubscription.callbackUrl).toBe(CALLBACK);
      return jsonResponse({
        data: {
          webhookSubscriptionCreate: {
            webhookSubscription: { id: "gid://x", topic: request.variables.topic },
            userErrors: [],
          },
        },
      });
    }) as unknown as typeof fetch;

    const result = await ensureSubscriptions(CALLBACK, mockFetch);
    expect(result.already.sort()).toEqual(["ORDERS_CREATE", "ORDERS_UPDATED"]);
    expect(result.created.sort()).toEqual(["PRODUCTS_CREATE", "PRODUCTS_UPDATE"]);
    expect(createdTopics.sort()).toEqual(["PRODUCTS_CREATE", "PRODUCTS_UPDATE"]);
  });
});

// ---------------------------------------------------------------------------
// Commandes : annulation / remboursement Shopify
// ---------------------------------------------------------------------------

describe("Annulations et remboursements Shopify", () => {
  const base = {
    id: 42,
    name: "#TR42",
    created_at: "2026-08-14T09:00:00Z",
    total_price: "100.00",
    line_items: [
      { id: 1, title: "Article", quantity: 1, price: "100.00", total_discount: "0.00" },
    ],
  };

  it("commande payée puis remboursée : net encaissé 0, sans opération inventée", () => {
    const paid = mapOrderPayload({ ...base, financial_status: "paid" });
    expect(paid.paidCents).toBe(10000);
    expect(paid.cancelled).toBe(false);

    const refunded = mapOrderPayload({
      ...base,
      financial_status: "refunded",
      cancelled_at: "2026-08-14T10:00:00Z",
    });
    expect(refunded.cancelled).toBe(true);
    expect(refunded.paidCents).toBe(0);
  });

  it("remboursement partiel : net = total courant Shopify", () => {
    const partial = mapOrderPayload({
      ...base,
      financial_status: "partially_refunded",
      current_total_price: "60.00",
    });
    expect(partial.paidCents).toBe(6000);
  });

  it("commande en attente de paiement : rien d'encaissé", () => {
    expect(mapOrderPayload({ ...base, financial_status: "pending" }).paidCents).toBe(0);
    expect(mapOrderPayload({ ...base, financial_status: "authorized" }).paidCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Acquisition : cas contradictoires et absents
// ---------------------------------------------------------------------------

describe("Acquisition mesurée — cas limites", () => {
  it("données contradictoires : l'UTM explicite prime sur le référent", () => {
    // utm_source=facebook mais référent Google → facebook (donnée déclarée
    // par le lien cliqué, plus précise que le référent).
    expect(
      acquisitionSourceFromJourney(
        "/x?utm_source=facebook&utm_medium=social",
        "https://www.google.com/",
      ),
    ).toBe("facebook");
    // utm_source=google + cpc mais référent Instagram → google_ads.
    expect(
      acquisitionSourceFromJourney(
        "/x?utm_source=google&utm_medium=cpc",
        "https://www.instagram.com/",
      ),
    ).toBe("google_ads");
  });

  it("TikTok, UTM absent, et absence totale de données", () => {
    expect(acquisitionSourceFromJourney(null, "https://www.tiktok.com/@x")).toBe("tiktok");
    expect(acquisitionSourceFromJourney("/produits", "https://www.google.fr/")).toBe(
      "google_naturel",
    );
    expect(acquisitionSourceFromJourney("/produits", null)).toBeUndefined();
  });
});
