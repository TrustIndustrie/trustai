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

/**
 * Un abonnement tel que Shopify le renvoie, sans rien de secret : le sujet,
 * le type de point de terminaison et, pour un point HTTP, son adresse.
 *
 * Limite Shopify : l'API Admin ne renvoie que les abonnements créés par
 * l'APPLICATION dont on utilise les identifiants. Ceux d'une autre
 * application, ou créés à la main dans Paramètres → Notifications, restent
 * invisibles ici.
 */
export interface VisibleSubscription {
  id: string;
  topic: string;
  endpointType: string;
  callbackUrl?: string;
  /** true si l'adresse est celle de CETTE application. */
  current: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const LIST_QUERY = `
  query TrustAiWebhookSubscriptions($after: String) {
    webhookSubscriptions(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
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

/**
 * TOUS les abonnements visibles par l'application, toutes pages confondues,
 * avec leur adresse. Lecture seule.
 */
export async function listVisibleSubscriptions(
  callbackUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VisibleSubscription[]> {
  const out: VisibleSubscription[] = [];
  let after: string | null = null;
  // Garde-fou : jamais plus de 20 pages (1 000 abonnements).
  for (let page = 0; page < 20; page++) {
    const data: any = await shopifyGraphQL<any>(LIST_QUERY, { after }, fetchImpl);
    const connection: any = data.webhookSubscriptions ?? {};
    for (const edge of connection.edges ?? []) {
      const node = edge.node ?? {};
      const url: string | undefined = node.endpoint?.callbackUrl ?? undefined;
      out.push({
        id: String(node.id ?? ""),
        topic: String(node.topic ?? ""),
        endpointType: String(node.endpoint?.__typename ?? "inconnu"),
        callbackUrl: url,
        current: url === callbackUrl,
      });
    }
    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo?.endCursor) break;
    after = connection.pageInfo.endCursor;
  }
  return out;
}

/** État des abonnements requis, comparé à l'URL publique de l'application. */
export async function listSubscriptionStatus(
  callbackUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubscriptionStatus[]> {
  return statusFromVisible(await listVisibleSubscriptions(callbackUrl, fetchImpl), callbackUrl);
}

/** Même calcul, à partir d'une liste déjà lue (évite une seconde lecture). */
export function statusFromVisible(
  existing: VisibleSubscription[],
  callbackUrl: string,
): SubscriptionStatus[] {
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
