"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LogIn } from "lucide-react";
import { getAppMode } from "@/lib/config";
import { TrustLogoTile } from "@/components/ui/TrustLogo";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Connexion (mode connecté uniquement).
 * Il n'existe AUCUNE inscription publique : les comptes sont créés ou
 * invités par un administrateur Trust (voir docs/SUPABASE_SETUP.md).
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(
          authError.message === "Invalid login credentials"
            ? "E-mail ou mot de passe incorrect."
            : `Connexion impossible : ${authError.message}`,
        );
        setSubmitting(false);
        return;
      }
      // Redirection vers la page demandée avant la connexion.
      const next = searchParams.get("next");
      const target = next && next.startsWith("/") ? next : "/dashboard";
      router.push(target);
      router.refresh();
    } catch {
      setError("Erreur réseau : réessayez dans un instant.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error ? (
        <p
          className="rounded-md border p-3 text-sm font-medium"
          style={{
            borderColor: "var(--danger)",
            background: "var(--danger-soft)",
            color: "var(--danger)",
          }}
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div>
        <label htmlFor="email" className="field-label">
          Adresse e-mail
        </label>
        <input
          id="email"
          type="email"
          className="field-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>
      <div>
        <label htmlFor="password" className="field-label">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          className="field-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={submitting}>
        <LogIn size={16} aria-hidden />
        {submitting ? "Connexion…" : "Se connecter"}
      </button>
      <Link
        href="/mot-de-passe-oublie"
        className="text-center text-sm font-medium"
        style={{ color: "var(--primary)" }}
      >
        Mot de passe oublié ?
      </Link>
      <p className="text-center text-xs" style={{ color: "var(--muted)" }}>
        Les comptes sont créés par un administrateur Trust Industrie.
        Aucune inscription publique.
      </p>
    </form>
  );
}

export default function LoginPage() {
  const mode = getAppMode();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2">
          <TrustLogoTile size={40} />
          <div>
            <p className="font-bold leading-tight">TRUST AI</p>
            <p className="text-xs leading-tight" style={{ color: "var(--muted)" }}>
              Trust Industrie
            </p>
          </div>
        </div>
        {mode === "demo" ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              L&apos;application fonctionne en <strong>mode démonstration</strong> :
              aucune connexion n&apos;est requise.
            </p>
            <p style={{ color: "var(--muted)" }}>
              Le mode connecté s&apos;active en configurant les variables Supabase
              (voir docs/SUPABASE_SETUP.md).
            </p>
            <Link href="/dashboard" className="btn-primary">
              Ouvrir la démonstration
            </Link>
          </div>
        ) : (
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        )}
      </div>
    </div>
  );
}
