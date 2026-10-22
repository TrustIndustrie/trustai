import { etapeSuivante } from "./etapes";
import { reattribuerRangs } from "./rangs";
import type { Fournisseur, ModeLogistique } from "./types";
import type {
  Anomalie,
  Caisse,
  CodeDepot,
  Depot,
  Etape,
  EtatScene,
  Vehicule,
} from "./types";

/**
 * LABORATOIRE 3D — générateur de données ENTIÈREMENT FICTIVES.
 *
 * ⚠ AUCUNE DONNÉE RÉELLE. Aucun appel réseau, aucune lecture Supabase.
 * Les noms de clients, de fournisseurs et les références sont inventés.
 *
 * Le tirage est DÉTERMINISTE (graine fixe) : la démonstration est donc
 * reproductible à l'identique d'une session à l'autre, ce qui compte pour
 * juger du prototype plutôt que d'observer du hasard.
 */

/** Générateur pseudo-aléatoire à graine — mulberry32, court et suffisant. */
function graine(valeur: number) {
  let a = valeur >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAINE_PAR_DEFAUT = 20261020;

export const DEPOTS: Depot[] = [
  {
    code: "argenteuil",
    nom: "Dépôt d'Argenteuil",
    ville: "Argenteuil",
    note: "Dépôt principal Île-de-France. Dessert notamment le magasin d'Herblay.",
    capacite: 140,
  },
  {
    code: "aubagne",
    nom: "Dépôt de La Penne-sur-Huveaune",
    ville: "La Penne-sur-Huveaune",
    note: "Dépôt Sud, alimenté par affrètement depuis Argenteuil.",
    capacite: 90,
  },
];

export const MAGASINS = [
  { nom: "Trust Lisses", depot: "argenteuil" as CodeDepot },
  { nom: "Trust Herblay", depot: "argenteuil" as CodeDepot },
  { nom: "Trust Aubagne", depot: "aubagne" as CodeDepot },
];

const ARTICLES = [
  "Canapé d'angle Marbella",
  "Canapé Eva XL gris",
  "Canapé Flipper 2 places",
  "Lit coffre Nalu beige",
  "Lit coffre Paris graphite",
  "Matelas Serra blanc 160",
  "Matelas Bambou 140",
  "Table à manger Oslo",
  "Buffet Lisbonne 3 portes",
  "Fauteuil Ruben velours",
  "Armoire Ratuna 4 portes",
  "Chaises Mila, lot de 4",
  "Tapis Kelim 200 x 290",
  "Suspension rotin Java",
  "Table basse Terrazzo",
];

const FOURNISSEURS = [
  "Mobilia Sud",
  "Nordica Import",
  "Atelier Vicenza",
  "Textil Porto",
  "Bois & Formes",
];

/** Noms de clients FICTIFS — aucun client réel n'apparaît dans ce prototype. */
const CLIENTS = [
  "Mme Vasseur",
  "M. et Mme Ferrand",
  "Mme Oliveira",
  "M. Benali",
  "Mme Chatelain",
  "M. et Mme Roux",
  "Mme Nguyen",
  "M. Lefevre",
];

/** Répartition des 200 caisses, pensée pour une scène vivante et lisible. */
/**
 * Les sites fournisseurs fictifs. Modes et délais tirés de façon
 * DÉTERMINISTE depuis le rang : la démonstration doit être reproductible, et
 * un fournisseur qui change de mode à chaque ouverture ne prouverait rien.
 */
const MODES_FICTIFS: ModeLogistique[] = [
  "livraison_fournisseur", "retrait_trust", "les_deux",
];

const FOURNISSEURS_FICTIFS: Fournisseur[] = FOURNISSEURS.map((nom, i) => ({
  id: `f-${i + 1}`,
  nom,
  pays: i % 4 === 3 ? "Italie" : "France",
  mode: MODES_FICTIFS[i % MODES_FICTIFS.length],
  delaiJours: 3 + ((i * 5) % 18),
  depot: "argenteuil",
  origine: "referentiel",
}));

const REPARTITION: { etape: Etape; nombre: number }[] = [
  { etape: "a_commander", nombre: 18 },
  { etape: "commandee", nombre: 14 },
  { etape: "attendue", nombre: 22 },
  { etape: "recue_argenteuil", nombre: 30 },
  { etape: "en_transfert", nombre: 16 },
  { etape: "recue_aubagne", nombre: 18 },
  { etape: "disponible", nombre: 62 },
  { etape: "sortie", nombre: 16 },
  { etape: "annulee", nombre: 4 },
];

export const NOMBRE_DE_CAISSES = REPARTITION.reduce((t, r) => t + r.nombre, 0);

function creerVehicules(alea: () => number): Vehicule[] {
  return [
    {
      id: "v-transfert-1",
      immatriculation: "FICTIF-TR-01",
      role: "transfert",
      libelle: "Affrètement Argenteuil → La Penne",
      livreur: null,
      progression: 0.34,
      vitesse: 0.22,
      depart: "argenteuil",
      arrivee: "aubagne",
      caisses: 9,
      passagesRestants: 0,
      enRoute: true,
    },
    {
      id: "v-transfert-2",
      immatriculation: "FICTIF-TR-02",
      role: "transfert",
      libelle: "Affrètement Argenteuil → La Penne",
      livreur: null,
      progression: 0.78,
      vitesse: 0.18,
      depart: "argenteuil",
      arrivee: "aubagne",
      caisses: 7,
      passagesRestants: 0,
      enRoute: true,
    },
    {
      id: "v-livraison-1",
      immatriculation: "FICTIF-LV-11",
      role: "livraison",
      libelle: "Tournée Nord — Herblay et Lisses",
      livreur: "Karim (fictif)",
      progression: 0.45 + alea() * 0.1,
      vitesse: 0.3,
      depart: "argenteuil",
      arrivee: "magasin",
      caisses: 6,
      passagesRestants: 4,
      enRoute: true,
    },
    {
      id: "v-livraison-2",
      immatriculation: "FICTIF-LV-12",
      role: "livraison",
      libelle: "Tournée Sud — Marseille",
      livreur: "Sonia (fictif)",
      progression: 0.2 + alea() * 0.1,
      vitesse: 0.26,
      depart: "aubagne",
      arrivee: "magasin",
      caisses: 5,
      passagesRestants: 3,
      enRoute: true,
    },
    {
      id: "v-fournisseur-1",
      immatriculation: "FICTIF-FO-21",
      role: "fournisseur",
      libelle: "Arrivage fournisseur Mobilia Sud",
      livreur: null,
      progression: 0.6,
      vitesse: 0.35,
      depart: "argenteuil",
      arrivee: "argenteuil",
      caisses: 22,
      passagesRestants: 0,
      enRoute: true,
    },
  ];
}

export function creerEtatInitial(valeurGraine = GRAINE_PAR_DEFAUT): EtatScene {
  const alea = graine(valeurGraine);
  const vehicules = creerVehicules(alea);
  const transferts = vehicules.filter((v) => v.role === "transfert");
  const livraisons = vehicules.filter((v) => v.role === "livraison");
  const fournisseur = vehicules.find((v) => v.role === "fournisseur")!;

  const caisses: Caisse[] = [];
  const anomalies: Anomalie[] = [];
  let index = 0;

  for (const bloc of REPARTITION) {
    for (let i = 0; i < bloc.nombre; i += 1) {
      // Environ un tiers de la marchandise est destinée au Sud : c'est ce
      // qui alimente le flux de transfert entre les deux dépôts.
      const depot: CodeDepot = alea() < 0.34 ? "aubagne" : "argenteuil";
      const etape = bloc.etape;

      let vehiculeId: string | null = null;
      if (etape === "en_transfert") {
        vehiculeId = transferts[i % transferts.length].id;
      } else if (etape === "sortie") {
        const candidats = livraisons.filter(
          (v) => v.depart === depot || depot === "argenteuil",
        );
        vehiculeId = (candidats[0] ?? livraisons[0]).id;
      } else if (etape === "attendue") {
        vehiculeId = fournisseur.id;
      }

      // Les blocages sont ce que la 3D doit faire ressortir : quelques
      // caisses immobiles depuis longtemps, et deux anomalies franches.
      const vieille = alea() < 0.12;
      const jours = vieille
        ? 7 + Math.floor(alea() * 12)
        : 1 + Math.floor(alea() * 5);

      const caisse: Caisse = {
        id: `c-${String(index + 1).padStart(3, "0")}`,
        designation: ARTICLES[Math.floor(alea() * ARTICLES.length)],
        fournisseur: FOURNISSEURS[Math.floor(alea() * FOURNISSEURS.length)],
        quantite: 1 + Math.floor(alea() * 3),
        etape,
        depot,
        joursDansEtape: jours,
        rang: i,
        vehiculeId,
        anomalie: null,
        clientPromis:
          etape === "sortie" || etape === "disponible"
            ? CLIENTS[Math.floor(alea() * CLIENTS.length)]
            : null,
      };

      if (vieille && alea() < 0.35 && etape !== "annulee") {
        caisse.anomalie = "Immobilisée au-delà du délai habituel";
        anomalies.push({
          id: `a-${caisse.id}`,
          caisseId: caisse.id,
          message: `${caisse.designation} — immobilisée depuis ${jours} jours`,
          jour: 0,
        });
      }

      caisses.push(caisse);
      index += 1;
    }
  }

  return {
    jour: 0,
    depots: DEPOTS,
    fournisseurs: FOURNISSEURS_FICTIFS,
    caisses: reattribuerRangs(caisses),
    vehicules,
    anomalies,
    journal: [
      { jour: 0, texte: "Simulation initialisée — 200 caisses fictives." },
    ],
  };
}

// ===========================================================================
// Le simulateur : ce qui fait vivre la scène
// ===========================================================================
//
// Chaque fonction rend un NOUVEL état, sans modifier l'ancien : React voit
// un objet différent et redessine. C'est aussi ce qui permettrait, demain,
// de remplacer ce simulateur par un vrai flux de données sans rien changer
// à la scène.

function journaliser(etat: EtatScene, texte: string): EtatScene["journal"] {
  return [{ jour: etat.jour, texte }, ...etat.journal].slice(0, 40);
}

/** Avance d'un jour simulé : la marchandise progresse, les camions roulent. */
/**
 * Une caisse livrée quitte le site, et un nouveau besoin prend sa place.
 *
 * Sans cela la simulation était à SENS UNIQUE : la marchandise progressait
 * jusqu'à « sortie » et rien ne réapprovisionnait jamais. Au bout d'environ
 * deux cents jours le plateau se vidait et le journal tournait à vide — ce
 * qu'une lecture auto laissée tourner longtemps a fini par révéler.
 *
 * On RECYCLE la caisse au lieu d'en créer une nouvelle, et au lieu de la
 * supprimer : l'affichage instancié est dimensionné une fois pour toutes, et
 * un entrepôt réel travaille de toute façon à flux constant.
 */
function renouvelerCaisse(c: Caisse, alea: () => number): Caisse {
  return {
    ...c,
    designation: ARTICLES[Math.floor(alea() * ARTICLES.length)],
    fournisseur: FOURNISSEURS[Math.floor(alea() * FOURNISSEURS.length)],
    quantite: 1 + Math.floor(alea() * 3),
    etape: "a_commander",
    depot: alea() < 0.34 ? "aubagne" : "argenteuil",
    joursDansEtape: 0,
    vehiculeId: null,
    anomalie: null,
    clientPromis: null,
  };
}

export function avancerJour(etat: EtatScene): EtatScene {
  const jour = etat.jour + 1;
  const alea = graine(GRAINE_PAR_DEFAUT + jour * 7919);
  let avancees = 0;
  let arrivees = 0;

  const vehicules = etat.vehicules.map((v) => {
    const progression = v.progression + v.vitesse;
    if (progression >= 1) {
      arrivees += 1;
      // Le camion repart pour un nouveau rotation : une noria, comme dans la
      // réalité d'un affrètement régulier.
      return { ...v, progression: progression - 1 };
    }
    return { ...v, progression };
  });

  let soldees = 0;

  const caisses = etat.caisses.map((c) => {
    // La marchandise sortie est arrivée chez le client au bout de quelques
    // jours : le besoin repart alors à zéro.
    if (c.etape === "sortie" && c.joursDansEtape >= 3) {
      soldees += 1;
      return renouvelerCaisse(c, alea);
    }
    // Une commande annulée libère sa place au bout d'une semaine.
    if (c.etape === "annulee" && c.joursDansEtape >= 6) {
      soldees += 1;
      return renouvelerCaisse(c, alea);
    }

    // Une caisse bloquée par une anomalie ne progresse pas : c'est tout
    // l'intérêt de la voir en rouge et immobile.
    if (c.anomalie) {
      return { ...c, joursDansEtape: c.joursDansEtape + 1 };
    }
    const suivante = etapeSuivante(c.etape, c.depot);
    // Toutes les caisses ne bougent pas chaque jour : sinon la scène se
    // viderait en une poignée de tours.
    if (suivante && alea() < 0.22) {
      avancees += 1;
      let vehiculeId: string | null = null;
      if (suivante === "en_transfert") {
        const t = vehicules.filter((v) => v.role === "transfert");
        vehiculeId = t[avancees % t.length]?.id ?? null;
      } else if (suivante === "sortie") {
        const l = vehicules.filter((v) => v.role === "livraison");
        vehiculeId = l[avancees % l.length]?.id ?? null;
      }
      return { ...c, etape: suivante, joursDansEtape: 0, vehiculeId };
    }
    return { ...c, joursDansEtape: c.joursDansEtape + 1 };
  });

  const base: EtatScene = {
    ...etat,
    jour,
    caisses: reattribuerRangs(caisses),
    vehicules,
  };
  return {
    ...base,
    journal: journaliser(
      base,
      `Jour ${jour} — ${avancees} mouvement(s) de marchandise, ${arrivees} camion(s) à quai` +
        (soldees > 0 ? `, ${soldees} livraison(s) soldée(s) et réapprovisionnée(s).` : "."),
    ),
  };
}

/** Lance un transfert : de la marchandise reçue à Argenteuil part vers le Sud. */
export function provoquerTransfert(etat: EtatScene): EtatScene {
  const transferts = etat.vehicules.filter((v) => v.role === "transfert");
  if (transferts.length === 0) return etat;
  const camion = transferts[0];

  const candidates = etat.caisses.filter(
    (c) => c.etape === "recue_argenteuil" && c.depot === "aubagne" && !c.anomalie,
  );
  if (candidates.length === 0) {
    return {
      ...etat,
      journal: journaliser(
        etat,
        "Aucune marchandise reçue à Argenteuil n'est destinée au Sud.",
      ),
    };
  }

  const lot = candidates.slice(0, 8).map((c) => c.id);
  const caisses = etat.caisses.map((c) =>
    lot.includes(c.id)
      ? { ...c, etape: "en_transfert" as Etape, joursDansEtape: 0, vehiculeId: camion.id }
      : c,
  );
  const vehicules = etat.vehicules.map((v) =>
    v.id === camion.id ? { ...v, progression: 0.02, caisses: lot.length } : v,
  );

  const base = { ...etat, caisses: reattribuerRangs(caisses), vehicules };
  return {
    ...base,
    journal: journaliser(
      base,
      `Transfert lancé — ${lot.length} caisse(s) partent d'Argenteuil vers La Penne.`,
    ),
  };
}

/** Déclare une anomalie bloquante sur une caisse en mouvement. */
export function declencherAnomalie(etat: EtatScene): EtatScene {
  const alea = graine(GRAINE_PAR_DEFAUT + etat.jour * 104729 + etat.anomalies.length);
  const candidates = etat.caisses.filter(
    (c) => !c.anomalie && c.etape !== "annulee" && c.etape !== "a_commander",
  );
  if (candidates.length === 0) return etat;
  const cible = candidates[Math.floor(alea() * candidates.length)];

  const motifs = [
    "Colis endommagé au déchargement",
    "Référence non conforme au bon de livraison",
    "Quantité manquante",
    "Marchandise introuvable au dépôt",
  ];
  const message = motifs[Math.floor(alea() * motifs.length)];

  const caisses = etat.caisses.map((c) =>
    c.id === cible.id ? { ...c, anomalie: message } : c,
  );
  const anomalies: Anomalie[] = [
    { id: `a-${cible.id}-${etat.jour}`, caisseId: cible.id, message, jour: etat.jour },
    ...etat.anomalies,
  ];

  const base = { ...etat, caisses, anomalies };
  return {
    ...base,
    journal: journaliser(base, `Anomalie — ${cible.designation} : ${message}.`),
  };
}

/** Solde une tournée : les caisses sorties sont livrées et quittent la scène. */
export function livrerTournee(etat: EtatScene): EtatScene {
  const livraisons = etat.vehicules.filter((v) => v.role === "livraison");
  if (livraisons.length === 0) return etat;
  const camion = livraisons[0];

  const livrees = etat.caisses.filter(
    (c) => c.etape === "sortie" && c.vehiculeId === camion.id,
  );
  if (livrees.length === 0) {
    return {
      ...etat,
      journal: journaliser(etat, "Aucun passage en attente sur cette tournée."),
    };
  }

  const ids = livrees.map((c) => c.id);
  // La caisse livrée est chez le client, mais elle ne DISPARAÎT pas : elle
  // redevient un besoin à commander. La supprimer vidait le plateau tournée
  // après tournée, exactement comme la simulation se vidait jour après jour.
  const alea = graine(GRAINE_PAR_DEFAUT + etat.jour * 7907 + ids.length);
  const caisses = etat.caisses.map((c) =>
    ids.includes(c.id) ? renouvelerCaisse(c, alea) : c,
  );
  const vehicules = etat.vehicules.map((v) =>
    v.id === camion.id
      ? { ...v, caisses: 0, passagesRestants: Math.max(0, v.passagesRestants - ids.length) }
      : v,
  );

  const base = { ...etat, caisses: reattribuerRangs(caisses), vehicules };
  return {
    ...base,
    journal: journaliser(
      base,
      `Tournée soldée — ${ids.length} livraison(s) constatée(s), marchandise sortie du stock.`,
    ),
  };
}

/** Remet la simulation à son état de départ, à l'identique. */
export function reinitialiser(): EtatScene {
  return creerEtatInitial();
}
