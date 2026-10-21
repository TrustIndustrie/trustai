import { describe, expect, it } from "vitest";
import { amount, detectDelimiter, field, isoDate, parseCsv } from "./csv";

describe("Séparateur", () => {
  it("reconnaît le point-virgule des exports de factures", () => {
    expect(detectDelimiter("NUMERO FACTURE;DATE;CLIENT;VENDEUR")).toBe(";");
  });

  it("reconnaît la virgule du catalogue, guillemets compris", () => {
    expect(detectDelimiter('"pk_fournisseur","libelle_fournisseur","titre"')).toBe(",");
  });

  it("ignore les séparateurs situés dans un champ entre guillemets", () => {
    // Un libellé d'article contient des virgules ET des points-virgules.
    expect(detectDelimiter('"a";"Dimension : L. 365, M. 200; H. 95";"c"')).toBe(";");
  });
});

describe("Découpage", () => {
  it("lit des fins de ligne Windows", () => {
    expect(parseCsv("a;b\r\nc;d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("garde les séparateurs protégés par des guillemets", () => {
    expect(parseCsv('"un","deux, encore","trois"')).toEqual([
      ["un", "deux, encore", "trois"],
    ]);
  });

  it("interprète deux guillemets consécutifs comme un guillemet", () => {
    expect(parseCsv('"cita""tion","b"')).toEqual([['cita"tion', "b"]]);
  });

  it("tolère une ligne plus courte que l'en-tête", () => {
    // Skara n'émet pas les champs vides de fin de ligne.
    const rows = parseCsv("a;b;c\r\n1;2\r\n");
    expect(rows[1]).toEqual(["1", "2"]);
    expect(field(rows[1], 2)).toBe("");
  });

  it("écarte les lignes entièrement vides", () => {
    expect(parseCsv("a;b\r\n\r\nc;d\r\n\r\n")).toHaveLength(2);
  });

  it("retire le marqueur d'ordre des octets", () => {
    expect(parseCsv("﻿a;b")).toEqual([["a", "b"]]);
  });
});

describe("Montants", () => {
  it("conserve la chaîne exacte reçue de Skara", () => {
    // 916,667 pour 1 100 toutes taxes : toute reconversion créerait un écart.
    expect(amount("916.667")).toEqual({ raw: "916.667", value: 916.667 });
  });

  it("distingue l'absence de valeur du zéro", () => {
    expect(amount("")).toEqual({ raw: null, value: null });
    expect(amount("0.00")).toEqual({ raw: "0.00", value: 0 });
  });

  it("traite « -0 » comme zéro, présent dans les avoirs", () => {
    expect(amount("-0").value).toBe(0);
  });

  it("accepte la virgule décimale par sécurité", () => {
    expect(amount("1 234,50").value).toBe(1234.5);
  });
});

describe("Dates", () => {
  it("convertit le format Skara", () => {
    expect(isoDate("01-09-2026")).toBe("2026-09-01");
    expect(isoDate("24/09/2026")).toBe("2026-09-24");
  });

  it("refuse une date impossible", () => {
    expect(isoDate("31-02-2026")).toBeNull();
    expect(isoDate("2026-09-01")).toBeNull();
    expect(isoDate("")).toBeNull();
  });
});
