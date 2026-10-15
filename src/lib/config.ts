/**
 * Configuration des deux modes de l'application.
 *
 * - Mode démonstration : aucune variable Supabase → localStorage v3,
 *   aucune authentification, badge « Mode démonstration ».
 * - Mode connecté : les deux variables publiques Supabase sont présentes →
 *   Supabase est la source de vérité, authentification obligatoire.
 *
 * Seules des clés PUBLIQUES sont lues ici. Aucune secret key, service role
 * key, URL Postgres directe ni mot de passe ne doit jamais être exposé au
 * navigateur ni committé.
 */

export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
}

export function getSupabasePublishableKey(): string | undefined {
  // Clé moderne « publishable » ; l'ancienne clé « anon » reste acceptée
  // pour compatibilité si un projet existant l'utilise encore.
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    undefined
  );
}

/** true si le mode connecté Supabase est activé. */
export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabasePublishableKey());
}

export type AppMode = "demo" | "connected";

export function getAppMode(): AppMode {
  return isSupabaseConfigured() ? "connected" : "demo";
}
