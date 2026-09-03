"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, Loader2, MessageCircle, Plus, Send } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Message = { id: string; role: "user" | "assistant"; content: string; created_at: string };
type Thread = { id: string; title: string };
type CoachContext = Record<string, unknown>;

function obj(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function number(value: unknown) { const x = Number(value); return Number.isFinite(x) ? x : null; }
function string(value: unknown) { return typeof value === "string" ? value : null; }

function RichText({ value }: { value: string }) {
  const parts = value.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : <span key={index}>{part}</span>)}</>;
}

export default function CoachClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [context, setContext] = useState<CoachContext>({});
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(async (threadId: string) => {
    const { data, error: messageError } = await supabase
      .from("coach_messages")
      .select("id,role,content,created_at")
      .eq("thread_id", threadId)
      .order("created_at");
    if (messageError) setError(messageError.message);
    setMessages((data || []) as Message[]);
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoading(false); return; }

    const [{ data: contextData }, { data: threadData }] = await Promise.all([
      supabase.rpc("get_coach_context"),
      supabase.from("coach_threads").select("id,title").eq("user_id", auth.user.id).eq("status", "active").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setContext((contextData || {}) as CoachContext);
    const latest = threadData as Thread | null;
    setThread(latest);
    if (latest) await loadMessages(latest.id);
    setLoading(false);
  }, [loadMessages, supabase]);

  useEffect(() => { load(); }, [load]);

  async function send(custom?: string) {
    const message = (custom ?? input).trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    if (!custom) setInput("");
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread?.id || null, message }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Réponse du Coach impossible");
      const nextThread = thread || { id: data.threadId as string, title: message.length > 58 ? `${message.slice(0, 55)}…` : message };
      setThread(nextThread);
      await loadMessages(nextThread.id);
      const { data: contextData } = await supabase.rpc("get_coach_context");
      setContext((contextData || {}) as CoachContext);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Réponse du Coach impossible");
    } finally {
      setSending(false);
    }
  }

  function newConversation() {
    setThread(null);
    setMessages([]);
    setError(null);
    setInput("");
  }

  const fitness = obj(context.fitness);
  const review = obj(context.weeklyReview);
  const nextWorkout = obj(context.nextWorkout);
  const recovery = number(fitness.recovery);
  const readiness = number(review.readiness_score ?? review.readinessScore);
  const reviewDecision = string(review.decision);
  const nextWorkoutTitle = string(nextWorkout.title);

  if (loading) return <div className="frog-centered"><Loader2 className="frog-spin" /> Chargement du Coach…</div>;

  return <>
    <section className="frog-card frog-card-soft">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
        <div>
          <div className="frog-kicker">Contexte Frog en direct</div>
          <h2 className="frog-card-title" style={{ marginTop: 6 }}>{nextWorkoutTitle || "Plan chargé"}</h2>
        </div>
        <Bot size={23} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        {recovery != null && <span className="frog-status-line" data-connected>Récupération {Math.round(recovery)}%</span>}
        {readiness != null && <span className="frog-status-line" data-connected>Disponibilité {Math.round(readiness)}/100</span>}
        {reviewDecision && <span className="frog-status-line">Bilan : {reviewDecision === "maintain" ? "maintien" : reviewDecision}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
        <Link href="/progress" className="frog-button frog-button-secondary">Progrès <ArrowRight size={16} /></Link>
        <Link href="/race-day" className="frog-button frog-button-secondary">Race Day <ArrowRight size={16} /></Link>
      </div>
    </section>

    <section className="frog-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div>
          <div className="frog-kicker">coach-engine-v1</div>
          <h2 className="frog-card-title" style={{ marginTop: 5 }}>{thread?.title || "Nouvelle conversation"}</h2>
        </div>
        <button type="button" className="frog-button frog-button-secondary" onClick={newConversation} disabled={sending}><Plus size={16} /> Nouveau</button>
      </div>

      {messages.length === 0 ? <div className="frog-empty" style={{ marginTop: 20 }}>
        <div className="frog-empty-icon"><MessageCircle size={24} /></div>
        <h3 className="frog-card-title">Demande quelque chose à Frog</h3>
        <p className="frog-card-text">Le Coach répond depuis ton objectif, ton plan, COROS, les bilans hebdomadaires, les analyses de séance et la mémoire Frog non sensible.</p>
      </div> : <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
        {messages.map((message) => <article key={message.id} style={{ padding: 12, borderRadius: 16, border: "1px solid var(--frog-border)", marginLeft: message.role === "user" ? 26 : 0, marginRight: message.role === "assistant" ? 26 : 0, background: message.role === "assistant" ? "var(--frog-soft, transparent)" : "transparent" }}>
          <div className="frog-kicker">{message.role === "assistant" ? "Frog" : "Toi"}</div>
          <p className="frog-card-text" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}><RichText value={message.content} /></p>
        </article>)}
      </div>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 16 }}>
        {["Que dois-je faire aujourd’hui ?", "Comment est ma forme ?", "Où en est ma progression ?", "Quelle stratégie pour le 20 km ?"].map((prompt) =>
          <button key={prompt} type="button" className="frog-button frog-button-secondary" style={{ fontSize: 12 }} disabled={sending} onClick={() => send(prompt)}>{prompt}</button>)}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); send(); }} style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input value={input} onChange={(event) => setInput(event.target.value)} maxLength={2000} placeholder="Écris à Frog…" style={{ flex: 1, minWidth: 0, border: "1px solid var(--frog-border)", borderRadius: 14, padding: "12px 13px", background: "transparent", color: "inherit" }} />
        <button className="frog-button frog-button-primary" disabled={sending || !input.trim()} aria-label="Envoyer">
          {sending ? <Loader2 size={18} className="frog-spin" /> : <Send size={18} />}
        </button>
      </form>
      {error && <div className="frog-error" style={{ marginTop: 10 }}>{error}</div>}
    </section>

    <p className="frog-footnote">Frog explique les données de coaching disponibles mais ne remplace pas un professionnel de santé. Les messages et le contexte ayant servi à chaque réponse sont conservés dans ton compte.</p>
  </>;
}
