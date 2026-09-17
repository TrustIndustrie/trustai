"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { getAppMode } from "@/lib/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const mode = getAppMode();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${window.location.origin}/reinitialiser-mot-de-passe` },
      );
      if (resetError) {
        setError(`Envoi impossible : ${resetError.message}`);
      } else {
        setSent(true);
      }
    } catch {
      setError("Erreur réseau : réessayez dans un instant.");
    }
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-bold">Mot de passe oublié</h1>
        {mode === "demo" ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Mode démonstration : aucune connexion n&apos;est requise.{" "}
            <Link href="/dashboard" style={{ color: "var(--primary)" }}>
              Retour à l&apos;application
            </Link>
          </p>
        ) : sent ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Si un compte existe pour <strong>{email}</strong>, un e-mail de
              réinitialisation vient d&apos;être envoyé. Ouvrez le lien reçu pour
              choisir un nouveau mot de passe.
            </p>
            <Link href="/connexion" className="btn-secondary">
              <ArrowLeft size={16} aria-hidden />
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Saisissez votre adresse e-mail professionnelle : un lien de
              réinitialisation vous sera envoyé.
            </p>
            {error ? (
              <p className="text-sm font-medium" style={{ color: "var(--danger)" }} role="alert">
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
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Envoi…" : "Envoyer le lien"}
            </button>
            <Link
              href="/connexion"
              className="text-center text-sm font-medium"
              style={{ color: "var(--primary)" }}
            >
              Retour à la connexion
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
