/**
 * TRUST AI — Synchronisation du récapitulatif ORIGINAL vers la copie TEST
 * ---------------------------------------------------------------------------
 * RÈGLE IMPÉRATIVE : AUCUNE ÉCRITURE DANS LE GOOGLE SHEET ORIGINAL.
 *
 *   * l'équipe travaille dans le fichier ORIGINAL, comme avant ;
 *   * ce script vit DANS LA COPIE TEST (Extensions → Apps Script de la copie)
 *     et recopie, onglet par onglet, les valeurs de l'original ;
 *   * TRUST AI lit UNIQUEMENT la copie TEST (compte de service en lecteur).
 *
 * Ce que le script fait sur l'ORIGINAL : `openById` + `getValues` /
 * `getNumberFormats`, c'est-à-dire de la LECTURE. Aucun `setValue`,
 * `setValues`, `insertSheet`, `deleteRow` ou équivalent n'est jamais appelé
 * sur lui. Une garde refuse même de s'exécuter si le script se trouve
 * installé par erreur dans l'original.
 *
 * Ce que le script fait sur la COPIE TEST :
 *   * remplace le contenu de chaque onglet suivi par celui de l'original
 *     (valeurs + formats de nombre, pour que les dates restent lisibles) ;
 *   * garantit une colonne « ID TRUST » remplie et STABLE d'une
 *     synchronisation à l'autre :
 *       - si l'original porte déjà un ID TRUST sur la ligne, il est recopié
 *         tel quel ;
 *       - sinon, l'identifiant déjà attribué dans la copie TEST à une ligne de
 *         mêmes COLONNES CLÉS (date, fournisseur, référence, désignation,
 *         quantité, client, ORDER) est conservé : les commentaires, réceptions
 *         et statuts peuvent changer chaque jour sans toucher l'identifiant ;
 *       - sinon, une ligne qui ne diffère que par UNE colonne clé d'une
 *         ancienne ligne encore libre, sans ambiguïté, reprend son identifiant ;
 *       - sinon, un identifiant neuf est généré.
 *     Deux lignes strictement identiques reçoivent chacune leur identifiant,
 *     dans l'ordre du fichier ;
 *   * tient un petit journal dans l'onglet « SYNCHRO » (date, lignes, IDs).
 *
 * Installation : voir docs/COPIE_TEST.md.
 */

// ---------------------------------------------------------------------------
// CONFIGURATION — les trois seules lignes à adapter.
// ---------------------------------------------------------------------------

/**
 * Identifiant du fichier ORIGINAL : la suite de caractères entre `/d/` et
 * `/edit` dans son adresse. Ce fichier n'est JAMAIS modifié.
 */
var ORIGINAL_SPREADSHEET_ID = 'A_REMPLIR';

/**
 * Onglets à recopier, avec le numéro de la ligne des titres (4 pour le
 * récapitulatif de Trust Industrie : trois bandeaux la précèdent).
 * En janvier, ajouter simplement le nouvel onglet ici.
 */
var SYNC_SHEETS = [
  { name: 'INTERNET',    headerRow: 4 },
  { name: 'SUIVIS 2025', headerRow: 4 },
];

/** Titre exact de la colonne d'identifiants (dans l'original ET la copie). */
var SYNC_ID_HEADER = 'ID TRUST';

/**
 * Colonnes qui définissent l'IDENTITÉ d'une ligne (titre exact, ou lettre
 * pour une colonne sans titre : « G » est la colonne client). Les autres
 * colonnes — commentaires, réceptions, statuts, dates de livraison — vivent
 * au quotidien et NE changent PAS l'identifiant.
 *
 * Une ligne dont UNE seule de ces colonnes change garde son identifiant si
 * elle reste reconnaissable sans ambiguïté (voir reconcilierIdentifiants).
 * Si deux colonnes clés changent d'un coup, c'est une autre ligne.
 */
