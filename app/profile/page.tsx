"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ProfilePage() {
  const router = useRouter();

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return <main>
    <div className="frog-kicker">Profil</div>
    <h1 className="frog-page-title">Ton espace Frog</h1>
    <p className="frog-page-subtitle">Le prochain lot ajoutera ton profil sportif, tes préférences, tes vigilances et l'écran « Ce que Frog sait de moi ».</p>

    <section className="frog-card">
      <h2 className="frog-card-title">Compte</h2>
      <p className="frog-card-text">Ton compte est isolé par les règles de sécurité de la base. Tes données métier seront toujours liées à ton utilisateur.</p>
      <button onClick={signOut} className="frog-button frog-button-secondary frog-button-wide" style={{ marginTop: 18 }}>Se déconnecter</button>
    </section>
  </main>;
}
