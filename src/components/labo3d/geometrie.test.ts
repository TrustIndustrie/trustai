import { describe, expect, it } from "vitest";
import {
  CONTOURNEMENT,
  ECHELLE_PENNE,
  PLAN,
  placeDansRacksPenne,
  placeDansZone,
  positionDuVehicule,
  trajetDuVehicule,
} from "./geometrie";
import { PENNE } from "@/lib/labo3d/depot-penne";

/**
 * CES TESTS GARDENT UN DÉFAUT QUE FAROUK A VU AVANT NOUS.
 *
 * Quand le vrai bâtiment de La Penne — cent mètres de long — a remplacé la
 * boîte générique sur la carte, deux camions se sont mis à rouler DANS le
 * dépôt et quatre-vingts caisses à joncher sa dalle. Rien ne l'interdisait :
 * la chaussée et les zones de marchandise avaient été écrites quand le
 * bâtiment faisait un cinquième de sa taille.
 *
 * On vérifie donc ici ce qu'aucun œil ne peut surveiller à chaque image : que
 * rien ne se pose à l'intérieur de l'emprise du bâtiment sans y avoir sa
 * place.
 */

/** L'emprise du bâtiment sur la carte, en coordonnées de plateau. */
const EMPRISE = {
  xMin: PLAN.aubagne.centre[0] - PLAN.aubagne.largeur / 2,
  xMax: PLAN.aubagne.centre[0] + PLAN.aubagne.largeur / 2,
  zMin: PLAN.aubagne.centre[2] - PLAN.aubagne.profondeur / 2,
  zMax: PLAN.aubagne.centre[2] + PLAN.aubagne.profondeur / 2,
};

function dansLeBatiment([x, , z]: [number, number, number]): boolean {
  return x > EMPRISE.xMin && x < EMPRISE.xMax && z > EMPRISE.zMin && z < EMPRISE.zMax;
}

const camion = (
  id: string,
  role: "transfert" | "livraison" | "fournisseur",
  depart: "argenteuil" | "aubagne",
  progression: number,
) => ({ id, role, depart, progression });

describe("les tournées partent vers leurs magasins", () => {
  it("celle d'Argenteuil remonte vers le nord", () => {
    // Lisses et Herblay sont au nord d'Argenteuil : un trajet négatif.
    expect(trajetDuVehicule("livraison", 0.5, "argenteuil")).toBeLessThan(0);
  });

  it("celle de La Penne descend vers le sud", () => {
    expect(trajetDuVehicule("livraison", 0.5, "aubagne")).toBeGreaterThan(1);
  });
});

describe("aucun camion ne traverse le dépôt de La Penne", () => {
  it("la tournée du Sud emprunte la voie de contournement", () => {
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const position = positionDuVehicule(
        camion("v-livraison-2", "livraison", "aubagne", p),
        0,
        false,
      );
      expect(dansLeBatiment(position), `progression ${p.toFixed(2)}`).toBe(false);
    }
  });

  it("et elle reste sur la voie, à l'est du bâtiment", () => {
    const position = positionDuVehicule(
      camion("v-livraison-2", "livraison", "aubagne", 0.8),
      0,
      false,
    );
    expect(position[0]).toBeGreaterThan(EMPRISE.xMax);
    // À la largeur d'une voie près : deux camions de tournée ne roulent pas
    // sur la même file.
    expect(Math.abs(position[0] - CONTOURNEMENT.x)).toBeLessThan(2.5);
  });

  it("la tournée du Nord non plus, en trafic continu", () => {
    for (let t = 0; t < 40; t += 0.37) {
      const position = positionDuVehicule(
        camion("v-livraison-1", "livraison", "argenteuil", 0.45),
        t,
        true,
      );
      expect(dansLeBatiment(position), `temps ${t.toFixed(2)}`).toBe(false);
    }
  });

  it("les semis d'affrètement s'arrêtent au quai, sans entrer", () => {
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const position = positionDuVehicule(
        camion("v-transfert-1", "transfert", "argenteuil", p),
        0,
        false,
      );
      expect(dansLeBatiment(position), `progression ${p.toFixed(2)}`).toBe(false);
    }
  });
});

