import { createHash } from "node:crypto";

/**
 * Analyse du fichier récapitulatif (une ligne = un article attendu).
 *
 * Ce module est PUR : il ne connaît ni Google, ni Supabase, ni le réseau.
 * Il reçoit un tableau de cellules brutes et produit des lignes normalisées,
 * ce qui le rend entièrement testable avec des fixtures réelles.
 *
 * Règles métier non négociables appliquées ici :
 *  * « ORDER » est le numéro de commande du FOURNISSEUR, jamais du client ;
 *  * Herblay est un MAGASIN, Argenteuil un DÉPÔT : jamais confondus ;
 *  * « Marseille » n'est qu'un alias historique d'Aubagne ;
 *  * une arrivée à Argenteuil PUIS à Aubagne est un TRANSFERT, pas deux
 *    disponibilités ;
 *  * une réception partielle ne rend jamais la ligne entièrement disponible ;
 *  * rien n'est deviné : ce qui n'est pas déterminé reste indéterminé.
 *
 * ---------------------------------------------------------------------------
 * TROIS CHEMINS DE SORTIE (décision A)
 *
 * Le récapitulatif décrit trois façons de servir un client, mutuellement
 * exclusives dans les faits (vérifié sur 1 107 lignes réelles) :
 *   1. Paris  — le client est servi depuis Argenteuil / Herblay ;
 *   2. Aubagne, livraison — le client est livré depuis Aubagne ;
 *   3. Aubagne, retrait   — le client vient chercher à Aubagne.
 * Une ligne close par l'un des trois n'est plus « disponible » : ne pas les
 * lire tous les trois reviendrait à annoncer de la marchandise déjà partie.
 *
 * CLÔTURE PAR LA DATE (décision C)
 * Le marqueur textuel (« LIVRÉ ») est régulièrement oublié — 30 lignes sur
 * 142 dans le fichier réel. C'est donc la DATE qui fait foi.
 *
 * DESTINATION (décision B) — hiérarchie, on s'arrête au premier qui répond :
 *   1. le bloc Aubagne est renseigné            → Aubagne  (fait)
 *   2. un numéro d'affrètement existe           → Aubagne  (transfert en cours)
 *   3. l'expéditeur nomme un dépôt              → ce dépôt (fait)
 *   4. l'expéditeur est un livreur client connu → Paris    (déduit)
 *   5. Paris a clos la ligne                    → Paris    (fait)
 *   6. sinon                                    → indéterminé
 * L'AFFRÈTEMENT est le vrai marqueur du transfert Argenteuil → Aubagne :
 * 251 des 289 lignes affrétées portent « LIVRAISON AUBAGNE », et aucune ligne
 * confiée à un livreur client n'en porte.
 * ---------------------------------------------------------------------------
 */

/** Champs métier reconnus, alimentés par le mapping de colonnes. */
export type RecapField =
  | "recap_row_id"
  | "recap_date"
  | "supplier_label"
  | "status_label"
  | "supplier_reference"
  | "designation"
  | "quantity"
  | "customer_label"
  | "supplier_order_ref"
  | "expected_at"
  | "comments"
  /** Second champ de commentaires : porte aussi des annulations et des SAV. */
  | "comments_2"
  | "received_argenteuil"
  | "received_argenteuil_at"
  /** Numéro d'affrètement : matérialise le transfert Argenteuil → Aubagne. */
  | "freight_label"
  | "exit_mode_label"
  | "received_aubagne"
  | "received_aubagne_at"
  /** Sortie 1 — le client est servi depuis Paris. */
  | "paris_release_label"
  | "paris_release_at"
  /** Sortie 2 — le client est livré depuis Aubagne. */
  | "aubagne_delivery_label"
  | "aubagne_delivery_at"
  /** Sortie 3 — le client retire sur place à Aubagne. */
  | "aubagne_pickup_label"
  | "aubagne_pickup_at";

/**
 * Mapping « champ métier → colonne du fichier ».
 *
 * La valeur est soit le TITRE de la colonne, soit sa LETTRE (« G », « AB »).
 * La lettre sert quand une colonne n'a pas de titre, ou quand deux colonnes
 * portent le même (le récapitulatif réel a deux « COMMENTAIRES ») : elle
 * évite d'avoir à modifier un fichier utilisé quotidiennement (décision G).
 */
