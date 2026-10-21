"use client";

import { useState } from "react";
import { Ruler } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { BusinessError } from "@/lib/store/DataProvider";
import type { ProductVariant, VariantLogistics } from "@/lib/types";

/**
 * Saisie du référentiel logistique d'une variante (poids, dimensions
 * emballées, colis, manutention).
 *
 * L'écriture passe TOUJOURS par `setVariantLogistics` : en mode connecté,
 * c'est la fonction serveur `set_variant_logistics` qui valide les valeurs,
 * vérifie la permission « gerer_referentiel_logistique » et l'appartenance à
 * l'organisation. Aucune mise à jour directe de la table depuis le navigateur.
 */
export function VariantLogisticsDialog({
  variant,
  onClose,
}: {
  variant: ProductVariant;
  onClose: () => void;
}) {
  const { setVariantLogistics } = useData();
  const { notify } = useToast();
  const current = variant.logistics ?? {};
  const [form, setForm] = useState({
    weightGrams: current.weightGrams?.toString() ?? "",
    packedLengthMm: current.packedLengthMm?.toString() ?? "",
    packedWidthMm: current.packedWidthMm?.toString() ?? "",
    packedHeightMm: current.packedHeightMm?.toString() ?? "",
    packageCount: current.packageCount?.toString() ?? "",
    recommendedHandlers: current.recommendedHandlers?.toString() ?? "",
    fragile: current.fragile ?? false,
    requiresInstallation: current.requiresInstallation ?? false,
    handlingNotes: current.handlingNotes ?? "",
  });
  const [busy, setBusy] = useState(false);

  /**
   * Un champ vidé signifie « effacer cette caractéristique » : on transmet
   * `null` explicite, jamais `undefined` (qui signifierait « ne pas
   * toucher »). Les décimales sont REFUSÉES, jamais arrondies en silence —
   * la fonction serveur applique la même règle.
   */
  const parseField = (
    value: string,
    label: string,
  ): number | null | { error: string } => {
    const trimmed = value.trim();
    if (trimmed === "") return null; // effacement volontaire
    const normalized = trimmed.replace(",", ".");
    if (!/^-?\d+$/.test(normalized)) {
      return {
        error: /^-?\d*[.,]\d+$/.test(trimmed)
          ? `${label} : nombre entier attendu (aucun arrondi automatique).`
          : `${label} : valeur numérique attendue.`,
      };
    }
    return Number(normalized);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fields: [keyof VariantLogistics, string, string][] = [
      ["weightGrams", form.weightGrams, "Poids (g)"],
      ["packedLengthMm", form.packedLengthMm, "Longueur emballée (mm)"],
      ["packedWidthMm", form.packedWidthMm, "Largeur emballée (mm)"],
      ["packedHeightMm", form.packedHeightMm, "Hauteur emballée (mm)"],
      ["packageCount", form.packageCount, "Nombre de colis"],
      ["recommendedHandlers", form.recommendedHandlers, "Livreurs conseillés"],
    ];
    const payload: VariantLogistics = {
      fragile: form.fragile,
      requiresInstallation: form.requiresInstallation,
      handlingNotes: form.handlingNotes.trim() || null,
    };
    for (const [key, raw, label] of fields) {
      const parsed = parseField(raw, label);
      if (parsed !== null && typeof parsed === "object") {
        notify(parsed.error, "error");
        return;
      }
      (payload as Record<string, unknown>)[key] = parsed;
    }
    setBusy(true);
    try {
      await setVariantLogistics(variant.id, payload);
      notify("Caractéristiques logistiques enregistrées.");
      onClose();
    } catch (error) {
      notify(
        error instanceof BusinessError || error instanceof Error
          ? error.message
          : "Enregistrement impossible.",
        "error",
      );
    }
    setBusy(false);
  };

  const field = (
    key: keyof typeof form,
    label: string,
    hint?: string,
  ) => (
    <label className="flex flex-col">
      <span className="field-label">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        className="field-input"
        value={form[key] as string}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(20,18,14,0.45)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Caractéristiques logistiques — ${variant.name}`}
    >
      <form
        onSubmit={submit}
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
      >
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Ruler size={17} aria-hidden style={{ color: "var(--primary)" }} />
          Caractéristiques logistiques
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {variant.name} · SKU {variant.sku}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("weightGrams", "Poids (g)", "Article emballé")}
          {field("packageCount", "Nombre de colis")}
          {field("packedLengthMm", "Longueur emballée (mm)")}
          {field("packedWidthMm", "Largeur emballée (mm)")}
          {field("packedHeightMm", "Hauteur emballée (mm)")}
          {field("recommendedHandlers", "Livreurs conseillés", "1 à 4")}
        </div>

        <div className="mt-3 flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.fragile}
              onChange={(e) => setForm({ ...form, fragile: e.target.checked })}
            />
            Fragile
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.requiresInstallation}
              onChange={(e) =>
                setForm({ ...form, requiresInstallation: e.target.checked })
              }
            />
            Nécessite une installation
          </label>
        </div>

        <label className="mt-3 flex flex-col">
          <span className="field-label">Consignes de manutention</span>
          <textarea
            className="field-input"
            rows={2}
            value={form.handlingNotes}
            onChange={(e) => setForm({ ...form, handlingNotes: e.target.value })}
          />
        </label>

        <p className="field-hint mt-3">
          Le volume est calculé automatiquement dès que les trois dimensions
          emballées sont renseignées.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            Enregistrer
          </button>
        </div>
      </form>
    </div>
  );
}
