import { afterEach, describe, expect, it, vi } from "vitest";
import { listSubscriptionStatus, listVisibleSubscriptions, statusFromVisible } from "./webhooks";
import { registerWebhookEvent, type WebhookEventsClient } from "./webhook-events";

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

/** Faux client Supabase : un index unique sur webhook_id, en mémoire. */
function fakeClient() {
  const rows: { id: string; webhook_id: string | null; status: string }[] = [];
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
                  const inserted = { id: `evt-${++seq}`, webhook_id: webhookId, status: String(row.status) };
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
                    data: found ? { id: found.id, status: found.status as never } : null,
                    error: null,
                  };
                },
              };
            },
          };
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
    expect(r).toEqual({ kind: "reprise", eventId: "evt-1" });
    expect(rows).toHaveLength(1);
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
