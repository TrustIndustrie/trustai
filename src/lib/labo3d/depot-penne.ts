/**
 * LE DÉPÔT DE LA PENNE-SUR-HUVEAUNE — géométrie de référence.
 *
 * ⚠ TOUTES LES MESURES SONT EN MÈTRES, et chacune porte son statut :
 * `CONFIRMÉ` quand elle vient de la description de Farouk, `HYPOTHÈSE` quand
 * elle a été posée pour pouvoir dessiner. Aucune hypothèse n'est enfouie dans
 * un composant : elles vivent toutes ici, et une seule ligne suffit à les
 * corriger le jour où quelqu'un prend un décamètre.
 *
 * ────────────────────────────────────────────────────────────────────────
 * L'ENTRÉE : DEUX SOURCES SE CONTREDISAIENT, FAROUK A TRANCHÉ.
 *
 * Le premier plan plaçait l'entrée au milieu du grand côté. La description
 * orale disait « en entrant, racks à GAUCHE », ce qui n'est vrai que si l'on
 * entre par un PETIT côté et qu'on marche dans la longueur. Farouk a confirmé
 * l'erreur du dessin et publié une capture corrigée le 22 octobre 2026 :
 *
 *   « Entrée sur le petit côté gauche du plan, face à la longueur du dépôt ;
 *     pas sur le grand côté inférieur. Bloc bureaux le long du bord
 *     inférieur, proche de l'entrée : il est à droite lorsqu'on entre.
 *     Supprimer l'ancien petit rack côté entrée. »
 *
 * PUIS L'ORIENTATION DU BLOC BUREAUX, LE MÊME JOUR.
 *
 *   « Le bureau n'est pas dans ce sens-là ; la porte d'entrée n'est pas par
 *     là, elle fait face au rack de Trust. »
 *
 * Le couloir court donc PERPENDICULAIREMENT au mur de droite, sa porte
 * ouverte vers les racks, et non parallèlement à ce mur comme il était
 * dessiné. On en déduit de quel côté est chaque bureau : on entre dos aux
 * racks, la main droite vers l'entrée du bâtiment, donc Trust — « porte à
 * droite » — est côté entrée et Mobilier Malin côté fond.
 *
 * C'est cette version qui fait foi ici.
 * ────────────────────────────────────────────────────────────────────────
 *
 * REPÈRE DE LA SCÈNE
 *   x : 0 au mur d'ENTRÉE → vers le FOND, sur les 100 m. C'est l'axe de
 *       marche : on entre en x = 0 et on avance en x croissant.
 *   z : 0 au mur de GAUCHE en entrant (côté racks) → vers la DROITE
 *       (côté bureaux et Mobilier Malin), sur la largeur.
 *   y : hauteur.
 *
 * « Gauche » et « droite » s'entendent donc toujours depuis l'entrée, dos à
 * la porte — la seule convention qui corresponde à la façon dont on décrit un
 * bâtiment quand on le visite.
 */

/** Statut d'une mesure, pour que l'écran puisse le dire au spectateur. */
export type Statut = "confirmé" | "hypothèse";

export interface Mesure {
  valeur: number;
  statut: Statut;
  note?: string;
}

const confirme = (valeur: number, note?: string): Mesure => ({
  valeur,
  statut: "confirmé",
  note,
});
const hypothese = (valeur: number, note?: string): Mesure => ({
  valeur,
  statut: "hypothèse",
  note,
});

/** L'entrée est-elle sur un petit côté ? Voir l'arbitrage ci-dessus. */
export const ENTREE_SUR_PETIT_COTE = true;

