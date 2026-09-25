import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ARCHIVED_PAGES,
  canAccessPage,
  canAccessStore,
  hasPermission,
  isInMainNav,
} from "./permissions";
import { ROLE_PERMISSIONS } from "./types";
import type { Role, UserProfile } from "./types";

/**
 * Contenu de la DERNIÈRE définition de `app.role_permissions` : les
 * migrations la redéfinissent (`create or replace`), seule la plus récente
 * s'applique réellement en base.
 */
function latestRolePermissionsSql(): string {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let latest: string | null = null;
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    if (content.includes("create or replace function app.role_permissions")) {
      latest = content;
    }
  }
  if (!latest) throw new Error("Aucune définition SQL de app.role_permissions trouvée.");
  return latest;
}

function profileWith(role: Role, stores: string[] = []): UserProfile {
  return {
    id: "p1",
    displayName: "Test",
    role,
    allowedStoreIds: stores,
    active: true,
  };
}

describe("Matrice de permissions (miroir de la fonction SQL app.role_permissions)", () => {
  it("un vendeur ne valide aucune décision importante et n'administre rien", () => {
    expect(hasPermission("vendeur", "valider_decision")).toBe(false);
    expect(hasPermission("vendeur", "administrer")).toBe(false);
    expect(hasPermission("vendeur", "produit_hors_catalogue")).toBe(false);
    expect(hasPermission("vendeur", "creer_commande")).toBe(true);
    expect(hasPermission("vendeur", "encaisser_reglement")).toBe(true);
  });

  it("la logistique n'a pas accès aux encaissements détaillés", () => {
    expect(hasPermission("logistique", "gerer_encaissements")).toBe(false);
    expect(hasPermission("logistique", "gerer_logistique")).toBe(true);
    expect(canAccessPage("logistique", "/encaissements")).toBe(false);
    expect(canAccessPage("logistique", "/arrivages")).toBe(true);
  });

  it("la comptabilité est autorisée sur les règlements", () => {
    expect(hasPermission("comptabilite", "gerer_encaissements")).toBe(true);
    expect(canAccessPage("comptabilite", "/encaissements")).toBe(true);
    expect(canAccessPage("comptabilite", "/achats")).toBe(false);
  });

  it("les achats valident les commandes fournisseurs", () => {
    expect(hasPermission("achats", "gerer_achats")).toBe(true);
    expect(hasPermission("achats", "valider_decision")).toBe(true);
    expect(canAccessPage("achats", "/validations")).toBe(true);
  });

  it("un vendeur est limité à ses magasins autorisés", () => {
    const vendeur = profileWith("vendeur", ["store-her"]);
    expect(canAccessStore(vendeur, "store-her")).toBe(true);
    expect(canAccessStore(vendeur, "store-lis")).toBe(false);
    const direction = profileWith("direction");
    expect(canAccessStore(direction, "store-lis")).toBe(true);
  });

  it("la matrice TS et la matrice SQL restent synchronisées", () => {
    // La matrice est redéfinie par les migrations successives : on compare
    // avec la DERNIÈRE définition, celle qui est réellement en vigueur.
    const sql = latestRolePermissionsSql();
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const block = sql.match(
        new RegExp(`when '${role}' then array\\[([\\s\\S]*?)\\]`),
      );
      expect(block, `rôle ${role} absent de la fonction SQL`).not.toBeNull();
      for (const permission of permissions) {
        expect(
          block![1].includes(`'${permission}'`),
          `permission ${permission} du rôle ${role} absente de la matrice SQL`,
        ).toBe(true);
      }
    }
  });
});

describe("Socle logistique (phase 1)", () => {
  it("compte exactement 9 rôles et 18 permissions", () => {
    const roles = Object.keys(ROLE_PERMISSIONS);
    expect(roles).toHaveLength(9);
    expect(roles).toContain("responsable_logistique");
    expect(roles).toContain("livreur");
    const permissions = new Set(Object.values(ROLE_PERMISSIONS).flat());
    expect(permissions.size).toBe(18);
  });

  it("le livreur ne détient AUCUNE permission en phase 1 (décision E18)", () => {
    expect(ROLE_PERMISSIONS.livreur).toEqual([]);
    const sensibles = [
      "gerer_livraisons",
      "voir_coordonnees_client",
      "voir_montants_livraison",
      "executer_livraison",
      "gerer_documents_client",
    ] as const;
    for (const permission of sensibles) {
      expect(hasPermission("livreur", permission)).toBe(false);
    }
    // Et il n'atteint aucune page du module.
    expect(canAccessPage("livreur", "/logistique")).toBe(false);
    expect(canAccessPage("livreur", "/commandes")).toBe(false);
  });

  it("le responsable logistique pilote le module sans toucher au commercial", () => {
    expect(hasPermission("responsable_logistique", "gerer_livraisons")).toBe(true);
    expect(hasPermission("responsable_logistique", "importer_recap")).toBe(true);
    expect(hasPermission("responsable_logistique", "gerer_documents_client")).toBe(true);
    expect(canAccessPage("responsable_logistique", "/logistique")).toBe(true);
    // Aucun droit commercial ni administratif.
    expect(hasPermission("responsable_logistique", "creer_commande")).toBe(false);
    expect(hasPermission("responsable_logistique", "gerer_encaissements")).toBe(false);
    expect(hasPermission("responsable_logistique", "administrer")).toBe(false);
  });

  it("les montants de livraison ne sont pas visibles par défaut", () => {
    expect(hasPermission("logistique", "voir_montants_livraison")).toBe(false);
    expect(hasPermission("logistique", "voir_coordonnees_client")).toBe(true);
    expect(hasPermission("vendeur", "voir_coordonnees_client")).toBe(false);
  });

  it("les modules commerciaux sortent du menu mais restent accessibles", () => {
    for (const href of ["/achats", "/relances", "/encaissements", "/acquisition"]) {
      expect(isInMainNav("administrateur", href), `${href} ne doit plus être au menu`).toBe(false);
    }
    // Accessibles malgré tout (aucune page supprimée, aucune URL cassée).
    expect(canAccessPage("achats", "/achats")).toBe(true);
    expect(canAccessPage("comptabilite", "/encaissements")).toBe(true);
    expect(ARCHIVED_PAGES.length).toBe(4);
    // Le menu principal conserve la logistique et le référentiel produits.
    expect(isInMainNav("responsable_logistique", "/logistique")).toBe(true);
    expect(isInMainNav("achats", "/catalogue")).toBe(true);
  });
});
