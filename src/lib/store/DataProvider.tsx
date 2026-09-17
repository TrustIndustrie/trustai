"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { repository } from "../repository";
import { SupabaseRepository } from "../repository/supabase";
import { todayIso } from "../format";
import { useSession } from "../auth/SessionProvider";
import {
  BusinessError,
  addPaymentM,
  createStoreOrderM,
  decideApprovalM,
  markReminderDoneM,
  prepareSupplierOrderM,
  receiveShipmentM,
  requestOrderCancellationM,
  setVariantLogisticsM,
  updateLineStatusM,
  type DecideApprovalOptions,
  type NewStoreOrderInput,
  type PaymentInput,
} from "../mutations";
import type { AppMode } from "../config";
import type {
  Database,
  LogisticsLineDetail,
  LogisticsLineFilters,
  LogisticsLinePage,
  LogisticsSummary,
  ProcurementStatus,
  RecapSource,
  RecapSourceInput,
  VariantLogistics,
} from "../types";

export type { NewStoreOrderInput, NewOrderLineInput, PaymentInput } from "../mutations";
export { BusinessError } from "../mutations";

/**
 * Fournisseur de données à deux modes :
 *
 * - « demo » : localStorage v3 + mutations métier pures (V1), inchangé ;
 * - « connected » : Supabase est la source de vérité. Les lectures chargent
 *   un instantané (filtré par RLS), les écritures passent par des fonctions
 *   RPC atomiques qui rejouent les règles V1.2 côté serveur avec l'identité
 *   authentifiée. localStorage n'est pas utilisé et les données de
 *   démonstration ne sont jamais recopiées vers Supabase.
 *
 * Toutes les actions sont asynchrones (résolution immédiate en mode démo).
 */
interface DataContextValue {
  mode: AppMode;
  /** null tant que le premier chargement n'est pas terminé. */
  db: Database | null;
  /** Erreur de chargement réseau (mode connecté). */
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Filtre global par magasin ("all" = tous les magasins). */
  storeFilter: string;
  setStoreFilter: (storeId: string) => void;
  createStoreOrder: (
    input: NewStoreOrderInput,
  ) => Promise<{ id: string; reference: string }>;
  addPayment: (orderId: string, payment: PaymentInput) => Promise<void>;
  markReminderDone: (
    lineId: string,
    outcome: "indisponible" | "disponible",
    actor?: string,
  ) => Promise<void>;
  prepareSupplierOrder: (supplierId: string, lineIds: string[]) => Promise<void>;
  decideApproval: (
    requestId: string,
    approved: boolean,
    actor: string,
    reason?: string,
    options?: DecideApprovalOptions,
  ) => Promise<void>;
  requestOrderCancellation: (orderId: string) => Promise<void>;
  updateLineStatus: (
    lineId: string,
    status: ProcurementStatus,
    options?: {
      supplierId?: string;
      altSupplierId?: string;
      destinationWarehouseId?: string;
    },
  ) => Promise<void>;
  receiveShipment: (
    shipmentId: string,
    receipts: { itemId: string; quantityReceived: number }[],
  ) => Promise<void>;
  /** Compteurs du module logistique (mode connecté : RPC serveur). */
  logisticsSummary: () => Promise<LogisticsSummary>;
  /** Référentiel logistique d'une variante (validation côté serveur). */
  setVariantLogistics: (
    variantId: string,
    logistics: VariantLogistics,
  ) => Promise<void>;
  /** Configuration du récapitulatif Google Sheets (phase 2). */
  listRecapSources: () => Promise<RecapSource[]>;
  saveRecapSource: (input: RecapSourceInput) => Promise<void>;
  setRecapSourceActive: (sourceId: string, active: boolean) => Promise<void>;
  listLogisticsLines: (filters: LogisticsLineFilters) => Promise<LogisticsLinePage>;
  getLogisticsLine: (lineId: string) => Promise<LogisticsLineDetail>;
  resetDemo: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { mode, profile, supabase } = useSession();
  const [db, setDb] = useState<Database | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const dbRef = useRef<Database | null>(null);
  const loaded = useRef(false);

