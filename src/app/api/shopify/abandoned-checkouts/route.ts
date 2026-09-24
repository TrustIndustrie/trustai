import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/serverGuard";

/**
 * Consultation des paniers abandonnés collectés.
 *
 * Lecture seule, permission `voir_acquisition` vérifiée côté serveur puis
 * rejouée par la base : la RPC refait le contrôle et filtre par
 * organisation. Aucune donnée n'est écrite ici.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requirePermission("voir_acquisition");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let supabase;
  try {
    supabase = createSupabaseServerClient();
  } catch {
    return NextResponse.json(
      { error: "Mode connecté requis (Supabase non configuré)." },
      { status: 503 },
    );
  }

  const params = new URL(request.url).searchParams;
  const status = params.get("statut");
  const limit = Number(params.get("limite"));

  const { data, error } = await supabase.rpc("list_abandoned_checkouts", {
    p_status: status && status !== "tous" ? status : null,
    p_limit: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 100,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
