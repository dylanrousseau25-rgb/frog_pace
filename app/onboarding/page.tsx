"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const SPORTS = [
  ["running", "Course route"],
  ["trail", "Trail"],
  ["road_cycling", "Vélo route"],
  ["gravel", "Gravel"],
] as const;

const DAYS = [
  [1, "Lun"], [2, "Mar"], [3, "Mer"], [4, "Jeu"], [5, "Ven"], [6, "Sam"], [7, "Dim"],
] as const;

const EQUIPMENT = [
  ["road_bike", "Vélo route"],
  ["gravel_bike", "Gravel"],
  ["treadmill", "Tapis"],
  ["home_strength", "Matériel renfo"],
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sports, setSports] = useState<string[]>([]);
  const [level, setLevel] = useState("intermediate");
  const [weeklySessions, setWeeklySessions] = useState(5);
  const [longDay, setLongDay] = useState(7);
  const [days, setDays] = useState<number[]>([2, 3, 4, 6, 7]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [injuryText, setInjuryText] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("flexible");
  const [strength, setStrength] = useState(true);
  const [crossTraining, setCrossTraining] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase
        .from("athlete_profiles")
        .select("primary_sports,experience_level,weekly_sessions_target,long_session_day,availability,injuries_and_vigilance,equipment,training_preferences")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (!active) return;
      if (data) {
        if (Array.isArray(data.primary_sports)) setSports(data.primary_sports);
        if (data.experience_level) setLevel(data.experience_level);
        if (data.weekly_sessions_target) setWeeklySessions(data.weekly_sessions_target);
        if (data.long_session_day) setLongDay(data.long_session_day);
        const availability = data.availability as { days?: number[] } | null;
        if (availability?.days?.length) setDays(availability.days);
        const injury = Array.isArray(data.injuries_and_vigilance) ? data.injuries_and_vigilance[0] as { text?: string } : null;
        if (injury?.text) setInjuryText(injury.text);
        const eq = (data.equipment || {}) as Record<string, boolean>;
        setEquipment(Object.entries(eq).filter(([, enabled]) => enabled).map(([key]) => key));
        const prefs = (data.training_preferences || {}) as Record<string, unknown>;
        if (typeof prefs.timeOfDay === "string") setTimeOfDay(prefs.timeOfDay);
        if (typeof prefs.strength === "boolean") setStrength(prefs.strength);
        if (typeof prefs.crossTraining === "boolean") setCrossTraining(prefs.crossTraining);
      }
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [router, supabase]);

  function toggleString(value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) {
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function toggleDay(value: number) {
    setDays((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value].sort());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!sports.length) return setError("Choisis au moins un sport.");
    if (!days.length) return setError("Choisis au moins un jour disponible.");
    setSaving(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setSaving(false);
      router.replace("/login");
      return;
    }

    const equipmentObject = Object.fromEntries(EQUIPMENT.map(([key]) => [key, equipment.includes(key)]));
    const injuries = injuryText.trim() ? [{ text: injuryText.trim(), source: "user_declared" }] : [];

    const { error: profileError } = await supabase
      .from("athlete_profiles")
      .update({
        primary_sports: sports,
        experience_level: level,
        weekly_sessions_target: weeklySessions,
        long_session_day: longDay,
        availability: { days },
        injuries_and_vigilance: injuries,
        equipment: equipmentObject,
        training_preferences: { timeOfDay, strength, crossTraining },
      })
      .eq("user_id", auth.user.id);

    if (profileError) {
      setSaving(false);
      return setError(profileError.message);
    }

    const { error: userError } = await supabase
      .from("user_profiles")
      .update({ onboarding_completed: true })
      .eq("user_id", auth.user.id);

    setSaving(false);
    if (userError) return setError(userError.message);
    router.replace("/today");
    router.refresh();
  }

  if (loading) {
    return <main className="frog-centered"><Loader2 className="frog-spin" /> <span>Préparation de ton profil…</span></main>;
  }

  return (
    <main>
      <div className="frog-kicker">Profil athlète</div>
      <h1 className="frog-page-title">Faisons connaissance.</h1>
      <p className="frog-page-subtitle">Ces données servent de garde-fous au moteur sportif. Tu pourras tout modifier ensuite.</p>

      <form onSubmit={submit} className="frog-stack">
        <section className="frog-card">
          <h2 className="frog-card-title">Tes sports</h2>
          <p className="frog-card-text">Sélectionne ceux que Frog peut intégrer à ton entraînement.</p>
          <div className="frog-chip-grid">
            {SPORTS.map(([value, label]) => (
              <button key={value} type="button" className="frog-chip" data-active={sports.includes(value)} onClick={() => toggleString(value, setSports)}>
                {sports.includes(value) && <Check size={15} />} {label}
              </button>
            ))}
          </div>
        </section>

        <section className="frog-card">
          <h2 className="frog-card-title">Ton rythme actuel</h2>
          <div className="frog-form-grid">
            <div className="frog-field">
              <label htmlFor="level">Niveau</label>
              <select id="level" className="frog-input" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="beginner">Débutant / reprise</option>
                <option value="intermediate">Intermédiaire</option>
                <option value="advanced">Avancé</option>
              </select>
            </div>
            <div className="frog-field">
              <label htmlFor="weekly">Créneaux par semaine</label>
              <input id="weekly" className="frog-input" type="number" min={1} max={14} value={weeklySessions} onChange={(e) => setWeeklySessions(Number(e.target.value))} />
            </div>
          </div>
          <div className="frog-field" style={{ marginTop: 14 }}>
            <label>Jours généralement disponibles</label>
            <div className="frog-day-row">
              {DAYS.map(([value, label]) => <button key={value} type="button" className="frog-day" data-active={days.includes(value)} onClick={() => toggleDay(value)}>{label}</button>)}
            </div>
          </div>
          <div className="frog-field" style={{ marginTop: 14 }}>
            <label htmlFor="long-day">Jour préféré pour la sortie longue</label>
            <select id="long-day" className="frog-input" value={longDay} onChange={(e) => setLongDay(Number(e.target.value))}>
              {DAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </section>

        <section className="frog-card">
          <h2 className="frog-card-title">Matériel</h2>
          <div className="frog-chip-grid">
            {EQUIPMENT.map(([value, label]) => (
              <button key={value} type="button" className="frog-chip" data-active={equipment.includes(value)} onClick={() => toggleString(value, setEquipment)}>
                {equipment.includes(value) && <Check size={15} />} {label}
              </button>
            ))}
          </div>
        </section>

        <section className="frog-card">
          <h2 className="frog-card-title">Vigilances</h2>
          <p className="frog-card-text">Indique une gêne, ancienne blessure ou zone à surveiller. Frog ne pose pas de diagnostic.</p>
          <div className="frog-field" style={{ marginTop: 14 }}>
            <label htmlFor="injury">À surveiller</label>
            <textarea id="injury" className="frog-textarea" value={injuryText} onChange={(e) => setInjuryText(e.target.value)} placeholder="Ex. tibia sensible après une forte hausse de volume…" maxLength={500} />
          </div>
        </section>

        <section className="frog-card">
          <h2 className="frog-card-title">Préférences</h2>
          <div className="frog-field" style={{ marginTop: 12 }}>
            <label htmlFor="time">Moment préféré</label>
            <select id="time" className="frog-input" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)}>
              <option value="flexible">Flexible</option>
              <option value="morning">Matin</option>
              <option value="lunch">Midi</option>
              <option value="evening">Soir</option>
            </select>
          </div>
          <label className="frog-toggle-row"><span><strong>Renforcement</strong><small>Autoriser Frog à l’intégrer au plan</small></span><input type="checkbox" checked={strength} onChange={(e) => setStrength(e.target.checked)} /></label>
          <label className="frog-toggle-row"><span><strong>Cross-training</strong><small>Vélo / gravel comme complément quand pertinent</small></span><input type="checkbox" checked={crossTraining} onChange={(e) => setCrossTraining(e.target.checked)} /></label>
        </section>

        <section className="frog-card frog-card-soft">
          <div className="frog-kicker">Ce que Frog a compris</div>
          <p className="frog-summary-line"><strong>{sports.length || 0}</strong> sport(s), <strong>{weeklySessions}</strong> créneau(x) / semaine, sortie longue plutôt <strong>{DAYS.find(([day]) => day === longDay)?.[1]}</strong>.</p>
          <p className="frog-card-text">Ce résumé devient ton profil permanent. Les apprentissages futurs seront séparés et identifiés comme déclarés ou inférés.</p>
        </section>

        {error && <div className="frog-error">{error}</div>}
        <button className="frog-button frog-button-primary frog-button-wide" disabled={saving}>
          {saving ? <><Loader2 size={18} className="frog-spin" /> Enregistrement…</> : "Valider mon profil"}
        </button>
      </form>
    </main>
  );
}
