import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl } from "../config";

/**
 * Client Supabase côté serveur (Server Components, Route Handlers,
 * Server Actions), basé sur les cookies de session.
 *
 * Règle de sécurité : pour toute décision d'autorisation, ne pas se fier à
 * `getSession()` (non revalidé) — utiliser `getUser()`, qui vérifie
 * l'identité auprès du serveur Supabase.
 */
export function createSupabaseServerClient() {
  const url = getSupabaseUrl();
  const key = getSupabasePublishableKey();
  if (!url || !key) {
    throw new Error("Supabase n'est pas configuré (mode démonstration).");
  }
  const cookieStore = cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un Server Component : les cookies seront
          // rafraîchis par le middleware.
        }
      },
    },
  });
}
