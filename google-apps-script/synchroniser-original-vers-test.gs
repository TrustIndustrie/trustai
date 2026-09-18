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
 *         même contenu est conservé (empreinte de la ligne) ;
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

  // --- Identifiants : recopiés, conservés, ou générés --------------------
  var resultat = reconcilierIdentifiants(
    anciennes.slice(headerRow), idColAncien,
    valeurs.slice(headerRow), idColCible,
    genererIdentifiantSynchro
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

/**
 * Empreinte d'une ligne : toutes ses cellules sauf la colonne ID, normalisées.
 * Les dates sont ramenées à AAAA-MM-JJ pour que Date et texte se rejoignent.
 */
function calculerEmpreinte(row, idCol) {
  var parts = [];
  for (var c = 0; c < row.length; c++) {
    if (c === idCol) continue;
    var v = row[c];
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      v = v.getFullYear() + '-' +
        ('0' + (v.getMonth() + 1)).slice(-2) + '-' +
        ('0' + v.getDate()).slice(-2);
    }
    parts.push(String(v).trim().toLowerCase());
  }
  // Les colonnes vides en fin de ligne ne changent pas l'empreinte.
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts.join('');
}

/**
 * Attribue un identifiant à chaque ligne de `nouvelles` (lignes de DONNÉES,
 * sans les titres) :
 *   1. l'identifiant présent dans l'original est recopié tel quel (sauf s'il
 *      est déjà pris par une ligne précédente : doublon de copier-coller) ;
 *   2. sinon, l'identifiant qu'avait dans la copie TEST une ligne de même
 *      empreinte est conservé (chaque ancien identifiant ne sert qu'une fois) ;
 *   3. sinon, `generer()` fournit un identifiant neuf.
 * Une ligne entièrement vide n'a pas d'identifiant.
 */
function reconcilierIdentifiants(anciennes, idColAncien, nouvelles, idColNouveau, generer) {
  var parEmpreinte = {};
  if (idColAncien !== -1) {
    for (var a = 0; a < anciennes.length; a++) {
      var ancienId = String(anciennes[a][idColAncien] || '').trim();
      if (ancienId === '' || ligneVide(anciennes[a], idColAncien)) continue;
      var e = calculerEmpreinte(anciennes[a], idColAncien);
      if (!parEmpreinte[e]) parEmpreinte[e] = [];
      parEmpreinte[e].push(ancienId);
    }
  }

  var ids = [];
  var pris = {};
  var recopies = 0, conserves = 0, generes = 0;

  for (var n = 0; n < nouvelles.length; n++) {
    var row = nouvelles[n];
    if (ligneVide(row, idColNouveau)) { ids.push(''); continue; }

    var id = String(row[idColNouveau] || '').trim();
    if (id !== '' && !pris[id]) {
      recopies++;
    } else {
      id = '';
      var empreinte = calculerEmpreinte(row, idColNouveau);
      var candidats = parEmpreinte[empreinte] || [];
      while (candidats.length && !id) {
        var c = candidats.shift();
        if (!pris[c]) id = c;
      }
      if (id !== '') {
        conserves++;
      } else {
        id = generer();
        generes++;
      }
    }
    pris[id] = true;
    ids.push(id);
  }
  return { ids: ids, recopies: recopies, conserves: conserves, generes: generes };
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
    feuille.appendRow(['Date', 'Onglet', 'Lignes', 'ID recopiés', 'ID conservés', 'ID générés', 'Erreur']);
  }
  var maintenant = new Date();
  for (var i = 0; i < rapport.length; i++) {
    var r = rapport[i];
    feuille.appendRow([
      maintenant, r.onglet, r.lignes || 0, r.recopies || 0,
      r.conserves || 0, r.generes || 0, r.erreur || '',
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
