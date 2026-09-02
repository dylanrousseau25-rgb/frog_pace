"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Memory = {
  id: string;
  category: string;
  content: string;
  source: string;
  confidence: number;
  sensitive: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  preference: "Préférence",
  constraint: "Contrainte",
  injury: "Vigilance",
  training_response: "Réponse à l’entraînement",
  habit: "Habitude",
  equipment: "Matériel",
  schedule: "Organisation",
  coach_learning: "Apprentissage Coach",
};

const SOURCE_LABELS: Record<string, string> = {
  user_declared: "Déclaré par toi",
  feedback: "Issu d’un ressenti",
  coach_inferred: "Inférence Frog",
  activity_pattern: "Tendance observée",
};

export default function MemoryPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [profileSummary, setProfileSummary] = useState<string[]>([]);
  const [category, setCategory] = useState("preference");
  const [content, setContent] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const [{ data: profile }, { data: memoryData }] = await Promise.all([
      supabase.from("athlete_profiles").select("primary_sports,weekly_sessions_target,long_session_day,injuries_and_vigilance,equipment,training_preferences").eq("user_id", auth.user.id).maybeSingle(),
      supabase.from("coach_memories").select("id,category,content,source,confidence,sensitive").eq("user_id", auth.user.id).eq("status", "active").order("created_at", { ascending: false }),
    ]);

    if (profile) {
      const lines: string[] = [];
      const sports = Array.isArray(profile.primary_sports) ? profile.primary_sports : [];
      if (sports.length) lines.push(`Sports : ${sports.join(", ")}`);
      if (profile.weekly_sessions_target) lines.push(`${profile.weekly_sessions_target} créneaux d’entraînement par semaine`);
      if (profile.long_session_day) lines.push(`Sortie longue préférée : jour ${profile.long_session_day}`);
      const injury = Array.isArray(profile.injuries_and_vigilance) ? profile.injuries_and_vigilance[0] as { text?: string } : null;
      if (injury?.text) lines.push(`Vigilance déclarée : ${injury.text}`);
      const equipment = (profile.equipment || {}) as Record<string, boolean>;
      const owned = Object.entries(equipment).filter(([, value]) => value).map(([key]) => key);
      if (owned.length) lines.push(`Matériel disponible : ${owned.join(", ")}`);
      setProfileSummary(lines);
    }
    setMemories((memoryData || []) as Memory[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addMemory(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error: insertError } = await supabase.from("coach_memories").insert({
      user_id: auth.user.id,
      category,
      content: content.trim(),
      source: "user_declared",
      confidence: 1,
      sensitive,
    });
    if (insertError) return setError(insertError.message);
    setContent("");
    setSensitive(false);
    await load();
  }

  async function saveMemory(memory: Memory) {
    setSavingId(memory.id);
    setError(null);
    const { error: updateError } = await supabase.from("coach_memories").update({ content: memory.content.trim(), last_confirmed_at: new Date().toISOString() }).eq("id", memory.id);
    setSavingId(null);
    if (updateError) setError(updateError.message);
  }

  async function removeMemory(id: string) {
    setSavingId(id);
    const { error: updateError } = await supabase.from("coach_memories").update({ status: "deleted" }).eq("id", id);
    setSavingId(null);
    if (updateError) return setError(updateError.message);
    setMemories((current) => current.filter((item) => item.id !== id));
  }

  if (loading) return <main className="frog-centered"><Loader2 className="frog-spin" /> Chargement de la mémoire…</main>;

  return (
    <main>
      <div className="frog-kicker">Mémoire</div>
      <h1 className="frog-page-title">Ce que Frog sait de moi</h1>
      <p className="frog-page-subtitle">Les faits de ton profil, ce que tu déclares et les futurs apprentissages du Coach restent séparés et corrigeables.</p>

      <section className="frog-card frog-card-soft">
        <h2 className="frog-card-title">Profil permanent</h2>
        {profileSummary.length ? <ul className="frog-list">{profileSummary.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="frog-card-text">Ton profil sportif n’est pas encore renseigné.</p>}
      </section>

      <section className="frog-card">
        <h2 className="frog-card-title">Ajouter quelque chose à retenir</h2>
        <form onSubmit={addMemory} className="frog-form" style={{ marginTop: 14 }}>
          <div className="frog-field">
            <label htmlFor="memory-category">Catégorie</label>
            <select id="memory-category" className="frog-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(CATEGORY_LABELS).filter(([key]) => key !== "coach_learning").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <div className="frog-field">
            <label htmlFor="memory-content">Ce que Frog doit retenir</label>
            <textarea id="memory-content" className="frog-textarea" value={content} onChange={(e) => setContent(e.target.value)} maxLength={500} placeholder="Ex. Je préfère faire ma sortie longue le dimanche matin." />
          </div>
          <label className="frog-toggle-row"><span><strong>Information sensible</strong><small>Ex. santé ou vigilance personnelle</small></span><input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} /></label>
          <button className="frog-button frog-button-primary frog-button-wide"><Plus size={18} /> Ajouter à la mémoire</button>
        </form>
      </section>

      <div className="frog-section-heading">
        <h2>Mémoires actives</h2><span>{memories.length}</span>
      </div>

      {memories.length === 0 ? (
        <section className="frog-card frog-empty-mini"><p className="frog-card-text">Aucune mémoire complémentaire pour le moment. Frog en proposera aussi à partir de tes futurs ressentis et tendances.</p></section>
      ) : memories.map((memory) => (
        <section className="frog-card" key={memory.id}>
          <div className="frog-memory-meta">
            <span className="frog-pill">{CATEGORY_LABELS[memory.category] || memory.category}</span>
            <span className="frog-source" data-inferred={memory.source !== "user_declared"}>{SOURCE_LABELS[memory.source] || memory.source}</span>
          </div>
          <textarea
            className="frog-textarea frog-memory-editor"
            value={memory.content}
            onChange={(e) => setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, content: e.target.value } : item))}
            maxLength={500}
          />
          <div className="frog-memory-actions">
            <button type="button" className="frog-button frog-button-secondary" onClick={() => removeMemory(memory.id)} disabled={savingId === memory.id}><Trash2 size={16} /> Supprimer</button>
            <button type="button" className="frog-button frog-button-primary" onClick={() => saveMemory(memory)} disabled={savingId === memory.id}><Save size={16} /> Corriger</button>
          </div>
        </section>
      ))}

      {error && <div className="frog-error" style={{ marginTop: 12 }}>{error}</div>}
    </main>
  );
}