export type ColumnMapping = Partial<Record<RecapField, string>>;

export interface WarehouseRef {
  id: string;
  name: string;
  city: string;
}

export interface ParseOptions {
  /** En-têtes du fichier, dans l'ordre des colonnes. */
  headers: string[];
  mapping: ColumnMapping;
  /** Dépôts connus (Argenteuil, Aubagne) pour résoudre les destinations. */
  warehouses: WarehouseRef[];
  /** Numéro de la première ligne de données (pour les messages). */
  firstDataRow?: number;
  /**
   * Transporteurs qui livrent le client depuis Paris (décision I).
   * Liste éditable dans la configuration, JAMAIS figée dans le code : elle
   * change d'une année sur l'autre.
   */
  clientCarriers?: string[];
}

export interface ParsedEvent {
  event_type:
    | "commande_fournisseur"
    | "arrivee_prevue"
    | "reception_argenteuil"
    | "depart_transfert"
    | "reception_aubagne"
    | "mise_a_disposition"
    | "sortie";
  occurred_on: string;
  warehouse_id?: string;
  quantity?: number;
  notes?: string;
}

export interface ParsedAnomaly {
  type: string;
  severity: "info" | "avertissement" | "bloquant";
  message: string;
}

/** Par quel chemin le client a été servi. */
export type ExitChannel =
  | "paris"
  | "livraison_aubagne"
  | "retrait_aubagne";

