import { afterEach, describe, expect, it, vi } from "vitest";
import { listSubscriptionStatus, listVisibleSubscriptions, statusFromVisible } from "./webhooks";
import { registerWebhookEvent, STALE_AFTER_MS, type WebhookEventsClient } from "./webhook-events";

const NEW = "https://trustai-omega.vercel.app/api/webhooks/shopify";
const OLD = "https://ancien-trust-ai.vercel.app/api/webhooks/shopify";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function page(nodes: { topic: string; url?: string; type?: string }[], next?: string) {
  return {
    data: {
      webhookSubscriptions: {
        pageInfo: { hasNextPage: Boolean(next), endCursor: next ?? null },
        edges: nodes.map((n, i) => ({
          node: {
            id: `gid://shopify/WebhookSubscription/${n.topic}-${i}`,
            topic: n.topic,
            endpoint: n.type
              ? { __typename: n.type }
              : { __typename: "WebhookHttpEndpoint", callbackUrl: n.url },
          },
        })),
      },
    },
  };
}

describe("Abonnements visibles : sujet et adresse, sans secret", () => {
  afterEach(() => {
    delete process.env.SHOPIFY_STORE_DOMAIN;
    delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  });

  it("renvoie TOUS les abonnements, ceux de l'ancien déploiement compris", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
    const mockFetch = vi.fn(async () =>
      jsonResponse(page([
        { topic: "ORDERS_CREATE", url: OLD },
        { topic: "ORDERS_UPDATED", url: OLD },
        { topic: "PRODUCTS_UPDATE", url: NEW },
        { topic: "APP_UNINSTALLED", type: "WebhookEventBridgeEndpoint" },
      ])),
    ) as unknown as typeof fetch;

    const visible = await listVisibleSubscriptions(NEW, mockFetch);
    expect(visible).toHaveLength(4);
    expect(visible.filter((s) => !s.current).map((s) => s.topic).sort())
      .toEqual(["APP_UNINSTALLED", "ORDERS_CREATE", "ORDERS_UPDATED"]);
    expect(visible.find((s) => s.topic === "ORDERS_CREATE")?.callbackUrl).toBe(OLD);
    expect(visible.find((s) => s.topic === "PRODUCTS_UPDATE")?.current).toBe(true);
    // Un point de terminaison non HTTP n'expose ni ARN ni sujet Pub/Sub.
    const bridge = visible.find((s) => s.topic === "APP_UNINSTALLED")!;
    expect(bridge.endpointType).toBe("WebhookEventBridgeEndpoint");
    expect(bridge.callbackUrl).toBeUndefined();
    expect(Object.keys(bridge).sort()).toEqual(["callbackUrl", "current", "endpointType", "id", "topic"]);

    // L'état des sujets requis ne compte QUE la nouvelle adresse.
    const status = statusFromVisible(visible, NEW);
    expect(status.map((s) => [s.topic, s.subscribed])).toEqual([
      ["ORDERS_CREATE", false],
      ["ORDERS_UPDATED", false],
      ["PRODUCTS_CREATE", false],
      ["PRODUCTS_UPDATE", true],
    ]);
  });

  it("suit la pagination de Shopify", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "test-boutique.myshopify.com";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
    const cursors: (string | null)[] = [];
    const mockFetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const after = JSON.parse(String(init.body)).variables.after ?? null;
      cursors.push(after);
      return after === null
        ? jsonResponse(page([{ topic: "ORDERS_CREATE", url: OLD }], "curseur-2"))
        : jsonResponse(page([{ topic: "ORDERS_UPDATED", url: NEW }]));
    }) as unknown as typeof fetch;

    const visible = await listVisibleSubscriptions(NEW, mockFetch);
    expect(cursors).toEqual([null, "curseur-2"]);
    expect(visible.map((s) => s.topic)).toEqual(["ORDERS_CREATE", "ORDERS_UPDATED"]);
    expect((await listSubscriptionStatus(NEW, mockFetch)).find((s) => s.topic === "ORDERS_UPDATED")?.subscribed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotence : l'insertion est la garde.
// ---------------------------------------------------------------------------

/**
 * Faux client Supabase : un index unique sur webhook_id, en mémoire, et des
 * mises à jour CONDITIONNELLES qui ne touchent une ligne que si ses
 * conditions tiennent encore — exactement ce sur quoi repose la prise en
 * charge atomique.
 */
type Row = { id: string; webhook_id: string | null; status: string; received_at: string; error: string | null };

function fakeClient() {
  const rows: Row[] = [];
  let seq = 0;
  const client: WebhookEventsClient = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  const webhookId = (row.webhook_id as string | null) ?? null;
                  if (webhookId && rows.some((r) => r.webhook_id === webhookId)) {
                    return { data: null, error: { code: "23505", message: "duplicate key" } };
                  }
                  const inserted: Row = {
                    id: `evt-${++seq}`, webhook_id: webhookId, status: String(row.status),
                    received_at: new Date().toISOString(), error: null,
                  };
                  rows.push(inserted);
                  return { data: { id: inserted.id }, error: null };
                },
              };
            },
          };
        },
        select() {
          return {
            eq(_c: string, value: string) {
              return {
                async maybeSingle() {
                  const found = rows.find((r) => r.webhook_id === value);
                  return {
                    data: found
                      ? { id: found.id, status: found.status as never, received_at: found.received_at }
                      : null,
                    error: null,
                  };
                },
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          const conditions: ((r: Row) => boolean)[] = [];
          const apply = async () => {
            const touched = rows.filter((r) => conditions.every((c) => c(r)));
            for (const r of touched) Object.assign(r, values);
            return { data: touched.map((r) => ({ id: r.id })), error: null };
          };
          const eqFactory = (column: string, value: string) => {
            conditions.push((r) => String((r as never as Record<string, unknown>)[column]) === value);
            return chain;
          };
          const chain = {
            eq: eqFactory,
            lt(column: string, value: string) {
              conditions.push((r) => String((r as never as Record<string, unknown>)[column]) < value);
              return { select: () => apply() };
            },
            select: () => apply(),
          };
          return { eq: eqFactory } as never;
        },
      };
    },
  };
  return { client, rows };
}

