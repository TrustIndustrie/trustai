import type { CodeDepot, Vehicule } from "@/lib/labo3d/types";
import type { Zone } from "@/lib/labo3d/etapes";
import { PENNE, abscissesRacks } from "@/lib/labo3d/depot-penne";

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

/**
 * L'ÉCARTEMENT DES DÉPÔTS — une échelle volontairement rompue.
 *
 * Argenteuil et La Penne-sur-Huveaune sont distants de ~770 km par la route,
 * soit environ huit heures de conduite. À l'échelle, les deux sites seraient
 * deux points invisibles séparés d'un désert, et la scène perdrait tout ce
 * qui en fait l'intérêt. On les écarte donc assez pour qu'on SENTE la
 * distance, et un panneau sur la route en donne la valeur réelle : le
 * spectateur ne peut pas se tromper sur ce qu'il regarde.
 */
export const DISTANCE_REELLE_KM = 770;
export const DUREE_REELLE_HEURES = 8;

/** Demi-écartement sur l'axe nord-sud. */
const ECART = 54;

export const PLAN: Record<CodeDepot, PlanDepot> = {
  argenteuil: {
    centre: [0, 0, -ECART],
    largeur: 30,
    profondeur: 18,
    hauteur: 7.5,
    orientationQuais: 1,
  },
  aubagne: {
    centre: [0, 0, ECART],
    // LES PROPORTIONS SONT CELLES DU VRAI BÂTIMENT : 100 m sur 45, soit un
    // rapport de 2,2. Le dessin précédent en faisait un carré, ce qui donnait
    // une fausse idée de la forme du site.
    //
    // La TAILLE, elle, reste celle d'une carte : la vue d'ensemble n'est pas
    // à l'échelle et ne peut pas l'être — sa route fait 86 unités pour 770 km.
    // Pour les mètres, c'est la page « Dépôt de La Penne » qui fait foi.
    largeur: 18,
    profondeur: 40,
    hauteur: 6.5,
    // Quais au nord : le quai unique et la porte d'entrée font face à la
    // route qui vient d'Argenteuil.
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
  // Les magasins suivent leur dépôt : les déplacer séparément les aurait
  // laissés orphelins au milieu du plateau au premier changement d'écartement.
  // Au NORD du bâtiment, pas à mi-hauteur de ses murs : leur bretelle
  // traversait sinon le dépôt d'Argenteuil, qui fait dix-huit unités de
  // profondeur depuis son centre.
  { nom: "Trust Lisses", position: [-30, 0, -ECART - 16] },
  { nom: "Trust Herblay", position: [30, 0, -ECART - 16] },
  { nom: "Trust Aubagne", position: [34, 0, ECART + 26] },
];

/** La route d'affrètement : d'un quai à l'autre, en ligne droite. */
export const ROUTE = {
  // Dérivés du plan, et non réécrits à la main : au premier changement
  // d'écartement, une constante oubliée aurait planté la route au milieu d'un
  // bâtiment.
  depart: [
    0, 0,
    PLAN.argenteuil.centre[2] + PLAN.argenteuil.profondeur / 2 + 3,
  ] as [number, number, number],
  arrivee: [
    0, 0,
    PLAN.aubagne.centre[2] - PLAN.aubagne.profondeur / 2 - 3,
  ] as [number, number, number],
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
  depart: CodeDepot = "aubagne",
): number {
  if (role === "transfert") return progression;
  // L'arrivage vient du nord et entre dans Argenteuil.
  if (role === "fournisseur") return -0.55 + progression * 0.5;
  // LA TOURNÉE PART DU DÉPÔT QUI LA CHARGE, ET VA VERS SES MAGASINS.
  //
  // Les deux tournées partaient auparavant vers le sud, quel que soit leur
  // dépôt de départ : celle d'Argenteuil traversait donc tout le plateau pour
  // aller livrer des magasins qui sont au NORD, et se retrouvait garée devant
  // La Penne — deux camions au même quai, alors que La Penne n'en a qu'un.
  if (depart === "argenteuil") return -0.08 - progression * 0.5;
  return 1.04 + progression * 0.5;
}

/**
 * LA VOIE DE CONTOURNEMENT DE LA PENNE.
 *
 * Le bâtiment réel fait cent mètres de long : posé sur la carte, il descend
 * bien plus bas que l'ancienne boîte générique, et la chaussée principale
 * — qui débordait au sud pour laisser passer les tournées — le traversait de
 * part en part. On voyait donc des camions rouler DANS le dépôt.
 *
 * La chaussée s'arrête désormais au quai : c'est un cul-de-sac, et c'en est
 * un dans la réalité aussi, puisqu'il n'y a qu'une porte. Les tournées du Sud
 * sortent du quai, prennent la voie de contournement à l'est du bâtiment, et
 * rejoignent la bretelle du magasin d'Aubagne.
 */
export const CONTOURNEMENT = {
  /** Abscisse de la voie, à l'est du bâtiment. */
  x: PLAN.aubagne.centre[0] + PLAN.aubagne.largeur / 2 + 5,
  /** Du raccordement sur la chaussée principale… */
  zDebut: PLAN.aubagne.centre[2] - PLAN.aubagne.profondeur / 2 - 4,
  /** …jusqu'à la bretelle du magasin d'Aubagne. */
  zFin: PLAN_MAGASINS[2].position[2],
};

/**
 * LA MÊME CHOSE AU NORD, POUR ARGENTEUIL.
 *
 * Le défaut était identique et plus ancien : la chaussée débordait de
 * vingt-trois unités au nord du quai, c'est-à-dire À TRAVERS le bâtiment
 * d'Argenteuil, dont les quais donnent au sud. Les arrivages fournisseurs le
 * traversaient donc en diagonale sous le toit, où personne ne les voyait.
 *
 * Les deux chaussées s'arrêtent maintenant à leur quai, et tout ce qui va
 * plus loin — arrivages, tournées du Nord — passe par cette voie, à l'ouest.
 */
export const CONTOURNEMENT_NORD = {
  x: PLAN.argenteuil.centre[0] - PLAN.argenteuil.largeur / 2 - 5,
  /** Au droit du quai : c'est là qu'on quitte la chaussée. */
  zDebut: PLAN.argenteuil.centre[2] + PLAN.argenteuil.profondeur / 2 + 2,
  /** Jusqu'au-delà des premières rangées de fournisseurs. */
  zFin: PLAN.argenteuil.centre[2] - 44,
};

/**
 * La position d'un véhicule, voie et contournement compris.
 *
 * Ce calcul est fait par le camion ET par la marchandise qu'il porte : il
 * vit ici seulement, sans quoi la caisse finit par flotter à côté de sa
 * remorque — c'est déjà arrivé une fois.
 */
export function positionDuVehicule(
  vehicule: Pick<Vehicule, "id" | "role" | "progression" | "depart">,
  temps: number,
  circulation: boolean,
): [number, number, number] {
  const avancement = avancementAffiche(vehicule.progression, temps, circulation);
  const t = trajetDuVehicule(vehicule.role, avancement, vehicule.depart);
  const voie = voieDuVehicule(vehicule.id, vehicule.role);
  const [x, , z] = positionSurRoute(t);

  // AU-DELÀ DU QUAI DE LA PENNE, ON QUITTE LA CHAUSSÉE PRINCIPALE.
  // Le trajet de la tournée du Sud vaut t ∈ [1,04 ; 1,54] : on le ramène à
  // une fraction propre, puis on le découpe en deux temps — la sortie du
  // quai vers l'est, puis la descente le long du contournement. Un calcul
  // d'un seul tenant laissait un saut de quelques mètres au raccordement.
  if (t > 1) {
    const u = Math.min(1, Math.max(0, (t - 1.04) / 0.5));
    const quai: [number, number] = [x + voie, ROUTE.arrivee[2] + 2];
    const entree: [number, number] = [CONTOURNEMENT.x + voie * 0.4, CONTOURNEMENT.zDebut];
    if (u < 0.2) {
      const k = u / 0.2;
      return [
        quai[0] + (entree[0] - quai[0]) * k,
        0,
        quai[1] + (entree[1] - quai[1]) * k,
      ];
    }
    const k = (u - 0.2) / 0.8;
    return [
      entree[0],
      0,
      entree[1] + (CONTOURNEMENT.zFin - entree[1]) * k,
    ];
  }

  // EN DEÇÀ DU QUAI D'ARGENTEUIL, DE MÊME : la chaussée s'arrête, et l'on
  // prend la voie de l'ouest. Les deux sens partagent ce chemin — l'arrivage
  // qui descend du nord et la tournée qui y remonte parcourent la même voie,
  // en sens inverse.
  if (t < 0) {
    const u = Math.min(1, -t / 0.55);
    const quai: [number, number] = [x + voie, CONTOURNEMENT_NORD.zDebut];
    const entree: [number, number] = [
      CONTOURNEMENT_NORD.x + voie * 0.4,
      CONTOURNEMENT_NORD.zDebut,
    ];
    if (u < 0.2) {
      const k = u / 0.2;
      return [quai[0] + (entree[0] - quai[0]) * k, 0, quai[1]];
    }
    const k = (u - 0.2) / 0.8;
    return [entree[0], 0, entree[1] + (CONTOURNEMENT_NORD.zFin - entree[1]) * k];
  }

  return [x + voie, 0, z];
}

/**
 * LA ROUTE QUI RACONTE — vitesse du trafic continu, en fraction de trajet par
 * seconde. 0,045 donne un aller complet en ~22 s : assez lent pour qu'on
 * suive un camion des yeux, assez vif pour qu'il se passe quelque chose
 * pendant qu'on commente la scène.
 */
export const VITESSE_TRAFIC = 0.045;

/**
 * L'avancement AFFICHÉ d'un véhicule.
 *
 * Hors trafic, c'est l'avancement officiel, celui que la simulation (ou la
 * base) porte. En trafic continu, on y ajoute une boucle tirée de l'horloge
 * de la scène, sans toucher à l'état : faire avancer un état soixante fois
 * par seconde relancerait React pour rien.
 *
 * Cette fonction est appelée par le camion ET par la marchandise qu'il porte.
 * C'est la raison d'être de sa centralisation : deux formules séparées
 * finiraient par diverger d'une image, et la caisse flotterait à côté de sa
 * remorque.
 */
export function avancementAffiche(
  progression: number,
  temps: number,
  circulation: boolean,
): number {
  if (!circulation) return progression;
  const t = (progression + temps * VITESSE_TRAFIC) % 1;
  return t < 0 ? t + 1 : t;
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
 * LA PENNE SUR LA CARTE — passage du repère du dépôt à celui du plateau.
 *
 * Le modèle de `DepotPenne` vit en mètres, centré puis tourné d'un quart de
 * tour : ce passage doit donc être écrit UNE SEULE FOIS, sinon la marchandise
 * se retrouve à côté du bâtiment qui est censé la contenir.
 */
export const ECHELLE_PENNE =
  PLAN.aubagne.profondeur / PENNE.batiment.longueur.valeur;

export function versLaCartePenne(
  xLocal: number,
  yLocal: number,
  zLocal: number,
): [number, number, number] {
  const xc = xLocal - PENNE.batiment.longueur.valeur / 2;
  const zc = zLocal - PENNE.batiment.largeur.valeur / 2;
  // Rotation d'un quart de tour : (x, z) → (−z, x). C'est celle qu'applique
  // `PenneSurCarte` au bâtiment lui-même.
  return [
    PLAN.aubagne.centre[0] - zc * ECHELLE_PENNE,
    yLocal * ECHELLE_PENNE,
    PLAN.aubagne.centre[2] + xc * ECHELLE_PENNE,
  ];
}

/**
 * LA MARCHANDISE DE LA PENNE EST DANS LES RACKS, PAS PAR TERRE.
 *
 * « Les racks sont toujours pleins » : poser quatre-vingts caisses à plat sur
 * la dalle donnait un dépôt encombré que personne ne reconnaîtrait, et cela
 * cachait le bâtiment lui-même. Les caisses occupent donc les alvéoles des
 * deux racks — deux niveaux, le sol et l'étage — dans l'ordre de leur rang.
 *
 * Il y a environ cent trente alvéoles : au-delà, on empile à l'étage du
 * dernier rack plutôt que de déborder sur le sol.
 */
export function alveolesPenne(): [number, number, number][] {
  const ax = abscissesRacks();
  const racks = [
    {
      z: (ax.grandDebut + ax.grandFin) / 2,
      depart: 0,
      longueur: PENNE.rackEnL.retourLongitudinal.valeur,
    },
    {
      z: (ax.paralleleDebut + ax.paralleleFin) / 2,
      depart: PENNE.rackParallele.reculDepart.valeur,
      longueur: PENNE.rackParallele.longueur.valeur,
    },
  ];
  const travee = PENNE.racks.travee.valeur;
  const niveaux = [0.95, PENNE.racks.hauteurPremierNiveau.valeur + 1.05];

  const places: [number, number, number][] = [];
  for (let n = 0; n < niveaux.length; n += 1) {
    for (let r = 0; r < racks.length; r += 1) {
      const rack = racks[r];
      const bandes = Math.max(1, Math.round(rack.longueur / travee));
      for (let i = 0; i < bandes; i += 1) {
        places.push(
          versLaCartePenne(
            rack.depart + (i + 0.5) * (rack.longueur / bandes),
            niveaux[n],
            rack.z,
          ),
        );
      }
    }
  }
  return places;
}

/** Les dimensions d'une charge d'alvéole, en unités de carte. */
export const CHARGE_ALVEOLE: [number, number, number] = [
  PENNE.rackEnL.profondeur.valeur * 0.78 * ECHELLE_PENNE,
  0.95 * ECHELLE_PENNE,
  PENNE.racks.travee.valeur * 0.86 * ECHELLE_PENNE,
];

export function placeDansRacksPenne(rang: number): [number, number, number] {
  const places = alveolesPenne();
  const total = places.length;
  return places[((rang % total) + total) % total];
}

/**
 * L'AIRE DE QUAI DE LA PENNE — le seul endroit où la marchandise touche le
 * sol. Elle est juste derrière la porte unique, entre le bout des racks et la
 * zone Mobilier Malin : c'est là que se pose ce qui vient d'arriver et ce qui
 * va partir, puisque tout entre et sort par la même ouverture.
 */
function placeSurLeQuaiPenne(zone: Zone, rang: number): [number, number, number] {
  // Coordonnées du dépôt, en mètres : x depuis le mur d'entrée, z depuis le
  // mur des racks.
  const bandes: Record<string, { x: number; z: number }> = {
    reception: { x: 4, z: 12 },
    preparation: { x: 4, z: 17 },
    expedition: { x: 11, z: 12 },
    stockage: { x: 11, z: 17 },
  };
  const base = bandes[zone] ?? bandes.reception;
  const pas = 2.2;
  const colonnes = 2;
  const rangees = 2;
  const parNiveau = colonnes * rangees;
  const niveau = Math.min(2, Math.floor(rang / parNiveau));
  const reste = rang % parNiveau;
  return versLaCartePenne(
    base.x + (reste % colonnes) * pas,
    0.95 + niveau * 1.1,
    base.z + Math.floor(reste / colonnes) * pas,
  );
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
  // LA PENNE N'A PAS QUATRE ZONES GÉNÉRIQUES : elle a deux racks, une allée,
  // une zone Mobilier Malin et UNE porte. Sa marchandise suit donc son
  // implantation réelle, et non le quadrillage qui sert aux dépôts dont on
  // ne connaît pas le plan.
  if (depot === "aubagne") {
    return zone === "stockage"
      ? placeDansRacksPenne(rang)
      : placeSurLeQuaiPenne(zone, rang);
  }

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
  // L'aire d'attente est accrochée à Argenteuil, pas à une coordonnée écrite
  // en dur : le dépôt d'entrée peut bouger sans l'abandonner derrière lui.
  return [
    PLAN.argenteuil.centre[0] - PLAN.argenteuil.largeur / 2 - 19
      + (rang % colonnes) * 1.5,
    0.45,
    PLAN.argenteuil.centre[2] + Math.floor(rang / colonnes) * 1.5,
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
