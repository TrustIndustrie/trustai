import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  mapOrderPayload,
  mapProductPayload,
  verifyShopDomain,
  verifyShopifyHmac,
} from "@/lib/shopify/mapping";
import {
  getAllowedShopDomains,
  getWebhookSigningSecrets,
  isShopifyWebhookConfigured,
} from "@/lib/shopify/config";
import {
  getOrganizationId,
  upsertOrder,
  upsertProduct,
} from "@/lib/shopify/sync";
import {
  duplicateResponse,
  registerWebhookEvent,
  type WebhookEventsClient,
} from "@/lib/shopify/webhook-events";

/**
 * Réception des webhooks Shopify — conforme au parcours 2026
 * (https://shopify.dev/docs/apps/build/webhooks/verify-deliveries) :
 *
 *  1. le CORPS BRUT est lu avant tout parsing JSON ;
 *  2. la signature X-Shopify-Hmac-Sha256 est vérifiée en temps constant
 *     avec le Client Secret de l'application (l'ancienne clé
 *     « Notifications » reste acceptée en repli legacy) ;
 *  3. X-Shopify-Shop-Domain doit correspondre exactement à
 *     SHOPIFY_STORE_DOMAIN — on ne fait jamais confiance aux données
 *     d'identité du payload ;
 *  4. X-Shopify-Webhook-Id assure l'idempotence : l'INSERTION dans le
 *     journal est la garde (index unique), pas une lecture préalable — deux
 *     livraisons simultanées ne peuvent pas passer toutes les deux. Une
 *     relivraison d'un événement TERMINÉ ou ignoré est acquittée (200)
 *     sans retraitement ni nouvelle ligne de journal ; une relivraison
 *     d'un événement encore « recu » reçoit 409 (Shopify relivrera) ; une
 *     événement dont le traitement avait ÉCHOUÉ, ou resté « recu » après
 *     une interruption du serveur, est PRISE EN CHARGE atomiquement par un
 *     seul appel et retraitée sur la même ligne ;
 *  5. les écritures utilisent la clé serveur Supabase, jamais exposée au
 *     navigateur ; aucun secret n'apparaît dans les réponses ni les logs.
 *
 * Règle métier : un orders/updated met à jour montants/quantités mais ne
 * touche JAMAIS au suivi d'approvisionnement saisi par l'équipe.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Durée maximale explicite (secondes). Au-delà, Vercel interrompt la
 * fonction et la ligne de journal reste « recu » : STALE_AFTER_MS (15 min)
 * est très supérieur à cette valeur ET au plafond absolu de Vercel
 * (800 s avec Fluid Compute), donc une reprise ne peut jamais doubler un
 * traitement encore en cours.
 */
export const maxDuration = 60;

const SUPPORTED_TOPICS = new Set([
  "orders/create",
  "orders/updated",
  "products/create",
  "products/update",
]);

export async function POST(request: Request) {
  if (!isShopifyWebhookConfigured()) {
    return NextResponse.json(
      {
        error:
          "Webhook Shopify non configuré : SHOPIFY_STORE_DOMAIN et SHOPIFY_CLIENT_SECRET sont requis (voir docs/SHOPIFY_SETUP.md).",
      },
      { status: 503 },
    );
  }

  // 1. Corps brut AVANT tout parsing.
  const rawBody = await request.text();

  // 2. Signature HMAC (Client Secret, repli legacy accepté).
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyHmac(rawBody, hmacHeader, getWebhookSigningSecrets())) {
    return NextResponse.json({ error: "Signature HMAC invalide." }, { status: 401 });
  }

  // 3. La boutique émettrice doit figurer dans la liste blanche.
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  if (!verifyShopDomain(shopDomain, getAllowedShopDomains())) {
    // Le domaine reçu est indiqué pour permettre de corriger la
    // configuration (il n'a rien de secret : Shopify l'envoie en clair).
    return NextResponse.json(
      {
        error: `Boutique émettrice inattendue : « ${shopDomain ?? "domaine absent"} » ne figure pas dans SHOPIFY_STORE_DOMAIN. Ajoutez-le (plusieurs domaines possibles, séparés par des virgules) — voir docs/SHOPIFY_SETUP.md.`,
      },
      { status: 401 },
    );
  }

  const topic = request.headers.get("x-shopify-topic") ?? "inconnu";
  const webhookId = request.headers.get("x-shopify-webhook-id");

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Clé serveur Supabase absente (SUPABASE_SECRET_KEY)." },
      { status: 503 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  // 4. Idempotence + journalisation en UNE écriture : l'index unique sur
  //    webhook_id tranche entre première livraison, doublon et reprise.
  // Le client Supabase est typé de façon très générique ; on ne lui demande
  // ici que les trois appels décrits par WebhookEventsClient.
  const registration = await registerWebhookEvent(supabase as unknown as WebhookEventsClient, {
    topic,
    webhookId,
    shopifyId: payload.id !== undefined ? String(payload.id) : null,
    payload,
    supported: SUPPORTED_TOPICS.has(topic),
  });
  if (registration.kind === "doublon") {
    // 200 seulement si l'événement est TERMINÉ ou ignoré ; sinon 409 pour
    // que Shopify relivre tant que le traitement n'est pas achevé.
    const response = duplicateResponse(registration.status);
    return NextResponse.json(response.body, { status: response.httpStatus });
  }
  const eventId = registration.eventId ?? undefined;
  const retry = registration.kind === "reprise" ? registration.reason : undefined;

  if (!SUPPORTED_TOPICS.has(topic)) {
    // Sujet non géré : accusé de réception pour éviter les re-livraisons.
    return NextResponse.json({ ok: true, ignored: topic });
  }

  try {
    const organizationId = await getOrganizationId(supabase);
    if (!organizationId) {
      throw new Error("Aucune organisation en base : appliquez le seed Supabase.");
    }
    if (topic === "orders/create" || topic === "orders/updated") {
      await upsertOrder(supabase, organizationId, mapOrderPayload(payload));
    } else {
      await upsertProduct(supabase, organizationId, mapProductPayload(payload));
    }
    if (eventId) {
      await supabase
        .from("shopify_webhook_events")
        .update({ status: "traite", error: null, processed_at: new Date().toISOString() })
        .eq("id", eventId);
    }
    return NextResponse.json({ ok: true, retried: retry });
  } catch (error) {
    if (eventId) {
      await supabase
        .from("shopify_webhook_events")
        .update({
          status: "erreur",
          error: error instanceof Error ? error.message : String(error),
          processed_at: new Date().toISOString(),
        })
        .eq("id", eventId);
    }
    // 500 → Shopify retentera la livraison automatiquement.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur de traitement." },
      { status: 500 },
    );
  }
}
