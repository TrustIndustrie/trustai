import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/serverGuard";
import { isShopifyAdminConfigured } from "@/lib/shopify/config";
import { ShopifyConfigError } from "@/lib/shopify/auth";
import { getOrganizationId, syncProductsPage } from "@/lib/shopify/sync";

/**
 * Synchronisation manuelle du catalogue depuis l'API Admin GraphQL Shopify
 * (les endpoints REST produits sont dépréciés), UNE page de 100 produits
 * par requête : chaque appel reste court quel que soit le volume du
 * catalogue (pas de timeout serveur). Le navigateur enchaîne les pages tant
 * que `nextCursor` n'est pas null ; la dernière page désactive les produits
 * Shopify disparus de la boutique et journalise le total du parcours.
 *
 * Autorisation vérifiée côté serveur : session authentifiée + permission
 * « gerer_catalogue ». Les identifiants Shopify (Client ID/Secret ou token
 * legacy) restent côté serveur et ne quittent jamais cette route.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export async function POST(request: Request) {
  const guard = await requirePermission("gerer_catalogue");
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

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Clé serveur Supabase absente (SUPABASE_SECRET_KEY)." },
      { status: 503 },
    );
  }
  const organizationId = await getOrganizationId(admin);
  if (!organizationId) {
    return NextResponse.json(
      { error: "Aucune organisation en base : appliquez le seed Supabase." },
      { status: 500 },
    );
  }

  // Corps optionnel : { cursor, startedAt, totals } — absent sur la 1re page.
  let payload: { cursor?: unknown; startedAt?: unknown; totals?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    // première page appelée sans corps : valeurs par défaut.
  }
  const cursor = typeof payload.cursor === "string" ? payload.cursor : null;
  const startedAt = typeof payload.startedAt === "string" ? payload.startedAt : null;

  try {
    const result = await syncProductsPage(admin, organizationId, { cursor, startedAt });
    if (!result.nextCursor) {
      // Fin de parcours : journal avec le TOTAL du parcours (cumul client +
      // dernière page) — valeur d'affichage uniquement, aucune règle métier.
      const totals = (payload.totals ?? {}) as { products?: unknown; variants?: unknown };
      const totalProducts = asCount(totals.products) + result.products;
      const totalVariants = asCount(totals.variants) + result.variants;
      await admin.from("activity_logs").insert({
        organization_id: organizationId,
        actor_profile_id: guard.userId,
        actor_label: guard.displayName,
        action: "Catalogue synchronisé",
        details: `${totalProducts} produit(s), ${totalVariants} variante(s) importés ou mis à jour depuis Shopify${result.deactivated > 0 ? ` ; ${result.deactivated} produit(s) désactivé(s) (absents de la boutique)` : ""}.`,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof ShopifyConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Erreur de synchronisation.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