var SYNC_KEY_COLUMNS = [
  'DATE DU RECAP', 'NOM DU FOURNISSEUR', 'REF FOURNISSEUR ARTICLES',
  'MARCHANDISES', 'QUANTITE', 'G', 'ORDER',
];

/** Préfixe des identifiants générés (identique au script id-trust.gs). */
var SYNC_ID_PREFIX = 'TR-';

/** Nom de l'onglet journal, créé dans la copie TEST uniquement. */
var SYNC_LOG_SHEET = 'SYNCHRO';

// ---------------------------------------------------------------------------
// POINT D'ENTRÉE
// ---------------------------------------------------------------------------

/**
 * Recopie tous les onglets configurés. À relier à un déclencheur horaire
 * (voir `installerDeclencheurSynchro`) ou à lancer depuis le menu TRUST AI.
 */
function synchroniserOriginalVersTest() {
  if (ORIGINAL_SPREADSHEET_ID === 'A_REMPLIR' || !ORIGINAL_SPREADSHEET_ID) {
    throw new Error('ORIGINAL_SPREADSHEET_ID n\'est pas renseigné (en haut du script).');
  }

  var copie = SpreadsheetApp.getActive();
  // GARDE : ce script ne doit JAMAIS tourner dans l'original.
  if (copie.getId() === ORIGINAL_SPREADSHEET_ID) {
    throw new Error(
      'Ce script est installé dans le fichier ORIGINAL. Il doit vivre dans la ' +
      'copie TEST. Aucune modification n\'a été faite.'
    );
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('Synchronisation déjà en cours : on n\'empile pas.');
    return;
  }

  try {
    var original = SpreadsheetApp.openById(ORIGINAL_SPREADSHEET_ID); // lecture
    var rapport = [];
    for (var s = 0; s < SYNC_SHEETS.length; s++) {
      rapport.push(synchroniserOnglet(original, copie, SYNC_SHEETS[s]));
    }
    journaliser(copie, rapport);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** Recopie UN onglet. Renvoie un résumé pour le journal. */
function synchroniserOnglet(original, copie, conf) {
  var source = original.getSheetByName(conf.name);
  if (!source) {
    return { onglet: conf.name, erreur: 'onglet introuvable dans l\'original' };
  }
  var headerRow = conf.headerRow || 1;
  var lastRow = source.getLastRow();
  var lastCol = source.getLastColumn();
  if (lastRow < headerRow || lastCol < 1) {
    return { onglet: conf.name, erreur: 'onglet vide dans l\'original' };
  }

  // --- LECTURE de l'original (et rien d'autre) ---------------------------
  var plage = source.getRange(1, 1, lastRow, lastCol);
  var valeurs = plage.getValues();
  var formats = plage.getNumberFormats();

  var entetes = valeurs[headerRow - 1];
  var idColOriginal = trouverColonne(entetes, SYNC_ID_HEADER); // -1 si absente

  // --- État actuel de la copie TEST (pour conserver les identifiants) ----
  var cible = copie.getSheetByName(conf.name);
  if (!cible) {
    cible = copie.insertSheet(conf.name);
  }
  var anciennes = [];
  var idColAncien = -1;
  if (cible.getLastRow() >= headerRow && cible.getLastColumn() >= 1) {
    anciennes = cible
      .getRange(1, 1, cible.getLastRow(), cible.getLastColumn())
      .getValues();
    idColAncien = trouverColonne(anciennes[headerRow - 1], SYNC_ID_HEADER);
  }

  // --- Colonne ID TRUST dans la copie : celle de l'original, sinon ajoutée -
  var idColCible = idColOriginal;
  if (idColCible === -1) {
    idColCible = lastCol; // nouvelle colonne, à la fin
    for (var r = 0; r < valeurs.length; r++) {
      valeurs[r].push('');
      formats[r].push('@');
    }
    valeurs[headerRow - 1][idColCible] = SYNC_ID_HEADER;
  }

  // --- Identifiants : recopiés, conservés, rapprochés ou générés ---------
  var cles = colonnesCles(valeurs[headerRow - 1], SYNC_KEY_COLUMNS, idColCible);
  var clesAnciennes = idColAncien === -1
    ? []
    : colonnesCles(anciennes[headerRow - 1], SYNC_KEY_COLUMNS, idColAncien);
  var resultat = reconcilierIdentifiants(
    anciennes.slice(headerRow), idColAncien,
    valeurs.slice(headerRow), idColCible,
    genererIdentifiantSynchro, cles, clesAnciennes
  );
  for (var i = 0; i < resultat.ids.length; i++) {
    valeurs[headerRow + i][idColCible] = resultat.ids[i];
  }

  // --- ÉCRITURE dans la copie TEST uniquement ----------------------------
  cible.clearContents();
  var dest = cible.getRange(1, 1, valeurs.length, valeurs[0].length);
  dest.setNumberFormats(formats);
  dest.setValues(valeurs);
  // Lignes résiduelles d'une ancienne copie plus longue : déjà effacées par
  // clearContents ; on ne supprime pas de lignes pour garder la mise en page.

  return {
    onglet: conf.name,
    lignes: valeurs.length - headerRow,
    recopies: resultat.recopies,
    conserves: resultat.conserves,
    rapproches: resultat.rapproches,
    generes: resultat.generes,
  };
}

// ---------------------------------------------------------------------------
// LOGIQUE PURE (testée par src/lib/recap/apps-script.test.ts)
// ---------------------------------------------------------------------------

/** Index (base 0) de la colonne dont le titre est `titre`, ou -1. */
function trouverColonne(entetes, titre) {
  var voulu = String(titre).trim().toLowerCase();
  for (var i = 0; i < entetes.length; i++) {
    if (String(entetes[i]).trim().toLowerCase() === voulu) return i;
  }
  return -1;
}

/** true si la ligne ne contient rien en dehors de la colonne ID. */
function ligneVide(row, idCol) {
  for (var c = 0; c < row.length; c++) {
    if (c === idCol) continue;
    if (String(row[c]).trim() !== '') return false;
  }
  return true;
}

/** Valeur d'une cellule normalisée (dates → AAAA-MM-JJ, texte → minuscules). */
function normaliserCellule(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return v.getFullYear() + '-' +
      ('0' + (v.getMonth() + 1)).slice(-2) + '-' +
      ('0' + v.getDate()).slice(-2);
  }
  return String(v).trim().toLowerCase();
}

/** Lettre(s) de colonne pour un index base 0 : 0 → A, 26 → AA. */
function lettreColonne(index) {
  var s = '';
  var n = index + 1;
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Index (base 0) des colonnes clés, retrouvées par TITRE ou par LETTRE.
 * Renvoie [] si aucune n'est trouvée : l'empreinte porte alors sur toute la
 * ligne (hors ID), comportement de repli.
 */
function colonnesCles(entetes, titres, idCol) {
  var out = [];
  for (var t = 0; t < titres.length; t++) {
    var idx = trouverColonne(entetes, titres[t]);
    if (idx === -1) {
      for (var c = 0; c < entetes.length; c++) {
        if (lettreColonne(c) === String(titres[t]).trim().toUpperCase()) { idx = c; break; }
      }
    }
    if (idx !== -1 && idx !== idCol && out.indexOf(idx) === -1) out.push(idx);
  }
  return out;
}

/** Valeurs clés d'une ligne (ou toute la ligne hors ID si `cles` est vide). */
function valeursCles(row, idCol, cles) {
  var parts = [];
  if (cles && cles.length) {
    for (var k = 0; k < cles.length; k++) {
      parts.push(cles[k] < row.length ? normaliserCellule(row[cles[k]]) : '');
    }
    return parts;
  }
  for (var c = 0; c < row.length; c++) {
    if (c === idCol) continue;
    parts.push(normaliserCellule(row[c]));
  }
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Empreinte d'une ligne : ses colonnes clés normalisées (toute la ligne hors
 * ID si aucune colonne clé n'est connue).
 */
function calculerEmpreinte(row, idCol, cles) {
  return valeursCles(row, idCol, cles).join('\u001f');
}

/**
 * Attribue un identifiant à chaque ligne de `nouvelles` (lignes de DONNÉES,
 * sans les titres), en quatre passes, dans l'ordre du fichier :
 *
 *   1. RECOPIE — l'identifiant présent dans l'original est repris tel quel
 *      (sauf s'il est déjà pris par une ligne précédente : copier-coller) ;
 *   2. CONSERVATION — même empreinte (colonnes clés) qu'une ligne de la copie
 *      TEST : son identifiant est repris. Chaque ancien identifiant ne sert
 *      qu'une fois ; deux lignes identiques sont servies dans l'ordre ;
 *   3. RAPPROCHEMENT — une ligne encore sans identifiant qui ne diffère
 *      d'une ancienne ligne encore libre que par UNE colonne clé reprend son
 *      identifiant, à condition que le rapprochement soit sans ambiguïté
 *      (un seul candidat à la plus courte distance de position). Dans le
 *      doute, on ne devine pas ;
 *   4. GÉNÉRATION — sinon, `generer()` fournit un identifiant neuf.
 *
 * Une ligne entièrement vide n'a pas d'identifiant. Une ligne modifiée sur
 * deux colonnes clés ou plus est une ligne NOUVELLE : c'est la limite d'une
 * identification par contenu, seul un identifiant écrit à la source la
 * lèverait.
 */
function reconcilierIdentifiants(anciennes, idColAncien, nouvelles, idColNouveau, generer, cles, clesAnciennes) {
  if (!clesAnciennes) clesAnciennes = cles;
  var pris = {};
  var ids = new Array(nouvelles.length);
  var recopies = 0, conserves = 0, rapproches = 0, generes = 0;

  // Anciennes lignes porteuses d'un identifiant, encore « libres ».
  var libres = [];
  if (idColAncien !== -1) {
    for (var a = 0; a < anciennes.length; a++) {
      var ancienId = String(anciennes[a][idColAncien] || '').trim();
      if (ancienId === '' || ligneVide(anciennes[a], idColAncien)) continue;
      libres.push({
        id: ancienId, position: a,
        cles: valeursCles(anciennes[a], idColAncien, clesAnciennes),
        pris: false,
      });
    }
  }

  // Passe 1 — recopie des identifiants de l'original.
  var n;
  for (n = 0; n < nouvelles.length; n++) {
    if (ligneVide(nouvelles[n], idColNouveau)) { ids[n] = ''; continue; }
    var id = String(nouvelles[n][idColNouveau] || '').trim();
    if (id !== '' && !pris[id]) {
      ids[n] = id; pris[id] = true; recopies++;
      for (var l = 0; l < libres.length; l++) {
        if (libres[l].id === id) libres[l].pris = true;
      }
    }
  }

  // Passe 2 — même empreinte.
  var parEmpreinte = {};
  for (var f = 0; f < libres.length; f++) {
    if (libres[f].pris) continue;
    var e = libres[f].cles.join('\u001f');
    if (!parEmpreinte[e]) parEmpreinte[e] = [];
    parEmpreinte[e].push(libres[f]);
  }
  for (n = 0; n < nouvelles.length; n++) {
    if (ids[n] !== undefined) continue;
    var empreinte = valeursCles(nouvelles[n], idColNouveau, cles).join('\u001f');
    var file = parEmpreinte[empreinte] || [];
    while (file.length) {
      var cand = file.shift();
      if (cand.pris || pris[cand.id]) continue;
      ids[n] = cand.id; pris[cand.id] = true; cand.pris = true; conserves++;
      break;
    }
  }

  // Passe 3 — rapprochement à une colonne clé près, sans ambiguïté.
  var nbCles = cles && cles.length ? cles.length : 0;
  if (nbCles >= 2) {
    for (n = 0; n < nouvelles.length; n++) {
      if (ids[n] !== undefined) continue;
      var vk = valeursCles(nouvelles[n], idColNouveau, cles);
      var meilleur = null, meilleureDistance = Infinity, exaequo = false;
      for (var m = 0; m < libres.length; m++) {
        var cand2 = libres[m];
        if (cand2.pris || pris[cand2.id] || cand2.cles.length !== nbCles) continue;
        var diff = 0;
        for (var k = 0; k < nbCles; k++) if (cand2.cles[k] !== vk[k]) diff++;
        if (diff !== 1) continue;
        var distance = Math.abs(cand2.position - n);
        if (distance < meilleureDistance) {
          meilleur = cand2; meilleureDistance = distance; exaequo = false;
        } else if (distance === meilleureDistance) {
          exaequo = true;
        }
      }
      if (meilleur && !exaequo) {
        ids[n] = meilleur.id; pris[meilleur.id] = true; meilleur.pris = true; rapproches++;
      }
    }
  }

  // Passe 4 — génération.
  for (n = 0; n < nouvelles.length; n++) {
    if (ids[n] !== undefined) continue;
    var neuf = generer();
    ids[n] = neuf; pris[neuf] = true; generes++;
  }

  return {
    ids: ids, recopies: recopies, conserves: conserves,
    rapproches: rapproches, generes: generes,
  };
}

/** Identifiant unique, court et lisible : TR- + horodatage + aléa. */
function genererIdentifiantSynchro() {
  var time = new Date().getTime().toString(36).toUpperCase();
  var rand = Math.floor(Math.random() * 1679616).toString(36).toUpperCase();
  while (rand.length < 4) rand = '0' + rand;
  return SYNC_ID_PREFIX + time + '-' + rand;
}

// ---------------------------------------------------------------------------
// JOURNAL, MENU, DÉCLENCHEUR (copie TEST uniquement)
// ---------------------------------------------------------------------------

function journaliser(copie, rapport) {
  var feuille = copie.getSheetByName(SYNC_LOG_SHEET);
  if (!feuille) {
    feuille = copie.insertSheet(SYNC_LOG_SHEET);
    feuille.appendRow(['Date', 'Onglet', 'Lignes', 'ID recopiés', 'ID conservés', 'ID rapprochés', 'ID générés', 'Erreur']);
  }
  var maintenant = new Date();
  for (var i = 0; i < rapport.length; i++) {
    var r = rapport[i];
    feuille.appendRow([
      maintenant, r.onglet, r.lignes || 0, r.recopies || 0,
      r.conserves || 0, r.rapproches || 0, r.generes || 0, r.erreur || '',
    ]);
  }
  // On garde les 500 dernières lignes de journal.
  var excedent = feuille.getLastRow() - 501;
  if (excedent > 0) feuille.deleteRows(2, excedent);
}

/** Menu « TRUST AI » dans la copie TEST. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TRUST AI')
    .addItem('Synchroniser depuis l\'original maintenant', 'synchroniserOriginalVersTest')
    .addItem('Activer la synchronisation automatique (15 min)', 'installerDeclencheurSynchro')
    .addItem('Désactiver la synchronisation automatique', 'retirerDeclencheurSynchro')
    .addToUi();
}

/** Déclencheur horaire : toutes les 15 minutes. Idempotent. */
function installerDeclencheurSynchro() {
  retirerDeclencheurSynchro();
  ScriptApp.newTrigger('synchroniserOriginalVersTest')
    .timeBased()
    .everyMinutes(15)
    .create();
  SpreadsheetApp.getUi().alert('Synchronisation automatique activée : toutes les 15 minutes.');
}

function retirerDeclencheurSynchro() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'synchroniserOriginalVersTest') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
