import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/serverGuard";

/**
 * Consultation des factures importées depuis Skara.
 *
 * Lecture seule. La permission « voir_acquisition » est vérifiée ici puis
 * REJOUÉE par la base, qui filtre aussi par organisation. Les fonctions
 * appelées sont déclarées `stable` : elles ne peuvent rien écrire.
 *
 * Avec `?id=`, renvoie le détail d'une pièce, ses lignes et sa contrepartie
 * éventuelle, car une facture entièrement annulée n'existe dans Skara que
 * sous la forme de son avoir.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NATURES = ["facture", "avoir", "non_emise"];
const ETATS = ["exportee", "non_exportee"];

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
  const id = params.get("id");

  if (id) {
    const { data, error } = await supabase.rpc("get_skara_invoice", { p_id: id });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, invoice: data });
  }

  const nature = params.get("nature");
  const etat = params.get("etat");
  const limite = Number(params.get("limite"));

  const filters: Record<string, unknown> = {
    store_id: params.get("magasin") || null,
    from: params.get("du") || null,
    to: params.get("au") || null,
    doc_type: nature && NATURES.includes(nature) ? nature : null,
    accounting_state: etat && ETATS.includes(etat) ? etat : null,
    search: params.get("recherche") || null,
    limit: Number.isFinite(limite) && limite > 0 ? Math.trunc(limite) : 100,
  };

  const { data, error } = await supabase.rpc("list_skara_invoices", {
    p_filters: filters,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
