"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, ChevronRight, Link2, LogOut, Scale, ShieldCheck, Target, UserRound } from "lucide-react";
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
    <p className="frog-page-subtitle">Ton profil, ta mémoire, tes objectifs et tes connexions sont séparés pour que tu gardes le contrôle.</p>

    <div className="frog-menu-list">
      <Link href="/onboarding" className="frog-menu-card">
        <span className="frog-menu-icon"><UserRound size={20} /></span>
        <span><strong>Profil sportif</strong><small>Sports, disponibilités, matériel, vigilances et préférences</small></span>
        <ChevronRight size={18} />
      </Link>
      <Link href="/profile/memory" className="frog-menu-card">
        <span className="frog-menu-icon"><Brain size={20} /></span>
        <span><strong>Ce que Frog sait de moi</strong><small>Voir, corriger ou supprimer les mémoires du Coach</small></span>
        <ChevronRight size={18} />
      </Link>
      <Link href="/profile/connections" className="frog-menu-card">
        <span className="frog-menu-icon"><Link2 size={20} /></span>
        <span><strong>Connexions & appareils</strong><small>COROS et passerelle TrainingPeaks</small></span>
        <ChevronRight size={18} />
      </Link>
      <Link href="/goals/manage" className="frog-menu-card">
        <span className="frog-menu-icon"><Target size={20} /></span>
        <span><strong>Cycle de préparation</strong><small>Abandonner proprement l’objectif principal et son plan actif</small></span>
        <ChevronRight size={18} />
      </Link>
      <Link href="/profile/account" className="frog-menu-card">
        <span className="frog-menu-icon"><ShieldCheck size={20} /></span>
        <span><strong>Compte & données</strong><small>Contrôle des données et suppression définitive du compte</small></span>
        <ChevronRight size={18} />
      </Link>
      <Link href="/legal" className="frog-menu-card">
        <span className="frog-menu-icon"><Scale size={20} /></span>
        <span><strong>Confidentialité & conditions</strong><small>Informations publiques sur le service et les données</small></span>
        <ChevronRight size={18} />
      </Link>
    </div>

    <section className="frog-card" style={{ marginTop: 18 }}>
      <h2 className="frog-card-title">Compte</h2>
      <p className="frog-card-text">Tes données sont isolées par utilisateur dans PostgreSQL et protégées par RLS.</p>
      <button onClick={signOut} className="frog-button frog-button-secondary frog-button-wide" style={{ marginTop: 18 }}><LogOut size={17} /> Se déconnecter</button>
    </section>
  </main>;
}
