/**
 * Lecteur CSV pour les exports Skara.
 *
 * Les quatre exports ne partagent PAS le même dialecte, et ce n'est pas un
 * détail : un lecteur naïf couperait au mauvais endroit.
 *
 *   * liste des factures et lignes de factures : séparateur « ; », sans
 *     guillemets, fins de ligne Windows ;
 *   * catalogue des articles : séparateur « , », tous les champs entre
 *     guillemets, et des libellés qui contiennent des virgules ;
 *   * journal comptable : séparateur « ; », champs entre guillemets, aucune
 *     ligne d'en-tête.
 *
 * Deux particularités communes, vérifiées sur vos fichiers réels :
 * Skara n'émet pas les champs vides de FIN de ligne, donc une ligne peut
 * compter moins de colonnes que l'en-tête ; et certains fichiers portent une
 * ligne de totaux en pied, qui n'est pas une donnée mais un contrôle.
 */

export type Delimiter = ";" | ",";

/**
 * Séparateur déduit de la première ligne : celui qui apparaît le plus, hors
 * guillemets. Un libellé d'article comme « Dimension : L. 365 x M. 200 »
 * contient des points-virgules potentiels, donc le comptage ignore ce qui est
 * entre guillemets.
 */
export function detectDelimiter(firstLine: string): Delimiter {
  let inQuotes = false;
  let semicolons = 0;
  let commas = 0;
  for (const char of firstLine) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (char === ";") semicolons += 1;
    else if (char === ",") commas += 1;
  }
  return commas > semicolons ? "," : ";";
}

/** Retire le marqueur d'ordre des octets qu'Excel ajoute parfois. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Découpe le texte en lignes de champs. Les guillemets protègent le
 * séparateur et les retours à la ligne ; deux guillemets consécutifs valent
 * un guillemet littéral.
 */
export function parseCsv(text: string, delimiter?: Delimiter): string[][] {
  const content = stripBom(text);
  const firstBreak = content.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? content : content.slice(0, firstBreak);
  const sep = delimiter ?? detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < content.length) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === sep) {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Fin de ligne Windows : le \n suivant est consommé avec.
      if (content[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  // Dernière ligne sans saut final.
  if (field !== "" || row.length > 0) endRow();

  // Une ligne entièrement vide n'est pas une donnée.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Champ i de la ligne, ou chaîne vide si Skara ne l'a pas émis. */
export function field(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

/**
 * Montant Skara → chaîne exacte et valeur numérique.
 *
 * La chaîne est conservée TELLE QUELLE pour être écrite en base sans
 * reconversion : le hors taxes de Skara vaut 916,667 pour 1 100 toutes
 * taxes, et tout recalcul créerait des écarts inexplicables avec votre
 * comptable. La valeur numérique ne sert qu'aux contrôles.
 */
export function amount(raw: string): { raw: string | null; value: number | null } {
  const text = raw.trim();
  if (text === "") return { raw: null, value: null };
  const normalized = text.replace(/\s/g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { raw: null, value: null };
  // « -0 » existe dans vos fichiers : c'est zéro, pas une valeur absente.
  return { raw: normalized, value: value === 0 ? 0 : value };
}

/** Date Skara « 01-09-2026 » ou « 01/09/2026 » → « 2026-09-01 ». */
export function isoDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Rejette le 31 février et compagnie.
  if (parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}
