import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/serverGuard";
import { isShopifyAdminConfigured } from "@/lib/shopify/config";
import { ShopifyConfigError } from "@/lib/shopify/auth";
import { fetchAbandonedCheckouts } from "@/lib/shopify/abandoned-checkouts";
import { getOrganizationId } from "@/lib/shopify/sync";

/**
 * Lecture des paniers abandonnés Shopify, puis écriture idempotente.
 *
 * DEUX APPELANTS :
 *   * POST — un administrateur connecté. La permission `administrer` est
 *     vérifiée côté serveur, et l'écriture passe par sa session : la base
 *     rejoue permission et organisation.
 *   * GET — la tâche planifiée Vercel, qui ne sait émettre que des GET et
 *     porte `Authorization: Bearer <CRON_SECRET>`. Sans session, l'écriture
 *     passe par la clé de service et l'organisation est explicite.
 *
 * RIEN N'EST ENVOYÉ AU CLIENT par cette route : elle ne fait que collecter.
 * La file d'envoi reste vide, aucun message n'est planifié.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Nombre de jours lus par défaut : au-delà, un panier n'est plus relançable. */
const DEFAULT_DAYS = 14;

function daysFrom(request: Request): number {
  const raw = new URL(request.url).searchParams.get("jours");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DAYS;
  return Math.min(Math.trunc(parsed), 90);
}

async function collect(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { rows, pages, truncated } = await fetchAbandonedCheckouts({ since });
  return { rows, pages, truncated, since: since.toISOString() };
}

function configurationError() {
  return NextResponse.json(
    {
      error:
        "Connexion Shopify non configurée : renseignez SHOPIFY_STORE_DOMAIN, " +
        "SHOPIFY_CLIENT_ID et SHOPIFY_CLIENT_SECRET (voir docs/SHOPIFY_SETUP.md).",
    },
    { status: 503 },
  );
}

/** Appel humain : un administrateur déclenche la lecture. */
export async function POST(request: Request) {
  const guard = await requirePermission("administrer");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  if (!isShopifyAdminConfigured()) return configurationError();

  let supabase;
  try {
    supabase = createSupabaseServerClient();
  } catch {
    return NextResponse.json(
      { error: "Mode connecté requis (Supabase non configuré)." },
      { status: 503 },
    );
  }

  let collected;
  try {
    collected = await collect(daysFrom(request));
  } catch (error) {
    const known = error instanceof ShopifyConfigError;
    return NextResponse.json(
      {
        error: known
          ? error.message
          : "Lecture des paniers abandonnés impossible. Vérifiez les " +
            "périmètres de l'application Shopify et l'accès aux données " +
            "client protégées.",
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: known ? 400 : 502 },
    );
  }

  const { data, error } = await supabase.rpc("upsert_abandoned_checkouts", {
    p_rows: collected.rows,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    since: collected.since,
    pages: collected.pages,
    truncated: collected.truncated,
    report: data,
  });
}

/**
 * Appel planifié. Le secret est comparé en longueur constante, et l'absence
 * de secret configuré ferme la route plutôt que de l'ouvrir.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Tâche planifiée non configurée (CRON_SECRET absent)." },
      { status: 503 },
    );
  }
  const provided = request.headers.get("authorization") ?? "";
  const bearer = provided.startsWith("Bearer ") ? provided.slice(7) : "";
  if (bearer.length !== expected.length || bearer !== expected) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 401 });
  }
  if (!isShopifyAdminConfigured()) return configurationError();

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Clé de service Supabase absente : tâche planifiée inopérante." },
      { status: 503 },
    );
  }

  const organizationId = await getOrganizationId(admin);
  if (!organizationId) {
    return NextResponse.json(
      { error: "Aucune organisation en base." },
      { status: 503 },
    );
  }

  let collected;
  try {
    collected = await collect(daysFrom(request));
  } catch (error) {
    return NextResponse.json(
      {
        error: "Lecture des paniers abandonnés impossible.",
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 502 },
    );
  }

  const { data, error } = await admin.rpc("upsert_abandoned_checkouts", {
    p_rows: collected.rows,
    p_organization_id: organizationId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    planifie: true,
    since: collected.since,
    pages: collected.pages,
    truncated: collected.truncated,
    report: data,
  });
}
