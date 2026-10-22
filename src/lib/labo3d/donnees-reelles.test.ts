import { describe, expect, it } from "vitest";
import {
  cleFournisseur,
  depotDuLibelle,
  etatDepuisLignes,
  fournisseursDepuisLignes,
  fusionnerFournisseurs,
  joursDepuis,
} from "./donnees-reelles";
import { zoneDeLEtape } from "./etapes";
import type { LogisticsLineRow } from "@/lib/types";

/**
 * L'adaptateur « vraies lignes → scène 3D » est la seule pièce du laboratoire
 * qui touche à des données de production. Elle est donc la seule à mériter
 * des tests : ce qui est fictif n'a rien à prouver, ce qui est réel si.
 *
 * Ces tests valident surtout ce que l'adaptateur doit REFUSER de faire :
 * inventer une étape, inventer un dépôt, ou superposer deux caisses.
 */

const MAINTENANT = Date.parse("2026-10-20T12:00:00Z");

function ligne(p: Partial<LogisticsLineRow>): LogisticsLineRow {
  return {
    id: "l-1",
    designation: "Carrelage 60x60",
    quantity: 2,
    stage: "disponible",
    destination_confidence: "sure",
    open_anomalies: 0,
    ...p,
  };
}

describe("depotDuLibelle", () => {
  it("rattache au Sud tout libellé qui parle d'Aubagne, accents et casse compris", () => {
    expect(depotDuLibelle("Dépôt d'Aubagne")).toBe("aubagne");
    expect(depotDuLibelle("AUBAGNE")).toBe("aubagne");
    expect(depotDuLibelle("Entrepôt Aubàgne")).toBe("aubagne");
  });

  // Le site est en réalité à La Penne-sur-Huveaune. Le jour où l'entrepôt est
  // renommé dans la base, la marchandise du Sud ne doit PAS basculer
  // silencieusement à Argenteuil — c'est le genre de panne qui ne lève
  // aucune erreur et qu'on ne découvre qu'en comptant les caisses.
  it("reconnaît aussi le vrai nom du site, avant et après renommage", () => {
    expect(depotDuLibelle("Dépôt de La Penne-sur-Huveaune")).toBe("aubagne");
    expect(depotDuLibelle("LA PENNE SUR HUVEAUNE")).toBe("aubagne");
    expect(depotDuLibelle("Huveaune")).toBe("aubagne");
  });

  it("rattache tout le reste à Argenteuil, y compris l'absence de libellé", () => {
    expect(depotDuLibelle("Dépôt d'Argenteuil")).toBe("argenteuil");
    expect(depotDuLibelle("Trust Herblay")).toBe("argenteuil");
    expect(depotDuLibelle(null)).toBe("argenteuil");
    expect(depotDuLibelle(undefined)).toBe("argenteuil");
  });
});

describe("joursDepuis", () => {
  it("compte les jours entiers écoulés", () => {
    expect(joursDepuis("2026-10-17T12:00:00Z", MAINTENANT)).toBe(3);
    expect(joursDepuis("2026-10-20T11:00:00Z", MAINTENANT)).toBe(0);
  });

  it("rend 0 plutôt que NaN sur une date absente ou illisible", () => {
    expect(joursDepuis(null, MAINTENANT)).toBe(0);
    expect(joursDepuis("pas une date", MAINTENANT)).toBe(0);
  });
});

