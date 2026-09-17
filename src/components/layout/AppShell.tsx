"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Archive,
  BarChart3,
  BookOpen,
  Building2,
  CheckSquare,
  CircleAlert,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  RotateCcw,
  Store,
  Truck,
  UserCircle2,
  X,
} from "lucide-react";
import { useData } from "@/lib/store/DataProvider";
import { useSession } from "@/lib/auth/SessionProvider";
import { canAccessPage, hasPermission } from "@/lib/permissions";
import { roleLabels } from "@/lib/labels";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TrustLogoTile } from "@/components/ui/TrustLogo";
import { LoadingState } from "@/components/ui/LoadingState";

/**
 * Menu principal recentré sur la logistique (phase 1). Les modules
 * commerciaux recouverts par Skara (achats, relances, encaissements,
 * acquisition, création de commande magasin) ne sont plus listés ici : ils
 * restent accessibles dans Paramètres › Archives. Aucune page n'est
 * supprimée et aucune URL n'est cassée.
 */
const navigation = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/logistique", label: "Logistique", icon: PackageSearch },
  { href: "/commandes", label: "Commandes", icon: ClipboardList },
  { href: "/arrivages", label: "Arrivages", icon: Truck },
  { href: "/catalogue", label: "Référentiel produits", icon: BookOpen },
  { href: "/fournisseurs", label: "Fournisseurs", icon: Building2 },
  { href: "/validations", label: "Validations", icon: CheckSquare },
  { href: "/parametres/archives", label: "Archives", icon: Archive },
];

// Routes d'authentification : rendues sans la coque applicative.
const AUTH_ROUTES = ["/connexion", "/mot-de-passe-oublie", "/reinitialiser-mot-de-passe"];

function NavLinks({
  onNavigate,
  pendingApprovals,
  visibleHrefs,
}: {
  onNavigate?: () => void;
  pendingApprovals: number;
  visibleHrefs: Set<string>;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Navigation principale">
      {navigation
        .filter((item) => visibleHrefs.has(item.href))
        .map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition"
              style={
                active
                  ? { background: "var(--primary-soft)", color: "var(--primary-strong)" }
                  : { color: "var(--muted)" }
              }
              aria-current={active ? "page" : undefined}
            >
              <item.icon size={18} aria-hidden />
              {item.label}
              {item.href === "/validations" && pendingApprovals > 0 ? (
                <span
                  className="ml-auto rounded-full px-2 py-0.5 text-xs font-bold text-white"
                  style={{ background: "var(--danger)" }}
                  aria-label={`${pendingApprovals} demande(s) en attente de validation`}
                >
                  {pendingApprovals}
                </span>
              ) : null}
            </Link>
          );
        })}
    </nav>
  );
}

