"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAppMode } from "@/lib/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** Page ouverte depuis le lien e-mail de réinitialisation Supabase. */
export default function ResetPasswordPage() {
  const mode = getAppMode();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          `Impossible de mettre à jour le mot de passe : ${updateError.message}. Le lien a peut-être expiré — refaites une demande depuis « Mot de passe oublié ».`,
        );
        setSubmitting(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Erreur réseau : réessayez dans un instant.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-bold">Nouveau mot de passe</h1>
        {mode === "demo" ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Mode démonstration : aucune connexion n&apos;est requise.{" "}
            <Link href="/dashboard" style={{ color: "var(--primary)" }}>
              Retour à l&apos;application
            </Link>
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error ? (
              <p className="text-sm font-medium" style={{ color: "var(--danger)" }} role="alert">
                {error}
              </p>
            ) : null}
            <div>
              <label htmlFor="password" className="field-label">
                Nouveau mot de passe
              </label>
              <input
                id="password"
                type="password"
                className="field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <label htmlFor="confirm" className="field-label">
                Confirmer le mot de passe
              </label>
              <input
                id="confirm"
                type="password"
                className="field-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Mise à jour…" : "Enregistrer le mot de passe"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
