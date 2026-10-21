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

const UPDATE_MUTATION = `
  mutation TrustAiWebhookSubscriptionUpdate(
    $id: ID!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
        endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
      }
      userErrors { field message }
    }
  }
`;

export interface RetargetPlanItem {
  id: string;
  topic: string;
  from: string;
  to: string;
}

export interface RetargetResult {
  dryRun: boolean;
  /** Abonnements concernés (adresse = `from`), modifiés si `dryRun` est faux. */
  plan: RetargetPlanItem[];
  /** Abonnements effectivement modifiés (vide en simulation). */
  updated: RetargetPlanItem[];
  /** Pour revenir en arrière : même appel avec from/to inversés. */
  rollback: { from: string; to: string };
}

/**
 * BASCULE : fait pointer vers `to` tous les abonnements qui pointent vers
 * `from`, en MODIFIANT chaque abonnement (même identifiant, même sujet) —
 * ni création, ni suppression, donc jamais de double livraison pendant
 * l'opération. Le retour arrière est le même appel, adresses inversées.
 *
 * Par défaut `dryRun` est vrai : on renvoie le plan sans rien changer.
 * Les abonnements qui pointent déjà vers `to`, ou ailleurs, ne sont pas
 * touchés.
 */
export async function retargetSubscriptions(
  from: string,
  to: string,
  options: { dryRun?: boolean } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<RetargetResult> {
  const dryRun = options.dryRun ?? true;
  if (!/^https:\/\/[^/\s]+\/api\/webhooks\/shopify$/.test(to)) {
    throw new Error(
      "Adresse cible invalide : attendu https://<domaine>/api/webhooks/shopify.",
    );
  }
  if (from === to) {
    throw new Error("Les adresses source et cible sont identiques.");
  }
  const visible = await listVisibleSubscriptions(to, fetchImpl);
  const plan: RetargetPlanItem[] = visible
    .filter((s) => s.endpointType === "WebhookHttpEndpoint" && s.callbackUrl === from)
    .map((s) => ({ id: s.id, topic: s.topic, from, to }));

  const updated: RetargetPlanItem[] = [];
  if (!dryRun) {
    for (const item of plan) {
      const result = await shopifyGraphQL<any>(
        UPDATE_MUTATION,
        { id: item.id, webhookSubscription: { callbackUrl: to, format: "JSON" } },
        fetchImpl,
      );
      const errors = result.webhookSubscriptionUpdate?.userErrors ?? [];
      if (errors.length > 0) {
        throw new Error(
          `Bascule de ${item.topic} refusée après ${updated.length} modification(s) : ${errors
            .map((e: any) => e.message)
            .join(" ; ")}. Retour arrière : rebasculer ${updated
            .map((u) => u.topic)
            .join(", ") || "aucun"} de ${to} vers ${from}.`,
        );
      }
      const applied = result.webhookSubscriptionUpdate?.webhookSubscription?.endpoint?.callbackUrl;
      if (applied !== to) {
        throw new Error(
          `Bascule de ${item.topic} : Shopify renvoie l'adresse « ${applied ?? "?"} » au lieu de la cible.`,
        );
      }
      updated.push(item);
    }
  }
  return { dryRun, plan, updated, rollback: { from: to, to: from } };
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
