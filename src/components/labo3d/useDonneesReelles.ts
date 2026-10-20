"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { hasPermission } from "@/lib/permissions";
import type { LogisticsLineRow } from "@/lib/types";
import { etatDepuisLignes, type SceneReelle } from "@/lib/labo3d/donnees-reelles";

/**
 * LABORATOIRE 3D — la lecture des vraies lignes.
 *
 * ⚠ LECTURE SEULE. Ce hook n'appelle QUE `list_logistics_lines`, qui est une
 * fonction serveur `stable` : elle ne peut rien écrire, même si on le voulait.
 * Aucune autre fonction n'est appelée depuis le laboratoire — ni validation,
 * ni décision, ni envoi, ni écriture dans le Google Sheet.
 *
 * Le serveur plafonne `p_limit` à 200 lignes par appel. On pagine donc, mais
 * jusqu'à un PLAFOND volontaire : au-delà, la scène deviendrait illisible
 * avant de devenir lente, et l'écran annonce « N affichées sur M » plutôt que
 * de laisser croire qu'on voit tout.
 */

const PAR_APPEL = 200;
export const PLAFOND = 600;

export type EtatChargement =
  | { phase: "inactif" }
  | { phase: "chargement" }
  | { phase: "pret"; scene: SceneReelle }
  | { phase: "refus"; message: string }
  | { phase: "erreur"; message: string };

export function useDonneesReelles(actif: boolean) {
  const { mode, listLogisticsLines } = useData();
  const { profile, loading } = useSession();
  const [etat, setEtat] = useState<EtatChargement>({ phase: "inactif" });
  const jeton = useRef(0);

  const charger = useCallback(async () => {
    const monJeton = jeton.current + 1;
    jeton.current = monJeton;

    if (mode !== "connected") {
      setEtat({
        phase: "refus",
        message:
          "Mode démonstration : aucune base n'est branchée, il n'y a donc aucune donnée réelle à lire.",
      });
      return;
    }
    if (
      profile === null ||
      !(
        hasPermission(profile.role, "gerer_logistique") ||
        hasPermission(profile.role, "gerer_livraisons")
      )
    ) {
      setEtat({
        phase: "refus",
        message:
          "Votre rôle ne permet pas de consulter les lignes logistiques. Le serveur refuserait la lecture de toute façon.",
      });
      return;
    }

    setEtat({ phase: "chargement" });
    try {
      const lignes: LogisticsLineRow[] = [];
      let total = 0;
      for (let offset = 0; offset < PLAFOND; offset += PAR_APPEL) {
        const page = await listLogisticsLines({ limit: PAR_APPEL, offset });
        if (jeton.current !== monJeton) return; // une autre lecture a pris la main
        total = page.total;
        lignes.push(...page.rows);
        if (page.rows.length < PAR_APPEL || lignes.length >= total) break;
      }
      setEtat({ phase: "pret", scene: etatDepuisLignes(lignes, { total }) });
    } catch (err: unknown) {
      setEtat({
        phase: "erreur",
        message: err instanceof Error ? err.message : "Lecture impossible.",
      });
    }
  }, [mode, profile, listLogisticsLines]);

  useEffect(() => {
    if (!actif) {
      jeton.current += 1; // annule une lecture en cours
      setEtat({ phase: "inactif" });
      return;
    }
    if (loading) return;
    void charger();
  }, [actif, loading, charger]);

  return { etat, recharger: charger };
}
