import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "../config";

/**
 * Client Supabase SERVEUR UNIQUEMENT (webhooks, synchronisation catalogue).
 *
 * Utilise la clé secrète `SUPABASE_SECRET_KEY` (variable d'environnement
 * serveur, SANS préfixe NEXT_PUBLIC_) : elle contourne la RLS et ne doit
 * JAMAIS être importée dans un composant client ni committée. Les routes
 * qui l'utilisent font leur propre contrôle d'accès (signature HMAC pour
 * les webhooks, session administrateur pour la synchronisation).
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY || // ancien nom, accepté
    undefined;
  if (!url || !secretKey) return null;
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
