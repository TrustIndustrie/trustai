import type { CodeDepot } from "@/lib/labo3d/types";
import type { Zone } from "@/lib/labo3d/etapes";

/**
 * LABORATOIRE 3D — le plan du plateau.
 *
 * Toutes les coordonnées de la scène vivent ici, en un seul endroit : les
 * bâtiments, les zones intérieures et la route s'y réfèrent, de sorte qu'on
 * déplace un dépôt en changeant un seul chiffre.
 *
 * Repère : X vers la droite, Y vers le haut, Z vers l'avant. Argenteuil est
 * au fond (Z négatif), Aubagne devant (Z positif), la route entre les deux.
 */

export interface PlanDepot {
  centre: [number, number, number];
  largeur: number;
  profondeur: number;
  hauteur: number;
  /** Côté des quais : -1 vers Argenteuil, +1 vers Aubagne. */
  orientationQuais: 1 | -1;
}

export const PLAN: Record<CodeDepot, PlanDepot> = {
  argenteuil: {
    centre: [0, 0, -30],
    largeur: 30,
    profondeur: 18,
    hauteur: 7.5,
    orientationQuais: 1,
  },
  aubagne: {
    centre: [0, 0, 30],
    largeur: 22,
    profondeur: 14,
    hauteur: 6.5,
    orientationQuais: -1,
  },
};

/**
 * L'identité visuelle de chaque site.
 *
 * Deux dépôts de la même teinte, ce sont deux boîtes qu'on confond. Argenteuil
 * est le grand site du Nord, en ardoise bleutée ; La Penne est le site du Sud,
 * en ocre. On reconnaît alors le lieu d'un coup d'œil, sans lire l'enseigne —
 * et c'est ce qu'on demande à une vue d'ensemble.
 */
export interface Palette {
  mur: string;
  murSombre: string;
  toit: string;
  bandeau: string;
  dalle: string;
}

export const PALETTES: Record<CodeDepot, Palette> = {
  argenteuil: {
    mur: "#e9e9ea",
    murSombre: "#c9ccd2",
    toit: "#49535f",
    bandeau: "#2f6f9e",
    dalle: "#c8c6c2",
  },
  aubagne: {
    mur: "#f0e7da",
    murSombre: "#d9c7b0",
    toit: "#6d5347",
    bandeau: "#b9623a",
    dalle: "#cdc3b2",
  },
};

/** Les trois magasins, posés en bordure de plateau. */
export const PLAN_MAGASINS: { nom: string; position: [number, number, number] }[] = [
  { nom: "Trust Lisses", position: [-30, 0, -38] },
  { nom: "Trust Herblay", position: [30, 0, -38] },
  { nom: "Trust Aubagne", position: [30, 0, 38] },
];

/** La route d'affrètement : d'un quai à l'autre, en ligne droite. */
export const ROUTE = {
  depart: [0, 0, -30 + 9 + 3] as [number, number, number],
  arrivee: [0, 0, 30 - 7 - 3] as [number, number, number],
  largeur: 6,
};

/**
 * Position sur la route. 0 = quai d'Argenteuil, 1 = quai d'Aubagne.
 * NON bornée : au-delà de ces valeurs, le véhicule vient d'ailleurs ou s'en
 * va ailleurs, ce qui est exactement le cas d'un arrivage fournisseur ou
 * d'une tournée de livraison.
 */
export function positionSurRoute(t: number): [number, number, number] {
  return [
    ROUTE.depart[0] + (ROUTE.arrivee[0] - ROUTE.depart[0]) * t,
    0,
    ROUTE.depart[2] + (ROUTE.arrivee[2] - ROUTE.depart[2]) * t,
  ];
}

/**
 * Avancement d'un véhicule traduit en position sur l'axe, selon son rôle.
 *
 * Ce calcul était écrit deux fois — dans le camion et dans la marchandise
 * qu'il porte — et deux copies finissent toujours par diverger : la caisse
 * flottait alors à côté de sa remorque. Il vit désormais ici seulement.
 */
