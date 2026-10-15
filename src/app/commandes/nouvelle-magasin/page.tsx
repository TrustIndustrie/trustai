"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PenLine, Plus, Trash2 } from "lucide-react";
import { useData, todayIso, BusinessError } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { hasPermission } from "@/lib/permissions";
import { useToast } from "@/components/ui/Toast";
import { LoadingState } from "@/components/ui/LoadingState";
import { Badge } from "@/components/ui/Badge";
import {
  ProductCombobox,
  type ProductSelection,
} from "@/components/ui/ProductCombobox";
import { formatEuro } from "@/lib/format";
import {
  acquisitionSourceLabels,
  fulfillmentModeLabels,
  paymentMethodLabels,
} from "@/lib/labels";
import type {
  AcquisitionSource,
  FulfillmentMode,
  PaymentMethod,
} from "@/lib/types";

interface LineDraft {
  key: number;
  /** Rattachement catalogue ; absent pour une ligne hors catalogue. */
  productId?: string;
  variantId?: string;
  offCatalog: boolean;
  productName: string;
  variant: string;
  reference: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  supplierId: string;
  altSupplierId: string;
  destinationWarehouseId: string;
  comments: string;
}

interface PaymentDraft {
  key: number;
  amount: string;
  date: string;
  method: PaymentMethod;
  comment: string;
}

let keyCounter = 1;

function emptyLine(): LineDraft {
  return {
    key: keyCounter++,
    offCatalog: true,
    productName: "",
    variant: "",
    reference: "",
    quantity: "1",
    unitPrice: "",
    discount: "",
    supplierId: "",
    altSupplierId: "",
    destinationWarehouseId: "",
    comments: "",
  };
}

/** Ligne préremplie depuis le catalogue : produit, variante, SKU, prix,
 *  fournisseur principal et alternatif. La quantité reste modifiable. */
function catalogLine(selection: ProductSelection): LineDraft {
  return {
    key: keyCounter++,
    productId: selection.product.id,
    variantId: selection.variant.id,
    offCatalog: false,
    productName: selection.product.title,
    variant: selection.variant.name,
    reference: selection.variant.sku,
    quantity: "1",
    unitPrice: String(selection.variant.price),
    discount: "",
    supplierId: selection.primarySupplierId ?? "",
    altSupplierId: selection.altSupplierId ?? "",
    destinationWarehouseId: "",
    comments: "",
  };
}

function emptyPayment(): PaymentDraft {
  return {
    key: keyCounter++,
    amount: "",
    date: todayIso(),
    method: "carte_bancaire",
    comment: "",
  };
}

