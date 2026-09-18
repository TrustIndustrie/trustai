"use client";

import { useRef, useState, type FormEvent } from "react";
import { useSession } from "@/lib/auth/SessionProvider";

const CONFIRMATION = "SUPPRIMER LES 3 COMMANDES TEST ET LEURS PAIEMENTS FICTIFS";
const TARGETS = [
  ["MAG-AUB-2026-0001", "5fa6fff4-9081-4dee-95ae-20521ad586b8", "9534bcc9-41cd-40bd-8d25-e57eb94f6012", "500 €"],
  ["MAG-AUB-2026-0002", "183f6375-1d36-4842-9bbe-21132d5d3253", "88f53de2-b6bd-45f4-afcc-445815bc3ec7", "1 000 €"],
  ["MAG-AUB-2026-0003", "70e0f34c-7ca1-4062-9d35-cffa62b67a82", "9d5ea1c3-e731-4e21-941e-cc64334d418f", "800 €"],
] as const;

export default function CleanupTestsPage() {
  const { mode, loading, profile, supabase } = useSession();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [auditId, setAuditId] = useState("");
  const inFlight = useRef(false);
  const allowed = mode === "connected" && profile?.active === true && profile.role === "administrateur";
  const expired = Date.now() >= Date.parse("2026-09-25T00:00:00Z");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || !supabase || expired || confirmation !== CONFIRMATION || inFlight.current || auditId) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      // Utilise uniquement la session connectée. Le rôle, l'organisation et les
      // listes blanches sont vérifiés à nouveau par la fonction V2 côté serveur.
      const { data, error: rpcError } = await supabase.rpc("cleanup_cancellation_tests_20260918", {
        p_confirmation: confirmation,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (typeof data !== "string" || !data) throw new Error("Réponse sans identifiant d’audit : faire vérifier le résultat avant toute nouvelle tentative.");
      setAuditId(data);
      setConfirmation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Résultat inconnu : faire vérifier les données avant toute nouvelle tentative.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (loading) return <p>Vérification de la session…</p>;
  if (!allowed) return <p>Cette opération est réservée aux administrateurs actifs connectés. Elle est indisponible en démonstration.</p>;

  return (
    <section className="card space-y-5 p-6">
      <h1 className="text-xl font-bold">Nettoyage temporaire des tests d’annulation</h1>
      <p>Suppression définitive des trois commandes ci-dessous et de leurs paiements fictifs (2 300 €), demandes approuvées, trois lignes et deux parcours d’acquisition. Les douze journaux sont conservés et un audit est ajouté dans la même transaction.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr><th>Commande</th><th>ID commande</th><th>ID paiement</th><th>Montant</th></tr></thead>
          <tbody>{TARGETS.map(([reference, order, payment, amount]) => (
            <tr key={order}><td className="p-2">{reference}</td><td className="p-2 font-mono">{order}</td><td className="p-2 font-mono">{payment}</td><td className="p-2">{amount}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {auditId ? (
        <div role="status" className="space-y-2">
          <p>Suppression confirmée par Supabase. Audit : <code>{auditId}</code></p>
          <p>Transmets cet identifiant pour le contrôle final des suppressions et des treize journaux, puis le retrait de cette page et de la fonction temporaire.</p>
        </div>
      ) : expired ? <p>Cette opération temporaire a expiré.</p> : (
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="cleanup-confirmation" className="block">Pour confirmer, recopie exactement : <strong>{CONFIRMATION}</strong></label>
          <input id="cleanup-confirmation" className="w-full rounded border p-3 text-black" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} />
          <button type="submit" className="btn-primary" disabled={busy || confirmation !== CONFIRMATION}>{busy ? "Suppression en cours…" : "Supprimer uniquement les trois commandes de test"}</button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}
