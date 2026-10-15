import { afterEach, describe, expect, it, vi } from "vitest";
import { retargetSubscriptions } from "./webhooks";

const OLD = "https://trust-industrie-ai.vercel.app/api/webhooks/shopify";
const NEW = "https://trustai-omega.vercel.app/api/webhooks/shopify";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function listing(subs: Record<string, string>) {
  return {
    data: {
      webhookSubscriptions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: Object.entries(subs).map(([topic, url], i) => ({
          node: { id: `gid://shopify/WebhookSubscription/${i + 1}`, topic, endpoint: { __typename: "WebhookHttpEndpoint", callbackUrl: url } },
        })),
      },
    },
  };
}

function shop(initial: Record<string, string>, failOn?: string) {
  const state = { ...initial };
  const updates: { id: string; url: string }[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
    const req = JSON.parse(String(init.body));
    if (String(req.query).includes("webhookSubscriptions(")) return jsonResponse(listing(state));
    if (String(req.query).includes("webhookSubscriptionUpdate")) {
      const idx = Number(req.variables.id.split("/").pop()) - 1;
      const topic = Object.keys(state)[idx];
      if (topic === failOn) {
        return jsonResponse({ data: { webhookSubscriptionUpdate: { webhookSubscription: null, userErrors: [{ field: ["callbackUrl"], message: "Address not allowed" }] } } });
      }
      state[topic] = req.variables.webhookSubscription.callbackUrl;
      updates.push({ id: req.variables.id, url: state[topic] });
      return jsonResponse({ data: { webhookSubscriptionUpdate: { webhookSubscription: { id: req.variables.id, topic, endpoint: { __typename: "WebhookHttpEndpoint", callbackUrl: state[topic] } }, userErrors: [] } } });
    }
    throw new Error("requête inattendue");
  }) as unknown as typeof fetch;
  return { fetchImpl, state, updates };
}

const QUATRE = { ORDERS_CREATE: OLD, ORDERS_UPDATED: OLD, PRODUCTS_CREATE: OLD, PRODUCTS_UPDATE: OLD };

describe("Bascule des abonnements Shopify (modification, réversible)", () => {
  afterEach(() => {
    delete process.env.SHOPIFY_STORE_DOMAIN;
    delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  });
  const env = () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
  };

  it("simulation par défaut : le plan est renvoyé, rien n'est modifié", async () => {
    env();
    const { fetchImpl, state, updates } = shop(QUATRE);
    const r = await retargetSubscriptions(OLD, NEW, {}, fetchImpl);
    expect(r.dryRun).toBe(true);
    expect(r.plan.map((p) => p.topic).sort()).toEqual(["ORDERS_CREATE", "ORDERS_UPDATED", "PRODUCTS_CREATE", "PRODUCTS_UPDATE"]);
    expect(r.updated).toEqual([]);
    expect(updates).toEqual([]);
    expect(Object.values(state).every((u) => u === OLD)).toBe(true);
    expect(r.rollback).toEqual({ from: NEW, to: OLD });
  });

  it("bascule effective : quatre modifications, mêmes identifiants, aucune création", async () => {
    env();
    const { fetchImpl, state, updates } = shop(QUATRE);
    const r = await retargetSubscriptions(OLD, NEW, { dryRun: false }, fetchImpl);
    expect(r.updated).toHaveLength(4);
    expect(updates.map((u) => u.id).sort()).toEqual(r.plan.map((p) => p.id).sort());
    expect(Object.values(state).every((u) => u === NEW)).toBe(true);
    const creations = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((c) => String(JSON.parse(String((c[1] as RequestInit).body)).query).includes("webhookSubscriptionCreate"));
    expect(creations).toHaveLength(0);
  });

  it("retour arrière : l'appel inverse remet les quatre adresses d'origine", async () => {
    env();
    const { fetchImpl, state } = shop(QUATRE);
    const aller = await retargetSubscriptions(OLD, NEW, { dryRun: false }, fetchImpl);
    const retour = await retargetSubscriptions(aller.rollback.from, aller.rollback.to, { dryRun: false }, fetchImpl);
    expect(retour.updated).toHaveLength(4);
    expect(Object.values(state).every((u) => u === OLD)).toBe(true);
  });

  it("ne touche ni aux abonnements déjà sur la cible ni à ceux qui pointent ailleurs", async () => {
    env();
    const { fetchImpl, state } = shop({ ...QUATRE, ORDERS_CREATE: NEW, APP_UNINSTALLED: "https://autre.example/hook" });
    const r = await retargetSubscriptions(OLD, NEW, { dryRun: false }, fetchImpl);
    expect(r.updated.map((u) => u.topic).sort()).toEqual(["ORDERS_UPDATED", "PRODUCTS_CREATE", "PRODUCTS_UPDATE"]);
    expect(state.ORDERS_CREATE).toBe(NEW);
    expect(state.APP_UNINSTALLED).toBe("https://autre.example/hook");
  });

  it("refus de Shopify en cours de route : arrêt, message qui dit quoi rebasculer", async () => {
    env();
    const { fetchImpl, state } = shop(QUATRE, "PRODUCTS_CREATE");
    await expect(retargetSubscriptions(OLD, NEW, { dryRun: false }, fetchImpl)).rejects.toThrow(/Retour arrière : rebasculer ORDERS_CREATE, ORDERS_UPDATED/);
    expect(state.ORDERS_CREATE).toBe(NEW);
    expect(state.PRODUCTS_CREATE).toBe(OLD);
    expect(state.PRODUCTS_UPDATE).toBe(OLD);
  });

  it("garde-fous : cible mal formée ou identique à la source", async () => {
    env();
    const { fetchImpl } = shop(QUATRE);
    await expect(retargetSubscriptions(OLD, "https://trustai-omega.vercel.app/autre", {}, fetchImpl)).rejects.toThrow(/Adresse cible invalide/);
    await expect(retargetSubscriptions(OLD, OLD, {}, fetchImpl)).rejects.toThrow(/identiques/);
  });
});
