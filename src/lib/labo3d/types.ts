/**
 * LABORATOIRE 3D — structures de la scène.
 *
 * ⚠ Prototype expérimental. Aucune de ces structures ne touche la base de
 * données : la scène ne lit JAMAIS Supabase, elle consomme uniquement un
 * `EtatScene` produit par le générateur fictif.
 *
 * C'est le contrat qui rend l'expérience réversible ET connectable : le jour
 * où l'on voudrait de vraies données, un second producteur fabriquerait le
 * même `EtatScene` depuis `list_logistics_lines`, `list_delivery_rounds` et
 * `logistics_summary`, sans qu'une seule ligne du code 3D ne change.
 */

/** Les étapes réelles de `logistics_lines.stage`, reprises à l'identique. */
export type Etape =
  | "a_commander"
  | "commandee"
  | "attendue"
  | "recue_argenteuil"
  | "en_transfert"
  | "recue_aubagne"
  | "disponible"
  | "sortie"
  | "annulee";

/** Les deux dépôts réels de Trust Industrie. */
export type CodeDepot = "argenteuil" | "aubagne";

export interface Caisse {
  id: string;
  designation: string;
  fournisseur: string;
  quantite: number;
  etape: Etape;
  /** Dépôt de rattachement : là où la marchandise doit finir. */
  depot: CodeDepot;
  /** Jours passés dans l'étape actuelle — ce qui révèle les blocages. */
  joursDansEtape: number;
  /** Rang dans sa zone, qui détermine sa place sur le plateau. */
  rang: number;
  /** Identifiant du véhicule qui la porte, quand elle roule. */
  vehiculeId: string | null;
  /** Anomalie bloquante : la caisse passe en rouge. */
  anomalie: string | null;
  clientPromis: string | null;
}

export type RoleVehicule = "transfert" | "livraison" | "fournisseur";

export interface Vehicule {
  id: string;
  immatriculation: string;
  role: RoleVehicule;
  libelle: string;
  livreur: string | null;
  /** Avancement sur son trajet, de 0 (départ) à 1 (arrivée). */
  progression: number;
  /** Vitesse par jour simulé. */
  vitesse: number;
  depart: CodeDepot;
  arrivee: CodeDepot | "magasin";
  caisses: number;
  passagesRestants: number;
  enRoute: boolean;
}

export interface Depot {
  code: CodeDepot;
  nom: string;
  ville: string;
  note: string;
  /** Capacité de stockage simulée, pour le taux d'occupation. */
  capacite: number;
}

export interface Anomalie {
  id: string;
  caisseId: string;
  message: string;
  jour: number;
}

export interface EtatScene {
  /** Jour simulé, pour que l'écran affiche une horloge fictive. */
  jour: number;
  depots: Depot[];
  caisses: Caisse[];
  vehicules: Vehicule[];
  anomalies: Anomalie[];
  /** Journal des événements, affiché dans le panneau de supervision. */
  journal: { jour: number; texte: string }[];
}

/** Ce sur quoi on vient de cliquer. */
export type Selection =
  | { genre: "depot"; code: CodeDepot }
  | { genre: "caisse"; id: string }
  | { genre: "vehicule"; id: string }
  | { genre: "magasin"; nom: string }
  | null;
