import { shopifyGraphQL } from "./admin-api";

/**
 * Gestion des abonnements webhooks via l'API Admin GraphQL (parcours
 * actuel — plus de création manuelle dans l'ancienne section
 * Notifications pour une application Dev Dashboard).
 *
 * Les abonnements ne sont JAMAIS créés automatiquement au chargement d'une
 * page : uniquement via une action explicite d'un administrateur, dont
 * l'autorisation est vérifiée côté serveur (route /api/shopify/webhooks).
 */

export const REQUIRED_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
] as const;

export type WebhookTopic = (typeof REQUIRED_TOPICS)[number];

export interface SubscriptionStatus {
  topic: WebhookTopic;
  subscribed: boolean;
  callbackUrl?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const LIST_QUERY = `
  query TrustAiWebhookSubscriptions {
    webhookSubscriptions(first: 50) {
      edges {
        node {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
        }
      }
    }
  }
`;

const CREATE_MUTATION = `
  mutation TrustAiWebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic }
      userErrors { field message }
    }
  }
`;

/** État des abonnements requis, comparé à l'URL publique de l'application. */
export async function listSubscriptionStatus(
  callbackUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubscriptionStatus[]> {
  const data = await shopifyGraphQL<any>(LIST_QUERY, {}, fetchImpl);
  const existing: { topic: string; callbackUrl?: string }[] =
    (data.webhookSubscriptions?.edges ?? []).map((edge: any) => ({
      topic: edge.node.topic,
      callbackUrl: edge.node.endpoint?.callbackUrl,
    }));
  return REQUIRED_TOPICS.map((topic) => {
    const match = existing.find(
      (e) => e.topic === topic && e.callbackUrl === callbackUrl,
    );
    return {
      topic,
      subscribed: Boolean(match),
      callbackUrl: match?.callbackUrl,
    };
  });
}

/**
 * Crée les abonnements MANQUANTS uniquement (aucun doublon : les sujets
 * déjà abonnés vers la même URL sont laissés tels quels).
 */
export async function ensureSubscriptions(
  callbackUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ created: WebhookTopic[]; already: WebhookTopic[] }> {
  const statuses = await listSubscriptionStatus(callbackUrl, fetchImpl);
  const created: WebhookTopic[] = [];
  const already: WebhookTopic[] = [];
  for (const status of statuses) {
    if (status.subscribed) {
      already.push(status.topic);
      continue;
    }
    const result = await shopifyGraphQL<any>(
      CREATE_MUTATION,
      {
        topic: status.topic,
        webhookSubscription: { callbackUrl, format: "JSON" },
      },
      fetchImpl,
    );
    const errors = result.webhookSubscriptionCreate?.userErrors ?? [];
    if (errors.length > 0) {
      throw new Error(
        `Création de l'abonnement ${status.topic} refusée : ${errors
          .map((e: any) => e.message)
          .join(" ; ")}`,
      );
    }
    created.push(status.topic);
  }
  return { created, already };
}
