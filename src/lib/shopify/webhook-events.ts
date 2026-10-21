/**
 * Journal des livraisons de webhooks Shopify et idempotence.
 *
 * Shopify peut livrer le MÊME événement plusieurs fois (relivraison après
 * un délai, ou deux livraisons strictement simultanées). L'identifiant
 * `X-Shopify-Webhook-Id` est unique par événement et la table
 * `shopify_webhook_events` porte un index unique dessus.
 *
 * L'INSERTION est la garde : c'est la base qui tranche, pas une lecture
 * préalable. Deux livraisons simultanées font deux insertions ; une seule
 * passe, l'autre reçoit une violation d'unicité et est traitée comme un
 * doublon. Aucune fenêtre entre « lire » et « écrire ».
 *
 * Quand la ligne existe déjà, sa PRISE EN CHARGE est elle aussi atomique :
 * une mise à jour conditionnelle (« si le statut est encore celui-ci »)
 * qui ne peut réussir que pour UN seul appelant.
 *
 * Trois issues :
 *   * `nouveau`  — première livraison : à traiter ;
 *   * `doublon`  — déjà reçue et traitée, ou en cours de traitement par un
 *                  autre appel : acquitter sans retraitement, sans nouvelle
 *                  ligne de journal ;
 *   * `reprise`  — cet appel a PRIS EN CHARGE une ligne dont le traitement
 *                  avait échoué, ou une ligne restée « recu » trop
 *                  longtemps (serveur interrompu en plein traitement) : on
 *                  retraite sur la MÊME ligne.
 */

export type WebhookEventStatus = "recu" | "traite" | "erreur" | "ignore";

export interface WebhookEventInput {
  topic: string;
  webhookId: string | null;
  shopifyId: string | null;
  payload: Record<string, unknown>;
  supported: boolean;
}

export type WebhookEventRegistration =
  | { kind: "nouveau"; eventId: string | null }
  | { kind: "doublon"; eventId: string; status: WebhookEventStatus }
  | { kind: "reprise"; eventId: string; reason: "echec" | "interrompue" };

/**
 * Au-delà de ce délai, une ligne encore « recu » est considérée comme
 * abandonnée (fonction interrompue, délai dépassé) : la relivraison
 * suivante la reprend. Plus long que toute durée d'exécution possible d'une
 * fonction Vercel, pour ne jamais doubler un traitement encore en cours.
 */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Réponse à donner à Shopify pour un DOUBLON. Un 200 acquitte
 * définitivement : réservé aux événements terminés (« traite ») ou
 * volontairement ignorés. Un événement encore « recu » (traitement en cours,
 * ou interrompu mais pas encore repris) reçoit un 409 : Shopify relivrera,
 * et la relivraison le reprendra une fois le délai passé.
 */
export function duplicateResponse(status: WebhookEventStatus): {
  httpStatus: 200 | 409;
  body: Record<string, unknown>;
} {
  if (status === "traite" || status === "ignore") {
    return { httpStatus: 200, body: { ok: true, duplicate: true, status } };
  }
  return {
    httpStatus: 409,
    body: {
      ok: false,
      duplicate: true,
      status,
      retry: true,
      error: "Événement en cours de traitement : relivraison attendue.",
    },
  };
}

/**
 * Sous-ensemble du client Supabase utilisé ici (facilite les tests). Les
 * constructeurs PostgREST sont « thenables », pas des Promise : on ne
 * demande que `then`.
 */
type Thenable<T> = PromiseLike<T>;

interface ExistingRow {
  id: string;
  status: WebhookEventStatus;
  received_at: string;
}

export interface WebhookEventsClient {
  from(table: "shopify_webhook_events"): {
    insert(row: Record<string, unknown>): {
      select(columns: string): {
        single(): Thenable<{
          data: { id: string } | null;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Thenable<{
          data: ExistingRow | null;
          error: { message?: string } | null;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          select(columns: string): Thenable<{
            data: { id: string }[] | null;
            error: { message?: string } | null;
          }>;
          lt(column: string, value: string): {
            select(columns: string): Thenable<{
              data: { id: string }[] | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  };
}

const UNIQUE_VIOLATION = "23505";

export async function registerWebhookEvent(
  supabase: WebhookEventsClient,
  input: WebhookEventInput,
  now: () => Date = () => new Date(),
): Promise<WebhookEventRegistration> {
  const { data, error } = await supabase
    .from("shopify_webhook_events")
    .insert({
      topic: input.topic,
      webhook_id: input.webhookId,
      shopify_id: input.shopifyId,
      payload: input.payload,
      status: input.supported ? "recu" : "ignore",
    })
    .select("id")
    .single();

  if (!error) {
    return { kind: "nouveau", eventId: data?.id ?? null };
  }

  if (error.code !== UNIQUE_VIOLATION || !input.webhookId) {
    // Journalisation impossible pour une autre raison : on traite quand
    // même (les écritures métier sont des upserts), sans identifiant de
    // journal. Comportement identique à l'ancien code.
    return { kind: "nouveau", eventId: null };
  }

  const { data: existing } = await supabase
    .from("shopify_webhook_events")
    .select("id, status, received_at")
    .eq("webhook_id", input.webhookId)
    .maybeSingle();

  if (!existing) {
    // Course extrême : la ligne concurrente a disparu entre-temps. On
    // acquitte : l'autre livraison a la main.
    return { kind: "doublon", eventId: "", status: "recu" };
  }

  const nowIso = now().toISOString();

  if (existing.status === "erreur") {
    // Prise en charge ATOMIQUE : seul l'appel dont la mise à jour touche
    // une ligne retraite ; les autres relivraisons simultanées voient un
    // doublon.
    const { data: claimed } = await supabase
      .from("shopify_webhook_events")
      .update({ status: "recu", error: null, processed_at: null, received_at: nowIso })
      .eq("id", existing.id)
      .eq("status", "erreur")
      .select("id");
    if (claimed && claimed.length > 0) {
      return { kind: "reprise", eventId: existing.id, reason: "echec" };
    }
    return { kind: "doublon", eventId: existing.id, status: "recu" };
  }

  if (existing.status === "recu") {
    // Toujours « recu » : soit un traitement est EN COURS (doublon), soit
    // le serveur a été interrompu et la ligne est restée là. Passé le
    // délai, on la reprend — atomiquement, en avançant received_at pour
    // qu'un autre appel simultané ne la reprenne pas aussi.
    const cutoff = new Date(now().getTime() - STALE_AFTER_MS).toISOString();
    const { data: claimed } = await supabase
      .from("shopify_webhook_events")
      .update({ received_at: nowIso, error: null })
      .eq("id", existing.id)
      .eq("status", "recu")
      .lt("received_at", cutoff)
      .select("id");
    if (claimed && claimed.length > 0) {
      return { kind: "reprise", eventId: existing.id, reason: "interrompue" };
    }
    return { kind: "doublon", eventId: existing.id, status: "recu" };
  }

  return { kind: "doublon", eventId: existing.id, status: existing.status };
}
