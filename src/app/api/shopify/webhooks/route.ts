import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/serverGuard";
import { isShopifyAdminConfigured } from "@/lib/shopify/config";
import { ShopifyConfigError } from "@/lib/shopify/auth";
import {
  ensureSubscriptions,
  listVisibleSubscriptions,
  retargetSubscriptions,
  statusFromVisible,
} from "@/lib/shopify/webhooks";

/**
 * Gestion des abonnements webhooks Shopify (API Admin GraphQL).
 *
 * - GET : liste l'état des 4 abonnements requis (existants / manquants) ET
 *   tous les abonnements visibles par l'application, avec leur adresse —
 *   pour repérer ceux qui pointent encore vers un ancien déploiement.
 *   Aucun secret : sujets, types de point de terminaison et adresses de
 *   rappel uniquement ;
 * - POST sans corps : crée UNIQUEMENT les abonnements manquants (aucun
 *   doublon) ;
 * - POST { action: "retarget", from, to, dryRun } : BASCULE les abonnements
 *   qui pointent vers `from` vers `to`, par modification (même identifiant,
 *   ni création ni suppression). `dryRun` vaut vrai par défaut : le plan est
 *   renvoyé sans rien changer ; il faut `dryRun: false` explicitement pour
 *   agir. Retour arrière : même appel, adresses inversées.
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

/** Corps JSON facultatif : absent ou vide → null. */
async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    throw new Error("Corps JSON invalide.");
  }
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
    const visible = await listVisibleSubscriptions(callbackUrl);
    const subscriptions = statusFromVisible(visible, callbackUrl);
    return NextResponse.json({
      ok: true,
      callbackUrl,
      subscriptions,
      // Tous les abonnements de l'application, adresse comprise. Ceux dont
      // `current` est false pointent ailleurs (ancien déploiement, autre
      // environnement) : à examiner avant tout nettoyage.
      visible,
      visibleCount: visible.length,
      other: visible.filter((s) => !s.current),
    });
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
    const body = await readJsonBody(request);
    if (body?.action === "retarget") {
      const from = typeof body.from === "string" ? body.from.trim() : "";
      const to = typeof body.to === "string" && body.to.trim() ? body.to.trim() : callbackUrl;
      if (!from) {
        return NextResponse.json(
          { error: "Bascule : l'adresse source « from » est obligatoire." },
          { status: 400 },
        );
      }
      const dryRun = body.dryRun !== false;
      const result = await retargetSubscriptions(from, to, { dryRun });
      return NextResponse.json({ ok: true, action: "retarget", ...result });
    }
    if (body?.action !== undefined) {
      return NextResponse.json({ error: `Action inconnue : ${String(body.action)}.` }, { status: 400 });
    }
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