describe("aucun camion ne traverse le dépôt d'Argenteuil non plus", () => {
  const empriseNord = {
    xMin: PLAN.argenteuil.centre[0] - PLAN.argenteuil.largeur / 2,
    xMax: PLAN.argenteuil.centre[0] + PLAN.argenteuil.largeur / 2,
    zMin: PLAN.argenteuil.centre[2] - PLAN.argenteuil.profondeur / 2,
    zMax: PLAN.argenteuil.centre[2] + PLAN.argenteuil.profondeur / 2,
  };
  const dedans = ([x, , z]: [number, number, number]) =>
    x > empriseNord.xMin && x < empriseNord.xMax && z > empriseNord.zMin && z < empriseNord.zMax;

  it("l'arrivage fournisseur descend par la voie de l'ouest", () => {
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const position = positionDuVehicule(
        camion("v-fournisseur-1", "fournisseur", "argenteuil", p),
        0,
        false,
      );
      expect(dedans(position), `progression ${p.toFixed(2)}`).toBe(false);
    }
  });

  it("et la tournée du Nord la remonte", () => {
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const position = positionDuVehicule(
        camion("v-livraison-1", "livraison", "argenteuil", p),
        0,
        false,
      );
      expect(dedans(position), `progression ${p.toFixed(2)}`).toBe(false);
    }
  });
});

describe("la marchandise de La Penne est dans ses racks", () => {
  const alveoles = 120;

  it("chaque caisse stockée tombe dans l'emprise du bâtiment", () => {
    for (let rang = 0; rang < alveoles; rang += 1) {
      const position = placeDansRacksPenne(rang);
      expect(dansLeBatiment(position), `rang ${rang}`).toBe(true);
    }
  });

  it("et jamais au-dessus de la toiture", () => {
    const plafond = PENNE.batiment.hauteur.valeur * ECHELLE_PENNE;
    for (let rang = 0; rang < alveoles; rang += 1) {
      expect(placeDansRacksPenne(rang)[1]).toBeLessThan(plafond);
    }
  });

  it("deux alvéoles voisines ne se superposent pas", () => {
    const vues = new Set<string>();
    for (let rang = 0; rang < alveoles; rang += 1) {
      const [x, y, z] = placeDansRacksPenne(rang);
      vues.add(`${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`);
    }
    expect(vues.size).toBe(alveoles);
  });

  it("le stockage passe par les racks, pas par le quadrillage générique", () => {
    // Deux rangs éloignés restent alignés sur les mêmes lignes de rack : les
    // caisses forment des travées, et non un tas.
    const abscisses = new Set<string>();
    for (let rang = 0; rang < 40; rang += 1) {
      abscisses.add(placeDansZone("aubagne", "stockage", rang)[0].toFixed(2));
    }
    // Deux racks, donc deux abscisses, et pas une grille de huit colonnes.
    expect(abscisses.size).toBe(2);
  });

  it("ce qui attend au sol tient dans l'aire de quai", () => {
    // Quelques caisses près de la porte, pas une dalle couverte : on borne
    // l'étalement au sol, dont c'était précisément le défaut.
    const positions = Array.from({ length: 24 }, (_, rang) =>
      placeDansZone("aubagne", "reception", rang),
    );
    const xs = positions.map((p) => p[0]);
    const zs = positions.map((p) => p[2]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(2);
    for (const position of positions) {
      expect(dansLeBatiment(position)).toBe(true);
    }
  });

  it("Argenteuil garde son quadrillage : on ne connaît pas son plan", () => {
    const abscisses = new Set<string>();
    for (let rang = 0; rang < 40; rang += 1) {
      abscisses.add(placeDansZone("argenteuil", "stockage", rang)[0].toFixed(2));
    }
    expect(abscisses.size).toBeGreaterThan(2);
  });
});
