"use client";

import { useState } from "react";
import { RefreshCw, UserCircle2, Webhook } from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { useToast } from "@/components/ui/Toast";
import { roleLabels } from "@/lib/labels";
import { hasPermission, roleDescriptions } from "@/lib/permissions";

interface SubscriptionRow {
  topic: string;
  subscribed: boolean;
}

/**
 * Carte d'administration Shopify : état des abonnements webhooks + création
 * des abonnements manquants. Les boutons ne sont qu'un confort d'interface :
 * l'autorisation réelle (permission « administrer ») est vérifiée côté
 * serveur par /api/shopify/webhooks, et rien n'est créé au chargement de la
 * page — uniquement sur action explicite.
 */
function ShopifyWebhooksCard() {
  const { notify } = useToast();
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [callbackUrl, setCallbackUrl] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const call = async (method: "GET" | "POST") => {
    setBusy(true);
    try {
      const response = await fetch("/api/shopify/webhooks", { method });
      const body = await response.json();
      if (!response.ok) {
        notify(body.error ?? "Action impossible.", "error");
      } else if (method === "POST") {
        notify(
          body.created.length > 0
            ? `Abonnement(s) créé(s) : ${body.created.join(", ")}.`
            : "Tous les abonnements existent déjà — aucun doublon créé.",
        );
        const check = await fetch("/api/shopify/webhooks");
        const checked = await check.json();
        if (check.ok) {
          setRows(checked.subscriptions);
          setCallbackUrl(checked.callbackUrl);
        }
      } else {
        setRows(body.subscriptions);
        setCallbackUrl(body.callbackUrl);
      }
    } catch {
      notify("Erreur réseau.", "error");
    }
    setBusy(false);
  };

  return (
    <div className="card max-w-xl p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Webhook size={16} aria-hidden style={{ color: "var(--primary)" }} />
        Intégration Shopify — abonnements webhooks
      </h2>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        Vérifie que Shopify envoie bien les commandes et produits vers
        l&apos;application, et crée les abonnements manquants (sans doublon).
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => call("GET")}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden className={busy ? "animate-spin" : undefined} />
          Vérifier les abonnements
        </button>
        {rows && rows.some((r) => !r.subscribed) ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => call("POST")}
            disabled={busy}
          >
            Créer les abonnements manquants
          </button>
        ) : null}
      </div>
      {rows ? (
        <ul className="mt-4 flex flex-col gap-1.5 text-sm">
          {rows.map((row) => (
            <li key={row.topic} className="flex items-center justify-between gap-3">
              <code className="text-xs">{row.topic}</code>
              <Badge tone={row.subscribed ? "success" : "warning"}>
                {row.subscribed ? "Abonné" : "Manquant"}
              </Badge>
            </li>
          ))}
          {callbackUrl ? (
            <li className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              URL de réception : <code>{callbackUrl}</code>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Page « Mon compte » : informations du profil connecté. */
export default function AccountPage() {
  const { db, mode } = useData();
  const { profile, email, loading } = useSession();

  if (mode === "demo") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">Mon compte</h1>
        <div className="card p-6 text-sm">
          <p>
            L&apos;application fonctionne en <strong>mode démonstration</strong> :
            il n&apos;y a pas de compte personnel. En mode connecté (Supabase),
            cette page affichera votre nom, votre rôle et vos magasins
            autorisés.
          </p>
        </div>
      </div>
    );
  }

  if (loading || !db) return <LoadingState />;
  if (!profile) return null; // géré par AppShell (session expirée)

  const primaryStore = db.stores.find((s) => s.id === profile.primaryStoreId);
  const allowedStores = db.stores.filter((s) =>
    profile.allowedStoreIds.includes(s.id),
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Mon compte</h1>
      <div className="card max-w-xl p-6">
        <div className="flex items-center gap-3">
          <UserCircle2 size={40} style={{ color: "var(--primary)" }} aria-hidden />
          <div>
            <p className="text-lg font-semibold">{profile.displayName}</p>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {email ?? "—"}
            </p>
          </div>
        </div>
        <dl className="mt-5 flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--muted)" }}>Rôle</dt>
            <dd className="font-medium">{roleLabels[profile.role]}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--muted)" }}>Magasin principal</dt>
            <dd className="font-medium">{primaryStore?.name ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--muted)" }}>Magasins autorisés</dt>
            <dd className="text-right font-medium">
              {allowedStores.length > 0
                ? allowedStores.map((s) => s.name).join(", ")
                : "Tous (rôle transverse)"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--muted)" }}>État du compte</dt>
            <dd>
              <Badge tone={profile.active ? "success" : "danger"}>
                {profile.active ? "Actif" : "Désactivé"}
              </Badge>
            </dd>
          </div>
        </dl>
        <p
          className="mt-5 rounded-md border p-3 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          {roleDescriptions[profile.role]}
        </p>
      </div>

      {hasPermission(profile.role, "administrer") ? <ShopifyWebhooksCard /> : null}
    </div>
  );
}
