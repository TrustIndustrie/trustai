"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { formatEuro } from "@/lib/format";

/**
 * Contrôle mensuel des données Skara.
 *
 * C'est l'écran qui donne confiance à tout le reste. Il compare, mois par
 * mois, ce que dit la liste des factures et ce que dit le journal comptable.
 * Ces deux exports sont produits indépendamment par Skara, donc leur
 * concordance vaut preuve.
 *
 * L'écart n'est pas une erreur : il doit s'expliquer par les pièces NON
 * ÉMISES, qui sont des pièces de gestion absentes de la comptabilité. Quand
 * l'écart correspond, la colonne le dit. Quand il ne correspond pas, c'est
 * qu'il manque un fichier, et c'est précisément ce qu'il faut voir.
 */

interface MoisMagasin {
  mois: string;
  magasin: string;
  factures: number;
  avoirs: number;
  non_emises: number;
  ttc: number;
  ht: number;
  tva: number;
  marge: number;
  reste_a_regler: number;
  sans_vendeur: number;
  marge_creuse: number;
  marge_creuse_ht: number;
}

interface MoisJournal {
  mois: string;
  ecritures: number;
  debit: number;
  credit: number;
  ventes: number;
  tva: number;
  clients: number;
}

interface Article {
  reference: string;
  title: string | null;
  supplier_label: string | null;
  family_label: string | null;
  sale_price_ttc: number | null;
}

interface Donnees {
  controle: {
    stores: MoisMagasin[];
    journal: MoisJournal[];
    /** Faux quand le profil n'a pas la vision globale : le journal comptable
     *  ne porte pas le magasin, il ne peut donc pas être cloisonné. */
    journal_visible?: boolean;
  };
  articles: {
    totals: { articles: number; sans_cout: number; reconstruits: number; fournis: number };
    rows: Article[];
  };
}

const n = (value: unknown) => Number(value ?? 0);