describe("etatDepuisLignes", () => {
  it("écarte une étape inconnue au lieu de la ranger au hasard", () => {
    const r = etatDepuisLignes(
      [ligne({ id: "a", stage: "disponible" }), ligne({ id: "b", stage: "etape_inventee" })],
      { maintenant: MAINTENANT },
    );
    expect(r.converties).toBe(1);
    expect(r.ignorees).toBe(1);
    expect(r.etat.caisses.map((c) => c.id)).toEqual(["a"]);
    expect(r.etat.journal.some((j) => j.texte.includes("écartée"))).toBe(true);
  });

  it("donne un rang unique PAR ZONE, pour que deux caisses ne se superposent pas", () => {
    const lignes = [
      ligne({ id: "a", stage: "disponible", destination_label: "Argenteuil" }),
      ligne({ id: "b", stage: "disponible", destination_label: "Argenteuil" }),
      ligne({ id: "c", stage: "disponible", destination_label: "Aubagne" }),
      ligne({ id: "d", stage: "sortie", destination_label: "Argenteuil" }),
    ];
    const { etat } = etatDepuisLignes(lignes, { maintenant: MAINTENANT });
    const par = new Map<string, number[]>();
    for (const c of etat.caisses) {
      const cle = `${c.depot}|${zoneDeLEtape(c.etape)}`;
      par.set(cle, [...(par.get(cle) ?? []), c.rang]);
    }
    par.forEach((rangs) => {
      expect(new Set(rangs).size).toBe(rangs.length);
    });
    expect(par.get("argenteuil|stockage")).toEqual([0, 1]);
    expect(par.get("aubagne|stockage")).toEqual([0]);
    expect(par.get("argenteuil|expedition")).toEqual([0]);
  });

  it("signale une anomalie ouverte et une ligne disparue du récapitulatif", () => {
    const { etat } = etatDepuisLignes(
      [
        ligne({ id: "a", open_anomalies: 2 }),
        ligne({ id: "b", missing_since: "2026-10-15T00:00:00Z" }),
        ligne({ id: "c" }),
      ],
      { maintenant: MAINTENANT },
    );
    const parId = new Map(etat.caisses.map((c) => [c.id, c]));
    expect(parId.get("a")?.anomalie).toContain("2 anomalie(s)");
    expect(parId.get("b")?.anomalie).toContain("5 jour(s)");
    expect(parId.get("c")?.anomalie).toBeNull();
    expect(etat.anomalies).toHaveLength(2);
  });

  it("fabrique un camion par affrètement, et aucun hors transfert", () => {
    const { etat } = etatDepuisLignes(
      [
        ligne({ id: "a", stage: "en_transfert", freight_ref: "E243" }),
        ligne({ id: "b", stage: "en_transfert", freight_ref: "E243" }),
        ligne({ id: "c", stage: "en_transfert", freight_ref: "E244" }),
        // Même référence, mais la marchandise n'est plus en transfert :
        // elle ne doit pas ressusciter un camion.
        ligne({ id: "d", stage: "disponible", freight_ref: "E245" }),
      ],
      { maintenant: MAINTENANT },
    );
    expect(etat.vehicules.map((v) => v.immatriculation).sort()).toEqual(["E243", "E244"]);
    expect(etat.vehicules.find((v) => v.immatriculation === "E243")?.caisses).toBe(2);
    expect(etat.caisses.find((c) => c.id === "d")?.vehiculeId).toBeNull();
  });

  it("n'invente aucune progression : les camions restent immobiles", () => {
    const { etat } = etatDepuisLignes(
      [ligne({ id: "a", stage: "en_transfert", freight_ref: "E243" })],
      { maintenant: MAINTENANT },
    );
    expect(etat.vehicules[0].vitesse).toBe(0);
    expect(etat.vehicules[0].progression).toBe(0.5);
  });

  it("dit le vrai total quand la page est tronquée", () => {
    const r = etatDepuisLignes([ligne({ id: "a" })], {
      maintenant: MAINTENANT,
      total: 2400,
    });
    expect(r.total).toBe(2400);
    expect(r.etat.journal[0].texte).toContain("sur 2400");
  });

  it("supporte une page vide sans rien inventer", () => {
    const r = etatDepuisLignes([], { maintenant: MAINTENANT });
    expect(r.etat.caisses).toHaveLength(0);
    expect(r.etat.vehicules).toHaveLength(0);
    expect(r.etat.depots).toHaveLength(2);
  });
});

/**
 * LES DEUX LISTES DE FOURNISSEURS.
 *
 * Farouk : « tu n'as pas mis les bons fournisseurs ? ils sont dans le sheet
 * pourtant. » Il avait raison : la scène ne montrait que le référentiel
 * `suppliers`, alors que le Google Sheet pose un nom de fournisseur sur
 * chaque ligne. Ces tests gardent la réunion des deux — et surtout le fait
 * qu'on n'invente rien sur ceux que le référentiel ignore.
 */
describe("réunion du référentiel et du récapitulatif", () => {
  const referentiel = fournisseursDepuisLignes([
    {
      id: "s-1",
      name: "Mobilier Éco",
      country: "France",
      logistics: "retrait_trust",
      lead_time_days: 12,
      active: true,
    },
  ]);

  it("garde les fournisseurs du référentiel avec leurs informations", () => {
    const f = fusionnerFournisseurs(referentiel, []);
    expect(f).toHaveLength(1);
    expect(f[0].origine).toBe("referentiel");
    expect(f[0].mode).toBe("retrait_trust");
    expect(f[0].delaiJours).toBe(12);
  });

  it("ajoute les noms qui n'apparaissent que dans le récapitulatif", () => {
    const f = fusionnerFournisseurs(referentiel, ["Sofas Porto", "Mobilier Éco"]);
    expect(f.map((x) => x.nom)).toEqual(["Mobilier Éco", "Sofas Porto"]);
    const ajoute = f.find((x) => x.nom === "Sofas Porto")!;
    expect(ajoute.origine).toBe("recapitulatif");
  });

  it("n'invente ni pays, ni mode, ni délai pour ceux-là", () => {
    const [ajoute] = fusionnerFournisseurs([], ["Sofas Porto"]);
    expect(ajoute.mode).toBeNull();
    expect(ajoute.delaiJours).toBeNull();
    expect(ajoute.pays).toBe("Pays non renseigné");
  });

  it("rapproche les noms malgré accents, casse et espaces en trop", () => {
    const f = fusionnerFournisseurs(referentiel, ["  mobilier  eco "]);
    expect(f).toHaveLength(1);
    expect(f[0].origine).toBe("referentiel");
  });

  it("ne crée pas deux sites pour le même nom écrit deux fois", () => {
    const f = fusionnerFournisseurs([], ["Sofas Porto", "SOFAS PORTO", "Sofas  Porto"]);
    expect(f).toHaveLength(1);
  });

  it("ignore les lignes sans fournisseur plutôt que d'en créer un vide", () => {
    expect(fusionnerFournisseurs([], [null, undefined, "", "   "])).toHaveLength(0);
  });

  it("donne un identifiant stable, pour que la sélection ne saute pas", () => {
    const une = fusionnerFournisseurs([], ["Sofas Porto"]);
    const deux = fusionnerFournisseurs([], ["Sofas Porto"]);
    expect(une[0].id).toBe(deux[0].id);
  });

  it("normalise ce qu'il faut, et rien de plus", () => {
    expect(cleFournisseur(" Mobilier  Éco ")).toBe("mobilier eco");
  });
});