export function trajetDuVehicule(
  role: "transfert" | "livraison" | "fournisseur",
  progression: number,
): number {
  if (role === "transfert") return progression;
  // L'arrivage vient du nord et entre dans Argenteuil.
  if (role === "fournisseur") return -0.55 + progression * 0.5;
  // La tournée quitte Aubagne vers le sud.
  return 1.08 + progression * 0.5;
}

/** Décalage latéral, pour que deux véhicules ne se chevauchent pas. */
export function voieDuVehicule(id: string, role: string): number {
  const base = role === "livraison" ? 1.7 : -1.7;
  // Un second camion du même rôle prend la voie d'à côté.
  const suffixe = Number(id.slice(-1)) || 1;
  return base + (suffixe % 2 === 0 ? (base > 0 ? 3.4 : -3.4) : 0);
}

/**
 * Les quatre zones intérieures d'un dépôt, exprimées en coordonnées locales
 * (le bâtiment est centré sur l'origine). La réception est côté quais,
 * l'expédition à l'opposé, le stockage occupe le cœur.
 */
export function rectangleZone(
  depot: CodeDepot,
  zone: Zone,
): { x: number; z: number; largeur: number; profondeur: number } {
  const p = PLAN[depot];
  const q = p.orientationQuais;
  const demiP = p.profondeur / 2;

  switch (zone) {
    case "reception":
      return {
        x: -p.largeur / 4,
        z: q * (demiP - 3),
        largeur: p.largeur / 2 - 2,
        profondeur: 4.5,
      };
    case "preparation":
      return {
        x: p.largeur / 4,
        z: q * (demiP - 3),
        largeur: p.largeur / 2 - 2,
        profondeur: 4.5,
      };
    case "stockage":
      return { x: 0, z: 0, largeur: p.largeur - 4, profondeur: p.profondeur - 11 };
    case "expedition":
      return {
        x: 0,
        z: -q * (demiP - 2.6),
        largeur: p.largeur - 4,
        profondeur: 3.8,
      };
    default:
      return { x: 0, z: 0, largeur: 1, profondeur: 1 };
  }
}

/**
 * Place la caisse de rang `rang` dans une zone : en grille, par piles de
 * deux, avec un pas régulier. C'est ce qui donne l'allure de travées rangées
 * plutôt que d'un tas.
 */
export function placeDansZone(
  depot: CodeDepot,
  zone: Zone,
  rang: number,
): [number, number, number] {
  const r = rectangleZone(depot, zone);
  const p = PLAN[depot];
  const pas = 1.6;
  const colonnes = Math.max(2, Math.floor(r.largeur / pas));
  const rangees = Math.max(2, Math.floor(r.profondeur / pas));
  const parNiveau = colonnes * rangees;

  // Plafond d'empilement : la pile ne doit JAMAIS traverser le toit. Avec
  // les 200 caisses fictives la question ne se posait pas ; avec de vraies
  // lignes, une zone chargée crevait le bâtiment par le haut.
  const niveauMax = Math.max(0, Math.floor((p.hauteur - 1.6) / 0.95));
  const niveau = Math.min(niveauMax, Math.floor(rang / parNiveau));
  const reste = rang % parNiveau;
  const colonne = reste % colonnes;
  const rangee = Math.floor(reste / colonnes);

  return [
    p.centre[0] + r.x - (r.largeur - pas) / 2 + colonne * pas,
    0.45 + niveau * 0.95,
    p.centre[2] + r.z - (r.profondeur - pas) / 2 + rangee * pas,
  ];
}

/** Position d'attente hors site, pour ce qui n'est pas encore arrivé. */
export function placeHorsSite(rang: number): [number, number, number] {
  const colonnes = 6;
  return [
    -34 + (rang % colonnes) * 1.5,
    0.45,
    -30 + Math.floor(rang / colonnes) * 1.5,
  ];
}

/** Place une caisse sur la remorque d'un camion, en deux rangs. */
export function placeSurRemorque(
  base: [number, number, number],
  rang: number,
): [number, number, number] {
  const colonne = rang % 2;
  const rangee = Math.floor(rang / 2) % 4;
  return [
    base[0] - 0.75 + colonne * 1.5,
    1.95,
    base[2] - 2.4 + rangee * 1.6,
  ];
}
