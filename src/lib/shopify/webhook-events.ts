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
 * Trois issues :
 *   * `nouveau`  — première livraison : à traiter ;
 *   * `doublon`  — déjà reçue et traitée (ou en cours) : acquitter sans
 *                  retraitement, sans nouvelle ligne de journal ;
 *   * `reprise`  — déjà reçue mais le traitement avait ÉCHOUÉ : Shopify
 *                  relivre justement pour cela, on retraite sur la MÊME
 *                  ligne de journal.
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
  | { kind: "reprise"; eventId: string };

/**
 * Sous-ensemble du client Supabase utilisé ici (facilite les tests). Les
 * constructeurs PostgREST sont « thenables », pas des Promise : on ne
 * demande que `then`.
 */
type Thenable<T> = PromiseLike<T>;

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
          data: { id: string; status: WebhookEventStatus } | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
}

const UNIQUE_VIOLATION = "23505";

export async function registerWebhookEvent(
  supabase: WebhookEventsClient,
  input: WebhookEventInput,
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
    .select("id, status")
    .eq("webhook_id", input.webhookId)
    .maybeSingle();

  if (!existing) {
    // Course extrême : la ligne concurrente a disparu entre-temps. On
    // acquitte : l'autre livraison a la main.
    return { kind: "doublon", eventId: "", status: "recu" };
  }
  if (existing.status === "erreur") {
    return { kind: "reprise", eventId: existing.id };
  }
  return { kind: "doublon", eventId: existing.id, status: existing.status };
}
