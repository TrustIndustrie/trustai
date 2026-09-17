import { ROLE_PERMISSIONS } from "./types";
import type { Permission, Role, UserProfile } from "./types";

/**
 * Aides de permissions côté application.
 *
 * IMPORTANT : cette couche adapte l'INTERFACE (menus, boutons, filtres) mais
 * n'est jamais la seule protection. En mode connecté, les mêmes règles sont
 * rejouées côté serveur : Row Level Security + fonctions RPC PostgreSQL
 * (voir supabase/migrations). Masquer un bouton n'est pas une sécurité.
 */

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAccessStore(profile: UserProfile, storeId: string): boolean {
  if (hasPermission(profile.role, "voir_tous_magasins")) return true;
  return profile.allowedStoreIds.includes(storeId);
}

/** Un rôle mono-magasin ne choisit pas son magasin. */
export function canChooseStore(profile: UserProfile): boolean {
  return (
    hasPermission(profile.role, "voir_tous_magasins") ||
    profile.allowedStoreIds.length > 1
  );
}

/** Pages accessibles par rôle (navigation). */
export interface PageAccess {
  href: string;
  permissions: Permission[] | null; // null = accessible à tout profil actif
  /**
   * Phase 1 : module commercial recouvert par Skara. La page reste
   * ACCESSIBLE (aucune suppression, aucune URL cassée) mais sort du menu
   * principal ; on la retrouve dans Paramètres › Archives.
   */
  archived?: boolean;
}

export const PAGE_ACCESS: PageAccess[] = [
  { href: "/dashboard", permissions: null },
  { href: "/logistique", permissions: ["gerer_livraisons", "gerer_logistique"] },
  { href: "/logistique/recap", permissions: ["importer_recap"] },
  { href: "/logistique/lignes", permissions: ["gerer_livraisons", "gerer_logistique"] },
  { href: "/commandes", permissions: ["creer_commande", "gerer_achats", "gerer_logistique", "gerer_encaissements", "valider_decision"] },
  { href: "/catalogue", permissions: ["creer_commande", "gerer_achats", "gerer_catalogue", "gerer_referentiel_logistique"] },
  { href: "/arrivages", permissions: ["gerer_logistique", "gerer_achats"] },
  { href: "/fournisseurs", permissions: ["gerer_achats", "gerer_logistique"] },
  { href: "/validations", permissions: ["valider_decision"] },
  { href: "/compte", permissions: null },
  { href: "/parametres/archives", permissions: ["administrer"] },
  // --- Modules archivés (hors menu principal) ---
  { href: "/achats", permissions: ["gerer_achats"], archived: true },
  { href: "/relances", permissions: ["gerer_achats"], archived: true },
  { href: "/encaissements", permissions: ["gerer_encaissements"], archived: true },
  { href: "/acquisition", permissions: ["voir_acquisition"], archived: true },
];

/** Modules sortis du menu principal, listés dans Paramètres › Archives. */
export const ARCHIVED_PAGES = PAGE_ACCESS.filter((p) => p.archived);

/** true si la page doit apparaître dans le menu principal. */
export function isInMainNav(role: Role, href: string): boolean {
  const entry = PAGE_ACCESS.find((p) => p.href === href);
  if (!entry || entry.archived) return false;
  return canAccessPage(role, href);
}

export function canAccessPage(role: Role, href: string): boolean {
  const entry = PAGE_ACCESS.find(
    (p) => href === p.href || href.startsWith(`${p.href}/`),
  );
  if (!entry) return true;
  if (entry.permissions === null) return true;
  return entry.permissions.some((perm) => hasPermission(role, perm));
}

export const roleDescriptions: Record<Role, string> = {
  vendeur:
    "Crée les commandes de son magasin et encaisse les règlements autorisés. Aucune validation importante.",
  responsable_magasin:
    "Gère son ou ses magasins : commandes, règlements, acquisition, demandes d'annulation. Ne peut pas valider sa propre demande.",
  achats:
    "Catalogue, fournisseurs, commandes fournisseurs, relances et validations liées aux achats.",
  logistique:
    "Arrivages, expéditions, dépôts et réceptions. Pas d'accès aux statistiques financières détaillées.",
  comptabilite:
    "Encaissements, règlements, RAP et futures opérations de remboursement — lecture des commandes nécessaire.",
  responsable_logistique:
    "Pilote le module logistique : suivi des marchandises, dossiers de livraison, documents clients et référentiel produit.",
  livreur:
    "Rôle du terrain. Aucun accès aux données tant que les tournées ne sont pas en place (phase 6).",
  direction:
    "Lecture complète, tableaux de bord, finances et validations importantes sur tous les magasins.",
  administrateur:
    "Accès complet, gestion des utilisateurs et de la configuration.",
};
