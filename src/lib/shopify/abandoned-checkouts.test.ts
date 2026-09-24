import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consentFromState,
  fetchAbandonedCheckouts,
  mapAbandonedCheckoutNode,
  tokenFromRecoveryUrl,
  MAX_PAGES,
} from "./abandoned-checkouts";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function node(over: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/AbandonedCheckout/7700001",
    abandonedCheckoutUrl:
      "https://boutique.myshopify.com/12345/checkouts/abc123DEF/recover?key=zzz",
    createdAt: "2026-09-20T09:00:00Z",
    updatedAt: "2026-09-20T09:42:00Z",
    totalPriceSet: { shopMoney: { amount: "1299.90", currencyCode: "EUR" } },
    customer: {
      displayName: "Client Panier",
      email: "client@example.com",
      phone: "+33600000000",
      emailMarketingConsent: { marketingState: "SUBSCRIBED" },
    },
    lineItems: {
      edges: [
        {
          node: {
            title: "Canapé Rustica",
            variantTitle: "Gris",
            quantity: 2,
            discountedUnitPriceSet: { shopMoney: { amount: "499.95" } },
            originalUnitPriceSet: { shopMoney: { amount: "599.00" } },
          },
        },
        {
          node: {
            title: "Table basse",
            quantity: 1,
            originalUnitPriceSet: { shopMoney: { amount: "300.00" } },
          },
        },
      ],
    },
    ...over,
  };
}

function page(nodes: unknown[], next?: string) {
  return {
    data: {
      abandonedCheckouts: {
        pageInfo: { hasNextPage: Boolean(next), endCursor: next ?? null },
        edges: nodes.map((n) => ({ node: n })),
      },
    },
  };
}

describe("Consentement marketing", () => {
  it("seul un abonnement franc vaut accord", () => {
    expect(consentFromState("SUBSCRIBED")).toBe(true);
    expect(consentFromState("subscribed")).toBe(true);
  });

  it("un refus explicite vaut refus", () => {
    expect(consentFromState("NOT_SUBSCRIBED")).toBe(false);
    expect(consentFromState("UNSUBSCRIBED")).toBe(false);
    expect(consentFromState("REDACTED")).toBe(false);
  });

  it("l'inconnu n'est pas un accord : il reste inconnu", () => {
    expect(consentFromState(undefined)).toBeNull();
    expect(consentFromState(null)).toBeNull();
    expect(consentFromState("")).toBeNull();
    expect(consentFromState("PENDING")).toBeNull();
    expect(consentFromState(42)).toBeNull();
  });
});

describe("Jeton de tunnel", () => {
  it("se lit dans l'adresse de récupération", () => {
    expect(
      tokenFromRecoveryUrl(
        "https://boutique.myshopify.com/12345/checkouts/abc123DEF/recover?key=zzz",
      ),
    ).toBe("abc123DEF");
  });

  it("reste absent quand l'adresse ne le porte pas", () => {
    expect(tokenFromRecoveryUrl("https://boutique.myshopify.com/panier")).toBeUndefined();
    expect(tokenFromRecoveryUrl(undefined)).toBeUndefined();
    expect(tokenFromRecoveryUrl(12)).toBeUndefined();
  });
});

describe("Transformation d'un panier abandonné", () => {
  it("garde le montant, le lien de récupération et le compte d'articles", () => {
    const row = mapAbandonedCheckoutNode(node());
    expect(row.shopify_checkout_id).toBe("7700001");
    expect(row.checkout_token).toBe("abc123DEF");
    expect(row.total_cents).toBe(129990);
    expect(row.currency).toBe("EUR");
    expect(row.item_count).toBe(3);
    expect(row.recovery_url).toContain("/recover?key=");
    // La date d'abandon est la dernière activité du tunnel.
    expect(row.abandoned_at).toBe("2026-09-20T09:42:00Z");
    expect(row.created_at_shopify).toBe("2026-09-20T09:00:00Z");
  });

  it("préfère le prix remisé au prix d'origine", () => {
    const row = mapAbandonedCheckoutNode(node());
    expect(row.line_items[0].unit_price_cents).toBe(49995);
    expect(row.line_items[0].variant_title).toBe("Gris");
    // Sans prix remisé, le prix d'origine sert de repli.
    expect(row.line_items[1].unit_price_cents).toBe(30000);
    expect(row.line_items[1].variant_title).toBeUndefined();
  });

  it("reste exploitable quand Shopify masque les données client", () => {
    // Sans l'approbation « protected customer data », ces champs sont vides.
    const row = mapAbandonedCheckoutNode(
      node({ customer: { displayName: "", email: null, phone: null } }),
    );
    expect(row.contact_email).toBeUndefined();
    expect(row.contact_phone).toBeUndefined();
    expect(row.contact_name).toBeUndefined();
    expect(row.marketing_consent).toBeNull();
    // Le panier lui-même reste lisible : il sera visible et non relançable.
    expect(row.total_cents).toBe(129990);
  });

  it("n'invente ni article ni quantité", () => {
    const row = mapAbandonedCheckoutNode({
      id: "gid://shopify/AbandonedCheckout/1",
      updatedAt: "2026-09-21T08:00:00Z",
    });
    expect(row.line_items).toEqual([]);
    expect(row.item_count).toBe(0);
    expect(row.total_cents).toBe(0);
    expect(row.recovery_url).toBeUndefined();
    expect(row.checkout_token).toBeUndefined();
  });
});

describe("Lecture paginée", () => {
  afterEach(() => {
    delete process.env.SHOPIFY_STORE_DOMAIN;
    delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  });

  function configure() {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
  }

  it("suit les pages jusqu'au bout", async () => {
    configure();
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(page([node({ id: "gid://shopify/AbandonedCheckout/1" })], "curseur-1")),
      )
      .mockResolvedValueOnce(
        jsonResponse(page([node({ id: "gid://shopify/AbandonedCheckout/2" })])),
      );

    const result = await fetchAbandonedCheckouts({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.rows.map((r) => r.shopify_checkout_id)).toEqual(["1", "2"]);

    // Le curseur de la première page est bien renvoyé à la seconde requête.
    const secondBody = JSON.parse(
      (mockFetch.mock.calls[1][1] as { body: string }).body,
    );
    expect(secondBody.variables.after).toBe("curseur-1");
  });

  it("écarte un panier sans date d'abandon plutôt que d'échouer en bloc", async () => {
    configure();
    const mockFetch = vi.fn(async () =>
      jsonResponse(
        page([
          node({ id: "gid://shopify/AbandonedCheckout/1" }),
          { id: "gid://shopify/AbandonedCheckout/2" },
        ]),
      ),
    );
    const result = await fetchAbandonedCheckouts({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(result.rows.map((r) => r.shopify_checkout_id)).toEqual(["1"]);
  });

  it("s'arrête au garde-fou de pages et le signale", async () => {
    configure();
    const mockFetch = vi.fn(async () =>
      jsonResponse(page([node()], "curseur-suivant")),
    );
    const result = await fetchAbandonedCheckouts({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(result.pages).toBe(MAX_PAGES);
    expect(result.truncated).toBe(true);
  });

  it("filtre sur une date quand on la lui donne", async () => {
    configure();
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(page([node()])));
    await fetchAbandonedCheckouts({
      since: new Date("2026-09-10T00:00:00Z"),
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.variables.query).toBe("created_at:>='2026-09-10'");
  });
});