export default function NewStoreOrderPage() {
  const { db, createStoreOrder, mode } = useData();
  const { profile } = useSession();
  const { notify } = useToast();
  const router = useRouter();

  // Mode connecté : l'identité vient de la session (aucun choix manuel) et
  // le magasin est limité aux magasins autorisés du profil. Côté serveur,
  // la fonction RPC re-vérifie tout — l'interface n'est jamais la sécurité.
  const connected = mode === "connected" && profile !== null;
  const allowedStores =
    connected && !hasPermission(profile.role, "voir_tous_magasins")
      ? profile.allowedStoreIds
      : null;
  const canOffCatalog =
    !connected || hasPermission(profile.role, "produit_hors_catalogue");

  const [storeId, setStoreId] = useState("");
  const [storeInitialized, setStoreInitialized] = useState(false);
  if (connected && !storeInitialized && profile.primaryStoreId) {
    setStoreId(profile.primaryStoreId);
    setStoreInitialized(true);
  }
  const [salespersonId, setSalespersonId] = useState("");
  const [orderedAt, setOrderedAt] = useState(todayIso());
  const [desiredAt, setDesiredAt] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>("retrait_magasin");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [discount, setDiscount] = useState("");
  const [acquisitionSource, setAcquisitionSource] = useState<AcquisitionSource | "">("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const salespeople = useMemo(
    () => (db ? db.salespeople.filter((s) => s.active && (!storeId || s.storeId === storeId)) : []),
    [db, storeId],
  );

  const num = (v: string) => {
    const n = parseFloat(v.replace(",", "."));
    return Number.isNaN(n) ? 0 : n;
  };

  const linesTotal = lines.reduce(
    (sum, l) => sum + num(l.quantity) * num(l.unitPrice) - num(l.discount),
    0,
  );
  const total = linesTotal - num(discount) + num(deliveryFee);
  const paid = payments.reduce((sum, p) => sum + num(p.amount), 0);
  // Le RAP affiché n'est JAMAIS négatif : un dépassement des règlements est
  // signalé séparément en rouge et bloque l'enregistrement (la même règle
  // est aussi appliquée côté mutation métier).
  const excess = Math.max(0, Math.round((paid - total) * 100) / 100);
  const rap = Math.max(0, Math.round((total - paid) * 100) / 100);

  if (!db) return <LoadingState />;

  // Recentrage sur la logistique : Skara reste la SOURCE DE CRÉATION des
  // commandes. Le formulaire est conservé (aucune donnée supprimée, aucune
  // URL cassée) mais n'est plus utilisable en mode connecté ; il reste
  // pleinement fonctionnel en mode démonstration pour les essais.
  // La fonction serveur `create_store_order` est de toute façon révoquée :
  // l'interface n'est pas la sécurité.
  if (connected) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/commandes"
          className="inline-flex items-center gap-1 text-sm font-medium"
          style={{ color: "var(--muted)" }}
        >
          <ArrowLeft size={14} aria-hidden />
          Commandes
        </Link>
        <div className="card max-w-2xl p-6">
          <h1 className="text-lg font-bold">Création de commande désactivée</h1>
          <p className="mt-2 text-sm">
            Les commandes clients sont créées dans <strong>Skara</strong>, qui
            reste la source de vérité commerciale. TRUST AI ne les recrée pas :
            il prend le relais sur la logistique — disponibilité des
            marchandises, prise de rendez-vous, tournées et livraisons.
          </p>
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Les commandes déjà enregistrées ici restent consultables : rien
            n&apos;a été supprimé.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/commandes" className="btn-primary">
              Voir les commandes
            </Link>
            <Link href="/logistique" className="btn-secondary">
              Aller à la logistique
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!storeId) errs.push("Le magasin est obligatoire.");
    if (!connected && !salespersonId) {
      errs.push("La vendeuse ou le vendeur est obligatoire.");
    }
    if (!customerName.trim()) errs.push("Le nom du client est obligatoire.");
    if (!phone.trim()) errs.push("Le téléphone du client est obligatoire.");
    if (fulfillmentMode === "livraison" && !address.trim()) {
      errs.push("L'adresse est obligatoire en cas de livraison.");
    }
    if (lines.length === 0) {
      errs.push(
        "Ajoutez au moins un article (depuis le catalogue ou hors catalogue).",
      );
    }
    lines.forEach((l, i) => {
      if (!l.productName.trim()) errs.push(`Article ${i + 1} : le produit est obligatoire.`);
      if (num(l.quantity) <= 0) errs.push(`Article ${i + 1} : la quantité doit être supérieure à zéro.`);
      if (num(l.unitPrice) <= 0) errs.push(`Article ${i + 1} : le prix unitaire est obligatoire.`);
    });
    payments.forEach((p, i) => {
      if (num(p.amount) === 0) errs.push(`Règlement ${i + 1} : le montant est obligatoire.`);
      if (!p.date) errs.push(`Règlement ${i + 1} : la date est obligatoire.`);
    });
    if (paid > total + 0.005) {
      errs.push("Le total des règlements dépasse le total de la commande.");
    }
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSubmitting(true);
    try {
      const order = await createStoreOrder({
        storeId,
        // En mode connecté l'identité est déduite de la session côté serveur.
        salespersonId: connected ? profile.id : salespersonId,
        orderedAt: new Date(`${orderedAt}T10:00:00`).toISOString(),
        desiredAt: desiredAt ? new Date(`${desiredAt}T10:00:00`).toISOString() : undefined,
        customer: {
          name: customerName.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          postalCode: postalCode.trim() || undefined,
          city: city.trim() || undefined,
        },
        fulfillmentMode,
        deliveryFee: num(deliveryFee),
        discount: num(discount),
        acquisitionSource: acquisitionSource || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          offCatalog: l.offCatalog,
          productName: l.productName.trim(),
          variant: l.variant.trim() || undefined,
          reference: l.reference.trim() || undefined,
          quantity: num(l.quantity),
          unitPrice: num(l.unitPrice),
          discount: num(l.discount),
          supplierId: l.supplierId || undefined,
          altSupplierId: l.altSupplierId || undefined,
          destinationWarehouseId: l.destinationWarehouseId || undefined,
          comments: l.comments.trim() || undefined,
        })),
        payments: payments.map((p) => ({
          amount: num(p.amount),
          date: new Date(`${p.date}T12:00:00`).toISOString(),
          method: p.method,
          comment: p.comment.trim() || undefined,
        })),
      });
      notify(`Commande ${order.reference} enregistrée.`);
      router.push(`/commandes/${order.id}`);
    } catch (err) {
      setSubmitting(false);
      notify(
        err instanceof BusinessError
          ? err.message
          : "Impossible d'enregistrer la commande.",
        "error",
      );
    }
  };

  const updateLine = (key: number, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const updatePayment = (key: number, patch: Partial<PaymentDraft>) => {
    setPayments((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <div>
        <h1 className="text-xl font-bold">Nouvelle commande magasin</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          L&apos;identifiant sera généré automatiquement (ex. MAG-HER-2026-0001).
        </p>
      </div>

      {errors.length > 0 ? (
        <div
          className="rounded-md border p-4 text-sm"
          style={{
            borderColor: "var(--danger)",
            background: "var(--danger-soft)",
            color: "var(--danger)",
          }}
          role="alert"
        >
          <p className="font-semibold">Merci de corriger les points suivants :</p>
          <ul className="mt-1 list-inside list-disc">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Magasin, vendeuse/vendeur, dates */}
      <section className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="store" className="field-label">
            Magasin *
          </label>
          <select
            id="store"
            className="field-input"
            value={storeId}
            onChange={(e) => {
              setStoreId(e.target.value);
              setSalespersonId("");
            }}
            required
          >
            <option value="">Choisir un magasin</option>
            {db.stores
              .filter((s) => !allowedStores || allowedStores.includes(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="salesperson" className="field-label">
            Vendeuse / vendeur *
          </label>
          {connected ? (
            <>
              <input
                id="salesperson"
                className="field-input"
                value={profile.displayName}
                readOnly
                aria-readonly
              />
              <p className="field-hint">
                Identité renseignée automatiquement depuis votre compte.
              </p>
            </>
          ) : (
            <>
              <select
                id="salesperson"
                className="field-input"
                value={salespersonId}
                onChange={(e) => setSalespersonId(e.target.value)}
                required
              >
                <option value="">Choisir</option>
                {salespeople.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {storeId === "" ? (
                <p className="field-hint">Choisissez d&apos;abord le magasin.</p>
              ) : null}
            </>
          )}
        </div>
        <div>
          <label htmlFor="orderedAt" className="field-label">
            Date de commande *
          </label>
          <input
            id="orderedAt"
            type="date"
            className="field-input"
            value={orderedAt}
            onChange={(e) => setOrderedAt(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="desiredAt" className="field-label">
            Date souhaitée
          </label>
          <input
            id="desiredAt"
            type="date"
            className="field-input"
            value={desiredAt}
            onChange={(e) => setDesiredAt(e.target.value)}
          />
        </div>
      </section>

      {/* Client */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Client</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="customerName" className="field-label">
              Nom du client *
            </label>
            <input
              id="customerName"
              className="field-input"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="phone" className="field-label">
              Téléphone *
            </label>
            <input
              id="phone"
              type="tel"
              className="field-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="email" className="field-label">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              className="field-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="address" className="field-label">
              Adresse {fulfillmentMode === "livraison" ? "*" : "(facultative)"}
            </label>
            <input
              id="address"
              className="field-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Numéro et rue"
            />
            {fulfillmentMode === "livraison" ? (
              <p className="field-hint">Obligatoire en cas de livraison.</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="postalCode" className="field-label">
                Code postal
              </label>
              <input
                id="postalCode"
                className="field-input"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="city" className="field-label">
                Ville
              </label>
              <input
                id="city"
                className="field-input"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Remise de la marchandise */}
      <section className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
        <div>
          <label htmlFor="fulfillment" className="field-label">
            Mode de remise *
          </label>
          <select
            id="fulfillment"
            className="field-input"
            value={fulfillmentMode}
            onChange={(e) => setFulfillmentMode(e.target.value as FulfillmentMode)}
          >
            {Object.entries(fulfillmentModeLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="deliveryFee" className="field-label">
            Frais de livraison (€)
          </label>
          <input
            id="deliveryFee"
            type="number"
            min="0"
            step="0.01"
            className="field-input"
            value={deliveryFee}
            onChange={(e) => setDeliveryFee(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <label htmlFor="acquisition" className="field-label">
            Source d&apos;acquisition (déclarée par le client)
          </label>
          <select
            id="acquisition"
            className="field-input"
            value={acquisitionSource}
            onChange={(e) => setAcquisitionSource(e.target.value as AcquisitionSource | "")}
          >
            <option value="">Non renseignée</option>
            {Object.entries(acquisitionSourceLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Articles */}
      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold">Articles</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Recherchez un produit du catalogue (nom, SKU, référence fournisseur)
          puis sélectionnez sa variante. La quantité reste modifiable.
        </p>
        <ProductCombobox
          db={db}
          onSelect={(selection) => setLines((ls) => [...ls, catalogLine(selection)])}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {canOffCatalog ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setLines((ls) => [...ls, emptyLine()])}
            >
              <PenLine size={16} aria-hidden />
              Produit hors catalogue
            </button>
          ) : (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              La saisie hors catalogue est réservée aux responsables.
            </p>
          )}
          {canOffCatalog && !connected ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              La saisie libre sera réservée aux responsables en mode connecté.
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {lines.length === 0 ? (
            <p
              className="rounded-md border border-dashed p-4 text-center text-sm"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              Aucun article pour l&apos;instant : sélectionnez un produit du
              catalogue ou ajoutez un produit hors catalogue.
            </p>
          ) : null}
          {lines.map((line, index) => (
            <fieldset
              key={line.key}
              className="rounded-md border p-3"
              style={{ borderColor: "var(--border)" }}
            >
              <legend
                className="flex items-center gap-2 px-1 text-xs font-semibold"
                style={{ color: "var(--muted)" }}
              >
                Article {index + 1}
                {line.offCatalog ? (
                  <Badge tone="warning">Hors catalogue</Badge>
                ) : (
                  <Badge tone="info">Catalogue</Badge>
                )}
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="lg:col-span-2">
                  <label htmlFor={`product-${line.key}`} className="field-label">
                    Produit *
                  </label>
                  <input
                    id={`product-${line.key}`}
                    className="field-input"
                    value={line.productName}
                    onChange={(e) => updateLine(line.key, { productName: e.target.value })}
                    placeholder="Ex. Canapé d'angle Milano"
                    readOnly={!line.offCatalog}
                    aria-readonly={!line.offCatalog}
                  />
                </div>
                <div>
                  <label htmlFor={`variant-${line.key}`} className="field-label">
                    Variante
                  </label>
                  <input
                    id={`variant-${line.key}`}
                    className="field-input"
                    value={line.variant}
                    onChange={(e) => updateLine(line.key, { variant: e.target.value })}
                    placeholder="Coloris, dimensions…"
                    readOnly={!line.offCatalog}
                    aria-readonly={!line.offCatalog}
                  />
                </div>
                <div>
                  <label htmlFor={`reference-${line.key}`} className="field-label">
                    {line.offCatalog ? "Référence" : "SKU"}
                  </label>
                  <input
                    id={`reference-${line.key}`}
                    className="field-input"
                    value={line.reference}
                    onChange={(e) => updateLine(line.key, { reference: e.target.value })}
                    readOnly={!line.offCatalog}
                    aria-readonly={!line.offCatalog}
                  />
                </div>
                <div>
                  <label htmlFor={`quantity-${line.key}`} className="field-label">
                    Quantité *
                  </label>
                  <input
                    id={`quantity-${line.key}`}
                    type="number"
                    min="1"
                    step="1"
                    className="field-input"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`unitPrice-${line.key}`} className="field-label">
                    Prix unitaire (€) *
                  </label>
                  <input
                    id={`unitPrice-${line.key}`}
                    type="number"
                    min="0"
                    step="0.01"
                    className="field-input"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`lineDiscount-${line.key}`} className="field-label">
                    Remise ligne (€)
                  </label>
                  <input
                    id={`lineDiscount-${line.key}`}
                    type="number"
                    min="0"
                    step="0.01"
                    className="field-input"
                    value={line.discount}
                    onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label htmlFor={`supplier-${line.key}`} className="field-label">
                    Fournisseur
                  </label>
                  <select
                    id={`supplier-${line.key}`}
                    className="field-input"
                    value={line.supplierId}
                    onChange={(e) => updateLine(line.key, { supplierId: e.target.value })}
                  >
                    <option value="">À déterminer</option>
                    {db.suppliers
                      .filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`altSupplier-${line.key}`} className="field-label">
                    Fournisseur alternatif
                  </label>
                  <select
                    id={`altSupplier-${line.key}`}
                    className="field-input"
                    value={line.altSupplierId}
                    onChange={(e) => updateLine(line.key, { altSupplierId: e.target.value })}
                  >
                    <option value="">Aucun</option>
                    {db.suppliers
                      .filter((s) => s.active && s.id !== line.supplierId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`warehouse-${line.key}`} className="field-label">
                    Dépôt de destination
                  </label>
                  <select
                    id={`warehouse-${line.key}`}
                    className="field-input"
                    value={line.destinationWarehouseId}
                    onChange={(e) =>
                      updateLine(line.key, { destinationWarehouseId: e.target.value })
                    }
                  >
                    <option value="">À déterminer</option>
                    {db.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label htmlFor={`comments-${line.key}`} className="field-label">
                    Commentaires
                  </label>
                  <input
                    id={`comments-${line.key}`}
                    className="field-input"
                    value={line.comments}
                    onChange={(e) => updateLine(line.key, { comments: e.target.value })}
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-sm font-medium">
                  Sous-total :{" "}
                  {formatEuro(
                    num(line.quantity) * num(line.unitPrice) - num(line.discount),
                  )}
                </p>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm font-medium"
                  style={{ color: "var(--danger)" }}
                  onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                >
                  <Trash2 size={15} aria-hidden />
                  Retirer l&apos;article
                </button>
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      {/* Règlements */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Règlements déjà reçus</h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPayments((ps) => [...ps, emptyPayment()])}
          >
            <Plus size={16} aria-hidden />
            Ajouter un règlement
          </button>
        </div>
        {payments.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Aucun règlement saisi : la commande sera marquée « À payer ».
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {payments.map((payment, index) => (
              <fieldset
                key={payment.key}
                className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-5"
                style={{ borderColor: "var(--border)" }}
              >
                <legend className="px-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
                  Règlement {index + 1}
                </legend>
                <div>
                  <label htmlFor={`payAmount-${payment.key}`} className="field-label">
                    Montant (€) *
                  </label>
                  <input
                    id={`payAmount-${payment.key}`}
                    type="number"
                    step="0.01"
                    className="field-input"
                    value={payment.amount}
                    onChange={(e) => updatePayment(payment.key, { amount: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`payDate-${payment.key}`} className="field-label">
                    Date *
                  </label>
                  <input
                    id={`payDate-${payment.key}`}
                    type="date"
                    className="field-input"
                    value={payment.date}
                    onChange={(e) => updatePayment(payment.key, { date: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`payMethod-${payment.key}`} className="field-label">
                    Moyen de paiement *
                  </label>
                  <select
                    id={`payMethod-${payment.key}`}
                    className="field-input"
                    value={payment.method}
                    onChange={(e) =>
                      updatePayment(payment.key, { method: e.target.value as PaymentMethod })
                    }
                  >
                    {Object.entries(paymentMethodLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`payComment-${payment.key}`} className="field-label">
                    Commentaire
                  </label>
                  <input
                    id={`payComment-${payment.key}`}
                    className="field-input"
                    value={payment.comment}
                    onChange={(e) => updatePayment(payment.key, { comment: e.target.value })}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 pb-2 text-sm font-medium"
                    style={{ color: "var(--danger)" }}
                    onClick={() =>
                      setPayments((ps) => ps.filter((p) => p.key !== payment.key))
                    }
                  >
                    <Trash2 size={15} aria-hidden />
                    Retirer
                  </button>
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </section>

      {/* Totaux */}
      <section className="card p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="discount" className="field-label">
              Remise globale (€)
            </label>
            <input
              id="discount"
              type="number"
              min="0"
              step="0.01"
              className="field-input"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="lg:col-span-3">
            <label htmlFor="notes" className="field-label">
              Notes
            </label>
            <textarea
              id="notes"
              className="field-input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informations utiles pour la livraison, le SAV…"
            />
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <dt className="text-sm" style={{ color: "var(--muted)" }}>
              Total de la commande
            </dt>
            <dd className="text-lg font-semibold">{formatEuro(total)}</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--muted)" }}>
              Règlements reçus
            </dt>
            <dd className="text-lg font-semibold">{formatEuro(paid)}</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--muted)" }}>
              Reste à payer (RAP)
            </dt>
            <dd
              className="text-lg font-semibold"
              style={{
                color:
                  excess > 0
                    ? "var(--danger)"
                    : rap > 0
                      ? "var(--danger)"
                      : "var(--success)",
              }}
            >
              {formatEuro(rap)}
            </dd>
            {excess > 0 ? (
              <p
                className="mt-1 text-sm font-semibold"
                style={{ color: "var(--danger)" }}
                role="alert"
              >
                Le total des règlements dépasse la commande de {formatEuro(excess)}.
                Corrigez les montants avant d&apos;enregistrer.
              </p>
            ) : null}
          </div>
        </dl>
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push("/commandes")}
        >
          Annuler
        </button>
        <button
          type="submit"
          className="btn-primary"
          disabled={submitting || excess > 0}
          title={
            excess > 0
              ? "Le total des règlements dépasse la commande : corrigez les montants."
              : undefined
          }
        >
          {submitting ? "Enregistrement…" : "Enregistrer la commande"}
        </button>
      </div>
    </form>
  );
}
