import type { CodeDepot, Etape } from "./types";

/**
 * LABORATOIRE 3D — l'étape EST la position.
 *
 * C'est l'idée qui tient toute la scène : une caisse ne porte pas un statut
 * écrit à côté d'elle, elle se TROUVE à l'endroit que son statut désigne.
 * Changer l'étape d'une caisse la fait physiquement se déplacer, et c'est
 * précisément ce qu'un tableau ne sait pas montrer.
 */

/** Les zones physiques d'un dépôt, dans l'ordre du flux. */
export type Zone =
  | "hors_site"
  | "reception"
  | "stockage"
  | "preparation"
  | "expedition"
  | "route";

export const LIBELLES_ETAPE: Record<Etape, string> = {
  a_commander: "À commander",
  commandee: "Commandée",
  attendue: "Attendue",
  recue_argenteuil: "Reçue à Argenteuil",
  en_transfert: "En transfert",
  recue_aubagne: "Reçue à Aubagne",
  disponible: "Disponible",
  sortie: "Sortie",
  annulee: "Annulée",
};

/**
 * Couleurs alignées sur la palette TRUST AI : vert pour ce qui est bon,
 * ambre pour ce qui attend, bleu pour ce qui circule, rouge pour ce qui
 * bloque, gris pour ce qui n'est pas encore là.
 */
export const COULEURS_ETAPE: Record<Etape, string> = {
  a_commander: "#9aa0a6",
  commandee: "#b08968",
  attendue: "#d99a2b",
  recue_argenteuil: "#3b82c4",
  en_transfert: "#5b9bd5",
  recue_aubagne: "#3b82c4",
  disponible: "#3f9e5a",
  sortie: "#7a5cc0",
  annulee: "#8a8f94",
};

export const COULEUR_ANOMALIE = "#c4453b";

/** Où se trouve physiquement une caisse, selon son étape. */
export function zoneDeLEtape(etape: Etape): Zone {
  switch (etape) {
    case "a_commander":
    case "commandee":
      return "hors_site";
    case "attendue":
      return "route";
    case "recue_argenteuil":
    case "recue_aubagne":
      return "reception";
    case "en_transfert":
      return "route";
    case "disponible":
      return "stockage";
    case "sortie":
      return "expedition";
    case "annulee":
      return "hors_site";
  }
}

/** Dans quel dépôt la caisse se trouve à cette étape (null = sur la route). */
export function depotDeLEtape(etape: Etape, rattachement: CodeDepot): CodeDepot | null {
  switch (etape) {
    case "recue_argenteuil":
      return "argenteuil";
    case "recue_aubagne":
      return "aubagne";
    case "disponible":
    case "sortie":
      return rattachement;
    case "en_transfert":
    case "attendue":
      return null;
    default:
      return "argenteuil";
  }
}

/**
 * Progression normale d'une étape à la suivante. Une caisse d'Argenteuil ne
 * passe pas par Aubagne ; une caisse d'Aubagne y transite.
 */
export function etapeSuivante(etape: Etape, depot: CodeDepot): Etape | null {
  switch (etape) {
    case "a_commander":
      return "commandee";
    case "commandee":
      return "attendue";
    case "attendue":
      return "recue_argenteuil";
    case "recue_argenteuil":
      return depot === "aubagne" ? "en_transfert" : "disponible";
    case "en_transfert":
      return "recue_aubagne";
    case "recue_aubagne":
      return "disponible";
    case "disponible":
      return "sortie";
    default:
      return null;
  }
}
