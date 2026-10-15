import { createSeed, SEED_VERSION } from "../seed";
import type { Database } from "../types";

/**
 * Couche d'accès aux données.
 *
 * L'interface `DataRepository` isole complètement l'application du support
 * de stockage. Aujourd'hui : `LocalStorageRepository` (démonstration).
 * Demain : un `SupabaseRepository` implémentera la même interface sans
 * toucher aux composants d'interface.
 *
 * Règle : aucun composant métier ne lit `localStorage` directement —
 * tout passe par le repository via le DataProvider.
 */
export interface DataRepository {
  /** Charge la base (initialisation ou migration si nécessaire). */
  load(): Database;
  /** Persiste l'état complet de la base. */
  save(db: Database): void;
  /** Réinitialise les données de démonstration. */
  reset(): Database;
}

const STORAGE_KEY = "trust-ai:db";

/**
 * Migration v2 → v3 (correctif financier V1.2).
 *
 * Aucune donnée n'est transformée : les totaux des commandes (y compris
 * annulées) ne sont JAMAIS stockés, ils sont dérivés des lignes, remises
 * et frais existants — la correction du calcul historique s'applique donc
 * automatiquement aux anciennes commandes annulées. La migration conserve
 * intégralement commandes, clients, règlements, validations et historiques
 * créés pendant les tests (aucun doublon, idempotente), et complète
 * simplement les collections manquantes depuis le seed si besoin.
 */
export function migrateV2toV3(old: Database): Database {
  const fresh = createSeed();
  const migrated: Database = {
    ...old,
    version: SEED_VERSION,
    // Collections ajoutées en v2 : présentes normalement, complétées sinon.
    userProfiles: old.userProfiles ?? fresh.userProfiles,
    products: old.products ?? fresh.products,
    productVariants: old.productVariants ?? fresh.productVariants,
  };
  return migrated;
}

/**
 * Migration v1 → v2 (ajout du catalogue produits et des profils employés).
 *
 * Principe : on repart du seed v2 (qui contient le catalogue) et on
 * conserve les données créées par l'utilisateur pendant la démo v1 —
 * commandes magasin saisies, avec leurs lignes, règlements, clients,
 * parcours d'acquisition et historique. Les identifiants du seed sont
 * déterministes (« ord-sho-1 »…) alors que les identifiants créés en
 * session sont aléatoires, ce qui permet de les distinguer sans risque.
 * Aucune donnée n'est réinitialisée silencieusement.
 */
export function migrateV1toV2(old: Database): Database {
  const fresh = createSeed();
  try {
    const seedOrderIds = new Set(fresh.orders.map((o) => o.id));
    const userOrders = (old.orders ?? []).filter((o) => !seedOrderIds.has(o.id));
    if (userOrders.length === 0) return fresh;

    const userOrderIds = new Set(userOrders.map((o) => o.id));
    fresh.orders.push(...userOrders);
    fresh.orderLines.push(
      ...(old.orderLines ?? []).filter((l) => userOrderIds.has(l.orderId)),
    );
    fresh.payments.push(
      ...(old.payments ?? []).filter((p) => userOrderIds.has(p.orderId)),
    );
    const seedCustomerIds = new Set(fresh.customers.map((c) => c.id));
    fresh.customers.push(
      ...(old.customers ?? []).filter(
        (c) =>
          !seedCustomerIds.has(c.id) &&
          userOrders.some((o) => o.customerId === c.id),
      ),
    );
    fresh.acquisitionJourneys.push(
      ...(old.acquisitionJourneys ?? []).filter((j) =>
        userOrderIds.has(j.orderId),
      ),
    );
    fresh.activityLog.unshift(
      ...(old.activityLog ?? []).filter(
        (a) => a.orderId && userOrderIds.has(a.orderId),
      ),
    );
    return fresh;
  } catch {
    // En cas de données corrompues, on repart du seed plutôt que de planter.
    return createSeed();
  }
}

export class LocalStorageRepository implements DataRepository {
  load(): Database {
    if (typeof window === "undefined") {
      // Rendu serveur : on renvoie le seed, le client rechargera depuis
      // localStorage après hydratation (géré par le DataProvider).
      return createSeed();
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return this.reset();
      const parsed = JSON.parse(raw) as Database;
      if (!parsed || typeof parsed.version !== "number") return this.reset();
      if (parsed.version === SEED_VERSION) return parsed;
      if (parsed.version === 1) {
        // Chaîne v1 → v2 → v3 (migrateV1toV2 repart du seed courant).
        const migrated = migrateV2toV3(migrateV1toV2(parsed));
        this.save(migrated);
        return migrated;
      }
      if (parsed.version === 2) {
        const migrated = migrateV2toV3(parsed);
        this.save(migrated);
        return migrated;
      }
      // Version inconnue (plus récente ou invalide) : seed propre.
      return this.reset();
    } catch {
      return this.reset();
    }
  }

  save(db: Database): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      // Stockage plein ou indisponible : la démo continue en mémoire.
    }
  }

  reset(): Database {
    const seed = createSeed();
    this.save(seed);
    return seed;
  }
}

export const repository: DataRepository = new LocalStorageRepository();
