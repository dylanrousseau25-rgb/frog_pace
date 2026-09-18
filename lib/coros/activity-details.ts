import { execute, rows } from "@/lib/db";
import { corosMcpTool, getCorosAccessToken, safeMessage } from "@/lib/coros/local-tools";

const DEFAULT_BATCH = 8;
const MAX_BATCH = 12;

function normalizeKey(value: unknown) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function flattenText(root: any): string {
  if (root == null) return "";
  if (typeof root === "string") return root;
  const lines: string[] = [];
  const queue = [root];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (current == null) continue;
    if (typeof current === "string") { lines.push(current); continue; }
    if (typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current); continue; }
    for (const [key, value] of Object.entries(current)) {
      if (["string", "number", "boolean"].includes(typeof value)) lines.push(`${key}: ${value}`);
      else if (value && typeof value === "object") queue.push(value);
    }
  }
  return lines.join("\n");
}

function findStructured(root: any, keys: string[]) {
  const wanted = new Set(keys.map(normalizeKey));
  const queue = [root];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current); continue; }
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key)) && ["string", "number", "boolean"].includes(typeof value) && value !== "") return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function detailNumber(root: any, keys: string[], regexes: RegExp[]) {
  const direct = numberValue(findStructured(root, keys));
  if (direct !== null) return direct;
  const text = flattenText(root);
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) return numberValue(match[1]);
  }
  return null;
}

function detailText(root: any, keys: string[], regexes: RegExp[]) {
  const direct = findStructured(root, keys);
  if (direct !== null && direct !== "") return String(direct).trim();
  const text = flattenText(root);
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function normalizeDetail(raw: any) {
  return {
    avg_hr: detailNumber(raw, ["avgHr", "averageHeartRate", "avgHeartRate", "avgHeartRateBpm"], [/(?:Average|Avg)\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    max_hr: detailNumber(raw, ["maxHr", "maxHeartRate", "maximumHeartRate", "maxHeartRateBpm"], [/Max(?:imum)?\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    elevation_gain_m: detailNumber(raw, ["elevationGain", "elevationGainM", "totalAscent", "ascent", "totalClimb"], [/(?:Elevation\s*Gain|Total\s*Ascent|Ascent)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    training_load: detailNumber(raw, ["trainingLoad", "exerciseLoad", "load"], [/(?:Training|Exercise)\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    avg_cadence: detailNumber(raw, ["avgCadence", "averageCadence", "cadenceAvg", "averageStepFrequency"], [/(?:Average|Avg)\s*Cadence\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    max_cadence: detailNumber(raw, ["maxCadence", "maximumCadence", "cadenceMax", "maxStepFrequency"], [/Max(?:imum)?\s*Cadence\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    training_focus: detailText(raw, ["trainingFocus", "focus", "trainingEffectLabel"], [/Training\s*Focus\s*[:=]\s*([^\n|]+)/i]),
  };
}

export async function enrichCorosActivityDetails(userId: string, requestedBatch: unknown, retryFailed = false) {
  const batchSize = Math.max(1, Math.min(MAX_BATCH, Number(requestedBatch) || DEFAULT_BATCH));
  const { accessToken } = await getCorosAccessToken(userId);
  const condition = retryFailed ? "detail_sync_error is not null" : "detail_sync_attempted_at is null";
  const activities = await rows<any>(`select id,provider_activity_id,sport_type,started_at from activities where user_id=? and provider='coros' and sport_type is not null and ${condition} order by started_at desc limit ${batchSize}`, [userId]);
  const remainingBefore = await rows<any>("select id from activities where user_id=? and provider='coros' and detail_sync_attempted_at is null", [userId]);
  if (!activities.length) return { processed: 0, succeeded: 0, failed: 0, remaining: remainingBefore.length, complete: remainingBefore.length === 0 };

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const activity of activities) {
    try {
      const raw = await corosMcpTool(accessToken, "getActivityDetail", { labelId: activity.provider_activity_id, sportType: Number(activity.sport_type) });
      const metrics = normalizeDetail(raw);
      await execute(
        "update activities set avg_hr=coalesce(?,avg_hr),max_hr=coalesce(?,max_hr),elevation_gain_m=coalesce(?,elevation_gain_m),training_load=coalesce(?,training_load),avg_cadence=coalesce(?,avg_cadence),max_cadence=coalesce(?,max_cadence),training_focus=coalesce(?,training_focus),detail_provider_data=?,detail_sync_attempted_at=utc_timestamp(3),detail_fetched_at=utc_timestamp(3),detail_sync_error=null where id=? and user_id=?",
        [metrics.avg_hr, metrics.max_hr, metrics.elevation_gain_m, metrics.training_load, metrics.avg_cadence, metrics.max_cadence, metrics.training_focus, JSON.stringify(raw ?? {}), activity.id, userId]
      );
      succeeded++;
    } catch (error) {
      const message = safeMessage(error);
      failed++;
      errors.push(`${activity.provider_activity_id}: ${message}`);
      await execute("update activities set detail_sync_attempted_at=utc_timestamp(3),detail_sync_error=? where id=? and user_id=?", [message, activity.id, userId]);
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  const remaining = await rows<any>("select id from activities where user_id=? and provider='coros' and detail_sync_attempted_at is null", [userId]);
  return { processed: activities.length, succeeded, failed, remaining: remaining.length, complete: remaining.length === 0, errors: errors.slice(0, 5) };
}
