import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/serverGuard";

/**
 * Dossiers de livraison : disponibilité et créneaux.
 *
 * GET sans paramètre  → la liste de travail, avec la disponibilité calculée.
 * GET avec ?id=       → le détail d'un dossier : ce qui bloque, et ses créneaux.
 * POST                → les quatre gestes de la chaîne, nommés par « action ».
 *
 * TRUST AI N'ENVOIE RIEN. « proposer » enregistre les créneaux qu'un humain
 * proposera au client ; aucune notification, aucun courriel, aucun appel
 * extérieur n'est déclenché ici. La base refait de toute façon tous les
 * contrôles : cette route ne lui fait pas confiance, et l'inverse non plus.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "autoriser" | "proposer" | "confirmer" | "refuser";

const ACTIONS: Action[] = ["autoriser", "proposer", "confirmer", "refuser"];

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

  if (id) {
    const { data, error } = await supabase.rpc("get_delivery_readiness", {
      p_delivery_job_id: id,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, dossier: data });
  }

  const filters: Record<string, string | number> = {};
  for (const key of ["stage", "readiness", "warehouse_id", "search"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  const { data, error } = await supabase.rpc("list_delivery_jobs", {
    p_filters: filters,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...(data as object) });
}

export async function POST(request: Request) {
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

  const jobId = typeof body.dossier_id === "string" ? body.dossier_id : null;
  const note = typeof body.note === "string" ? body.note : null;

  if (action === "confirmer") {
    const slotId = typeof body.creneau_id === "string" ? body.creneau_id : null;
    if (!slotId) {
      return NextResponse.json({ error: "Créneau à confirmer non précisé." }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("confirm_delivery_slot", {
      p_slot_id: slotId,
      p_note: note,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, resultat: data });
  }

  if (!jobId) {
    return NextResponse.json({ error: "Dossier non précisé." }, { status: 400 });
  }

  if (action === "autoriser") {
    const { data, error } = await supabase.rpc("authorize_delivery_contact", {
      p_delivery_job_id: jobId,
      p_note: note,
      p_allow_partial: body.accepter_partiel === true,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, resultat: data });
  }

  if (action === "proposer") {
    if (!Array.isArray(body.creneaux) || body.creneaux.length === 0) {
      return NextResponse.json(
        { error: "Indiquez au moins un créneau à proposer." },
        { status: 400 },
      );
    }
    const { data, error } = await supabase.rpc("propose_delivery_slots", {
      p_delivery_job_id: jobId,
      p_slots: body.creneaux,
      p_note: note,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, resultat: data });
  }

  // refuser
  const { data, error } = await supabase.rpc("decline_delivery_slots", {
    p_delivery_job_id: jobId,
    p_note: note,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, resultat: data });
}