export interface ParsedRow {
  /** true = ligne écartée (vide, total, en-tête répété). */
  ignored: boolean;
  ignoredReason?: string;
  rowNumber: number;
  recap_row_id?: string;
  fingerprint: string;
  recap_date?: string;
  supplier_label?: string;
  supplier_reference?: string;
  /** Numéro de commande FOURNISSEUR (colonne « ORDER »). */
  supplier_order_ref?: string;
  designation?: string;
  quantity: number;
  customer_label?: string;
  expected_at?: string;
  comments?: string;
  /** Numéro d'affrètement, quand la marchandise part vers Aubagne. */
  freight_ref?: string;
  stage: string;
  current_warehouse_id?: string;
  destination_warehouse_id?: string;
  destination_confidence: "sure" | "deduite" | "ambigue";
  /** Renseigné dès que la ligne est sortie (décision A). */
  exit_channel?: ExitChannel;
  exit_at?: string;
  events: ParsedEvent[];
  anomalies: ParsedAnomaly[];
  raw_row: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Minuscules sans accents ni ponctuation : comparaison robuste d'en-têtes. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** « A » → 0, « Z » → 25, « AA » → 26. Renvoie -1 si ce n'est pas une lettre. */
export function columnLetterToIndex(value: string): number {
  const letters = value.trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(letters)) return -1;
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/**
 * Index d'une colonne d'après son en-tête, quel que soit l'ordre du fichier.
 *
 * Le TITRE l'emporte toujours : la lettre n'est essayée que si aucun en-tête
 * ne correspond, pour qu'une colonne réellement intitulée « M » reste
 * atteignable par son nom.
 */
export function findColumnIndex(headers: string[], name?: string): number {
  if (!name) return -1;
  const target = normalizeHeader(name);
  if (!target) return -1;
  const byTitle = headers.findIndex((h) => normalizeHeader(h) === target);
  if (byTitle >= 0) return byTitle;
  return columnLetterToIndex(name);
}

const TRUE_WORDS = new Set([
  "x", "oui", "o", "yes", "true", "vrai", "1", "ok", "fait", "recu", "recue",
  "receptionne", "receptionnee", "arrive", "arrivee", "livre", "livree",
  "retire", "retiree",
]);
const FALSE_WORDS = new Set(["", "non", "n", "no", "false", "faux", "0", "-", "/"]);

export function parseBoolean(raw: string | undefined): boolean | undefined {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return undefined;          // cellule vide : on ne sait pas
  const value = normalizeHeader(trimmed).replace(/\s+/g, "");
  // Une cellule ne contenant que de la ponctuation (« - », « / ») est un
  // marquage explicite de « rien » : c'est un NON, pas une inconnue.
  if (value === "") return false;
  if (TRUE_WORDS.has(value)) return true;
  if (FALSE_WORDS.has(value)) return false;
  return undefined;
}

/**
 * Dates : format français (jj/mm/aaaa ou jj-mm-aa), ISO, ou numéro de série
 * Google Sheets (jours depuis le 30/12/1899). Retourne « aaaa-mm-jj ».
 *
 * Le fichier réel contient beaucoup de texte libre — « MI JANVIER »,
 * « LUNDI PROCHAIN », « FIN FÉVRIER ». Ce n'est pas une erreur : la date
 * reste simplement vide, et le reste de la ligne fonctionne normalement.
 */
export function parseDate(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim();
  if (!value) return undefined;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const fr = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (fr) {
    const day = Number(fr[1]);
    const month = Number(fr[2]);
    let year = Number(fr[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Numéro de série Google Sheets / Excel.
  if (/^\d{4,6}(\.\d+)?$/.test(value)) {
    const serial = Math.floor(Number(value));
    if (serial > 20000 && serial < 80000) {
      const epoch = Date.UTC(1899, 11, 30);
      const date = new Date(epoch + serial * 86400000);
      return date.toISOString().slice(0, 10);
    }
  }
  return undefined;
}

/** Quantité : accepte « 2 », « 2,0 », « x3 », « 3 pcs ». Défaut : 1. */
export function parseQuantity(raw: string | undefined): number | undefined {
  const value = (raw ?? "").trim();
  if (!value) return undefined;
  const match = value.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const parsed = Math.floor(Number(match[1]));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const TOTAL_WORDS = ["total", "totaux", "sous total", "recapitulatif", "somme"];

/** Ligne de total / séparateur : à écarter sans bruit. */
export function isTotalRow(cells: string[]): boolean {
  const filled = cells.filter((c) => (c ?? "").trim() !== "");
  if (filled.length === 0) return false;
  const joined = normalizeHeader(filled.join(" "));
  return (
    filled.length <= 3 &&
    TOTAL_WORDS.some((w) => joined.startsWith(w) || joined === w)
  );
}

/**
 * Annulation écrite en clair dans un commentaire (décision F).
 *
 * On repère le signalement, on ne l'applique PAS : « elle veut annuler sa
 * commande » est une demande, pas un fait. C'est un humain qui tranche.
 */
export function detectCancellation(...texts: (string | undefined)[]): string | undefined {
  for (const text of texts) {
    const value = (text ?? "").trim();
    if (value && /annul/i.test(normalizeHeader(value))) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Dépôts : Argenteuil / Aubagne (Marseille = alias d'Aubagne)
// ---------------------------------------------------------------------------

function warehouseByCity(warehouses: WarehouseRef[], city: string) {
  const target = normalizeHeader(city);
  return warehouses.find(
    (w) => normalizeHeader(w.city) === target || normalizeHeader(w.name).includes(target),
  );
}

/**
 * Reconnaît un libellé de lieu : « Marseille » renvoie toujours Aubagne.
 *
 * Tolère les fautes de frappe du fichier réel : « ARGENTEUL » (48 occurrences)
 * est reconnu comme Argenteuil — le radical « argenteu » suffit.
 */
export function resolveWarehouse(
  warehouses: WarehouseRef[],
  label: string | undefined,
): WarehouseRef | undefined {
  const value = normalizeHeader(label ?? "");
  if (!value) return undefined;
  if (value.includes("argenteu")) return warehouseByCity(warehouses, "Argenteuil");
  // « Marseille » est un ALIAS historique d'Aubagne, jamais un lieu distinct.
  if (value.includes("aubagne") || value.includes("marseille")) {
    return warehouseByCity(warehouses, "Aubagne");
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Analyse d'une ligne
// ---------------------------------------------------------------------------

function fingerprintOf(parts: (string | undefined)[]): string {
  return createHash("sha256")
    .update(parts.map((p) => (p ?? "").trim().toLowerCase()).join("|"))
    .digest("hex")
    .slice(0, 32);
}

interface ExitCandidate {
  channel: ExitChannel;
  date?: string;
  label?: string;
  warehouse?: WarehouseRef;
}

export function parseRecapRows(
  rows: string[][],
  options: ParseOptions,
): ParsedRow[] {
  const { headers, mapping, warehouses } = options;
  const firstDataRow = options.firstDataRow ?? 2;
  const carriers = new Set(
    (options.clientCarriers ?? []).map((c) => normalizeHeader(c)).filter(Boolean),
  );
  const index: Partial<Record<RecapField, number>> = {};
  for (const [field, header] of Object.entries(mapping) as [RecapField, string][]) {
    index[field] = findColumnIndex(headers, header);
  }

  const cellOf = (cells: string[], field: RecapField): string | undefined => {
    const i = index[field];
    if (i === undefined || i < 0) return undefined;
    const value = (cells[i] ?? "").trim();
    return value === "" ? undefined : value;
  };

  /**
   * Lecture d'une colonne censée contenir une DATE.
   *
   * Une cellule remplie mais illisible n'est pas ignorée en silence : c'est
   * presque toujours un décalage de saisie. Le fichier réel en contient — cinq
   * lignes de 2025 ont « LIVRE » dans la colonne de date de livraison et
   * « 05-02 » (sans année) dans la colonne de statut. Passer outre reviendrait
   * à perdre une sortie sans que personne ne le sache.
   *
   * Exception assumée : « ARRIVAGE PREVU » est du texte libre par nature
   * (« MI JANVIER », « LUNDI PROCHAIN ») et n'est donc jamais signalé.
   */
  const strictDate = (
    cells: string[],
    field: RecapField,
    label: string,
    anomalies: ParsedAnomaly[],
  ): string | undefined => {
    const raw = cellOf(cells, field);
    if (!raw) return undefined;
    const parsed = parseDate(raw);
    if (!parsed) {
      anomalies.push({
        type: "date_illisible",
        severity: "avertissement",
        message: `« ${label} » contient « ${raw} », qui n'est pas une date : colonnes probablement décalées.`,
      });
      return undefined;
    }
    return parsed;
  };

  return rows.map((cells, position) => {
    const rowNumber = firstDataRow + position;
    const raw_row: Record<string, string> = {};
    headers.forEach((header, i) => {
      const value = (cells[i] ?? "").trim();
      // Une colonne sans titre est repérée par sa lettre : la ligne source
      // reste lisible dans le détail même quand le fichier ne nomme rien.
      if (value !== "") raw_row[header.trim() || indexToLetter(i)] = value;
    });

    const anomalies: ParsedAnomaly[] = [];
    const events: ParsedEvent[] = [];

    // --- Lignes à écarter -------------------------------------------------
    if (cells.every((c) => (c ?? "").trim() === "")) {
      return emptyIgnored(rowNumber, "Ligne vide", raw_row);
    }
    if (isTotalRow(cells)) {
      return emptyIgnored(rowNumber, "Ligne de total", raw_row);
    }
    const designation = cellOf(cells, "designation");
    const customer = cellOf(cells, "customer_label");
    const supplier = cellOf(cells, "supplier_label");
    if (!designation && !customer && !supplier) {
      return emptyIgnored(rowNumber, "Ligne sans donnée exploitable", raw_row);
    }

    // --- Champs simples ---------------------------------------------------
    const recapDate = strictDate(cells, "recap_date", "date du récapitulatif", anomalies);
    const expectedAt = parseDate(cellOf(cells, "expected_at"));
    const quantityRaw = cellOf(cells, "quantity");
    const quantity = parseQuantity(quantityRaw) ?? 1;
    if (quantityRaw && parseQuantity(quantityRaw) === undefined) {
      anomalies.push({
        type: "quantite_illisible",
        severity: "avertissement",
        message: `Quantité illisible (« ${quantityRaw} ») : 1 retenu par défaut, à vérifier.`,
      });
    }
    if (!designation) {
      anomalies.push({
        type: "designation_manquante",
        severity: "avertissement",
        message: "Aucune désignation d'article sur cette ligne.",
      });
    }
    if (!customer) {
      anomalies.push({
        type: "client_manquant",
        severity: "info",
        message: "Aucun nom de client : rapprochement impossible en l'état.",
      });
    }

    // Les DEUX colonnes de commentaires portent de l'information métier
    // (décision E) : annulations, SAV, retours, erreurs de couleur.
    const comment1 = cellOf(cells, "comments");
    const comment2 = cellOf(cells, "comments_2");
    const comments = [comment1, comment2].filter(Boolean).join(" — ") || undefined;

    // --- Réceptions : Argenteuil PUIS Aubagne = un transfert --------------
    const argenteuil = warehouseByCity(warehouses, "Argenteuil");
    const aubagne = warehouseByCity(warehouses, "Aubagne");
    const recArgFlag = parseBoolean(cellOf(cells, "received_argenteuil"));
    const recArgDate = strictDate(cells, "received_argenteuil_at", "date de réception Argenteuil", anomalies);
    const recAubFlag = parseBoolean(cellOf(cells, "received_aubagne"));
    const recAubDate = strictDate(cells, "received_aubagne_at", "date de réception Aubagne", anomalies);
    const receivedArgenteuil = recArgFlag === true || Boolean(recArgDate);
    const receivedAubagne = recAubFlag === true || Boolean(recAubDate);
    const freight = cellOf(cells, "freight_label");

    if (receivedArgenteuil && argenteuil) {
      events.push({
        event_type: "reception_argenteuil",
        occurred_on: recArgDate ?? recapDate ?? expectedAt ?? todayIso(),
        warehouse_id: argenteuil.id,
      });
    }
    if (receivedAubagne && aubagne) {
      events.push({
        event_type: "reception_aubagne",
        occurred_on: recAubDate ?? recapDate ?? expectedAt ?? todayIso(),
        warehouse_id: aubagne.id,
      });
    }
    if (receivedArgenteuil && receivedAubagne && recArgDate && recAubDate && recAubDate < recArgDate) {
      anomalies.push({
        type: "incoherence_dates",
        severity: "avertissement",
        message: `Réception à Aubagne (${recAubDate}) antérieure à Argenteuil (${recArgDate}) : parcours à vérifier.`,
      });
    }

    // --- Les trois chemins de sortie (décisions A, C, J) ------------------
    const parisLabel = cellOf(cells, "paris_release_label");
    const parisDate = strictDate(cells, "paris_release_at", "date de sortie Paris", anomalies);
    const aubDelLabel = cellOf(cells, "aubagne_delivery_label");
    const aubDelDate = strictDate(cells, "aubagne_delivery_at", "date de livraison Aubagne", anomalies);
    const aubPickLabel = cellOf(cells, "aubagne_pickup_label");
    const aubPickDate = strictDate(cells, "aubagne_pickup_at", "date de retrait Aubagne", anomalies);

    const exits: ExitCandidate[] = [];
    if (parisLabel || parisDate) {
      exits.push({ channel: "paris", date: parisDate, label: parisLabel, warehouse: argenteuil });
    }
    if (aubDelLabel || aubDelDate) {
      exits.push({ channel: "livraison_aubagne", date: aubDelDate, label: aubDelLabel, warehouse: aubagne });
    }
    if (aubPickLabel || aubPickDate) {
      exits.push({ channel: "retrait_aubagne", date: aubPickDate, label: aubPickLabel, warehouse: aubagne });
    }
    // Décision J : plusieurs sorties → la plus ancienne fait foi, et un
    // humain vérifie. Une ligne sans date mais avec un marqueur reste sortie
    // (décision C : le marqueur est un confort, la date fait foi quand elle
    // existe — mais son absence n'annule pas la sortie).
    exits.sort((a, b) => (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99"));
    const exit = exits[0];
    if (exits.length > 1) {
      anomalies.push({
        type: "sorties_multiples",
        severity: "avertissement",
        message: `Deux sorties enregistrées (${exits
          .map((e) => `${channelLabel(e.channel)}${e.date ? ` le ${e.date}` : ""}`)
          .join(", ")}) : la plus ancienne est retenue, à vérifier.`,
      });
    }

    // --- Destination : hiérarchie de la décision B ------------------------
    const exitModeLabel = cellOf(cells, "exit_mode_label");
    const exitModeWarehouse = resolveWarehouse(warehouses, exitModeLabel);
    const aubagneBlockFilled =
      receivedAubagne || Boolean(aubDelLabel || aubDelDate || aubPickLabel || aubPickDate);

    let destination: WarehouseRef | undefined;
    let confidence: ParsedRow["destination_confidence"];
    if (aubagneBlockFilled && aubagne) {
      destination = aubagne;                     // 1. fait constaté
      confidence = "sure";
    } else if (freight && aubagne) {
      destination = aubagne;                     // 2. affrètement = transfert
      confidence = "deduite";
    } else if (exitModeWarehouse) {
      destination = exitModeWarehouse;           // 3. l'expéditeur nomme le lieu
      confidence = "sure";
    } else if (exitModeLabel && carriers.has(normalizeHeader(exitModeLabel)) && argenteuil) {
      destination = argenteuil;                  // 4. livreur client connu
      confidence = "deduite";
    } else if ((parisLabel || parisDate) && argenteuil) {
      destination = argenteuil;                  // 5. Paris a clos la ligne
      confidence = "sure";
    } else {
      confidence = "ambigue";
      // Décision K : on n'alerte que si la marchandise est PHYSIQUEMENT là
      // sans qu'on sache où l'envoyer. Une commande encore chez le
      // fournisseur n'a pas à avoir de destination : ce serait du bruit.
      if (receivedArgenteuil) {
        anomalies.push({
          type: "recue_sans_destination",
          severity: "avertissement",
          message: exitModeLabel
            ? `Marchandise reçue à Argenteuil, destination non reconnue (« ${exitModeLabel} »).`
            : "Marchandise reçue à Argenteuil sans destination indiquée.",
        });
      }
    }

    // --- Annulation signalée (décision F) ---------------------------------
    const cancelled = detectCancellation(comment1, comment2);
    if (cancelled) {
      anomalies.push({
        type: "annulation_signalee",
        // Marchandise déjà reçue ET commande annulée : il y a du stock
        // physique à réaffecter, c'est le cas le plus urgent.
        severity: receivedArgenteuil || receivedAubagne ? "bloquant" : "avertissement",
        message: `Annulation signalée dans les commentaires (« ${cancelled} ») : à trancher, la ligne n'est pas fermée automatiquement.`,
      });
    }

    // --- Réception partielle : jamais disponible en totalité --------------
    const partial = detectPartial(comments, cellOf(cells, "status_label"), quantity);
    if (partial) {
      anomalies.push({
        type: "reception_partielle",
        severity: "avertissement",
        message: `Réception partielle signalée (${partial} sur ${quantity}) : la ligne reste incomplète.`,
      });
    }

    // --- Étape courante ---------------------------------------------------
    const statusLabel = cellOf(cells, "status_label");
    let stage: string;
    let currentWarehouse: WarehouseRef | undefined;

    if (exit) {
      stage = "sortie";
      currentWarehouse = exit.warehouse ?? destination;
      events.push({
        event_type: "sortie",
        occurred_on: exit.date ?? recAubDate ?? recArgDate ?? recapDate ?? todayIso(),
        warehouse_id: currentWarehouse?.id,
        notes: channelLabel(exit.channel),
      });
    } else if (partial) {
      // Une partie seulement est arrivée : on reste au stade réception.
      stage = receivedAubagne ? "recue_aubagne" : receivedArgenteuil ? "recue_argenteuil" : "attendue";
      currentWarehouse = receivedAubagne ? aubagne : receivedArgenteuil ? argenteuil : undefined;
    } else if (receivedAubagne) {
      stage = "disponible";
      currentWarehouse = aubagne;
    } else if (receivedArgenteuil) {
      // Reçue à Argenteuil mais attendue à Aubagne → transfert à faire.
      const needsTransfer = Boolean(destination && aubagne && destination.id === aubagne.id);
      stage = needsTransfer ? "en_transfert" : "disponible";
      currentWarehouse = argenteuil;
      if (needsTransfer) {
        events.push({
          event_type: "depart_transfert",
          occurred_on: recArgDate ?? recapDate ?? todayIso(),
          warehouse_id: argenteuil?.id,
          notes: freight
            ? `Transfert Argenteuil → Aubagne, affrètement ${freight}.`
            : "Transfert Argenteuil → Aubagne déduit du récapitulatif.",
        });
      }
    } else if (statusLabel && /command/i.test(statusLabel)) {
      stage = "commandee";
    } else if (expectedAt) {
      stage = "attendue";
    } else {
      stage = "a_commander";
    }

    if (stage === "disponible" && !partial) {
      events.push({
        event_type: "mise_a_disposition",
        occurred_on: recAubDate ?? recArgDate ?? todayIso(),
        warehouse_id: currentWarehouse?.id,
      });
    }
    if (expectedAt) {
      events.push({ event_type: "arrivee_prevue", occurred_on: expectedAt });
    }

    const recapRowId = cellOf(cells, "recap_row_id");
    // Empreinte de secours : stable tant que les colonnes structurantes ne
    // changent pas. Utilisée uniquement quand « ID TRUST » est absent — et
    // insuffisante quand deux lignes sont strictement identiques, ce qui
    // arrive réellement (7 groupes sur les deux onglets).
    const fingerprint = fingerprintOf([
      recapDate,
      supplier,
      cellOf(cells, "supplier_reference"),
      designation,
      String(quantity),
      customer,
    ]);

    return {
      ignored: false,
      rowNumber,
      recap_row_id: recapRowId,
      fingerprint,
      recap_date: recapDate,
      supplier_label: supplier,
      supplier_reference: cellOf(cells, "supplier_reference"),
      // « ORDER » : numéro de commande du FOURNISSEUR, jamais du client.
      supplier_order_ref: cellOf(cells, "supplier_order_ref"),
      designation,
      quantity,
      customer_label: customer,
      expected_at: expectedAt,
      comments,
      freight_ref: freight,
      stage,
      current_warehouse_id: currentWarehouse?.id,
      destination_warehouse_id: destination?.id,
      destination_confidence: confidence,
      exit_channel: exit?.channel,
      exit_at: exit?.date,
      events,
      anomalies,
      raw_row,
    };
  });
}

/** 0 → « A », 26 → « AA » : nomme une colonne sans titre. */
export function indexToLetter(index: number): string {
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    const rest = (value - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

export function channelLabel(channel: ExitChannel): string {
  switch (channel) {
    case "paris":
      return "servi par Paris";
    case "livraison_aubagne":
      return "livré depuis Aubagne";
    case "retrait_aubagne":
      return "retiré à Aubagne";
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyIgnored(
  rowNumber: number,
  reason: string,
  raw_row: Record<string, string>,
): ParsedRow {
  return {
    ignored: true,
    ignoredReason: reason,
    rowNumber,
    fingerprint: "",
    quantity: 0,
    stage: "a_commander",
    destination_confidence: "ambigue",
    events: [],
    anomalies: [],
    raw_row,
  };
}

/** Quantité partielle mentionnée dans les commentaires ou le statut. */
function detectPartial(
  comments: string | undefined,
  status: string | undefined,
  quantity: number,
): number | undefined {
  const haystack = `${comments ?? ""} ${status ?? ""}`;
  if (!/partiel/i.test(haystack)) {
    // « 2/4 reçus » signale aussi une réception partielle.
    const ratio = haystack.match(/(\d+)\s*\/\s*(\d+)/);
    if (ratio && Number(ratio[1]) < Number(ratio[2])) return Number(ratio[1]);
    return undefined;
  }
  const ratio = haystack.match(/(\d+)\s*(?:\/|sur)\s*(\d+)/i);
  if (ratio && Number(ratio[1]) < Number(ratio[2])) return Number(ratio[1]);
  const single = haystack.match(/(\d+)/);
  if (single && Number(single[1]) < quantity) return Number(single[1]);
  return quantity > 1 ? quantity - 1 : undefined;
}
