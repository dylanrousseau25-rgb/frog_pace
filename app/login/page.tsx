"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();

    if (mode === "signup") {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });
      setLoading(false);
      if (signUpError) return setError(signUpError.message);
      if (data.session) {
        router.replace("/today");
        router.refresh();
      } else {
        setMessage("Compte créé. Vérifie ton e-mail pour confirmer ton inscription.");
      }
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) return setError(signInError.message);
    router.replace("/today");
    router.refresh();
  }

  return (
    <main className="frog-auth">
      <div className="frog-auth-logo" aria-hidden>🐸</div>
      <div className="frog-kicker">Frog Pace</div>
      <h1>Ton coach.<br />Ton rythme.</h1>
      <p>Un coach d'endurance personnel qui apprend de tes données, de tes sensations et de tes objectifs.</p>

      <div className="frog-segment" role="tablist" aria-label="Authentification">
        <button type="button" data-active={mode === "login"} onClick={() => setMode("login")}>Connexion</button>
        <button type="button" data-active={mode === "signup"} onClick={() => setMode("signup")}>Créer un compte</button>
      </div>

      <form className="frog-form" onSubmit={submit}>
        {mode === "signup" && (
          <div className="frog-field">
            <label htmlFor="name">Prénom</label>
            <input id="name" className="frog-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Dylan" required />
          </div>
        )}
        <div className="frog-field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="frog-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="toi@exemple.fr" required />
        </div>
        <div className="frog-field">
          <label htmlFor="password">Mot de passe</label>
          <input id="password" className="frog-input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 caractères minimum" required />
        </div>

        {error && <div className="frog-error">{error}</div>}
        {message && <div className="frog-success">{message}</div>}

        <button className="frog-button frog-button-primary frog-button-wide" disabled={loading}>
          {loading ? "Un instant…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
        </button>
      </form>
    </main>
  );
}
