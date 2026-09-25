import { createSign } from "node:crypto";

/**
 * Accès Google Sheets en LECTURE SEULE, strictement côté serveur.
 *
 * Authentification par COMPTE DE SERVICE : on signe une assertion JWT avec la
 * clé privée, on l'échange contre un jeton d'accès, et on interroge l'API
 * Sheets. Aucune dépendance supplémentaire n'est nécessaire — la signature
 * RS256 est faite avec `node:crypto`.
 *
 * Garanties :
 *   * scope `spreadsheets.readonly` : TRUST AI ne peut pas écrire dans le
 *     fichier, même en cas d'erreur de code (seul l'Apps Script installé
 *     dans le Sheet gère la colonne « ID TRUST ») ;
 *   * les secrets ne sortent jamais du serveur : ils ne sont ni renvoyés au
 *     navigateur, ni journalisés, ni stockés dans Supabase ;
 *   * les messages d'erreur sont explicites mais ne contiennent JAMAIS la
 *     clé privée ni le jeton.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export class GoogleSheetsConfigError extends Error {}
export class GoogleSheetsAccessError extends Error {}

export function getServiceAccountEmail(): string | undefined {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || undefined;
}

/**
 * Clé privée du compte de service. Les variables d'environnement stockent
 * souvent les retours à la ligne sous forme littérale « \n » : on les
 * rétablit pour obtenir un PEM valide.
 */
export function getPrivateKey(): string | undefined {
  const raw = process.env.GOOGLE_PRIVATE_KEY;
  if (!raw) return undefined;
  const key = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  return key.trim() ? key : undefined;
}

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(getServiceAccountEmail() && getPrivateKey());
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Assertion JWT signée RS256, valable une heure au maximum. */
export function buildAssertion(
  email: string,
  privateKey: string,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

interface CachedToken {
  token: string;
  refreshAfter: number;
}
let cache: CachedToken | null = null;

/** Réservé aux tests. */
export function _clearTokenCache(): void {
  cache = null;
}

export async function getAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const email = getServiceAccountEmail();
  const privateKey = getPrivateKey();
  if (!email || !privateKey) {
    throw new GoogleSheetsConfigError(
      "Connexion Google Sheets non configurée : renseignez GOOGLE_SERVICE_ACCOUNT_EMAIL et GOOGLE_PRIVATE_KEY côté serveur.",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (cache && now < cache.refreshAfter) return cache.token;

  let assertion: string;
  try {
    assertion = buildAssertion(email, privateKey, now);
  } catch {
    // Le détail de l'erreur peut contenir des fragments de clé : on ne le
    // remonte jamais.
    throw new GoogleSheetsConfigError(
      "Clé privée Google illisible : vérifiez que la variable GOOGLE_PRIVATE_KEY contient bien la clé complète (BEGIN/END PRIVATE KEY).",
    );
  }

  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    throw new GoogleSheetsAccessError(
      `Authentification Google refusée (HTTP ${response.status}). Vérifiez l'adresse du compte de service et la clé privée.`,
    );
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new GoogleSheetsAccessError("Google n'a pas renvoyé de jeton d'accès.");
  }
  // Marge de sécurité de 5 minutes avant expiration.
  cache = {
    token: body.access_token,
    refreshAfter: now + Math.max((body.expires_in ?? 3600) - 300, 60),
  };
  return cache.token;
}

export interface SheetValues {
  headers: string[];
  rows: string[][];
  /** Numéro de la première ligne de données dans le fichier. */
  firstDataRow: number;
}

/**
 * Lit un onglet entier et sépare la ligne d'en-têtes des données.
 * `headerRow` est un numéro de ligne du fichier (1 = première ligne).
 */
export async function readSheet(
  spreadsheetId: string,
  sheetName: string,
  headerRow: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SheetValues> {
  const token = await getAccessToken(fetchImpl);
  const range = encodeURIComponent(sheetName);
  const url =
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}` +
    `?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE` +
    `&dateTimeRenderOption=FORMATTED_STRING`;

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 403) {
    throw new GoogleSheetsAccessError(
      "Accès refusé par Google : partagez le fichier en LECTURE avec l'adresse du compte de service, puis réessayez.",
    );
  }
  if (response.status === 404) {
    throw new GoogleSheetsAccessError(
      "Fichier introuvable : vérifiez l'identifiant du Google Sheet.",
    );
  }
  if (!response.ok) {
    throw new GoogleSheetsAccessError(
      `Lecture du Google Sheet impossible (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as { values?: unknown[][] };
  const values = (body.values ?? []).map((row) =>
    (row ?? []).map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
  );

  const index = Math.max(headerRow, 1) - 1;
  if (values.length <= index) {
    throw new GoogleSheetsAccessError(
      `L'onglet « ${sheetName} » ne contient pas de ligne d'en-têtes à la ligne ${headerRow}.`,
    );
  }
  const headers = values[index].map((h) => h.trim());
  if (headers.every((h) => h === "")) {
    throw new GoogleSheetsAccessError(
      `La ligne ${headerRow} de l'onglet « ${sheetName} » est vide : indiquez la ligne contenant les titres de colonnes.`,
    );
  }

  return {
    headers,
    rows: values.slice(index + 1),
    firstDataRow: index + 2,
  };
}
