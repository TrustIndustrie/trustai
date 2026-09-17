import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/serverGuard";
import { isShopifyAdminConfigured } from "@/lib/shopify/config";
import { ShopifyConfigError } from "@/lib/shopify/auth";
import {
  ensureSubscriptions,
  listSubscriptionStatus,
} from "@/lib/shopify/webhooks";

/**
 * Gestion des abonnements webhooks Shopify (API Admin GraphQL).
 *
 * - GET : liste l'état des 4 abonnements requis (existants / manquants) ;
 * - POST : crée UNIQUEMENT les abonnements manquants (aucun doublon).
 *
 * Autorisation vérifiée côté serveur : permission « administrer ».
 * Aucun abonnement n'est créé automatiquement au chargement d'une page :
 * la création n'a lieu que sur action explicite (POST).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function callbackUrlFrom(request: Request): string {
  // URL publique de l'application : NEXT_PUBLIC_APP_URL en priorité,
  // sinon l'origine de la requête (domaine Vercel).
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const origin = configured || new URL(request.url).origin;
  return `${origin}/api/webhooks/shopify`;
}

async function guardAndConfig() {
  const guard = await requirePermission("administrer");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  if (!isShopifyAdminConfigured()) {
    return NextResponse.json(
      {
        error:
          "Shopify non configuré : renseignez SHOPIFY_STORE_DOMAIN + SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (voir docs/SHOPIFY_SETUP.md).",
      },
      { status: 503 },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const blocked = await guardAndConfig();
  if (blocked) return blocked;
  const callbackUrl = callbackUrlFrom(request);
  try {
    const subscriptions = await listSubscriptionStatus(callbackUrl);
    return NextResponse.json({ ok: true, callbackUrl, subscriptions });
  } catch (error) {
    const message =
      error instanceof ShopifyConfigError || error instanceof Error
        ? error.message
        : "Erreur Shopify.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const blocked = await guardAndConfig();
  if (blocked) return blocked;
  const callbackUrl = callbackUrlFrom(request);
  try {
    const result = await ensureSubscriptions(callbackUrl);
    return NextResponse.json({ ok: true, callbackUrl, ...result });
  } catch (error) {
    const message =
      error instanceof ShopifyConfigError || error instanceof Error
        ? error.message
        : "Erreur Shopify.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
