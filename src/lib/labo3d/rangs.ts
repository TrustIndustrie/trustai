import { zoneDeLEtape } from "./etapes";
import type { Caisse } from "./types";

/**
 * LABORATOIRE 3D — la place de chaque caisse dans sa zone.
 *
 * Le `rang` décide de l'emplacement physique sur le plateau. Deux caisses
 * d'une même zone ne doivent donc JAMAIS porter le même rang, sans quoi
 * elles se superposent exactement et l'une masque l'autre.
 *
 * C'est le défaut jumeau de celui trouvé côté données réelles : à la
 * création, chaque étape numérotait ses caisses de 0 à n-1, ce qui tenait
 * tant que rien ne bougeait. Dès que la simulation avançait, des caisses
 * venues d'étapes différentes se retrouvaient dans la même zone avec le même
 * rang. Le rang doit donc être recalculé après chaque mouvement, et c'est ce
 * que fait cette fonction — une seule fois, pour les deux générateurs.
 *
 * La clé de regroupement suit exactement la logique d'affichage : une caisse
 * posée sur une remorque se range par rapport À SON camion, pas par rapport
 * à la zone qu'elle traverse.
 */
export function reattribuerRangs(caisses: Caisse[]): Caisse[] {
  const compteurs = new Map<string, number>();
  return caisses.map((c) => {
    const cle = c.vehiculeId ?? `${c.depot}|${zoneDeLEtape(c.etape)}`;
    const rang = compteurs.get(cle) ?? 0;
    compteurs.set(cle, rang + 1);
    return c.rang === rang ? c : { ...c, rang };
  });
}
