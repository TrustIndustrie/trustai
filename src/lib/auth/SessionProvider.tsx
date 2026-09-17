"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppMode, type AppMode } from "../config";
import { createSupabaseBrowserClient } from "../supabase/client";
import type { Role, UserProfile } from "../types";

/**
 * Session applicative.
 *
 * - Mode démonstration : pas d'authentification, `profile` reste null et
 *   l'interface fonctionne comme en V1 (choix manuel de la vendeuse).
 * - Mode connecté : charge l'utilisateur vérifié + son profil `profiles`.
 *   L'identité affichée et utilisée par l'interface vient TOUJOURS de la
 *   session authentifiée — jamais d'un champ de formulaire. Côté serveur,
 *   les fonctions RPC PostgreSQL re-déduisent elles-mêmes le profil depuis
 *   `auth.uid()`, donc même une requête forgée ne peut pas usurper une
 *   identité.
 */

export interface SessionState {
  mode: AppMode;
  /** Chargement initial de la session (mode connecté uniquement). */
  loading: boolean;
  email?: string;
  profile: (UserProfile & { email?: string }) | null;
  /** Erreur de session : profil absent, compte désactivé, réseau… */
  sessionError?: "profil_absent" | "compte_desactive" | "erreur_reseau";
  signOut: () => Promise<void>;
  supabase: SupabaseClient | null;
}

const SessionContext = createContext<SessionState | null>(null);

interface ProfileRow {
  id: string;
  display_name: string;
  role: Role;
  primary_store_id: string | null;
  active: boolean;
  store_ids: string[] | null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const mode = getAppMode();
  const [loading, setLoading] = useState(mode === "connected");
  const [email, setEmail] = useState<string | undefined>();
  const [profile, setProfile] = useState<SessionState["profile"]>(null);
  const [sessionError, setSessionError] = useState<SessionState["sessionError"]>();

  const supabase = useMemo(() => {
    if (mode !== "connected") return null;
    try {
      return createSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, [mode]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function load() {
      try {
        // Identité vérifiée par le serveur Supabase.
        const {
          data: { user },
        } = await supabase!.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setEmail(user.email ?? undefined);
        const { data, error } = await supabase!
          .rpc("current_profile")
          .single<ProfileRow>();
        if (cancelled) return;
        if (error || !data) {
          setSessionError("profil_absent");
          setProfile(null);
        } else if (!data.active) {
          setSessionError("compte_desactive");
          setProfile(null);
        } else {
          setProfile({
            id: data.id,
            displayName: data.display_name,
            role: data.role,
            primaryStoreId: data.primary_store_id ?? undefined,
            allowedStoreIds: data.store_ids ?? [],
            active: data.active,
            email: user.email ?? undefined,
          });
        }
      } catch {
        if (!cancelled) setSessionError("erreur_reseau");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setEmail(undefined);
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        load();
      }
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    window.location.href = "/connexion";
  }, [supabase]);

  const value = useMemo<SessionState>(
    () => ({ mode, loading, email, profile, sessionError, signOut, supabase }),
    [mode, loading, email, profile, sessionError, signOut, supabase],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession doit être utilisé dans un <SessionProvider>.");
  }
  return ctx;
}
