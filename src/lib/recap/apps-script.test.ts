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
      "\nthis.__exports = { reconcilierIdentifiants, calculerEmpreinte, trouverColonne, ligneVide, colonnesCles, lettreColonne };",
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
  cles?: number[],
  clesAnciennes?: number[],
) => { ids: string[]; recopies: number; conserves: number; rapproches: number; generes: number };

const s = chargerScript("synchroniser-original-vers-test.gs");
const reconcilier = s.reconcilierIdentifiants as Reconcile;
const empreinte = s.calculerEmpreinte as (row: unknown[], idCol: number, cles?: number[]) => string;
const colonnesCles = s.colonnesCles as (h: unknown[], t: string[], idCol: number) => number[];
const lettreColonne = s.lettreColonne as (i: number) => string;
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

describe("synchroniserOriginalVersTest — colonnes clés : ce qui change l'identité et ce qui ne la change pas", () => {
  // Colonnes : 0 date, 1 fournisseur, 2 désignation, 3 quantité, 4 client,
  // 5 commentaires (vivant), 6 réception (vivant), 7 ID TRUST.
  const ID = 7;
  const CLES = [0, 1, 2, 3, 4];
  const ligne = (
    date: string, four: string, desig: string, qte: string, client: string,
    comm = "", recu = "", id = "",
  ) => [date, four, desig, qte, client, comm, recu, id];

  const copieTest = [
    ligne("01/02/2026", "POLEZ", "Canapé", "2", "Client A", "", "", "TR-A"),
    ligne("02/02/2026", "ELEONORA", "Table", "1", "Client B", "", "", "TR-B"),
    ligne("03/02/2026", "POLEZ", "Chaise", "4", "Client C", "", "", "TR-C"),
  ];

  it("modifier un commentaire ou une date de réception ne change pas l'identifiant", () => {
    const nouvelles = [
      ligne("01/02/2026", "POLEZ", "Canapé", "2", "Client A", "RETOUR LE 30/04", "OUI"),
      ligne("02/02/2026", "ELEONORA", "Table", "1", "Client B", "", "OUI"),
      ligne("03/02/2026", "POLEZ", "Chaise", "4", "Client C", "partiel 2/4", ""),
    ];
    const r = reconcilier(copieTest, ID, nouvelles, ID, generateur(), CLES);
    expect(r.ids).toEqual(["TR-A", "TR-B", "TR-C"]);
    expect(r).toMatchObject({ conserves: 3, rapproches: 0, generes: 0 });
  });

  it("modifier UNE colonne clé (quantité corrigée) conserve l'identifiant par rapprochement", () => {
    const nouvelles = [
      ligne("01/02/2026", "POLEZ", "Canapé", "2", "Client A"),
      ligne("02/02/2026", "ELEONORA", "Table", "1", "Client B"),
      ligne("03/02/2026", "POLEZ", "Chaise", "3", "Client C"),
    ];
    const r = reconcilier(copieTest, ID, nouvelles, ID, generateur(), CLES);
    expect(r.ids).toEqual(["TR-A", "TR-B", "TR-C"]);
    expect(r).toMatchObject({ conserves: 2, rapproches: 1, generes: 0 });
  });

  it("modifier DEUX colonnes clés fait une ligne nouvelle : on ne devine pas", () => {
    const nouvelles = [
      ligne("01/02/2026", "POLEZ", "Canapé", "2", "Client A"),
      ligne("02/02/2026", "ELEONORA", "Table", "1", "Client B"),
      ligne("03/02/2026", "POLEZ", "Fauteuil", "3", "Client C"),
    ];
    const r = reconcilier(copieTest, ID, nouvelles, ID, generateur(), CLES);
    expect(r.ids).toEqual(["TR-A", "TR-B", "TR-NEW-1"]);
    expect(r.generes).toBe(1);
  });

  it("tri du fichier : chaque ligne retrouve son identifiant", () => {
    const nouvelles = [copieTest[2], copieTest[0], copieTest[1]].map((row) => [...row.slice(0, ID), ""]);
    const r = reconcilier(copieTest, ID, nouvelles, ID, generateur(), CLES);
    expect(r.ids).toEqual(["TR-C", "TR-A", "TR-B"]);
  });

  it("insertion au milieu : la nouvelle ligne seule reçoit un identifiant neuf", () => {
    const nouvelles = [
      ligne("01/02/2026", "POLEZ", "Canapé", "2", "Client A"),
      ligne("01/02/2026", "GEODIS", "Lit", "1", "Client Z"),
      ligne("02/02/2026", "ELEONORA", "Table", "1", "Client B"),
      ligne("03/02/2026", "POLEZ", "Chaise", "4", "Client C"),
    ];
    const r = reconcilier(copieTest, ID, nouvelles, ID, generateur(), CLES);
    expect(r.ids).toEqual(["TR-A", "TR-NEW-1", "TR-B", "TR-C"]);
  });

  it("suppression : les lignes restantes gardent leur identifiant, rien n'est réattribué", () => {
    const nouvelles = [
      ligne("01/02/2026", "POLEZ", "Canapé", "2", "Client A"),
      ligne("03/02/2026", "POLEZ", "Chaise", "4", "Client C"),
    ];
    const r = reconcilier(copieTest, ID, nouvelles, ID, generateur(), CLES);
    expect(r.ids).toEqual(["TR-A", "TR-C"]);
    expect(r.ids).not.toContain("TR-B");
  });

  it("lignes identiques : servies dans l'ordre, une supprimée libère la dernière", () => {
    const anciennes = [
      ligne("01/02/2026", "POLEZ", "Chaise", "1", "Client C", "", "", "TR-1"),
      ligne("01/02/2026", "POLEZ", "Chaise", "1", "Client C", "", "", "TR-2"),
      ligne("01/02/2026", "POLEZ", "Chaise", "1", "Client C", "", "", "TR-3"),
    ];
    const nouvelles = [
      ligne("01/02/2026", "POLEZ", "Chaise", "1", "Client C", "reçue"),
      ligne("01/02/2026", "POLEZ", "Chaise", "1", "Client C"),
    ];
    const r = reconcilier(anciennes, ID, nouvelles, ID, generateur(), CLES);
    expect(r.ids).toEqual(["TR-1", "TR-2"]);
  });

  it("lignes identiques dont une change de quantité : pas de rapprochement ambigu avec ses jumelles", () => {
    const anciennes = [
      ligne("01/02/2026", "POLEZ", "Chaise", "1", "Client C", "", "", "TR-1"),
      ligne("01/02/2026", "POLEZ", "Chaise", "1", "Client C", "", "", "TR-2"),
    ];
    const nouvelles = [
      ligne("01/02/2026", "POLEZ", "Chaise", "1", "Client C"),
      ligne("01/02/2026", "POLEZ", "Chaise", "2", "Client C"),
    ];
    const r = reconcilier(anciennes, ID, nouvelles, ID, generateur(), CLES);
    // La première reprend TR-1 (empreinte exacte). La seconde ne diffère de
    // TR-2 que par la quantité, à distance 0 : rapprochement sans ambiguïté.
    expect(r.ids).toEqual(["TR-1", "TR-2"]);
  });

  it("rapprochement ambigu (deux candidats à même distance) : identifiant neuf", () => {
    const anciennes = [
      ligne("01/02/2026", "POLEZ", "Chaise", "1", "Client C", "", "", "TR-1"),
      ligne("05/02/2026", "GEODIS", "Lit", "1", "Client Z", "", "", "TR-Z"),
      ligne("01/02/2026", "POLEZ", "Chaise", "3", "Client C", "", "", "TR-3"),
    ];
    // Une seule nouvelle ligne, en position 0 : distance 0 de TR-1, 2 de TR-3 → TR-1.
    let r = reconcilier(anciennes, ID, [ligne("01/02/2026", "POLEZ", "Chaise", "2", "Client C")], ID, generateur(), CLES);
    expect(r.ids).toEqual(["TR-1"]);
    // En position 1, entre les deux candidates : distance 1 des deux → ambigu.
    r = reconcilier(
      anciennes, ID,
      [ligne("05/02/2026", "GEODIS", "Lit", "1", "Client Z"), ligne("01/02/2026", "POLEZ", "Chaise", "2", "Client C")],
      ID, generateur(), CLES,
    );
    expect(r.ids).toEqual(["TR-Z", "TR-NEW-1"]);
  });

  it("colonnes clés retrouvées par titre ou par lettre, et jamais la colonne ID", () => {
    const entetes = ["DATE DU RECAP", "NOM DU FOURNISSEUR", "MARCHANDISES", "QUANTITE", "", "COMMENTAIRES", "", "ID TRUST"];
    expect(colonnesCles(entetes, ["DATE DU RECAP", "MARCHANDISES", "E", "ID TRUST", "INCONNUE"], 7))
      .toEqual([0, 2, 4]);
    expect(lettreColonne(0)).toBe("A");
    expect(lettreColonne(25)).toBe("Z");
    expect(lettreColonne(26)).toBe("AA");
    expect(lettreColonne(31)).toBe("AF");
  });

  it("sans colonnes clés connues, l'empreinte porte sur toute la ligne (repli)", () => {
    expect(empreinte(["a", "b", "TR-1", ""], 2)).toBe(empreinte(["A ", " b", "TR-2"], 2));
    expect(empreinte(["a", "b", "TR-1"], 2, [0])).toBe(empreinte(["a", "autre", "TR-2"], 2, [0]));
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
