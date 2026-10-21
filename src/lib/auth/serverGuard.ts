import { createSupabaseServerClient } from "../supabase/server";
import { isSupabaseConfigured } from "../config";
import { hasPermission } from "../permissions";
import type { Permission, Role } from "../types";

/**
 * Garde d'autorisation SERVEUR pour les routes API : identité vérifiée via
 * getUser() (jamais la session locale seule) + profil actif + permission.
 * Masquer un bouton côté client n'est jamais la sécurité : chaque route
 * sensible passe par cette garde.
 */

export type GuardResult =
  | { ok: true; userId: string; role: Role; displayName: string }
  | { ok: false; status: number; error: string };

export async function requirePermission(
  permission: Permission,
): Promise<GuardResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Mode démonstration : cette action nécessite le mode connecté.",
    };
  }
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, error: "Authentification requise." };
  }
  const { data: profile } = await supabase
    .rpc("current_profile")
    .single<{ role: Role; active: boolean; display_name: string }>();
  if (!profile || !profile.active) {
    return { ok: false, status: 403, error: "Profil absent ou désactivé." };
  }
  if (!hasPermission(profile.role, permission)) {
    return {
      ok: false,
      status: 403,
      error: "Votre rôle ne permet pas cette action.",
    };
  }
  return {
    ok: true,
    userId: user.id,
    role: profile.role,
    displayName: profile.display_name,
  };
}

/**
 * Variante « au moins une de ces permissions ».
 *
 * Utile quand un même écran sert deux publics par des chemins différents :
 * les tournées se lisent avec `gerer_livraisons` pour l'encadrement, ou avec
 * `executer_livraison` pour le livreur, qui ne verra alors que les siennes.
 * C'est la base qui tranche ce cloisonnement, pas cette garde : elle ne fait
 * que barrer l'entrée aux rôles qui n'ont rien à faire là.
 */
export async function requireAnyPermission(
  permissions: Permission[],
): Promise<GuardResult> {
  let dernier: GuardResult | null = null;
  for (const permission of permissions) {
    const guard = await requirePermission(permission);
    if (guard.ok) return guard;
    dernier = guard;
    // Une authentification manquante ou un profil inactif ne se rattrapent
    // pas en essayant une autre permission : on rend le refus tel quel.
    if (guard.status !== 403) return guard;
  }
  return dernier ?? { ok: false, status: 403, error: "Accès refusé." };
}