const input = (webhookId: string | null) => ({
  topic: "orders/create",
  webhookId,
  shopifyId: "42",
  payload: { id: 42 },
  supported: true,
});

describe("Livraisons Shopify : doublons acquittés sans retraitement", () => {
  it("première livraison : nouveau, une ligne de journal", async () => {
    const { client, rows } = fakeClient();
    const r = await registerWebhookEvent(client, input("wh-1"));
    expect(r.kind).toBe("nouveau");
    expect(rows).toHaveLength(1);
  });

  it("relivraison d'un événement traité : doublon, AUCUNE nouvelle ligne", async () => {
    const { client, rows } = fakeClient();
    await registerWebhookEvent(client, input("wh-1"));
    rows[0].status = "traite";
    const r = await registerWebhookEvent(client, input("wh-1"));
    expect(r).toMatchObject({ kind: "doublon", eventId: "evt-1", status: "traite" });
    expect(rows).toHaveLength(1);
  });

  it("deux livraisons simultanées : une seule passe, l'autre est un doublon", async () => {
    const { client, rows } = fakeClient();
    const [a, b] = await Promise.all([
      registerWebhookEvent(client, input("wh-1")),
      registerWebhookEvent(client, input("wh-1")),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["doublon", "nouveau"]);
    expect(rows).toHaveLength(1);
  });

  it("relivraison après un ÉCHEC de traitement : reprise sur la même ligne", async () => {
    const { client, rows } = fakeClient();
    await registerWebhookEvent(client, input("wh-1"));
    rows[0].status = "erreur";
    const r = await registerWebhookEvent(client, input("wh-1"));
    expect(r).toEqual({ kind: "reprise", eventId: "evt-1", reason: "echec" });
    expect(rows).toHaveLength(1);
  });

  it("deux relivraisons SIMULTANÉES après un échec : une seule reprend, l'autre est un doublon", async () => {
    const { client, rows } = fakeClient();
    await registerWebhookEvent(client, input("wh-1"));
    rows[0].status = "erreur";
    rows[0].error = "panne";
    const [a, b] = await Promise.all([
      registerWebhookEvent(client, input("wh-1")),
      registerWebhookEvent(client, input("wh-1")),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["doublon", "reprise"]);
    expect(rows).toHaveLength(1);
    // La ligne est repassée « recu », erreur effacée : le retraitement est en cours.
    expect(rows[0].status).toBe("recu");
    expect(rows[0].error).toBeNull();
  });

  it("livraison restée « recu » après interruption du serveur : reprise après le délai, une seule fois", async () => {
    const { client, rows } = fakeClient();
    await registerWebhookEvent(client, input("wh-1"));
    // Le serveur est tombé : la ligne reste « recu ». Peu après, Shopify relivre.
    const t0 = new Date(rows[0].received_at).getTime();
    const bientot = () => new Date(t0 + 60 * 1000);
    const encoreEnCours = await registerWebhookEvent(client, input("wh-1"), bientot);
    expect(encoreEnCours.kind).toBe("doublon"); // traitement peut-être encore en cours : on ne double pas

    // Bien plus tard, deux relivraisons simultanées : une seule reprend.
    const plusTard = () => new Date(t0 + STALE_AFTER_MS + 1000);
    const [a, b] = await Promise.all([
      registerWebhookEvent(client, input("wh-1"), plusTard),
      registerWebhookEvent(client, input("wh-1"), plusTard),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["doublon", "reprise"]);
    const reprise = [a, b].find((r) => r.kind === "reprise")!;
    expect(reprise).toMatchObject({ eventId: "evt-1", reason: "interrompue" });
    expect(rows).toHaveLength(1);
    // received_at a été avancé : une troisième relivraison immédiate est un doublon.
    const c = await registerWebhookEvent(client, input("wh-1"), plusTard);
    expect(c.kind).toBe("doublon");
  });

  it("une ligne « traite » ou « ignore » n'est jamais reprise", async () => {
    for (const status of ["traite", "ignore"] as const) {
      const { client, rows } = fakeClient();
      await registerWebhookEvent(client, input("wh-1"));
      rows[0].status = status;
      const r = await registerWebhookEvent(client, input("wh-1"), () => new Date(Date.now() + 2 * STALE_AFTER_MS));
      expect(r).toMatchObject({ kind: "doublon", status });
    }
  });

  it("sans identifiant de livraison : jamais considéré comme doublon", async () => {
    const { client, rows } = fakeClient();
    const a = await registerWebhookEvent(client, input(null));
    const b = await registerWebhookEvent(client, input(null));
    expect(a.kind).toBe("nouveau");
    expect(b.kind).toBe("nouveau");
    expect(rows).toHaveLength(2);
  });
});
