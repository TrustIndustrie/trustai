"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl } from "../config";

/**
 * Client Supabase côté navigateur (mode connecté uniquement).
 * N'utilise que l'URL du projet et la publishable key — jamais de clé
 * secrète ni de service role key côté client.
 */
export function createSupabaseBrowserClient() {
  const url = getSupabaseUrl();
  const key = getSupabasePublishableKey();
  if (!url || !key) {
    throw new Error(
      "Supabase n'est pas configuré : l'application fonctionne en mode démonstration.",
    );
  }
  return createBrowserClient(url, key);
}
