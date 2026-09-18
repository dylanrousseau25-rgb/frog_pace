import { randomUUID } from "crypto";
import { execute, row, rows } from "@/lib/db";

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is";
export type QueryFilter = { field: string; op: FilterOp; value: unknown };
export type QueryOrder = { field: string; ascending: boolean };
export type QueryAction = "select" | "insert" | "update" | "delete" | "upsert";

export type QuerySpec = {
  table: string;
  action: QueryAction;
  columns?: string;
  values?: Record<string, unknown> | Record<string, unknown>[];
  filters?: QueryFilter[];
  orders?: QueryOrder[];
  limit?: number;
  single?: "single" | "maybeSingle";
};

const POLICY: Record<string, Set<QueryAction>> = {
  user_profiles: new Set(["select", "update"]),
  athlete_profiles: new Set(["select", "update"]),
  provider_connections: new Set(["select"]),
  provider_syncs: new Set(["select"]),
  activities: new Set(["select"]),
  fitness_snapshots: new Set(["select"]),
  coach_memories: new Set(["select", "insert", "update"]),
  goals: new Set(["select", "insert", "update", "delete"]),
  goal_feasibility_assessments: new Set(["select"]),
  training_plans: new Set(["select", "delete"]),
  training_plan_weeks: new Set(["select"]),
  planned_workouts: new Set(["select"]),
  workout_exports: new Set(["select"]),
  workout_matches: new Set(["select"]),
  workout_feedback: new Set(["select", "insert", "update", "delete"]),
  workout_analyses: new Set(["select"]),
  weekly_reviews: new Set(["select"]),
  plan_adaptations: new Set(["select"]),
  race_strategies: new Set(["select"]),
  coach_threads: new Set(["select", "insert", "update", "delete"]),
  coach_messages: new Set(["select", "insert"]),
};

const TABLES_WITH_ID = new Set([
  "athlete_profiles", "provider_connections", "provider_syncs", "activities", "fitness_snapshots",
  "coach_memories", "goals", "goal_feasibility_assessments", "training_plans", "training_plan_weeks",
  "planned_workouts", "workout_exports", "workout_matches", "workout_feedback", "workout_analyses",
  "weekly_reviews", "plan_adaptations", "race_strategies", "coach_threads", "coach_messages",
]);

function ident(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`Identifiant SQL invalide: ${value}`);
  return `\`${value}\``;
}

function selectList(columns = "*") {
  if (columns.trim() === "*") return "*";
  return columns.split(",").map((column) => ident(column.trim())).join(",");
}

function dbValue(value: unknown) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value;
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) return JSON.stringify(value);
  return value;
}

function buildFilters(filters: QueryFilter[], params: unknown[]) {
  const parts: string[] = [];
  for (const filter of filters) {
    const field = ident(filter.field);
    if (filter.op === "in") {
      const values = Array.isArray(filter.value) ? filter.value : [];
      if (!values.length) { parts.push("1=0"); continue; }
      parts.push(`${field} in (${values.map(() => "?").join(",")})`);
      params.push(...values.map(dbValue));
      continue;
    }
    if (filter.op === "is") {
      if (filter.value === null) parts.push(`${field} is null`);
      else parts.push(`${field} is not null`);
      continue;
    }
    const op = ({ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const)[filter.op];
    parts.push(`${field} ${op} ?`);
    params.push(dbValue(filter.value));
  }
  return parts;
}

export async function runUserQuery(userId: string, spec: QuerySpec) {
  const permissions = POLICY[spec.table];
  if (!permissions || !permissions.has(spec.action)) throw new Error("Opération non autorisée");

  const table = ident(spec.table);
  const filters = [...(spec.filters || []).filter((filter) => filter.field !== "user_id")];
  filters.push({ field: "user_id", op: "eq", value: userId });

  if (spec.action === "select") {
    const params: unknown[] = [];
    const where = buildFilters(filters, params);
    let sql = `select ${selectList(spec.columns)} from ${table} where ${where.join(" and ")}`;
    if (spec.orders?.length) sql += ` order by ${spec.orders.map((order) => `${ident(order.field)} ${order.ascending ? "asc" : "desc"}`).join(",")}`;
    if (spec.limit != null) sql += ` limit ${Math.max(0, Math.min(1000, Math.trunc(spec.limit)))}`;
    else if (spec.single) sql += " limit 2";
    const data = await rows(sql, params);
    if (spec.single === "single") {
      if (data.length !== 1) return { data: null, error: { message: data.length ? "Plusieurs résultats" : "Résultat introuvable" } };
      return { data: data[0], error: null };
    }
    if (spec.single === "maybeSingle") {
      if (data.length > 1) return { data: null, error: { message: "Plusieurs résultats" } };
      return { data: data[0] || null, error: null };
    }
    return { data, error: null };
  }

  if (spec.action === "insert") {
    const inputRows = Array.isArray(spec.values) ? spec.values : [spec.values || {}];
    const insertedIds: string[] = [];
    for (const input of inputRows) {
      const value = { ...input, user_id: userId } as Record<string, unknown>;
      if (TABLES_WITH_ID.has(spec.table) && !value.id) value.id = randomUUID();
      if (spec.table === "coach_messages") value.role = value.role === "assistant" ? "user" : value.role;
      const fields = Object.keys(value);
      if (!fields.length) throw new Error("Insertion vide");
      await execute(
        `insert into ${table} (${fields.map(ident).join(",")}) values (${fields.map(() => "?").join(",")})`,
        fields.map((field) => dbValue(value[field]))
      );
      if (typeof value.id === "string") insertedIds.push(value.id);
    }
    if (spec.columns && insertedIds.length === 1) {
      const data = await row(`select ${selectList(spec.columns)} from ${table} where id=? and user_id=? limit 1`, [insertedIds[0], userId]);
      return { data, error: null };
    }
    return { data: null, error: null };
  }

  if (spec.action === "update") {
    const value = { ...(Array.isArray(spec.values) ? spec.values[0] : spec.values || {}) } as Record<string, unknown>;
    delete value.user_id;
    delete value.id;
    const fields = Object.keys(value);
    if (!fields.length) return { data: null, error: null };
    const params: unknown[] = fields.map((field) => dbValue(value[field]));
    const where = buildFilters(filters, params);
    await execute(`update ${table} set ${fields.map((field) => `${ident(field)}=?`).join(",")} where ${where.join(" and ")}`, params);
    return { data: null, error: null };
  }

  if (spec.action === "delete") {
    const params: unknown[] = [];
    const where = buildFilters(filters, params);
    await execute(`delete from ${table} where ${where.join(" and ")}`, params);
    return { data: null, error: null };
  }

  throw new Error("Upsert utilisateur non pris en charge");
}
