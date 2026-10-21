import { describe, expect, it } from "vitest";
import {
  avancerJour,
  creerEtatInitial,
  livrerTournee,
  provoquerTransfert,
} from "./donnees-fictives";
import { zoneDeLEtape } from "./etapes";
import type { EtatScene } from "./types";

/**
 * Ces tests existent à cause d'un défaut trouvé à l'usage, pas en relecture :
 * la lecture auto laissée tourner longtemps vidait le plateau. La simulation
 * était à sens unique — la marchandise sortait et rien ne la remplaçait.
 *
 * Ce qu'ils vérifient tient en une phrase : la scène doit rester vivante,
 * quel que soit le nombre de jours écoulés.
 */

function rangsUniquesParZone(etat: EtatScene): boolean {
  const vus = new Map<string, Set<number>>();
  for (const c of etat.caisses) {
    const cle = c.vehiculeId ?? `${c.depot}|${zoneDeLEtape(c.etape)}`;
    const dejaVus = vus.get(cle) ?? new Set<number>();
    if (dejaVus.has(c.rang)) return false;
    dejaVus.add(c.rang);
    vus.set(cle, dejaVus);
  }
  return true;
}

describe("la simulation ne s'épuise pas", () => {
  it("garde ses 200 caisses après 400 jours", () => {
    let etat = creerEtatInitial();
    for (let i = 0; i < 400; i += 1) etat = avancerJour(etat);
    expect(etat.jour).toBe(400);
    expect(etat.caisses).toHaveLength(200);
  });

  it("ne laisse jamais le plateau se vider — c'est le défaut corrigé", () => {
    let etat = creerEtatInitial();
    let minimumEnMouvement = Infinity;
    for (let i = 0; i < 400; i += 1) {
      etat = avancerJour(etat);
      // « En mouvement » : tout ce qui n'est ni sorti, ni annulé, ni en
      // attente de commande. C'est ce qui faisait la scène, et c'est ce qui
      // tombait à presque rien au bout de deux cents jours.
      const vivantes = etat.caisses.filter(
        (c) => c.etape !== "sortie" && c.etape !== "annulee" && c.etape !== "a_commander",
      ).length;
      minimumEnMouvement = Math.min(minimumEnMouvement, vivantes);
    }
    // Avant correction, ce minimum tombait sous 10. Le seuil est volontairement
    // bas : on veut détecter l'épuisement, pas figer un équilibre précis.
    expect(minimumEnMouvement).toBeGreaterThan(30);
  });

  it("réapprovisionne la marchandise livrée plutôt que de la faire disparaître", () => {
    let etat = creerEtatInitial();
    for (let i = 0; i < 40; i += 1) etat = avancerJour(etat);
    const avant = etat.caisses.length;
    etat = livrerTournee(etat);
    // Une tournée soldée ne doit RIEN retirer du plateau.
    expect(etat.caisses).toHaveLength(avant);
  });

  it("journalise le réapprovisionnement quand il a lieu", () => {
    let etat = creerEtatInitial();
    let vu = false;
    for (let i = 0; i < 40 && !vu; i += 1) {
      etat = avancerJour(etat);
      vu = etat.journal.some((l) => l.texte.includes("réapprovisionnée"));
    }
    expect(vu).toBe(true);
  });
});

describe("deux caisses ne se superposent jamais", () => {
  it("à l'état initial", () => {
    expect(rangsUniquesParZone(creerEtatInitial())).toBe(true);
  });

  it("après 200 jours de mouvements", () => {
    let etat = creerEtatInitial();
    for (let i = 0; i < 200; i += 1) {
      etat = avancerJour(etat);
      expect(rangsUniquesParZone(etat)).toBe(true);
    }
  });

  it("après un transfert et une tournée", () => {
    let etat = creerEtatInitial();
    for (let i = 0; i < 10; i += 1) etat = avancerJour(etat);
    etat = provoquerTransfert(etat);
    expect(rangsUniquesParZone(etat)).toBe(true);
    etat = livrerTournee(etat);
    expect(rangsUniquesParZone(etat)).toBe(true);
  });
});

describe("le déterminisme de la démonstration est préservé", () => {
  it("deux simulations identiques donnent le même état au jour 50", () => {
    let a = creerEtatInitial();
    let b = creerEtatInitial();
    for (let i = 0; i < 50; i += 1) {
      a = avancerJour(a);
      b = avancerJour(b);
    }
    expect(a.caisses.map((c) => `${c.etape}:${c.rang}`)).toEqual(
      b.caisses.map((c) => `${c.etape}:${c.rang}`),
    );
  });
});
