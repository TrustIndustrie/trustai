import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  acquisitionSourceFromJourney,
  categoryFromProductType,
  mapOrderPayload,
  mapProductPayload,
  moneyStringToCents,
  parseUtm,
  verifyShopifyHmac,
} from "./mapping";

const SECRET = "secret-de-test";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
}

describe("Sécurité des webhooks (HMAC)", () => {
  it("accepte une signature valide et refuse tout le reste", () => {
    const body = JSON.stringify({ id: 123 });
    expect(verifyShopifyHmac(body, sign(body), SECRET)).toBe(true);
    // Signature d'un AUTRE corps → refus.
    expect(verifyShopifyHmac(body, sign(body + " "), SECRET)).toBe(false);
    // Mauvais secret → refus.
    expect(verifyShopifyHmac(body, sign(body), "autre-secret")).toBe(false);
    // En-tête absent ou invalide → refus.
    expect(verifyShopifyHmac(body, null, SECRET)).toBe(false);
    expect(verifyShopifyHmac(body, "pas-du-base64!!!", SECRET)).toBe(false);
  });
});

describe("Montants Shopify (chaînes → centimes exacts)", () => {
  it("convertit sans erreur de flottants", () => {
    expect(moneyStringToCents("1490.00")).toBe(149000);
    expect(moneyStringToCents("0.10")).toBe(10);
    expect(moneyStringToCents("19.9")).toBe(1990);
    expect(moneyStringToCents("89")).toBe(8900);
    expect(moneyStringToCents("-25.50")).toBe(-2550);
    expect(moneyStringToCents(null)).toBe(0);
    expect(moneyStringToCents("n/a")).toBe(0);
  });
});

describe("Acquisition mesurée (UTM, landing page)", () => {
  it("extrait les paramètres UTM de la landing page", () => {
    const utm = parseUtm(
      "/collections/canapes?utm_source=google&utm_medium=cpc&utm_campaign=hiver",
    );
    expect(utm).toEqual({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "hiver",
      utmContent: undefined,
      utmTerm: undefined,
    });
    expect(parseUtm("/products/table")).toEqual({});
    expect(parseUtm(null)).toEqual({});
  });

  it("déduit la source sans jamais inventer", () => {
    expect(
      acquisitionSourceFromJourney("/x?utm_source=google&utm_medium=cpc", null),
    ).toBe("google_ads");
    expect(acquisitionSourceFromJourney("/x?gclid=abc123", null)).toBe("google_ads");
    expect(
      acquisitionSourceFromJourney(null, "https://www.instagram.com/"),
    ).toBe("instagram");
    expect(
      acquisitionSourceFromJourney(null, "https://www.google.com/"),
    ).toBe("google_naturel");
    expect(acquisitionSourceFromJourney("/x?utm_source=newsletter", null)).toBe("autre");
    // Aucune donnée de visite → aucune source (jamais de valeur inventée).
    expect(acquisitionSourceFromJourney("/produits", null)).toBeUndefined();
    expect(acquisitionSourceFromJourney(null, null)).toBeUndefined();
  });
});

// Payload minimal représentatif d'un webhook orders/create.
const orderPayload = {
  id: 5901234567,
  name: "#TR2001",
  order_number: 2001,
  created_at: "2026-08-13T10:00:00+02:00",
  updated_at: "2026-08-13T10:05:00+02:00",
  email: "client.test@exemple.fr",
  financial_status: "paid",
  total_price: "1638.00",
  total_discounts: "50.00",
  landing_site: "/collections/tables?utm_source=google&utm_medium=cpc&utm_campaign=tables",
  referring_site: "https://www.google.com/",
  note: "Appeler avant livraison",
  customer: {
    id: 7001,
    first_name: "Nora",
    last_name: "Client-Test",
    phone: "+33600000042",
  },
  shipping_address: {
    address1: "10 rue des Tests",
    zip: "75011",
    city: "Paris",
    phone: null,
  },
  shipping_lines: [{ price: "89.00" }],
  line_items: [
    {
      id: 90001,
      variant_id: 44100005,
      title: "Table à manger Marbella",
      variant_title: "Effet marbre blanc, 200 cm",
      sku: "EUR-MARB-200",
      quantity: 1,
      price: "1590.00",
      total_discount: "50.00",
    },
    {
      id: 90002,
      variant_id: null,
      title: "Bougie parfumée",
      variant_title: "Default Title",
      sku: "",
      quantity: 1,
      price: "9.00",
      total_discount: "0.00",
    },
  ],
};

