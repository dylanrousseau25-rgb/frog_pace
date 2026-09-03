import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function n(value: unknown) { const x = Number(value); return Number.isFinite(x) ? x : null; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function km(value: unknown) { const x = n(value); return x == null ? "—" : `${(x / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`; }
function duration(seconds: unknown) {
  const x = n(seconds); if (x == null) return "—";
  const h = Math.floor(x / 3600), m = Math.round((x % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}
function pace(seconds: unknown) {
  const x = n(seconds); if (x == null || x <= 0) return "—";
  const m = Math.floor(x / 60), s = Math.round(x % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function coachReply(message: string, rawContext: unknown) {
  const ctx = asObject(rawContext);
  const goal = asObject(ctx.goal);
  const fitness = asObject(ctx.fitness);
  const review = asObject(ctx.weeklyReview);
  const today = asObject(ctx.todayWorkout);
  const next = asObject(ctx.nextWorkout);
  const progress = asObject(ctx.progress);
  const current28 = asObject(progress.current28);
  const previous28 = asObject(progress.previous28);
  const last90 = asObject(progress.last90);
  const year = asObject(progress.year);
  const plan = asObject(progress.plan);
  const analyses = asObject(progress.analyses);
  const race = asObject(ctx.raceStrategy);
  const segments = Array.isArray(race.segments) ? race.segments.map(asObject) : [];
  const q = normalize(message);

  const recovery = n(fitness.recovery);
  const loadRatio = n(fitness.load_ratio ?? fitness.loadRatio);
  const readiness = n(review.readiness_score ?? review.readinessScore);
  const reviewDecision = text(review.decision);
  const targetName = text(goal.event_name ?? goal.eventName) || "ton objectif";
  const targetDuration = duration(goal.target_duration_s ?? goal.targetDurationS);

  if (/aujourd|seance|entrainement|entrainement du jour|quoi faire/.test(q)) {
    const workout = Object.keys(today).length ? today : next;
    if (!Object.keys(workout).length) return "Je n’ai pas de séance future planifiée à te proposer pour le moment. Vérifie l’onglet Plan ou régénère le plan si nécessaire.";
    const when = text(workout.scheduled_date) ? new Date(`${text(workout.scheduled_date)}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "prochainement";
    const metric = workout.distance_m ? km(workout.distance_m) : duration(workout.duration_s);
    return `La séance de référence est **${text(workout.title) || "séance planifiée"}**, prévue ${when}, ${metric}. ${text(workout.description)}${recovery != null ? `\n\nTa récupération COROS est actuellement à **${Math.round(recovery)} %**` : ""}${reviewDecision ? ` et le bilan hebdomadaire recommande **${reviewDecision === "maintain" ? "de maintenir le plan" : "une adaptation"}**.` : "."}`;
  }

  if (/forme|fatigue|recuper|hrv|charge|fraicheur|etat/.test(q)) {
    const pieces = [
      recovery != null ? `récupération COROS **${Math.round(recovery)} %**` : null,
      loadRatio != null ? `ratio de charge **${loadRatio.toFixed(2)}**` : null,
      readiness != null ? `disponibilité Frog **${Math.round(readiness)}/100**` : null,
      text(asObject(fitness.hrv).evaluation) ? `HRV **${text(asObject(fitness.hrv).evaluation)}**` : null,
    ].filter(Boolean);
    return `Les derniers signaux disponibles donnent : ${pieces.join(" · ") || "pas encore assez de données récentes"}. ${text(review.summary) || "Frog continuera à croiser ces métriques avec tes retours après séance."}\n\nJe traite ces indicateurs comme des signaux d’entraînement, pas comme un diagnostic médical.`;
  }

  if (/progres|progression|evolution|volume|km|kilomet/.test(q)) {
    const cur = n(current28.runningDistanceM) || 0;
    const prev = n(previous28.runningDistanceM) || 0;
    const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    return `Sur les **28 derniers jours**, tu as enregistré **${km(cur)} de course** sur **${n(current28.activities) || 0} activités tous sports**.${pct != null ? ` C’est **${pct > 0 ? "+" : ""}${pct} %** par rapport aux 28 jours précédents.` : ""}\n\nSur 90 jours, ta plus longue sortie course est **${km(last90.longestRunM)}**. Sur 12 mois, elle est **${km(year.longestRunM)}**. Côté plan, **${n(plan.completedDue) || 0}/${n(plan.plannedDue) || 0}** séance(s) due(s) sont confirmées.${n(analyses.avgAdherence) != null ? ` L’adhérence moyenne analysée est de **${Math.round(n(analyses.avgAdherence) || 0)}/100**.` : ""}`;
  }

  if (/race|course|strategie|objectif|chrono|20 km|20km|allure/.test(q)) {
    if (!Object.keys(race).length) return `Ton objectif actif est **${targetName}**${targetDuration !== "—" ? ` en ${targetDuration}` : ""}. La stratégie Race Day n’a pas encore été générée : ouvre Race Day pour la créer à partir des données actuelles.`;
    const lines = segments.map((segment) => `${n(segment.fromKm)}–${n(segment.toKm)} km : **${pace(segment.paceSecondsPerKm)}**`).join(" · ");
    return `Pour **${targetName}**, la stratégie actuelle vise **${duration(race.target_duration_s)}** avec une allure moyenne de **${pace(race.target_pace_s_per_km)}**.\n\n${lines}\n\nLe principe est un départ contrôlé puis une accélération progressive, sans forcer le dernier bloc si les sensations ne le permettent pas. La stratégie peut être régénérée après les prochaines semaines pour intégrer ta forme la plus récente.`;
  }

  if (/plan|semaine|adapt|pourquoi|modifier/.test(q)) {
    return `Le bilan hebdomadaire actuel est **${reviewDecision === "maintain" ? "maintien" : reviewDecision || "non calculé"}**${readiness != null ? ` avec une disponibilité de **${Math.round(readiness)}/100**` : ""}. ${text(review.summary)} ${text(review.recommendation)}\n\nFrog ne déplace pas librement les séances en V1 : il peut uniquement maintenir, alléger ou transformer une séance future sur sa date actuelle, après validation explicite.`;
  }

  return `Voici ma lecture actuelle : ton objectif est **${targetName}**${targetDuration !== "—" ? ` en ${targetDuration}` : ""}. ${recovery != null ? `Récupération **${Math.round(recovery)} %**` : ""}${loadRatio != null ? ` · ratio de charge **${loadRatio.toFixed(2)}**` : ""}. ${text(review.summary)}\n\nTu peux me demander par exemple : **« Que dois-je faire aujourd’hui ? »**, **« Comment est ma forme ? »**, **« Où en est ma progression ? »** ou **« Quelle stratégie pour la course ? »**.`;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let body: { threadId?: string | null; message?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Requête invalide" }, { status: 400 }); }
  const message = String(body.message || "").trim();
  if (!message || message.length > 2000) return NextResponse.json({ error: "Message invalide" }, { status: 400 });

  let threadId = body.threadId || null;
  if (threadId) {
    const { data: thread } = await supabase.from("coach_threads").select("id").eq("id", threadId).eq("user_id", auth.user.id).maybeSingle();
    if (!thread) return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
  } else {
    const title = message.length > 58 ? `${message.slice(0, 55)}…` : message;
    const { data: thread, error } = await supabase.from("coach_threads").insert({ user_id: auth.user.id, title }).select("id").single();
    if (error || !thread) return NextResponse.json({ error: error?.message || "Création de la conversation impossible" }, { status: 400 });
    threadId = thread.id;
  }

  const { error: userMessageError } = await supabase.from("coach_messages").insert({ thread_id: threadId, user_id: auth.user.id, role: "user", content: message });
  if (userMessageError) return NextResponse.json({ error: userMessageError.message }, { status: 400 });

  const { data: context, error: contextError } = await supabase.rpc("get_coach_context");
  if (contextError) return NextResponse.json({ error: contextError.message }, { status: 400 });
  const reply = coachReply(message, context);

  const { error: assistantError } = await supabase.rpc("append_coach_assistant_message", {
    p_thread_id: threadId,
    p_content: reply,
    p_context: { engine: "coach-engine-v1", context }
  });
  if (assistantError) return NextResponse.json({ error: assistantError.message }, { status: 400 });

  return NextResponse.json({ threadId, reply, engine: "coach-engine-v1" });
}
