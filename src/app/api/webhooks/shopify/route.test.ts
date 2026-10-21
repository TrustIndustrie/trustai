import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { STALE_AFTER_MS } from "@/lib/shopify/webhook-events";

/**
 * Séquence complète sur la ROUTE de réception, avec un faux Supabase à
 * index unique et un traitement métier contrôlé :
 *   1. première livraison : le traitement est INTERROMPU (ne répond jamais) ;
 *   2. relivraison avant expiration : 409, aucun retraitement ;
 *   3. relivraison après expiration : reprise, traitement, 200 ;
 *   4. relivraison suivante : 200 « terminé », aucun retraitement.
 */

type Row = Record<string, unknown> & { id: string; status: string; received_at: string };
const rows: Row[] = [];
let seq = 0;

function thenable<T>(fn: () => T) {
  return { then: (res: (v: T) => unknown) => Promise.resolve(fn()).then(res) };
}

function fakeSupabase() {
  return {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                single: () =>
                  thenable(() => {
                    if (row.webhook_id && rows.some((r) => r.webhook_id === row.webhook_id)) {
                      return { data: null, error: { code: "23505" } };
                    }
                    const inserted = { ...row, id: `evt-${++seq}`, received_at: new Date().toISOString(), error: null } as unknown as Row;
                    rows.push(inserted);
                    return { data: { id: inserted.id }, error: null };
                  }),
              };
            },
          };
        },
        select() {
          return {
            eq: (_c: string, v: string) => ({
              maybeSingle: () =>
                thenable(() => {
                  const f = rows.find((r) => r.webhook_id === v);
                  return { data: f ? { id: f.id, status: f.status, received_at: f.received_at } : null, error: null };
                }),
            }),
          };
        },
        update(values: Record<string, unknown>) {
          const conds: ((r: Row) => boolean)[] = [];
          const apply = () => {
            const touched = rows.filter((r) => conds.every((c) => c(r)));
            for (const r of touched) Object.assign(r, values);
            return { data: touched.map((r) => ({ id: r.id })), error: null };
          };
          const chain: Record<string, unknown> = {
            eq(c: string, v: string) { conds.push((r) => String(r[c]) === v); return chain; },
            lt(c: string, v: string) { conds.push((r) => String(r[c]) < v); return chain; },
            select: () => thenable(apply),
            then: (res: (v: unknown) => unknown) => Promise.resolve(apply()).then(res),
          };
          return chain;
        },
      };
    },
  };
}

// Le traitement métier : la première exécution reste suspendue à jamais
// (fonction interrompue), les suivantes aboutissent.
const upserts: string[] = [];
let hang = true;
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeSupabase() }));
vi.mock("@/lib/shopify/sync", () => ({
  getOrganizationId: async () => "org-1",
  upsertOrder: async (_s: unknown, _o: string, order: { shopifyId: string }) => {
    upserts.push(order.shopifyId);
    if (hang) return new Promise<never>(() => {});
  },
  upsertProduct: async () => {},
}));

const SECRET = "secret-de-test";
const DOMAIN = "wn02qe-0w.myshopify.com";

function deliver(webhookId: string) {
  const body = JSON.stringify({ id: 4242, name: "#TR4242", line_items: [] });
  const hmac = createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
  return new Request("https://trustai.example/api/webhooks/shopify", {
    method: "POST",
    headers: {
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-shop-domain": DOMAIN,
      "x-shopify-topic": "orders/create",
      "x-shopify-webhook-id": webhookId,
      "content-type": "application/json",
    },
    body,
  });
}

describe("Route de réception : interruption, relivraison, reprise", () => {
  beforeEach(() => {
    process.env.SHOPIFY_STORE_DOMAIN = DOMAIN;
    process.env.SHOPIFY_CLIENT_SECRET = SECRET;
    process.env.SUPABASE_SECRET_KEY = "sb-test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    rows.length = 0; upserts.length = 0; seq = 0; hang = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("interrompue, puis 409 avant expiration, puis reprise unique après expiration", async () => {
    const { POST } = await import("./route");

    // 1. Première livraison : le traitement démarre puis la fonction est coupée.
    const interrompue = POST(deliver("wh-1"));
    await vi.waitFor(() => expect(upserts).toHaveLength(1));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("recu");
    void interrompue; // ne se résout jamais : fonction interrompue.

    // 2. Relivraison 1 minute plus tard : traitement peut-être en cours → 409.
    hang = false;
    vi.setSystemTime(new Date("2026-09-18T12:01:00Z"));
    const avant = await POST(deliver("wh-1"));
    expect(avant.status).toBe(409);
    expect(await avant.json()).toMatchObject({ ok: false, duplicate: true, retry: true, status: "recu" });
    expect(upserts).toHaveLength(1); // AUCUN retraitement
    expect(rows).toHaveLength(1);

    // 3. Relivraison après expiration : reprise, une seule, même ligne, 200.
    vi.setSystemTime(new Date(Date.parse("2026-09-18T12:00:00Z") + STALE_AFTER_MS + 1000));
    const [a, b] = await Promise.all([POST(deliver("wh-1")), POST(deliver("wh-1"))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ok = a.status === 200 ? a : b;
    expect(await ok.json()).toMatchObject({ ok: true, retried: "interrompue" });
    expect(upserts).toHaveLength(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("traite");

    // 4. Relivraison d'un événement terminé : 200 sans retraitement.
    const fini = await POST(deliver("wh-1"));
    expect(fini.status).toBe(200);
    expect(await fini.json()).toMatchObject({ ok: true, duplicate: true, status: "traite" });
    expect(upserts).toHaveLength(2);
  });

  it("signature invalide : 401 sans écriture", async () => {
    const { POST } = await import("./route");
    const req = deliver("wh-2");
    const mauvaise = new Request(req, { headers: { ...Object.fromEntries(req.headers), "x-shopify-hmac-sha256": "AAAA" } });
    const res = await POST(mauvaise);
    expect(res.status).toBe(401);
    expect(rows).toHaveLength(0);
  });
});
