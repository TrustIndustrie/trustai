import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/serverGuard";
import {
  isBlocked,
  parseArticles,
  parseInvoiceList,
  parseInvoiceLines,
  parseJournal,
} from "@/lib/skara/parsers";
import { MAX_ROWS, buildPayload, summarize } from "@/lib/skara/payload";
import type { ParsedFile, SkaraFileKind } from "@/lib/skara/types";

/**
 * Dépôt d'un export Skara.
 *
 * Chaîne de responsabilité :
 *   1. permission « administrer » vérifiée côté serveur ;
 *   2. lecture du fichier par les analyseurs purs, testés unitairement ;
 *   3. PRÉVISUALISATION obligatoire : sans « confirmer », rien n'est écrit ;
 *   4. écriture par la RPC, qui revérifie tout et ne fait pas confiance à
 *      cette lecture.
 *
 * TRUST AI ne contacte jamais Skara et ne lui écrit rien : l'utilisateur
 * dépose un fichier qu'il a lui-même exporté. Pour le journal comptable, ce
 * fichier doit venir de l'Historique de Skara, jamais d'un nouvel export,
 * qui consommerait les écritures au détriment du comptable.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 8 Mo : au-delà, l'export doit être découpé par période ou par famille. */
const MAX_BYTES = 8 * 1024 * 1024;

const KINDS: SkaraFileKind[] = [
  "liste_factures",
  "lignes_factures",
  "catalogue",
  "journal_comptable",
];

const STORE_REQUIRED: SkaraFileKind[] = ["liste_factures", "lignes_factures"];

/**
 * Les exports sont en UTF-8, mais Skara produit aussi des fichiers nommés
 * « .xls » qui sont du texte. Si le décodage UTF-8 laisse des caractères de
 * remplacement, on retente en Windows-1252 plutôt que d'abîmer les accents.
 */
function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("windows-1252").decode(buffer);
  } catch {
    return utf8;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseByKind(kind: SkaraFileKind, content: string): ParsedFile<any> {
  if (kind === "liste_factures") return parseInvoiceList(content);
  if (kind === "lignes_factures") return parseInvoiceLines(content);
  if (kind === "catalogue") return parseArticles(content);
  return parseJournal(content);
}

export async function POST(request: Request) {
  const guard = await requirePermission("administrer");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Envoi attendu sous forme de formulaire avec un fichier." },
      { status: 400 },
    );
  }

  const kind = String(form.get("nature") ?? "") as SkaraFileKind;
  if (!KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `Nature de fichier inconnue. Attendu : ${KINDS.join(", ")}.` },
      { status: 400 },
    );
  }

  const storeId = String(form.get("magasin") ?? "").trim() || null;
  if (STORE_REQUIRED.includes(kind) && !storeId) {
    return NextResponse.json(
      {
        error:
          "Le magasin est obligatoire pour un export de factures : Skara n'inscrit pas le magasin dans le fichier, il vient du sélecteur de l'écran.",
      },
      { status: 400 },
    );
  }

  const file = form.get("fichier");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json(
      {
        error:
          "Le fichier est vide. Un export comptable ne ressort que les écritures pas encore exportées : passez par l'Historique de Skara.",
      },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Fichier trop volumineux : découpez l'export par période ou par famille." },
      { status: 413 },
    );
  }

  const buffer = await file.arrayBuffer();
  const content = decodeText(buffer);
  const contentHash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");

  const parsed = parseByKind(kind, content);
  const summary = summarize(parsed);

  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      {
        error: `Ce fichier contient ${parsed.rows.length} lignes, au-delà de la limite de ${MAX_ROWS}. Découpez l'export.`,
        summary,
      },
      { status: 413 },
    );
  }

  const confirmed = String(form.get("confirmer") ?? "") === "1";
  if (!confirmed || isBlocked(parsed.anomalies)) {
    // Prévisualisation : aucune écriture. Un fichier bloquant ne peut pas
    // être confirmé, même en insistant.
    return NextResponse.json({
      ok: !isBlocked(parsed.anomalies),
      preview: true,
      fileName: file.name,
      contentHash,
      summary,
      rows: parsed.rows.slice(0, 20),
    });
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

  const payload = buildPayload(parsed, {
    fileName: file.name,
    contentHash,
    storeId,
  });

  const { data, error } = await supabase.rpc("import_skara_file", {
    p_payload: payload,
  });
  if (error) {
    return NextResponse.json({ error: error.message, summary }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    preview: false,
    fileName: file.name,
    summary,
    report: data,
  });
}

/** Historique des imports, en lecture seule. */
export async function GET() {
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
  const { data, error } = await supabase.rpc("list_skara_imports", { p_limit: 50 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, imports: data ?? [] });
}