export default function ControleSkaraPage() {
  const { notify } = useToast();
  const [donnees, setDonnees] = useState<Donnees | null>(null);

  const charger = useCallback(async () => {
    try {
      const response = await fetch("/api/skara/controle");
      const body = (await response.json()) as Donnees & { error?: string };
      if (!response.ok) {
        notify(body.error ?? "Lecture impossible.", "error");
        return;
      }
      setDonnees(body);
    } catch {
      notify("Lecture impossible : réseau indisponible.", "error");
    }
  }, [notify]);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (!donnees) return <LoadingState />;

  const { stores, journal } = donnees.controle;
  const journalVisible = donnees.controle.journal_visible !== false;
  const mois = Array.from(new Set(stores.map((s) => s.mois))).sort().reverse();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Contrôle mensuel Skara</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          La liste des factures et le journal comptable sont produits
          séparément par Skara. Leur concordance vaut donc preuve, et
          l&apos;écart doit s&apos;expliquer par les pièces non émises.
        </p>
      </div>

      {stores.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Rien à contrôler"
          description="Importez au moins une liste de factures."
        />
      ) : (
        <section className="flex flex-col gap-4">
          {mois.map((m) => {
            const lignes = stores.filter((s) => s.mois === m);
            const compta = journal.find((j) => j.mois === m);
            const htListe = lignes.reduce((total, l) => total + n(l.ht), 0);
            const nonEmises = lignes.reduce((total, l) => total + l.non_emises, 0);
            const avoirs = lignes.reduce((total, l) => total + l.avoirs, 0);
            const ecart = compta ? n(compta.ventes) - htListe : null;

            return (
              <article
                key={m}
                className="rounded-xl border p-3"
                style={{ borderColor: "var(--border)", background: "var(--card)" }}
              >
                <h2 className="font-semibold">{m}</h2>

                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: "var(--muted)" }}>
                        <th className="text-left font-medium">Magasin</th>
                        <th className="text-right font-medium">Factures</th>
                        <th className="text-right font-medium">Avoirs</th>
                        <th className="text-right font-medium">Toutes taxes</th>
                        <th className="text-right font-medium">Hors taxes</th>
                        <th className="text-right font-medium">TVA</th>
                        <th className="text-right font-medium">Marge</th>
                        <th className="text-right font-medium">Sans vendeur</th>
                        <th className="text-right font-medium">Coût manquant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((l) => (
                        <tr key={`${l.mois}-${l.magasin}`}>
                          <td className="py-1">{l.magasin}</td>
                          <td className="py-1 text-right">{l.factures}</td>
                          <td className="py-1 text-right">{l.avoirs}</td>
                          <td className="py-1 text-right">{formatEuro(n(l.ttc))}</td>
                          <td className="py-1 text-right">{formatEuro(n(l.ht))}</td>
                          <td className="py-1 text-right">{formatEuro(n(l.tva))}</td>
                          <td className="py-1 text-right">{formatEuro(n(l.marge))}</td>
                          <td className="py-1 text-right">
                            {l.sans_vendeur} / {l.factures + l.avoirs + l.non_emises}
                          </td>
                          <td className="py-1 text-right">
                            {l.marge_creuse} · {formatEuro(n(l.marge_creuse_ht))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 rounded-lg border p-2 text-sm"
                     style={{ borderColor: "var(--border)" }}>
                  {compta ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">Journal comptable</span>
                        {n(compta.debit) === n(compta.credit) ? (
                          <Badge tone="success">équilibré</Badge>
                        ) : (
                          <Badge tone="danger">déséquilibré</Badge>
                        )}
                        <span style={{ color: "var(--muted)" }}>
                          {compta.ecritures} écriture(s)
                        </span>
                      </div>
                      <p>
                        Ventes au journal {formatEuro(n(compta.ventes))}, hors taxes
                        de la liste {formatEuro(htListe)}, écart{" "}
                        {formatEuro(ecart ?? 0)}.
                      </p>
                      <p style={{ color: "var(--muted)" }}>
                        {nonEmises + avoirs > 0
                          ? `Cet écart doit correspondre aux ${nonEmises} pièce(s) non émise(s) et ${avoirs} avoir(s), que la comptabilité ne porte pas.`
                          : "Aucune pièce non émise ni avoir ce mois-ci : l'écart devrait être nul."}
                      </p>
                    </div>
                  ) : (
                    <p style={{ color: "var(--muted)" }}>
                      {journalVisible
                        ? "Aucune écriture comptable importée pour ce mois. Le recoupement est impossible : retéléchargez le journal depuis l'historique de Skara."
                        : "Le journal comptable ne distingue pas les magasins : il n'est donc montré qu'aux profils ayant la vision de tous les magasins. Le recoupement n'est pas disponible ici."}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Articles sans coût d&apos;achat</h2>
        <p className="mb-2 text-sm" style={{ color: "var(--muted)" }}>
          {donnees.articles.totals.sans_cout} article(s) sur{" "}
          {donnees.articles.totals.articles} n&apos;ont aucun coût exploitable, dont{" "}
          {donnees.articles.totals.reconstruits} dont le coût a été reconstruit
          depuis le prix brut. Compléter ces fiches dans Skara rend la marge
          calculable. Les plus chers d&apos;abord : c&apos;est l&apos;ordre
          d&apos;impact.
        </p>
        {donnees.articles.rows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Aucun article sans coût"
            description="Tous les articles importés ont un coût d'achat exploitable."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border"
               style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="p-2 text-left font-medium">Référence</th>
                  <th className="p-2 text-left font-medium">Article</th>
                  <th className="p-2 text-left font-medium">Fournisseur</th>
                  <th className="p-2 text-left font-medium">Famille</th>
                  <th className="p-2 text-right font-medium">Prix de vente</th>
                </tr>
              </thead>
              <tbody>
                {donnees.articles.rows.map((a) => (
                  <tr key={a.reference}>
                    <td className="p-2">{a.reference}</td>
                    <td className="p-2">{a.title ?? "sans titre"}</td>
                    <td className="p-2">{a.supplier_label ?? "—"}</td>
                    <td className="p-2">{a.family_label ?? "—"}</td>
                    <td className="p-2 text-right">
                      {formatEuro(n(a.sale_price_ttc))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
