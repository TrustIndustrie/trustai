import type { LogisticsLineRow } from "@/lib/types";
import { reattribuerRangs } from "./rangs";
import { estModeLogistique } from "./fournisseurs";
import type {
  Fournisseur,
  Anomalie,
  Caisse,
  CodeDepot,
  Depot,
  Etape,
  EtatScene,
  Vehicule,
} from "./types";

/**
 * LABORATOIRE 3D — le producteur de scène à partir des VRAIES lignes.
 *
 * C'est le second producteur annoncé dans `types.ts` : il fabrique exactement
 * le même `EtatScene` que le générateur fictif, mais à partir des lignes
 * renvoyées par `list_logistics_lines`. Pas une ligne du code 3D ne change.
 *
 * ⚠ LECTURE SEULE, ET RIEN D'AUTRE. Ce fichier n'importe pas Supabase, ne
 * connaît aucun client, n'écrit nulle part : il reçoit des lignes déjà lues
 * et rend un objet en mémoire. C'est volontaire — tant que la conversion vit
 * ici, aucune écriture ne peut s'y glisser par accident, et la fonction reste
 * testable sans base de données.
 *
 * Ce que la base NE dit PAS, et que la scène ne doit donc pas prétendre :
 *   - la position d'un camion sur la route (aucune géolocalisation) ;
 *   - la capacité réelle d'un dépôt (la table `warehouses` n'en a pas) ;
 *   - le jour « simulé » (il n'a pas de sens ici : la scène montre l'instant).
 * Ces trois points sont signalés à l'écran plutôt que maquillés.
 */

/** Les neuf valeurs de `logistics_lines.stage`, reprises à l'identique. */
const ETAPES: readonly Etape[] = [
  "a_commander",
  "commandee",
  "attendue",
  "recue_argenteuil",
  "en_transfert",
  "recue_aubagne",
  "disponible",
  "sortie",
  "annulee",
];

function estEtape(valeur: string): valeur is Etape {
  return (ETAPES as readonly string[]).includes(valeur);
}

/**
 * Les façons de nommer le dépôt du Sud.
 *
 * Le site n'est pas à Aubagne : il est à LA PENNE-SUR-HUVEAUNE, sur un site
 * partagé avec le dépôt de Mobilier Malin. La base le nomme encore « Dépôt
 * d'Aubagne », et ce nom sera corrigé. Les deux appellations doivent donc
 * être reconnues, sinon le jour où l'entrepôt est renommé la marchandise du
 * Sud bascule silencieusement à Argenteuil — une panne invisible, du genre
 * qui ne lève aucune erreur et qu'on ne découvre qu'en comptant les caisses.
 */
const NOMS_DU_SUD = ["aubagne", "penne", "huveaune"];

/**
 * Le dépôt d'une ligne, déduit du LIBELLÉ de l'entrepôt.
 *
 * La table `warehouses` n'a pas de colonne « code » : elle a un `name` et une
 * `city`. On rapproche donc sur le texte, sans accent ni casse. Tout ce qui
 * n'est pas le dépôt du Sud est rattaché à Argenteuil, qui est le dépôt
 * d'entrée.
 */
export function depotDuLibelle(libelle: string | null | undefined): CodeDepot {
  const t = (libelle ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return NOMS_DU_SUD.some((n) => t.includes(n)) ? "aubagne" : "argenteuil";
}

/** Nombre de jours entiers écoulés depuis une date ISO, 0 si illisible. */
export function joursDepuis(iso: string | null | undefined, maintenant: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((maintenant - t) / 86_400_000));
}

/** Une ligne de `public.suppliers`, telle que la base la rend. */
export interface LigneFournisseur {
  id: string;
  name: string;
  country?: string | null;
  logistics?: string | null;
  lead_time_days?: number | null;
  active?: boolean | null;
}

/**
 * Convertit les fournisseurs réels. Rien n'est inventé : ce que la base ne
 * renseigne pas devient « Pays non renseigné » ou un délai nul, et l'écran le
 * montre tel quel.
 */