describe("Mapping d'une commande Shopify", () => {
  it("transforme le payload sans inventer de données", () => {
    const mapped = mapOrderPayload(orderPayload);

    expect(mapped.order.shopify_order_id).toBe("5901234567");
    expect(mapped.order.reference).toBe("#TR2001");
    expect(mapped.order.delivery_fee_cents).toBe(8900);
    expect(mapped.order.discount_cents).toBe(5000);
    expect(mapped.order.acquisition_source).toBe("google_ads");

    expect(mapped.customer.name).toBe("Nora Client-Test");
    expect(mapped.customer.shopify_customer_id).toBe("7001");
    expect(mapped.customer.city).toBe("Paris");

    expect(mapped.lines).toHaveLength(2);
    expect(mapped.lines[0]).toMatchObject({
      shopify_line_id: "90001",
      shopify_variant_id: "44100005",
      product_name: "Table à manger Marbella",
      variant_label: "Effet marbre blanc, 200 cm",
      reference: "EUR-MARB-200",
      quantity: 1,
      unit_price_cents: 159000,
      discount_cents: 5000,
    });
    // « Default Title » et SKU vide ne sont pas inventés.
    expect(mapped.lines[1].variant_label).toBeUndefined();
    expect(mapped.lines[1].reference).toBeUndefined();
    expect(mapped.lines[1].shopify_variant_id).toBeUndefined();

    // Paiement en ligne : commande payée → montant exact en centimes.
    expect(mapped.paidCents).toBe(163800);

    expect(mapped.journey.utmCampaign).toBe("tables");
    expect(mapped.journey.landing_page).toContain("/collections/tables");
  });

  it("ne crée aucun règlement si la commande n'est pas payée", () => {
    const mapped = mapOrderPayload({ ...orderPayload, financial_status: "pending" });
    expect(mapped.paidCents).toBe(0);
  });

  it("reste stable si le client est absent du payload", () => {
    const mapped = mapOrderPayload({
      ...orderPayload,
      customer: undefined,
      shipping_address: undefined,
      email: null,
    });
    expect(mapped.customer.name).toBe("Client Shopify");
    expect(mapped.customer.shopify_customer_id).toBeUndefined();
  });
});

describe("Mapping d'un produit Shopify", () => {
  it("transforme le payload produit avec ses variantes", () => {
    const mapped = mapProductPayload({
      id: 8200001,
      title: "Canapé Oslo",
      body_html: "<p>Un canapé <strong>très</strong> confortable.</p>",
      product_type: "Canapés",
      handle: "canape-oslo",
      status: "active",
      updated_at: "2026-08-13T09:00:00Z",
      image: { src: "https://cdn.shopify.com/img.jpg" },
      options: [
        { name: "Couleur", position: 1 },
        { name: "Dimensions", position: 2 },
      ],
      variants: [
        {
          id: 91001,
          title: "Gris",
          sku: "OSLO-GR",
          price: "899.00",
          barcode: "123",
          option1: "Gris",
          option2: "L. 220 x l. 95 cm",
        },
        { id: 91002, title: "Default Title", sku: "", price: "899.00" },
      ],
    });
    expect(mapped.product.shopify_product_id).toBe("8200001");
    expect(mapped.product.category).toBe("canapes");
    expect(mapped.product.short_description).toBe("Un canapé très confortable.");
    expect(mapped.product.source).toBe("shopify");
    expect(mapped.variants[0]).toMatchObject({
      shopify_variant_id: "91001",
      name: "Gris",
      sku: "OSLO-GR",
      price_cents: 89900,
      // Options structurées reconnues par leur nom (Couleur / Dimensions).
      color: "Gris",
      dimensions: "L. 220 x l. 95 cm",
    });
    // Variante par défaut : nom lisible + SKU de repli déterministe,
    // aucune couleur/dimension inventée.
    expect(mapped.variants[1].name).toBe("Standard");
    expect(mapped.variants[1].sku).toBe("SHOPIFY-91002");
    expect(mapped.variants[1].color).toBeUndefined();
    expect(mapped.variants[1].dimensions).toBeUndefined();
  });

  it("déduit la catégorie depuis le type de produit (heuristique)", () => {
    expect(categoryFromProductType("Tables à manger")).toBe("tables");
    expect(categoryFromProductType("Matelas")).toBe("matelas");
    expect(categoryFromProductType(null, "Suspension rotin")).toBe("luminaires");
    expect(categoryFromProductType("Vase")).toBe("decoration");
    // « Canapé-lit » : le canapé prime (testé avant « lit »).
    expect(categoryFromProductType("Canapé-lit")).toBe("canapes");
  });
});
