import type { SupabaseClient } from "@supabase/supabase-js";
import { BusinessError, type NewStoreOrderInput, type PaymentInput } from "../mutations";
import { fromCents, toCents } from "../money";
import { SEED_VERSION } from "../seed";
import type {
  AcquisitionSource,
  ApprovalRequest,
  Database,
  DeliveryStatus,
  FulfillmentMode,
  LogisticsLineDetail,
  LogisticsLineFilters,
  LogisticsLinePage,
  LogisticsLineRow,
  LogisticsSummary,
  OrderOrigin,
  RecapSource,
  RecapSourceInput,
  OrderStatus,
  PaymentMethod,
  ProcurementStatus,
  ProductCategory,
  ProductSource,
  Role,
  ShipmentEndpointType,
  ShipmentStatus,
  SupplierChannel,
  SupplierLogistics,
  SupplierOrderStatus,
  TransportMode,
  VariantLogistics,
} from "../types";

/**
 * Couche d'accès Supabase (mode connecté).
 *
 * - Lecture : charge un instantané complet du domaine (les policies RLS
 *   limitent automatiquement ce que chaque profil voit) et le mappe vers la
 *   forme `Database` existante — toute l'interface V1 fonctionne sans
 *   réécriture.
 * - Écriture : chaque opération sensible appelle une fonction RPC Postgres
 *   ATOMIQUE (supabase/migrations/..._business_functions.sql) qui rejoue
 *   les règles métier V1.2 côté serveur avec l'identité authentifiée.
 *   localStorage n'est JAMAIS utilisé pour les données métier dans ce mode,
 *   et les données de démonstration ne sont JAMAIS recopiées vers Supabase.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function throwAsBusiness(error: { message: string } | null): void {
  if (!error) return;
  // Les fonctions RPC lèvent des exceptions avec des messages en français :
  // on les remonte tels quels à l'interface.
  throw new BusinessError(error.message);
}

async function selectAll(
  supabase: SupabaseClient,
  table: string,
  columns = "*",
): Promise<Row[]> {
  const { data, error } = await supabase.from(table).select(columns).limit(10000);
  if (error) {
    throw new BusinessError(
      `Lecture impossible (${table}) : ${error.message}`,
    );
  }
  return (data ?? []) as Row[];
}

export class SupabaseRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /** Instantané complet du domaine, mappé vers la forme Database de la V1. */
  async loadSnapshot(): Promise<Database> {
    const [
      stores,
      warehouses,
      profiles,
      storeAccess,
      customers,
      products,
      variants,
      suppliers,
      productSuppliers,
      orders,
      orderLines,
      supplierOrders,
      supplierOrderLines,
      shipments,
      shipmentItems,
      shipmentLegs,
      payments,
      journeys,
      approvals,
      activity,
    ] = await Promise.all([
      selectAll(this.supabase, "stores"),
      selectAll(this.supabase, "warehouses"),
      selectAll(this.supabase, "profiles"),
      selectAll(this.supabase, "user_store_access"),
      selectAll(this.supabase, "customers"),
      selectAll(this.supabase, "products"),
      selectAll(this.supabase, "product_variants"),
      selectAll(this.supabase, "suppliers"),
      selectAll(this.supabase, "product_suppliers"),
      selectAll(this.supabase, "orders"),
      selectAll(this.supabase, "order_lines"),
      selectAll(this.supabase, "supplier_orders"),
      selectAll(this.supabase, "supplier_order_lines"),
      selectAll(this.supabase, "shipments"),
      selectAll(this.supabase, "shipment_items"),
      selectAll(this.supabase, "shipment_legs"),
      selectAll(this.supabase, "payments"),
      selectAll(this.supabase, "acquisition_journeys"),
      selectAll(this.supabase, "approval_requests"),
      selectAll(this.supabase, "activity_logs"),
    ]);

    const profileName = (id: string | null): string | undefined =>
      id ? profiles.find((p) => p.id === id)?.display_name : undefined;

    return {
      version: SEED_VERSION,
      stores: stores.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        city: s.city,
        aliases: s.aliases ?? [],
        active: s.active,
      })),
      warehouses: warehouses.map((w) => ({
        id: w.id,
        name: w.name,
        city: w.city,
        linkedStoreIds: stores
          .filter((s) => s.default_warehouse_id === w.id)
          .map((s) => s.id),
        active: w.active,
        notes: w.notes ?? undefined,
      })),
      // En mode connecté, l'équipe de vente = les profils employés.
      salespeople: profiles.map((p) => ({
        id: p.id,
        name: p.display_name,
        storeId: p.primary_store_id ?? "",
        active: p.active,
      })),
      userProfiles: profiles.map((p) => ({
        id: p.id,
        displayName: p.display_name,
        role: p.role as Role,
        primaryStoreId: p.primary_store_id ?? undefined,
        allowedStoreIds: storeAccess
          .filter((a) => a.profile_id === p.id)
          .map((a) => a.store_id),
        active: p.active,
      })),
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        address: c.address ?? undefined,
        postalCode: c.postal_code ?? undefined,
        city: c.city ?? undefined,
      })),
      products: products.map((p) => ({
        id: p.id,
        shopifyProductId: p.shopify_product_id ?? undefined,
        title: p.title,
        shortDescription: p.short_description ?? undefined,
        category: p.category as ProductCategory,
        imageUrl: p.image_url ?? undefined,
        shopifyHandle: p.shopify_handle ?? undefined,
        source: p.source as ProductSource,
        active: p.active,
        lastSyncedAt: p.last_synced_at ?? undefined,
      })),
      productVariants: variants.map((v) => ({
        id: v.id,
        productId: v.product_id,
        name: v.name,
        sku: v.sku,
        barcode: v.barcode ?? undefined,
        color: v.color ?? undefined,
        dimensions: v.dimensions ?? undefined,
        price: fromCents(v.price_cents),
        shopifyVariantId: v.shopify_variant_id ?? undefined,
        // Référentiel logistique (phase 1) : lecture seule ici, écriture par
        // la fonction serveur set_variant_logistics uniquement.
        logistics: {
          weightGrams: v.weight_grams ?? undefined,
          packedLengthMm: v.packed_length_mm ?? undefined,
          packedWidthMm: v.packed_width_mm ?? undefined,
          packedHeightMm: v.packed_height_mm ?? undefined,
          volumeCm3: v.volume_cm3 ?? undefined,
          packageCount: v.package_count ?? undefined,
          fragile: v.fragile ?? undefined,
          requiresInstallation: v.requires_installation ?? undefined,
          recommendedHandlers: v.recommended_handlers ?? undefined,
          handlingNotes: v.handling_notes ?? undefined,
          verifiedAt: v.logistics_verified_at ?? undefined,
          verifiedBy: v.logistics_verified_by ?? undefined,
        },
      })),
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        phone: s.phone ?? undefined,
        country: s.country ?? undefined,
        specialties: s.specialties ?? [],
        website: s.website ?? undefined,
        orderChannel: s.order_channel as SupplierChannel,
        stockUrl: s.stock_url ?? undefined,
        usualOrderDay: s.usual_order_day ?? undefined,
        pickupDays: s.pickup_days ?? [],
        leadTimeDays: s.lead_time_days ?? undefined,
        active: s.active,
        logistics: s.logistics as SupplierLogistics,
        comments: s.comments ?? undefined,
      })),
      productSuppliers: productSuppliers.map((ps) => ({
        id: ps.id,
        productId: ps.product_id ?? undefined,
        variantId: ps.variant_id ?? undefined,
        productName: ps.product_name,
        variant: ps.variant_label ?? undefined,
        supplierId: ps.supplier_id,
        supplierReference: ps.supplier_reference ?? undefined,
        leadTimeDays: ps.lead_time_days ?? undefined,
        priority: ps.priority,
        isPrimary: ps.is_primary,
      })),
      orders: orders.map((o) => ({
        id: o.id,
        reference: o.reference,
        origin: o.origin as OrderOrigin,
        storeId: o.store_id ?? undefined,
        salespersonId: o.salesperson_profile_id ?? undefined,
        customerId: o.customer_id,
        orderedAt: o.ordered_at,
        desiredAt: o.desired_at ?? undefined,
        fulfillmentMode: o.fulfillment_mode as FulfillmentMode,
        deliveryStatus: o.delivery_status as DeliveryStatus,
        fulfillmentLocationLabel: o.fulfillment_location_label ?? undefined,
        deliveryFee: fromCents(o.delivery_fee_cents),
        discount: fromCents(o.discount_cents),
        acquisitionSource: (o.acquisition_source ?? undefined) as
          | AcquisitionSource
          | undefined,
        status: o.status as OrderStatus,
        notes: o.notes ?? undefined,
        createdAt: o.created_at,
        createdByProfileId: o.created_by ?? undefined,
        shopify: o.shopify_order_id
          ? {
              shopifyId: o.shopify_order_id,
              orderNumber: o.shopify_order_number ?? o.reference,
            }
          : undefined,
      })),
      orderLines: orderLines.map((l) => ({
        id: l.id,
        orderId: l.order_id,
        productId: l.product_id ?? undefined,
        variantId: l.variant_id ?? undefined,
        offCatalog: l.off_catalog || undefined,
        productName: l.product_name,
        variant: l.variant_label ?? undefined,
        reference: l.reference ?? undefined,
        quantity: l.quantity,
        unitPrice: fromCents(l.unit_price_cents),
        discount: fromCents(l.discount_cents),
        supplierId: l.supplier_id ?? undefined,
        altSupplierId: l.alt_supplier_id ?? undefined,
        procurementStatus: l.procurement_status as ProcurementStatus,
        expectedArrival: l.expected_arrival ?? undefined,
        destinationWarehouseId: l.destination_warehouse_id ?? undefined,
        supplierOrderId: l.supplier_order_id ?? undefined,
        lastReminderAt: l.last_reminder_at ?? undefined,
        nextReminderAt: l.next_reminder_at ?? undefined,
        comments: l.comments ?? undefined,
      })),
      supplierOrders: supplierOrders.map((so) => ({
        id: so.id,
        reference: so.reference,
        supplierId: so.supplier_id,
        status: so.status as SupplierOrderStatus,
        lines: supplierOrderLines
          .filter((sol) => sol.supplier_order_id === so.id)
          .map((sol) => ({
            id: sol.id,
            orderLineId: sol.order_line_id ?? undefined,
            productName: sol.product_name,
            variant: sol.variant_label ?? undefined,
            supplierReference: sol.supplier_reference ?? undefined,
            quantity: sol.quantity,
            unitCost:
              sol.unit_cost_cents !== null && sol.unit_cost_cents !== undefined
                ? fromCents(sol.unit_cost_cents)
                : undefined,
          })),
        createdAt: so.created_at,
        validatedAt: so.validated_at ?? undefined,
        validatedBy: profileName(so.validated_by),
        expectedAt: so.expected_at ?? undefined,
        notes: so.notes ?? undefined,
      })),
      shipments: shipments.map((s) => ({
        id: s.id,
        reference: s.reference,
        supplierId: s.supplier_id ?? undefined,
        warehouseId: s.warehouse_id ?? undefined,
        originLabel: s.origin_label,
        destinationLabel: s.destination_label,
        mode: s.mode as TransportMode,
        carrier: s.carrier ?? undefined,
        charterReference: s.charter_reference ?? undefined,
        plannedAt: s.planned_at ?? undefined,
        actualAt: s.actual_at ?? undefined,
        status: s.status as ShipmentStatus,
        comments: s.comments ?? undefined,
        items: shipmentItems
          .filter((i) => i.shipment_id === s.id)
          .map((i) => ({
            id: i.id,
            orderLineId: i.order_line_id ?? undefined,
            productName: i.product_name,
            variant: i.variant_label ?? undefined,
            quantity: i.quantity,
            quantityReceived: i.quantity_received,
          })),
        legs: shipmentLegs
          .filter((l) => l.shipment_id === s.id)
          .map((l) => ({
            id: l.id,
            shipmentId: l.shipment_id,
            sequence: l.sequence,
            originType: l.origin_type as ShipmentEndpointType,
            originLabel: l.origin_label,
            destinationType: l.destination_type as ShipmentEndpointType,
            destinationLabel: l.destination_label,
            mode: l.mode as TransportMode,
            carrier: l.carrier ?? undefined,
            charterReference: l.charter_reference ?? undefined,
            plannedAt: l.planned_at ?? undefined,
            actualAt: l.actual_at ?? undefined,
            status: l.status as ShipmentStatus,
          })),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        orderId: p.order_id,
        amount: fromCents(p.amount_cents),
        date: p.date,
        method: p.method as PaymentMethod,
        storeId: p.store_id ?? undefined,
        salespersonId: p.received_by ?? undefined,
        receivedByProfileId: p.received_by ?? undefined,
        comment: p.comment ?? undefined,
      })),
      acquisitionJourneys: journeys.map((j) => ({
        id: j.id,
        orderId: j.order_id,
        source: j.source as AcquisitionSource,
        landingPage: j.landing_page ?? undefined,
        firstVisitAt: j.first_visit_at ?? undefined,
        lastVisitAt: j.last_visit_at ?? undefined,
        utmSource: j.utm_source ?? undefined,
        utmMedium: j.utm_medium ?? undefined,
        utmCampaign: j.utm_campaign ?? undefined,
        utmContent: j.utm_content ?? undefined,
        utmTerm: j.utm_term ?? undefined,
        daysToConversion: j.days_to_conversion ?? undefined,
        newCustomer: j.new_customer ?? undefined,
      })),
      approvalRequests: approvals.map((a) => ({
        id: a.id,
        type: a.type as ApprovalRequest["type"],
        title: a.title,
        description: a.description,
        relatedOrderId: a.related_order_id ?? undefined,
        relatedSupplierOrderId: a.related_supplier_order_id ?? undefined,
        relatedShipmentId: a.related_shipment_id ?? undefined,
        requestedBy: profileName(a.requested_by),
        requestedByProfileId: a.requested_by ?? undefined,
        financialImpact:
          a.financial_impact_cents !== null && a.financial_impact_cents !== undefined
            ? fromCents(a.financial_impact_cents)
            : undefined,
        status: a.status as ApprovalRequest["status"],
        createdAt: a.created_at,
        decidedAt: a.decided_at ?? undefined,
        decidedBy: profileName(a.decided_by),
        decisionReason: a.decision_reason ?? undefined,
      })),
      activityLog: activity
        .map((l) => ({
          id: l.id,
          at: l.at,
          actor: l.actor_label,
          action: l.action,
          details: l.details ?? undefined,
          orderId: l.order_id ?? undefined,
        }))
        .sort((a, b) => b.at.localeCompare(a.at)),
    };
  }

  // -------------------------------------------------------------------
  // Écritures : fonctions RPC atomiques, identité issue de la session.
  // -------------------------------------------------------------------

  async createStoreOrder(
    input: NewStoreOrderInput,
  ): Promise<{ id: string; reference: string }> {
    const payload = {
      store_id: input.storeId,
      ordered_at: input.orderedAt,
      desired_at: input.desiredAt ?? null,
      fulfillment_mode: input.fulfillmentMode,
      delivery_fee_cents: toCents(input.deliveryFee),
      discount_cents: toCents(input.discount),
      acquisition_source: input.acquisitionSource ?? null,
      notes: input.notes ?? null,
      customer: {
        name: input.customer.name,
        phone: input.customer.phone ?? null,
        email: input.customer.email ?? null,
        address: input.customer.address ?? null,
        postal_code: input.customer.postalCode ?? null,
        city: input.customer.city ?? null,
      },
      lines: input.lines.map((l) => ({
        product_id: l.productId ?? null,
        variant_id: l.variantId ?? null,
        off_catalog: l.offCatalog ?? false,
        product_name: l.productName,
        variant_label: l.variant ?? null,
        reference: l.reference ?? null,
        quantity: l.quantity,
        unit_price_cents: toCents(l.unitPrice),
        discount_cents: toCents(l.discount),
        supplier_id: l.supplierId ?? null,
        alt_supplier_id: l.altSupplierId ?? null,
        destination_warehouse_id: l.destinationWarehouseId ?? null,
        comments: l.comments ?? null,
      })),
      payments: input.payments.map((p) => ({
        amount_cents: toCents(p.amount),
        date: p.date,
        method: p.method,
        comment: p.comment ?? null,
      })),
    };
    const { data, error } = await this.supabase.rpc("create_store_order", {
      p_payload: payload,
    });
    throwAsBusiness(error);
    const orderId = data as string;
    const { data: order } = await this.supabase
      .from("orders")
      .select("reference")
      .eq("id", orderId)
      .single();
    return { id: orderId, reference: (order as Row | null)?.reference ?? "" };
  }

  async addPayment(orderId: string, payment: PaymentInput): Promise<void> {
    const { error } = await this.supabase.rpc("add_payment", {
      p_order_id: orderId,
      p_amount_cents: toCents(payment.amount),
      p_date: payment.date,
      p_method: payment.method,
      p_comment: payment.comment ?? null,
    });
    throwAsBusiness(error);
  }

  async requestOrderCancellation(orderId: string): Promise<void> {
    const { error } = await this.supabase.rpc("request_order_cancellation", {
      p_order_id: orderId,
    });
    throwAsBusiness(error);
  }

  /** Qualification d'une ligne (stock local / à commander / indisponible). */
  async setLineProcurement(
    lineId: string,
    status: ProcurementStatus,
    options: {
      supplierId?: string;
      altSupplierId?: string;
      destinationWarehouseId?: string;
    } = {},
  ): Promise<void> {
    const { error } = await this.supabase.rpc("set_line_procurement", {
      p_line_id: lineId,
      p_status: status,
      p_supplier_id: options.supplierId ?? null,
      p_alt_supplier_id: options.altSupplierId ?? null,
      p_destination_warehouse_id: options.destinationWarehouseId ?? null,
    });
    throwAsBusiness(error);
  }

  async decideApproval(
    requestId: string,
    approved: boolean,
    reason?: string,
    expectedAt?: string,
  ): Promise<void> {
    const { error } = await this.supabase.rpc("decide_approval", {
      p_request_id: requestId,
      p_approved: approved,
      p_reason: reason ?? null,
      p_expected_at: expectedAt ?? null,
    });
    throwAsBusiness(error);
  }

  async prepareSupplierOrder(
    supplierId: string,
    lineIds: string[],
  ): Promise<void> {
    const { error } = await this.supabase.rpc("prepare_supplier_order", {
      p_supplier_id: supplierId,
      p_line_ids: lineIds,
    });
    throwAsBusiness(error);
  }

  async markReminderDone(
    lineId: string,
    outcome: "indisponible" | "disponible",
  ): Promise<void> {
    const { error } = await this.supabase.rpc("mark_reminder_done", {
      p_line_id: lineId,
      p_outcome: outcome,
    });
    throwAsBusiness(error);
  }

  async receiveShipment(
    shipmentId: string,
    receipts: { itemId: string; quantityReceived: number }[],
  ): Promise<void> {
    const { error } = await this.supabase.rpc("receive_shipment", {
      p_shipment_id: shipmentId,
      p_receipts: receipts.map((r) => ({
        item_id: r.itemId,
        quantity_received: r.quantityReceived,
      })),
    });
    throwAsBusiness(error);
  }

  // -------------------------------------------------------------------------
  // Socle logistique (phase 1)
  // -------------------------------------------------------------------------
  // Les 13 tables logistiques n'accordent AUCUN droit direct : tout passe par
  // des fonctions serveur qui vérifient permission et organisation.

  /** Compteurs du module logistique (cloisonnés par organisation). */
  async logisticsSummary(): Promise<LogisticsSummary> {
    const { data, error } = await this.supabase.rpc("logistics_summary");
    throwAsBusiness(error);
    const row = (data ?? {}) as Record<string, number>;
    return {
      lignesTotal: Number(row.lignes_total ?? 0),
      lignesDisponibles: Number(row.lignes_disponibles ?? 0),
      dossiersTotal: Number(row.dossiers_total ?? 0),
      dossiersAContacter: Number(row.dossiers_a_contacter ?? 0),
      anomaliesOuvertes: Number(row.anomalies_ouvertes ?? 0),
      documentsAVerifier: Number(row.documents_a_verifier ?? 0),
    };
  }

  // --- Récapitulatif Google Sheets (phase 2) -------------------------------

  /** Onglets configurés du récapitulatif (liste vide si rien n'est branché). */
  async listRecapSources(): Promise<RecapSource[]> {
    const { data, error } = await this.supabase.rpc("list_recap_sources");
    throwAsBusiness(error);
    const rows = (data ?? []) as Record<string, unknown>[];
    return rows.map((row) => {
      const last = (row.last_read ?? null) as Record<string, unknown> | null;
      return {
        id: String(row.id),
        label: String(row.label ?? ""),
        spreadsheetId: (row.spreadsheet_id as string) ?? "",
        sheetName: (row.sheet_name as string) ?? "",
        headerRow: Number(row.header_row ?? 1),
        idColumn: (row.id_column as string) ?? undefined,
        columnMapping: (row.column_mapping ?? {}) as Record<string, string>,
        clientCarriers: (row.client_carriers ?? []) as string[],
        active: row.active !== false,
        linesCount: Number(row.lines_count ?? 0),
        lastReadAt: (row.last_read_at as string) ?? undefined,
        lastReadStatus: (row.last_read_status as string) ?? undefined,
        lastRead: last
          ? {
              startedAt: String(last.started_at ?? ""),
              finishedAt: (last.finished_at as string) ?? undefined,
              rowsRead: Number(last.rows_read ?? 0),
              rowsCreated: Number(last.rows_created ?? 0),
              rowsUpdated: Number(last.rows_updated ?? 0),
              rowsIgnored: Number(last.rows_ignored ?? 0),
              errorsCount: Number(last.errors_count ?? 0),
              report: (last.report ?? {}) as Record<string, number>,
            }
          : undefined,
      };
    });
  }

  /** Crée ou met à jour un onglet (permission « importer_recap »). */
  async upsertRecapSource(input: RecapSourceInput): Promise<void> {
    const { error } = await this.supabase.rpc("upsert_recap_source", {
      p_payload: {
        id: input.id ?? null,
        label: input.label,
        spreadsheet_id: input.spreadsheetId,
        sheet_name: input.sheetName,
        header_row: input.headerRow,
        id_column: input.idColumn ?? null,
        column_mapping: input.columnMapping,
        client_carriers: input.clientCarriers,
      },
    });
    throwAsBusiness(error);
  }

  /**
   * Met un onglet en sommeil (ou le réveille).
   * Aucune ligne n'est supprimée : elles perdraient leur historique.
   */
  async setRecapSourceActive(sourceId: string, active: boolean): Promise<void> {
    const { error } = await this.supabase.rpc("set_recap_source_active", {
      p_source_id: sourceId,
      p_active: active,
    });
    throwAsBusiness(error);
  }

  /** Lignes logistiques paginées et filtrées (aucun accès direct aux tables). */
  async listLogisticsLines(filters: LogisticsLineFilters): Promise<LogisticsLinePage> {
    const { data, error } = await this.supabase.rpc("list_logistics_lines", {
      p_search: filters.search ?? null,
      p_stage: filters.stage ?? null,
      p_supplier: filters.supplier ?? null,
      p_warehouse_id: filters.warehouseId ?? null,
      p_only_anomalies: filters.onlyAnomalies ?? false,
      p_limit: filters.limit ?? 50,
      p_offset: filters.offset ?? 0,
      p_source_id: filters.sourceId ?? null,
      p_exit_channel: filters.exitChannel ?? null,
    });
    throwAsBusiness(error);
    const row = (data ?? {}) as { total?: number; rows?: unknown[] };
    return {
      total: Number(row.total ?? 0),
      rows: (row.rows ?? []) as LogisticsLineRow[],
    };
  }

  /** Détail d'une ligne : historique des événements et anomalies. */
  async getLogisticsLine(lineId: string): Promise<LogisticsLineDetail> {
    const { data, error } = await this.supabase.rpc("get_logistics_line", {
      p_line_id: lineId,
    });
    throwAsBusiness(error);
    return (data ?? { line: null, events: [], anomalies: [] }) as LogisticsLineDetail;
  }

  /** Référentiel logistique d'une variante (validation côté serveur). */
  async setVariantLogistics(
    variantId: string,
    logistics: VariantLogistics,
  ): Promise<void> {
    // Un champ ABSENT n'est pas transmis (valeur conservée) ; un champ à
    // `null` EST transmis pour effacer la caractéristique côté serveur.
    const payload: Record<string, unknown> = {};
    const put = (key: string, value: number | boolean | string | null | undefined) => {
      if (value !== undefined) payload[key] = value;
    };
    put("weight_grams", logistics.weightGrams);
    put("packed_length_mm", logistics.packedLengthMm);
    put("packed_width_mm", logistics.packedWidthMm);
    put("packed_height_mm", logistics.packedHeightMm);
    put("volume_cm3", logistics.volumeCm3);
    put("package_count", logistics.packageCount);
    put("fragile", logistics.fragile);
    put("requires_installation", logistics.requiresInstallation);
    put("recommended_handlers", logistics.recommendedHandlers);
    put("handling_notes", logistics.handlingNotes);

    const { error } = await this.supabase.rpc("set_variant_logistics", {
      p_variant_id: variantId,
      p_payload: payload,
    });
    throwAsBusiness(error);
  }
}
