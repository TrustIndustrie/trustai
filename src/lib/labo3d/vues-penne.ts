import { PENNE } from "./depot-penne";

/**
 * LES POINTS DE VUE DU DÉPÔT DE LA PENNE.
 *
 * ⚠ EXPRIMÉS DANS LE REPÈRE DU DÉPÔT — x = 0 au mur d'entrée, z = 0 au mur
 * des racks — parce que c'est le seul repère dans lequel on puisse les écrire
 * à la main sans se tromper. La conversion vers le repère de la scène se fait
 * ici, une fois : le bâtiment est centré sur l'origine, il est donc décalé de
 * la moitié de ses dimensions.
 *
 * C'est exactement l'erreur commise une première fois — des coordonnées du
 * dépôt passées telles quelles à la caméra, qui visait alors le milieu du
 * bâtiment en croyant viser l'entrée, et la « vue bureaux » regardait un pré.
 * Le repère vit désormais dans une seule fonction, partagée par la page et
 * par la scène.
 */

export const VUES_LOCALES = {
  entree: {
    nom: "Depuis l'entrée",
    // Reculé DEHORS, devant la porte, et en plongée : assez haut pour
    // reconnaître d'un coup les racks à gauche, les bureaux à droite et la
    // zone Mobilier Malin devant soi.
    position: [-26, 26, 20] as const,
    cible: [34, 2, 20] as const,
  },
  dessus: {
    nom: "Vue du dessus",
    // À la verticale du centre : une vue de dessus qui montre les murs de
    // côté n'est plus une vue de dessus.
    position: [50, 108, 22.6] as const,
    cible: [50, 0, 22.5] as const,
  },
  bureaux: {
    nom: "Bloc bureaux",
    // DEPUIS LE DÉPÔT, FACE À LA PORTE DU COULOIR. Le couloir ayant été
    // réorienté — il s'ouvre vers les racks, pas vers le fond — l'ancien
    // point de vue montrait le bloc par-derrière, c'est-à-dire deux pignons
    // aveugles.
    position: [9, 10, 26] as const,
    cible: [18.6, 1.2, 41] as const,
  },
} as const;

export type VuePenne = keyof typeof VUES_LOCALES;

/** Du repère du dépôt vers celui de la scène. */
export function versLeMonde(
  p: readonly [number, number, number],
): [number, number, number] {
  return [
    p[0] - PENNE.batiment.longueur.valeur / 2,
    p[1],
    p[2] - PENNE.batiment.largeur.valeur / 2,
  ];
}

export const VUE_INITIALE = {
  position: versLeMonde(VUES_LOCALES.entree.position),
  cible: versLeMonde(VUES_LOCALES.entree.cible),
};
