import { getCurrentUser } from "@/lib/auth";
import { runUserQuery, type QueryFilter, type QueryOrder, type QuerySpec } from "@/lib/local/query";
import { runRpc } from "@/lib/local/rpc";

class LocalQueryBuilder implements PromiseLike<any> {
  private spec: QuerySpec;
  private userId: string;

  constructor(userId: string, table: string) {
    this.userId = userId;
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

  private execute() { return runUserQuery(this.userId, this.spec); }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export async function createSupabaseServerClient() {
  const user = await getCurrentUser();

  return {
    auth: {
      async getUser() { return { data: { user }, error: user ? null : { message: "Session expirée" } }; },
      async getSession() { return { data: { session: user ? { user } : null }, error: user ? null : { message: "Session expirée" } }; },
    },
    from(table: string) {
      if (!user) throw new Error("Non authentifié");
      return new LocalQueryBuilder(user.id, table);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      if (!user) return { data: null, error: { message: "Non authentifié" } };
      try {
        return { data: await runRpc(user.id, name, args), error: null };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : "Opération impossible" } };
      }
    },
  };
}
