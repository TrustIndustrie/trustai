import type { Fournisseur, ModeLogistique } from "./types";

/**
 * LABORATOIRE 3D — les sites fournisseurs.
 *
 * CE QUE LA BASE DIT, ET CE QU'ELLE NE DIT PAS.
 *
 * La table `suppliers` porte un `name`, un `country`, un `logistics` et un
 * `lead_time_days`. Elle NE PORTE NI ADRESSE NI VILLE : on ne peut donc pas
 * poser un fournisseur à sa vraie place. Le placement ci-dessous est
 * explicitement schématique — par pays, en bordure de plateau — et l'écran le
 * dit. Inventer une ville pour faire joli serait le seul vrai mensonge que ce
 * prototype pourrait commettre.
 *
 * CE QUI EST RÉEL, EN REVANCHE, et qui est plus utile qu'une coordonnée :
 *   - `logistics` distingue « il nous livre » de « on va chercher ». Ce sont
 *     deux flux physiques différents, et c'est exactement ce qu'une vue 3D
 *     sait montrer d'un coup d'œil ;
 *   - `lead_time_days` donne le délai annoncé.
 */

export type { Fournisseur, ModeLogistique };


export const LIBELLES_MODE: Record<ModeLogistique, string> = {
  retrait_trust: "Nous allons chercher",
  livraison_fournisseur: "Il nous livre",
  les_deux: "Les deux",
};

/**
 * Le flux se lit à la couleur : ambre quand c'est à nous d'aller chercher
 * (une charge pour nos camions), vert quand le fournisseur livre (une charge
 * pour les siens), bleu quand les deux sont possibles.
 */
export const COULEURS_MODE: Record<ModeLogistique, string> = {
  retrait_trust: "#d99a2b",
  livraison_fournisseur: "#3f9e5a",
  les_deux: "#4a86b8",
};

/** Le libellé du mode, y compris quand il n'est pas connu. */
export function libelleDuMode(mode: ModeLogistique | null): string {
  return mode === null ? "Mode logistique inconnu" : LIBELLES_MODE[mode];
}

/**
 * La couleur du mode. Un fournisseur dont on ignore le flux reste GRIS : lui
 * donner l'ambre ou le vert ferait croire qu'on sait qui transporte.
 */
export const COULEUR_MODE_INCONNU = "#8b9096";

export function couleurDuMode(mode: ModeLogistique | null): string {
  return mode === null ? COULEUR_MODE_INCONNU : COULEURS_MODE[mode];
}

export function estModeLogistique(v: string): v is ModeLogistique {
  return v === "retrait_trust" || v === "livraison_fournisseur" || v === "les_deux";
}

/**
 * Place les sites fournisseurs en arc au nord d'Argenteuil, groupés par pays.
 *
 * Le pays est la seule information de localisation disponible : on l'assume
 * comme un classement, pas comme une carte. La France d'abord, au plus près
 * du dépôt d'entrée ; les autres pays derrière, dans l'ordre alphabétique,
 * pour que la scène reste identique d'une ouverture à l'autre.
 */
export function placerFournisseurs(
  fournisseurs: Fournisseur[],
  centreDepot: [number, number, number],
): { fournisseur: Fournisseur; position: [number, number, number] }[] {
  const paysOrdonnes = Array.from(new Set(fournisseurs.map((f) => f.pays))).sort(
    (a, b) => {
      const fa = a.toLowerCase() === "france" ? 0 : 1;
      const fb = b.toLowerCase() === "france" ? 0 : 1;
      return fa !== fb ? fa - fb : a.localeCompare(b, "fr");
    },
  );

  const resultat: { fournisseur: Fournisseur; position: [number, number, number] }[] = [];

  paysOrdonnes.forEach((pays, rangPays) => {
    const duPays = fournisseurs.filter((f) => f.pays === pays);
    // Une rangée par pays, en s'éloignant du dépôt. Les sites sont décalés en
    // QUINCONCE : alignés, leurs étiquettes se chevauchaient et devenaient
    // illisibles — un défaut qu'on ne voit qu'en regardant la scène.
    const z = centreDepot[2] - 34 - rangPays * 20;
    const pas = 27;
    const largeur = (duPays.length - 1) * pas;
    duPays.forEach((f, i) => {
      resultat.push({
        fournisseur: f,
        position: [
          centreDepot[0] - largeur / 2 + i * pas,
          0,
          z - (i % 2 === 0 ? 0 : 13),
        ],
      });
    });
  });

  return resultat;
}