function CenteredNotice({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <CircleAlert size={32} style={{ color: "var(--warning)" }} aria-hidden />
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {description}
        </p>
        {action}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { db, storeFilter, setStoreFilter, resetDemo, mode, loadError, refresh } =
    useData();
  const session = useSession();
  const { notify } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const profile = session.profile;

  // Rôles mono-magasin : le filtre global est verrouillé sur leur magasin.
  const lockedStoreId =
    mode === "connected" &&
    profile &&
    !hasPermission(profile.role, "voir_tous_magasins") &&
    profile.allowedStoreIds.length === 1
      ? profile.allowedStoreIds[0]
      : null;

  useEffect(() => {
    if (lockedStoreId && storeFilter !== lockedStoreId) {
      setStoreFilter(lockedStoreId);
    }
  }, [lockedStoreId, storeFilter, setStoreFilter]);

  // Pages d'authentification : rendu nu (pas de barre latérale).
  if (AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return <>{children}</>;
  }

  // États du mode connecté.
  if (mode === "connected") {
    if (session.loading) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <LoadingState label="Vérification de la session…" />
        </div>
      );
    }
    if (session.sessionError === "compte_desactive") {
      return (
        <CenteredNotice
          title="Compte désactivé"
          description="Votre compte a été désactivé. Contactez un administrateur Trust Industrie."
          action={
            <button type="button" className="btn-secondary" onClick={session.signOut}>
              Se déconnecter
            </button>
          }
        />
      );
    }
    if (session.sessionError === "profil_absent") {
      return (
        <CenteredNotice
          title="Profil introuvable"
          description="Votre compte existe mais aucun profil employé n'est associé. Un administrateur doit créer votre profil (voir docs/SUPABASE_SETUP.md)."
          action={
            <button type="button" className="btn-secondary" onClick={session.signOut}>
              Se déconnecter
            </button>
          }
        />
      );
    }
    if (!profile) {
      return (
        <CenteredNotice
          title="Session expirée"
          description="Votre session n'est plus valide. Reconnectez-vous pour continuer."
          action={
            <Link href="/connexion" className="btn-primary">
              Se connecter
            </Link>
          }
        />
      );
    }
    if (!canAccessPage(profile.role, pathname)) {
      return (
        <CenteredNotice
          title="Accès refusé"
          description="Votre rôle ne permet pas d'accéder à cette page. (Les données restent de toute façon protégées côté serveur.)"
          action={
            <Link href="/dashboard" className="btn-primary">
              Retour au tableau de bord
            </Link>
          }
        />
      );
    }
    if (loadError && !db) {
      return (
        <CenteredNotice
          title="Erreur réseau"
          description={loadError}
          action={
            <button type="button" className="btn-primary" onClick={() => refresh()}>
              Réessayer
            </button>
          }
        />
      );
    }
  }

  const stores = db?.stores ?? [];
  const pendingApprovals =
    db?.approvalRequests.filter((r) => r.status === "en_attente").length ?? 0;
  const currentStoreName =
    storeFilter === "all"
      ? "Tous les magasins"
      : stores.find((s) => s.id === storeFilter)?.name ?? "Tous les magasins";

  const visibleHrefs = new Set(
    navigation
      .filter((item) =>
        mode === "connected" && profile
          ? canAccessPage(profile.role, item.href)
          : true,
      )
      .map((item) => item.href),
  );

  const primaryStoreName = profile?.primaryStoreId
    ? stores.find((s) => s.id === profile.primaryStoreId)?.name
    : undefined;

  const sidebarContent = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2 px-2">
        <TrustLogoTile size={36} />
        <div>
          <p className="text-sm font-bold leading-tight">TRUST AI</p>
          <p className="text-xs leading-tight" style={{ color: "var(--muted)" }}>
            Trust Industrie
          </p>
        </div>
      </div>
      <NavLinks
        onNavigate={() => setMobileOpen(false)}
        pendingApprovals={pendingApprovals}
        visibleHrefs={visibleHrefs}
      />
      <div className="mt-auto flex flex-col gap-2">
        {mode === "connected" && profile ? (
          <div
            className="rounded-md border p-2.5"
            style={{ borderColor: "var(--border)" }}
          >
            <Link
              href="/compte"
              className="flex items-center gap-2"
              onClick={() => setMobileOpen(false)}
            >
              <UserCircle2 size={20} style={{ color: "var(--primary)" }} aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {profile.displayName}
                </span>
                <span className="block truncate text-xs" style={{ color: "var(--muted)" }}>
                  {roleLabels[profile.role]}
                  {primaryStoreName ? ` · ${primaryStoreName}` : ""}
                </span>
              </span>
            </Link>
            <button
              type="button"
              onClick={session.signOut}
              className="mt-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium transition hover:bg-black/5"
              style={{ color: "var(--muted)" }}
            >
              <LogOut size={14} aria-hidden />
              Se déconnecter
            </button>
          </div>
        ) : (
          <>
            <span
              className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
            >
              <BarChart3 size={13} aria-hidden />
              Mode démonstration
            </span>
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition hover:bg-black/5"
              style={{ color: "var(--muted)" }}
            >
              <RotateCcw size={14} aria-hidden />
              Réinitialiser les données de démo
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Barre latérale (ordinateur) */}
      <aside
        className="sticky top-0 hidden h-screen w-64 shrink-0 border-r lg:block"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        {sidebarContent}
      </aside>

      {/* Menu mobile */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div
            className="absolute inset-y-0 left-0 w-72 shadow-xl"
            style={{ background: "var(--surface)" }}
          >
            <button
              type="button"
              className="absolute right-3 top-3 rounded p-1 hover:bg-black/5"
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
            >
              <X size={20} />
            </button>
            {sidebarContent}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* En-tête */}
        <header
          className="sticky top-0 z-40 flex items-center gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <button
            type="button"
            className="rounded-md border p-2 lg:hidden"
            style={{ borderColor: "var(--border)" }}
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <p className="text-sm font-bold">TRUST AI</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {mode === "demo" ? (
              <span
                className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex lg:hidden"
                style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
              >
                Mode démonstration
              </span>
            ) : profile ? (
              <span
                className="hidden items-center gap-1.5 text-xs font-medium sm:inline-flex"
                style={{ color: "var(--muted)" }}
              >
                {profile.displayName} · {roleLabels[profile.role]}
              </span>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Store size={16} style={{ color: "var(--muted)" }} aria-hidden />
              <span className="sr-only">Filtrer par magasin</span>
              {lockedStoreId ? (
                <span className="text-sm font-medium">{currentStoreName}</span>
              ) : (
                <select
                  className="field-input w-auto py-1.5"
                  value={storeFilter}
                  onChange={(e) => setStoreFilter(e.target.value)}
                  aria-label="Filtrer par magasin"
                >
                  <option value="all">Tous les magasins</option>
                  {stores
                    .filter(
                      (store) =>
                        mode === "demo" ||
                        !profile ||
                        hasPermission(profile.role, "voir_tous_magasins") ||
                        profile.allowedStoreIds.includes(store.id),
                    )
                    .map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                </select>
              )}
            </label>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <p className="mb-4 text-xs lg:hidden" style={{ color: "var(--muted)" }}>
            Magasin affiché : {currentStoreName}
          </p>
          {children}
        </main>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Réinitialiser les données de démonstration ?"
        description="Toutes les commandes, règlements et relances saisis pendant la démo seront remplacés par le jeu de données initial."
        confirmLabel="Réinitialiser"
        danger
        onConfirm={() => {
          resetDemo();
          setConfirmReset(false);
          notify("Données de démonstration réinitialisées.");
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