export function fournisseursDepuisLignes(lignes: LigneFournisseur[]): Fournisseur[] {
  return lignes
    .filter((f) => f.active !== false)
    .map((f) => {
      const mode = String(f.logistics ?? "");
      return {
        id: String(f.id),
        nom: String(f.name ?? "Fournisseur sans nom"),
        pays:
          f.country && String(f.country).trim() !== ""
            ? String(f.country).trim()
            : "Pays non renseigné",
        // Une valeur inconnue n'est pas rangée au hasard : `les_deux` est la
        // valeur par défaut de la colonne, c'est donc la lecture la moins
        // fausse.
        mode: estModeLogistique(mode) ? mode : "les_deux",
        delaiJours:
          typeof f.lead_time_days === "number" && f.lead_time_days > 0
            ? f.lead_time_days
            : null,
        depot: "argenteuil" as const,
      };
    })
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export interface OptionsConversion {
  /** Horodatage de référence, injectable pour que les tests soient stables. */
  maintenant?: number;
  /** Nombre total de lignes côté serveur, quand la page est tronquée. */
  total?: number;
  /** Fournisseurs réels, déjà convertis. */
  fournisseurs?: Fournisseur[];
}

export interface SceneReelle {
  etat: EtatScene;
  /** Lignes effectivement converties. */
  converties: number;
  /** Lignes écartées parce que leur `stage` est inconnu du laboratoire. */
  ignorees: number;
  /** Total annoncé par le serveur, pour dire honnêtement « 600 sur 2 400 ». */
  total: number;
}

/**
 * Capacités de stockage : SIMULÉES, faute de donnée réelle.
 *
 * On garde les mêmes valeurs que la scène fictive pour que le taux
 * d'occupation reste lisible, et l'écran précise que ce pourcentage est une
 * estimation. Inventer une capacité en la présentant comme réelle serait le
 * seul vrai mensonge que ce prototype pourrait commettre.
 */
const CAPACITES: Record<CodeDepot, number> = {
  argenteuil: 140,
  aubagne: 90,
};

const DEPOTS_REELS: Depot[] = [
  {
    code: "argenteuil",
    nom: "Dépôt d'Argenteuil",
    ville: "Argenteuil",
    note: "Dépôt d'entrée : toute la marchandise y est reçue.",
    capacite: CAPACITES.argenteuil,
  },
  {
    code: "aubagne",
    nom: "Dépôt de La Penne-sur-Huveaune",
    ville: "La Penne-sur-Huveaune",
    note: "Dépôt du Sud, site partagé avec Mobilier Malin, alimenté par affrètement depuis Argenteuil.",
    capacite: CAPACITES.aubagne,
  },
];

/**
 * Convertit une page de lignes logistiques réelles en scène 3D.
 *
 * Le `rang` est recalculé par zone : il détermine la place de la caisse sur
 * le plateau, et deux caisses d'une même zone ne doivent pas se superposer.
 * L'index de la ligne dans la page ne conviendrait pas — il est global.
 */
export function etatDepuisLignes(
  lignes: LogisticsLineRow[],
  options: OptionsConversion = {},
): SceneReelle {
  const maintenant = options.maintenant ?? Date.now();
  const caisses: Caisse[] = [];
  const anomalies: Anomalie[] = [];
  const affretements = new Map<string, { caisses: number; depart: CodeDepot }>();
  let ignorees = 0;

  for (const ligne of lignes) {
    const etape = String(ligne.stage ?? "");
    if (!estEtape(etape)) {
      // Une étape inconnue ne doit RIEN afficher : mieux vaut une caisse
      // manquante qu'une caisse rangée au mauvais endroit.
      ignorees += 1;
      continue;
    }

    const depot = depotDuLibelle(ligne.destination_label ?? ligne.current_label);
    // L'anomalie réelle a deux visages : une anomalie ouverte tranchée par
    // l'équipe, ou une ligne qui a disparu du récapitulatif.
    const ouvertes = Number(ligne.open_anomalies ?? 0);
    const manquanteDepuis = ligne.missing_since ?? null;
    let anomalie: string | null = null;
    if (ouvertes > 0) {
      anomalie = `${ouvertes} anomalie(s) ouverte(s)`;
    } else if (manquanteDepuis) {
      anomalie = `Introuvable dans le récapitulatif depuis ${joursDepuis(manquanteDepuis, maintenant)} jour(s)`;
    }

    // Un affrètement = un camion. C'est la seule notion de véhicule que la
    // base porte réellement aujourd'hui (`freight_ref`, « E243 »).
    const affretement =
      etape === "en_transfert" && ligne.freight_ref ? String(ligne.freight_ref) : null;
    if (affretement) {
      const v = affretements.get(affretement);
      if (v) v.caisses += 1;
      else affretements.set(affretement, { caisses: 1, depart: "argenteuil" });
    }

    const caisse: Caisse = {
      id: String(ligne.id),
      designation: String(ligne.designation ?? "Sans désignation"),
      fournisseur: String(ligne.supplier_label ?? "Fournisseur inconnu"),
      quantite: Math.max(1, Number(ligne.quantity ?? 1)),
      etape,
      depot,
      joursDansEtape: joursDepuis(ligne.last_changed_at ?? ligne.last_seen_at, maintenant),
      // Place provisoire : `reattribuerRangs` la fixe une fois la liste
      // complète, en tenant compte du camion qui porte la caisse.
      rang: 0,
      vehiculeId: affretement ? `aff-${affretement}` : null,
      anomalie,
      clientPromis: ligne.customer_label ? String(ligne.customer_label) : null,
    };
    caisses.push(caisse);

    if (anomalie) {
      anomalies.push({
        id: `a-${caisse.id}`,
        caisseId: caisse.id,
        message: `${caisse.designation} — ${anomalie}`,
        jour: 0,
      });
    }
  }

  // Les camions d'affrètement. Leur progression est fixée à mi-parcours :
  // la base ne dit PAS où ils se trouvent, et une position inventée qui
  // avancerait toute seule laisserait croire à un suivi en temps réel.
  const vehicules: Vehicule[] = Array.from(affretements.entries()).map(([ref, v]) => ({
    id: `aff-${ref}`,
    immatriculation: ref,
    role: "transfert",
    libelle: `Affrètement ${ref}`,
    livreur: null,
    progression: 0.5,
    vitesse: 0,
    depart: v.depart,
    arrivee: "aubagne",
    caisses: v.caisses,
    passagesRestants: 0,
    enRoute: true,
  }));

  const total = options.total ?? caisses.length + ignorees;

  return {
    etat: {
      jour: 0,
      depots: DEPOTS_REELS,
      fournisseurs: options.fournisseurs ?? [],
      caisses: reattribuerRangs(caisses),
      vehicules,
      anomalies,
      journal: [
        {
          jour: 0,
          texte: `${caisses.length} ligne(s) réelle(s) affichée(s) sur ${total} — lecture seule.`,
        },
        ...(ignorees > 0
          ? [
              {
                jour: 0,
                texte: `${ignorees} ligne(s) écartée(s) : étape inconnue du laboratoire.`,
              },
            ]
          : []),
      ],
    },
    converties: caisses.length,
    ignorees,
    total,
  };
}