  const remote = useMemo(
    () => (mode === "connected" && supabase ? new SupabaseRepository(supabase) : null),
    [mode, supabase],
  );

  const refresh = useCallback(async () => {
    if (!remote) return;
    try {
      const snapshot = await remote.loadSnapshot();
      dbRef.current = snapshot;
      setDb(snapshot);
      setLoadError(null);
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Erreur réseau lors du chargement.",
      );
    }
  }, [remote]);

  // Chargement initial.
  useEffect(() => {
    if (mode === "demo") {
      if (loaded.current) return;
      loaded.current = true;
      const initial = repository.load();
      dbRef.current = initial;
      setDb(initial);
      return;
    }
    // Mode connecté : on attend un profil actif avant de charger.
    if (profile) {
      void refresh();
    }
  }, [mode, profile, refresh]);

  /** Mode démo : mutation pure locale + persistance localStorage. */
  const applyLocal = useCallback(<T,>(fn: (draft: Database) => T): T => {
    const current = dbRef.current;
    if (!current) {
      throw new Error("Données non chargées : réessayez dans un instant.");
    }
    const draft = structuredClone(current);
    const result = fn(draft); // peut lever une BusinessError → aucun effet
    dbRef.current = draft;
    repository.save(draft);
    setDb(draft);
    return result;
  }, []);

  const createStoreOrder = useCallback(
    async (input: NewStoreOrderInput) => {
      if (remote) {
        const created = await remote.createStoreOrder(input);
        await refresh();
        return created;
      }
      const order = applyLocal((d) => createStoreOrderM(d, input));
      return { id: order.id, reference: order.reference };
    },
    [remote, refresh, applyLocal],
  );

  const addPayment = useCallback(
    async (orderId: string, payment: PaymentInput) => {
      if (remote) {
        await remote.addPayment(orderId, payment);
        await refresh();
        return;
      }
      applyLocal((d) => addPaymentM(d, orderId, payment));
    },
    [remote, refresh, applyLocal],
  );

  const markReminderDone = useCallback(
    async (
      lineId: string,
      outcome: "indisponible" | "disponible",
      actor = "Équipe achats",
    ) => {
      if (remote) {
        await remote.markReminderDone(lineId, outcome);
        await refresh();
        return;
      }
      applyLocal((d) => markReminderDoneM(d, lineId, outcome, actor));
    },
    [remote, refresh, applyLocal],
  );

  const prepareSupplierOrder = useCallback(
    async (supplierId: string, lineIds: string[]) => {
      if (remote) {
        await remote.prepareSupplierOrder(supplierId, lineIds);
        await refresh();
        return;
      }
      applyLocal((d) => prepareSupplierOrderM(d, supplierId, lineIds, "Équipe achats"));
    },
    [remote, refresh, applyLocal],
  );

  const decideApproval = useCallback(
    async (
      requestId: string,
      approved: boolean,
      actor: string,
      reason?: string,
      options?: DecideApprovalOptions,
    ) => {
      if (remote) {
        // L'identité du décideur vient de la session côté serveur.
        await remote.decideApproval(requestId, approved, reason, options?.expectedAt);
        await refresh();
        return;
      }
      applyLocal((d) => decideApprovalM(d, requestId, approved, actor, reason, options));
    },
    [remote, refresh, applyLocal],
  );

  const requestOrderCancellation = useCallback(
    async (orderId: string) => {
      if (remote) {
        await remote.requestOrderCancellation(orderId);
        await refresh();
        return;
      }
      applyLocal((d) => requestOrderCancellationM(d, orderId));
    },
    [remote, refresh, applyLocal],
  );

  const updateLineStatus = useCallback(
    async (
      lineId: string,
      status: ProcurementStatus,
      options?: {
        supplierId?: string;
        altSupplierId?: string;
        destinationWarehouseId?: string;
      },
    ) => {
      if (remote) {
        // Mode connecté : le serveur rejoue les mêmes règles avec l'identité
        // réelle (permission « gerer_achats », commande annulée refusée…).
        await remote.setLineProcurement(lineId, status, options ?? {});
        await refresh();
        return;
      }
      applyLocal((d) => updateLineStatusM(d, lineId, status, options));
    },
    [remote, refresh, applyLocal],
  );

  // --- Socle logistique (phase 1) -----------------------------------------
  const logisticsSummary = useCallback(async (): Promise<LogisticsSummary> => {
    if (remote) return remote.logisticsSummary();
    // Mode démonstration : le module logistique s'appuie sur la base
    // partagée ; aucun compteur simulé n'est inventé.
    return {
      lignesTotal: 0,
      lignesDisponibles: 0,
      dossiersTotal: 0,
      dossiersAContacter: 0,
      anomaliesOuvertes: 0,
      documentsAVerifier: 0,
    };
  }, [remote]);

  const setVariantLogistics = useCallback(
    async (variantId: string, logistics: VariantLogistics) => {
      if (remote) {
        await remote.setVariantLogistics(variantId, logistics);
        await refresh();
        return;
      }
      applyLocal((d) => setVariantLogisticsM(d, variantId, logistics));
    },
    [remote, refresh, applyLocal],
  );

  const listRecapSources = useCallback(async (): Promise<RecapSource[]> => {
    // Mode démonstration : la connexion au récapitulatif s'appuie sur la base
    // partagée ; aucune configuration fictive n'est inventée.
    return remote ? remote.listRecapSources() : [];
  }, [remote]);

  const saveRecapSource = useCallback(
    async (input: RecapSourceInput) => {
      if (!remote) {
        throw new BusinessError(
          "La connexion au récapitulatif n'est disponible qu'en mode connecté.",
        );
      }
      await remote.upsertRecapSource(input);
    },
    [remote],
  );

  const setRecapSourceActive = useCallback(
    async (sourceId: string, active: boolean) => {
      if (!remote) {
        throw new BusinessError(
          "La connexion au récapitulatif n'est disponible qu'en mode connecté.",
        );
      }
      await remote.setRecapSourceActive(sourceId, active);
    },
    [remote],
  );

  const listLogisticsLines = useCallback(
    async (filters: LogisticsLineFilters): Promise<LogisticsLinePage> => {
      if (!remote) return { total: 0, rows: [] };
      return remote.listLogisticsLines(filters);
    },
    [remote],
  );

  const getLogisticsLine = useCallback(
    async (lineId: string): Promise<LogisticsLineDetail> => {
      if (!remote) return { line: null, events: [], anomalies: [] };
      return remote.getLogisticsLine(lineId);
    },
    [remote],
  );

  const receiveShipment = useCallback(
    async (
      shipmentId: string,
      receipts: { itemId: string; quantityReceived: number }[],
    ) => {
      if (remote) {
        await remote.receiveShipment(shipmentId, receipts);
        await refresh();
        return;
      }
      applyLocal((d) => receiveShipmentM(d, shipmentId, receipts));
    },
    [remote, refresh, applyLocal],
  );

  const resetDemo = useCallback(() => {
    if (mode !== "demo") return;
    const fresh = repository.reset();
    dbRef.current = fresh;
    setDb(fresh);
  }, [mode]);

  const value = useMemo<DataContextValue>(
    () => ({
      mode,
      db,
      loadError,
      refresh,
      storeFilter,
      setStoreFilter,
      createStoreOrder,
      addPayment,
      markReminderDone,
      prepareSupplierOrder,
      decideApproval,
      requestOrderCancellation,
      updateLineStatus,
      receiveShipment,
      logisticsSummary,
      setVariantLogistics,
      listRecapSources,
      saveRecapSource,
      setRecapSourceActive,
      listLogisticsLines,
      getLogisticsLine,
      resetDemo,
    }),
    [
      mode,
      db,
      loadError,
      refresh,
      storeFilter,
      createStoreOrder,
      addPayment,
      markReminderDone,
      prepareSupplierOrder,
      decideApproval,
      requestOrderCancellation,
      updateLineStatus,
      receiveShipment,
      logisticsSummary,
      setVariantLogistics,
      listRecapSources,
      saveRecapSource,
      setRecapSourceActive,
      listLogisticsLines,
      getLogisticsLine,
      resetDemo,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useData doit être utilisé dans un <DataProvider>.");
  }
  return ctx;
}

/** Date du jour (yyyy-mm-dd) pour préremplir les formulaires. */
export { todayIso };
