import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/serverGuard";

/**
 * Exclusion ou réintégration d'un panier abandonné.
 *
 * La décision est humaine, motivée, et tracée par la base dans un historique
 * en ajout seul. La réintégration ne restaure rien : le statut est RECALCULÉ,
 * donc un panier sans consentement ne redevient pas relançable et une adresse
 * désinscrite est refusée.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DecisionBody {
  id?: unknown;
  excluded?: unknown;
  note?: unknown;
}

export async function POST(request: Request) {
  const guard = await requirePermission("valider_decision");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: DecisionBody;
  try {
    body = (await request.json()) as DecisionBody;
  } catch {
    return NextResponse.json({ error: "Corps JSON attendu." }, { status: 400 });
  }

  if (typeof body.id !== "string" || body.id.trim() === "") {
    return NextResponse.json(
      { error: "L'identifiant du panier est obligatoire." },
      { status: 400 },
    );
  }
  if (typeof body.excluded !== "boolean") {
    return NextResponse.json(
      { error: "Le champ « excluded » est obligatoire (vrai ou faux)." },
      { status: 400 },
    );
  }
  if (typeof body.note !== "string" || body.note.trim().length < 3) {
    return NextResponse.json(
      { error: "Une décision doit être motivée (au moins 3 caractères)." },
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

  const { data, error } = await supabase.rpc("set_abandoned_checkout_exclusion", {
    p_id: body.id.trim(),
    p_excluded: body.excluded,
    p_note: body.note.trim(),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, checkout: data });
}
