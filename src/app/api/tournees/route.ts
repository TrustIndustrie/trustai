import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/serverGuard";

/**
 * Tournées de livraison.
 *
 * GET                        → la liste des tournées.
 * GET ?id=                   → le plan de route d'une tournée.
 * GET ?date=&warehouse_id=   → les dossiers encore chargeables ce jour-là.
 * POST                       → les gestes de composition et d'exécution.
 *
 * La base refait tous les contrôles, à commencer par le seul qui compte
 * vraiment : un passage ne s'ajoute que si la date de la tournée est
 * exactement celle promise au client. Cette route ne lui fait pas confiance,
 * et l'inverse non plus.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = [
  "creer",
  "ajouter",
  "retirer",
  "reordonner",
  "planifier",
  "demarrer",
  "resultat",
] as const;
type Action = (typeof ACTIONS)[number];

export async function GET(request: Request) {
  const guard = await requirePermission("gerer_livraisons");
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

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const date = url.searchParams.get("date");
  const warehouseId = url.searchParams.get("warehouse_id");

  if (id) {
    const { data, error } = await supabase.rpc("get_delivery_round", {
      p_round_id: id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, tournee: data });
  }

  if (date && warehouseId) {
    const { data, error } = await supabase.rpc("list_round_candidates", {
      p_date: date,
      p_warehouse_id: warehouseId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, candidats: data ?? [] });
  }

  const filters: Record<string, string> = {};
  for (const key of ["from", "to", "stage", "warehouse_id"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  const { data, error } = await supabase.rpc("list_delivery_rounds", {
    p_filters: filters,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, ...(data as object) });
}

export async function POST(request: Request) {
  // La composition demande « gerer_logistique », l'exécution
  // « executer_livraison » : la base tranche, cette garde ne fait que barrer
  // l'entrée aux rôles qui n'ont rien à faire ici.
  const guard = await requirePermission("gerer_livraisons");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps de requête illisible." }, { status: 400 });
  }

  const action = String(body.action ?? "") as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `Action inconnue. Attendu : ${ACTIONS.join(", ")}.` },
      { status: 400 },
    );
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

  const roundId = typeof body.tournee_id === "string" ? body.tournee_id : null;
  const stopId = typeof body.passage_id === "string" ? body.passage_id : null;
  const note = typeof body.note === "string" ? body.note : null;

  // Un aiguillage explicite plutôt qu'une table de fonctions : le client
  // Supabase ne renvoie pas une promesse ordinaire, et le typage s'en plaint
  // à juste titre.
  const appel = async () => {
    switch (action) {
      case "creer":
        return supabase.rpc("create_delivery_round", { p_payload: body.tournee ?? {} });
      case "ajouter":
        return supabase.rpc("add_round_stop", {
          p_round_id: roundId,
          p_delivery_job_id: body.dossier_id,
        });
      case "retirer":
        return supabase.rpc("remove_round_stop", { p_stop_id: stopId });
      case "reordonner":
        return supabase.rpc("reorder_round_stops", {
          p_round_id: roundId,
          p_stop_ids: body.ordre,
        });
      case "planifier":
        return supabase.rpc("plan_delivery_round", { p_round_id: roundId });
      case "demarrer":
        return supabase.rpc("start_delivery_round", { p_round_id: roundId });
      case "resultat":
        return supabase.rpc("record_round_stop_outcome", {
          p_stop_id: stopId,
          p_status: body.resultat,
          p_note: note,
        });
    }
  };

  const { data, error } = await appel();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, resultat: data });
}
