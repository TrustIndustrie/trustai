import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * Les scripts Apps Script du dépôt sont du JavaScript classique : on exécute
 * leur logique PURE dans un bac à sable Node, sans SpreadsheetApp, pour
 * prouver les règles de stabilité des identifiants.
 */
function chargerScript(nom: string): Record<string, unknown> {
  const source = readFileSync(
    path.resolve(__dirname, "../../../google-apps-script", nom),
    "utf8",
  );
  const contexte: Record<string, unknown> = {};
  vm.createContext(contexte);
  vm.runInContext(
    source +
      "\nthis.__exports = { reconcilierIdentifiants, calculerEmpreinte, trouverColonne, ligneVide };",
    contexte,
    { filename: nom },
  );
  return contexte.__exports as Record<string, unknown>;
}

type Reconcile = (
  anciennes: unknown[][],
  idColAncien: number,
  nouvelles: unknown[][],
  idColNouveau: number,
  generer: () => string,
) => { ids: string[]; recopies: number; conserves: number; generes: number };

const s = chargerScript("synchroniser-original-vers-test.gs");
const reconcilier = s.reconcilierIdentifiants as Reconcile;
const empreinte = s.calculerEmpreinte as (row: unknown[], idCol: number) => string;
const trouverColonne = s.trouverColonne as (h: unknown[], t: string) => number;

function generateur() {
  let n = 0;
  return () => `TR-NEW-${++n}`;
}

describe("synchroniserOriginalVersTest — identifiants stables", () => {
  const ID = 3;

  it("recopie tel quel un ID TRUST présent dans l'original", () => {
    const r = reconcilier([], -1, [["01/02/2026", "Canapé", "Client A", "TR-ORIG-1"]], ID, generateur());
    expect(r.ids).toEqual(["TR-ORIG-1"]);
    expect(r).toMatchObject({ recopies: 1, conserves: 0, generes: 0 });
  });

  it("conserve l'ID déjà attribué dans la copie TEST à une ligne identique", () => {
    const anciennes = [["01/02/2026", "Canapé", "Client A", "TR-OLD-1"]];
    const nouvelles = [["01/02/2026", "Canapé", "Client A", ""]];
    const r = reconcilier(anciennes, ID, nouvelles, ID, generateur());
    expect(r.ids).toEqual(["TR-OLD-1"]);
    expect(r.conserves).toBe(1);
  });

  it("conserve l'ID même si la ligne a été déplacée ou triée", () => {
    const anciennes = [
      ["01/02/2026", "Canapé", "Client A", "TR-OLD-1"],
      ["02/02/2026", "Table", "Client B", "TR-OLD-2"],
    ];
    const nouvelles = [
      ["02/02/2026", "Table", "Client B", ""],
      ["01/02/2026", "Canapé", "Client A", ""],
    ];
    expect(reconcilier(anciennes, ID, nouvelles, ID, generateur()).ids)
      .toEqual(["TR-OLD-2", "TR-OLD-1"]);
  });

  it("deux lignes strictement identiques gardent chacune leur identifiant", () => {
    const anciennes = [
      ["01/02/2026", "Chaise", "Client C", "TR-OLD-1"],
      ["01/02/2026", "Chaise", "Client C", "TR-OLD-2"],
    ];
    const nouvelles = [
      ["01/02/2026", "Chaise", "Client C", ""],
      ["01/02/2026", "Chaise", "Client C", ""],
    ];
    expect(reconcilier(anciennes, ID, nouvelles, ID, generateur()).ids)
      .toEqual(["TR-OLD-1", "TR-OLD-2"]);
  });

  it("une ligne modifiée reçoit un identifiant neuf, les autres gardent le leur", () => {
    const anciennes = [
      ["01/02/2026", "Canapé", "Client A", "TR-OLD-1"],
      ["02/02/2026", "Table", "Client B", "TR-OLD-2"],
    ];
    const nouvelles = [
      ["01/02/2026", "Canapé 3 places", "Client A", ""],
      ["02/02/2026", "Table", "Client B", ""],
    ];
    const r = reconcilier(anciennes, ID, nouvelles, ID, generateur());
    expect(r.ids).toEqual(["TR-NEW-1", "TR-OLD-2"]);
    expect(r).toMatchObject({ conserves: 1, generes: 1 });
  });

  it("deux synchronisations successives donnent les mêmes identifiants", () => {
    const nouvelles = [
      ["01/02/2026", "Canapé", "Client A", ""],
      ["01/02/2026", "Canapé", "Client A", ""],
      ["03/02/2026", "Lit", "Client D", ""],
    ];
    const premiere = reconcilier([], -1, nouvelles, ID, generateur());
    const copieTest = nouvelles.map((row, i) => [...row.slice(0, ID), premiere.ids[i]]);
    const seconde = reconcilier(copieTest, ID, nouvelles, ID, generateur());
    expect(seconde.ids).toEqual(premiere.ids);
    expect(seconde.generes).toBe(0);
  });

  it("un ID dupliqué dans l'original (copier-coller) n'est recopié qu'une fois", () => {
    const nouvelles = [
      ["01/02/2026", "Canapé", "Client A", "TR-ORIG-1"],
      ["01/02/2026", "Canapé", "Client A", "TR-ORIG-1"],
    ];
    const r = reconcilier([], -1, nouvelles, ID, generateur());
    expect(r.ids[0]).toBe("TR-ORIG-1");
    expect(r.ids[1]).toBe("TR-NEW-1");
  });

  it("une ligne vide n'a pas d'identifiant", () => {
    const r = reconcilier([], -1, [["", "", "", ""], ["", "", "", "TR-RESIDU"]], ID, generateur());
    expect(r.ids).toEqual(["", ""]);
  });

  it("l'empreinte ignore la casse, les espaces et les colonnes vides finales, et normalise les dates", () => {
    const a = empreinte([new Date(2026, 1, 1), " Canapé ", "Client A", "TR-1", "", ""], 3);
    const b = empreinte(["2026-02-01", "canapé", "client a", "TR-2"], 3);
    expect(a).toBe(b);
  });

  it("retrouve la colonne ID TRUST par son titre, quelle que soit la casse", () => {
    expect(trouverColonne(["Date", " id trust ", "Client"], "ID TRUST")).toBe(1);
    expect(trouverColonne(["Date", "Client"], "ID TRUST")).toBe(-1);
  });
});

describe("id-trust.gs — le remplissage couvre bien tous les onglets", () => {
  it("ne référence plus de variable inexistante", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../google-apps-script/id-trust.gs"),
      "utf8",
    );
    expect(source).not.toMatch(/TRUST_SHEET_NAME|TRUST_HEADER_ROW/);
  });
});