export const PENNE = {
  batiment: {
    longueur: confirme(100, "Le grand rack file sur toute la longueur."),
    largeur: hypothese(45, "Les 30 m annoncés ne concernent que Mobilier Malin."),
    hauteur: hypothese(8, "Racks de 6 m plus un dégagement sous toiture."),
  },

  /**
   * LE QUAI — UN SEUL, et il est confondu avec la porte d'entrée.
   *
   * Confirmé par Farouk : pas de quai séparé à La Penne. La même ouverture
   * sert d'entrée et de quai de chargement, et elle est fermée par un RIDEAU
   * MÉTALLIQUE (porte à enroulement). C'est une contrainte d'exploitation
   * forte : tout entre et tout sort par le même point, donc une réception et
   * une expédition ne peuvent pas se faire en même temps.
   */
  quai: {
    nombre: confirme(1, "Un seul, confondu avec la porte d'entrée."),
    type: "rideau_metallique" as const,
  },

  entree: {
    // Largeur de la porte principale : inconnue. 6 m laisse passer un
    // transpalette et deux personnes de front, le minimum crédible.
    largeur: hypothese(6, "Largeur et position fine non mesurées."),
    // Sur le petit côté gauche, à ~20 m du mur des racks : valeur donnée par
    // la capture corrigée.
    decalageDepuisRacks: confirme(20, "Capture corrigée du 22 octobre."),
  },

  /**
   * LE RACK EN L — le premier ensemble en entrant.
   * Portion courte le long du mur d'entrée, retour sur toute la longueur.
   */
  rackEnL: {
    portionCourte: confirme(10, "Le long du mur d'entrée, à gauche."),
    retourLongitudinal: confirme(100, "Le long du mur de gauche."),
    profondeur: hypothese(2.5, "Profondeur de rack, pour le dessin seulement."),
  },

  /**
   * LE RACK PARALLÈLE — même extrémité au fond, départ reculé.
   * C'est lui qui crée l'allée de travail.
   */
  rackParallele: {
    longueur: confirme(80),
    reculDepart: confirme(20, "Par rapport au départ du grand rack."),
    profondeur: hypothese(2.5),
  },

  /** L'allée se mesure entre les FACES des racks, pas entre leurs axes. */
  allee: confirme(5, "Entre faces, pas entre axes."),

  /**
   * LE TAUX DE REMPLISSAGE — confirmé : « les racks sont toujours pleins ».
   * La scène doit donc montrer des racks CHARGÉS, pas une structure vide :
   * un rack vide donne une impression de dépôt au repos, et c'est faux.
   */
  remplissage: confirme(1, "« Les racks sont toujours pleins. »"),

  racks: {
    hauteur: confirme(6, "Estimée entre 5 et 7 m ; 6 m retenu comme valeur de travail."),
    // DEUX niveaux AU TOTAL : le sol et un étage. Surtout pas deux étages
    // au-dessus du sol — c'est une erreur de lecture facile à commettre, et
    // elle doublerait la hauteur apparente du stockage.
    niveaux: confirme(2, "Le sol plus un étage. Pas deux étages au-dessus du sol."),
    // Canapés et matelas : l'entraxe vertical est grand, ce ne sont pas des
    // étagères de magasin.
    hauteurPremierNiveau: hypothese(3, "Entraxe large : canapés et matelas."),
    travee: hypothese(2.7, "Largeur d'une travée entre montants."),
  },

  /**
   * LA ZONE MOBILIER MALIN — mobilier de bureau d'occasion.
   * Les 30 m sont une LARGEUR DE ZONE, pas la largeur du bâtiment.
   */
  mobilierMalin: {
    largeur: confirme(30, "Largeur de la zone, pas du bâtiment."),
    longueur: confirme(100),
    note: "Contour à ajuster pour les passages et le bloc bureaux. Ne revendique pas 3 000 m² nets.",
  },

  /**
   * LE BLOC BUREAUX — à l'intérieur du dépôt, à droite après quelques pas.
   * C'est là que les livreurs viennent chercher leurs bons.
   */
  bureaux: {
    // Le long du bord inférieur — à droite quand on entre — et proche de
    // l'entrée. La capture corrigée donne x ≈ 15 m comme position indicative.
    reculDepuisEntree: confirme(15, "Capture corrigée : position indicative."),
    couloir: {
      longueur: confirme(5),
      largeur: hypothese(1.8),
    },
    // « À droite » et « à gauche » s'entendent EN ENTRANT DANS LE COULOIR,
    // c'est-à-dire dos aux racks : Trust est donc côté entrée du bâtiment.
    trust: confirme(9, "En m², porte à DROITE à mi-couloir, côté entrée."),
    mobilierMalin: confirme(18, "En m², porte à GAUCHE, exactement en face."),
    sanitaires: {
      // Toilettes, douche et évier au fond du couloir. Leur cloisonnement
      // n'est pas connu : on ne prétend pas à un nombre de pièces.
      surface: hypothese(8),
      note: "WC, douche et évier au fond. Cloisonnement interne inconnu.",
    },
  },

  /**
   * LE SEGMENT DE RACK CÔTÉ ENTRÉE — SUPPRIMÉ.
   *
   * Il figurait sur le premier croquis, et sa liaison avec le rack en L
   * n'avait jamais été établie. La capture corrigée demande explicitement de
   * le retirer. On garde le drapeau plutôt que d'effacer le code : si
   * quelqu'un le retrouve sur place, une seule ligne le rétablit.
   */
  rackEntree: {
    present: false,
    longueur: hypothese(12),
    profondeur: hypothese(2.5),
  },
} as const;

/** Les mesures encore incertaines, à afficher telles quelles à l'écran. */
export const INCERTITUDES: string[] = [
  "Largeur totale et hauteur du bâtiment",
  "Profondeur des racks et largeur des travées",
  "Taille et position exactes de la porte principale",
  "Largeur du couloir et proportions des bureaux",
  "Profondeur des sanitaires au fond du couloir",
  "Cloisonnement des sanitaires",
  "Contour exact de la zone Mobilier Malin",
];

/**
 * Les abscisses des racks, calculées depuis l'allée.
 *
 * L'allée se mesure entre les FACES : le rack parallèle commence donc à
 * `profondeur du grand rack + allée`, et non à `allée` tout court. C'est la
 * distinction que la description prenait soin de faire, et s'en écarter
 * décalerait toute la travée de deux mètres et demi.
 */
export function abscissesRacks() {
  const grandDebut = 0;
  const grandFin = PENNE.rackEnL.profondeur.valeur;
  const paralleleDebut = grandFin + PENNE.allee.valeur;
  const paralleleFin = paralleleDebut + PENNE.rackParallele.profondeur.valeur;
  return { grandDebut, grandFin, paralleleDebut, paralleleFin };
}
