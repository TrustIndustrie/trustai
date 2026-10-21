import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/serverGuard";

/**
 * Contrôle mensuel des données Skara.
 *
 * Deux lectures en une :
 *   * le recoupement, mois par mois, entre la liste des factures et le
 *     journal comptable. Ces deux sources sont produites indépendamment par
 *     Skara, donc leur concordance vaut preuve, et l'écart doit s'expliquer
 *     par les pièces non émises, absentes de la comptabilité ;
 *   * la liste des articles sans coût d'achat exploitable, qui est la
 *     traduction concrète des marges creuses.
 *
 * Lecture seule, permission « voir_acquisition ».
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

  const controle = await supabase.rpc("get_skara_monthly_control", {
    p_from: params.get("du") || null,
    p_to: params.get("au") || null,
  });
  if (controle.error) {
    return NextResponse.json({ error: controle.error.message }, { status: 400 });
  }

  const articles = await supabase.rpc("list_skara_articles_without_cost", {
    p_limit: 100,
  });
  if (articles.error) {
    return NextResponse.json({ error: articles.error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    controle: controle.data,
    articles: articles.data,
  });
}
