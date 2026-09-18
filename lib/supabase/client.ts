"use client";

import type { QueryFilter, QueryOrder, QuerySpec } from "@/lib/local/query";

class RemoteQueryBuilder implements PromiseLike<any> {
  private spec: QuerySpec;

  constructor(table: string) {
    this.spec = { table, action: "select", filters: [], orders: [] };
  }

  select(columns = "*", options: { count?: "exact"; head?: boolean } = {}) {
    this.spec.columns = columns;
    this.spec.count = options.count;
    this.spec.head = options.head;
    return this;
  }
  insert(values: Record<string, unknown> | Record<string, unknown>[]) { this.spec.action = "insert"; this.spec.values = values; return this; }
  update(values: Record<string, unknown>) { this.spec.action = "update"; this.spec.values = values; return this; }
  upsert(values: Record<string, unknown> | Record<string, unknown>[], _options?: { onConflict?: string }) { this.spec.action = "upsert"; this.spec.values = values; return this; }
  delete() { this.spec.action = "delete"; return this; }

  private filter(field: string, op: QueryFilter["op"], value: unknown) {
    (this.spec.filters ||= []).push({ field, op, value });
    return this;
  }
  eq(field: string, value: unknown) { return this.filter(field, "eq", value); }
  neq(field: string, value: unknown) { return this.filter(field, "neq", value); }
  gt(field: string, value: unknown) { return this.filter(field, "gt", value); }
  gte(field: string, value: unknown) { return this.filter(field, "gte", value); }
  lt(field: string, value: unknown) { return this.filter(field, "lt", value); }
  lte(field: string, value: unknown) { return this.filter(field, "lte", value); }
  in(field: string, value: unknown[]) { return this.filter(field, "in", value); }
  is(field: string, value: unknown) { return this.filter(field, "is", value); }
  not(field: string, operator: string, value: unknown) {
    if (operator === "is") return this.filter(field, "is_not", value);
    if (operator === "eq") return this.filter(field, "neq", value);
    throw new Error(`Opérateur not non pris en charge: ${operator}`);
  }
  match(values: Record<string, unknown>) { Object.entries(values).forEach(([field, value]) => this.eq(field, value)); return this; }

  order(field: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    (this.spec.orders ||= []).push({ field, ascending: options.ascending !== false } as QueryOrder);
    return this;
  }
  limit(limit: number) { this.spec.limit = limit; return this; }
  range(from: number, to: number) { this.spec.offset = from; this.spec.limit = Math.max(0, to - from + 1); return this; }

  single() { this.spec.single = "single"; return this.execute(); }
  maybeSingle() { this.spec.single = "maybeSingle"; return this.execute(); }

  private async execute() {
    const response = await fetch("/api/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.spec),
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({ data: null, error: { message: "Réponse serveur illisible" } }));
    if (!response.ok && !body?.error) body.error = { message: `Erreur ${response.status}` };
    return body;
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

async function postJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export function createSupabaseBrowserClient() {
  return {
    auth: {
      async getUser() {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const body = await response.json().catch(() => ({ user: null }));
        return { data: { user: body.user || null }, error: response.ok ? null : { message: "Session expirée" } };
      },
      async getSession() {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const body = await response.json().catch(() => ({ user: null }));
        return { data: { session: body.user ? { user: body.user } : null }, error: response.ok ? null : { message: "Session expirée" } };
      },
      async signOut(_options?: { scope?: string }) {
        const { response, payload } = await postJson("/api/auth/logout");
        return { error: response.ok ? null : { message: payload?.error || "Déconnexion impossible" } };
      },
      async signInWithPassword(credentials: { email: string; password: string }) {
        const { response, payload } = await postJson("/api/auth/login", credentials);
        return { data: { user: payload?.user || null, session: payload?.user ? { user: payload.user } : null }, error: response.ok ? null : { message: payload?.error || "Connexion impossible" } };
      },
      async signUp(input: { email: string; password: string; options?: { data?: { display_name?: string } } }) {
        const { response, payload } = await postJson("/api/auth/signup", { email: input.email, password: input.password, displayName: input.options?.data?.display_name || "" });
        return { data: { user: payload?.user || null, session: payload?.user ? { user: payload.user } : null }, error: response.ok ? null : { message: payload?.error || "Création du compte impossible" } };
      },
    },
    from(table: string) { return new RemoteQueryBuilder(table); },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const { response, payload } = await postJson("/api/rpc", { name, args });
      return { data: payload?.data ?? null, error: response.ok ? null : { message: payload?.error || "Opération impossible" } };
    },
    functions: {
      async invoke(name: string, options: { body?: unknown } = {}) {
        const { response, payload } = await postJson(`/api/functions/${encodeURIComponent(name)}`, options.body ?? {});
        return { data: payload?.data ?? payload ?? null, error: response.ok ? null : { message: payload?.error || "Fonction impossible" } };
      },
    },
  };
}
