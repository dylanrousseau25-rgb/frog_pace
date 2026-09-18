import { randomUUID } from "crypto";
import { execute, row, rows } from "@/lib/db";
import { getCorosAccessToken, listCorosTools } from "@/lib/coros/local-tools";

function toolCapability(tools: any[]) {
  const names = tools.map((tool) => String(tool?.name || ""));
  const relevant = tools.filter((tool) => /trainingplan|workout/i.test(String(tool?.name || "")));
  const generate = names.find((name) => name === "generateTrainingPlan") || null;
  const update = names.find((name) => name === "updateTrainingPlan") || null;
  const detail = names.find((name) => name === "queryTrainingPlanDetail") || null;
  return {
    writeAvailable: Boolean(generate || update),
    generateTool: generate,
    updateTool: update,
    detailTool: detail,
    toolCount: names.length,
    relevantTools: relevant.map((tool) => ({ name: tool.name, description: tool.description || null, inputSchema: tool.inputSchema || null })),
  };
}

function sportTypeCode(sport: string) {
  if (sport === "trail") return 102;
  if (sport === "road_cycling") return 200;
  if (sport === "gravel") return 203;
  return 100;
}

function durationTarget(step: any) {
  const seconds = Number(step?.duration_s);
  if (Number.isFinite(seconds) && seconds > 0) return { type: "time", seconds: Math.round(seconds) };
  const meters = Number(step?.distance_m);
  if (Number.isFinite(meters) && meters > 0) return { type: "distance", meters: Math.round(meters) };
  return { type: "open" };
}

function paceTarget(step: any) {
  const seconds = Number(step?.target_pace_seconds_per_km);
  if (Number.isFinite(seconds) && seconds > 0) return { type: "pace", secondsPerKm: Math.round(seconds) };
  return { type: "open" };
}

function exportSteps(steps: any[]) {
  const mapped: any[] = [];
  const notes: string[] = [];
  for (const step of steps) {
    const kind = String(step?.kind || "");
    if (kind === "guidance") {
      if (step?.target_pace_seconds_per_km) notes.push(`Allure indicative ${Math.round(Number(step.target_pace_seconds_per_km))} s/km`);
      continue;
    }
    if (kind === "repeat") {
      mapped.push({
        type: "repeat",
        count: Math.max(1, Math.round(Number(step?.repetitions) || 1)),
        work: { duration: { type: "time", seconds: Math.max(1, Math.round(Number(step?.work_duration_s) || 1)) }, target: paceTarget(step) },
        recovery: { duration: { type: "time", seconds: Math.max(1, Math.round(Number(step?.recovery_duration_s) || 1)) }, target: { type: "easy" } },
      });
      continue;
    }
    if (["warmup", "cooldown", "steady"].includes(kind)) {
      mapped.push({ type: kind, duration: durationTarget(step), target: paceTarget(step), intensity: step?.intensity || null });
    }
  }
  return { steps: mapped, notes };
}

function buildCanonicalPayload(workout: any) {
  const structured = Array.isArray(workout.structured_steps) ? workout.structured_steps : [];
  const converted = exportSteps(structured);
  return {
    schema: "frog-coros-v1",
    generatedAt: new Date().toISOString(),
    workout: {
      frogWorkoutId: workout.id,
      name: workout.title,
      scheduledDate: workout.scheduled_date,
      description: workout.description || null,
      sport: workout.sport,
      corosSportTypeCode: sportTypeCode(workout.sport),
      durationSeconds: workout.duration_s == null ? null : Number(workout.duration_s),
      distanceMeters: workout.distance_m == null ? null : Number(workout.distance_m),
      intensity: workout.intensity || null,
      steps: converted.steps,
      notes: converted.notes,
    },
  };
}

async function capabilities(userId: string) {
  const { accessToken, connection } = await getCorosAccessToken(userId);
  const tools = await listCorosTools(accessToken);
  const capability = toolCapability(tools);
  const metadata = { ...(connection.metadata || {}), training_write_capability: { ...capability, checkedAt: new Date().toISOString() } };
  await execute("update provider_connections set metadata=? where id=? and user_id=?", [JSON.stringify(metadata), connection.id, userId]);
  return capability;
}

async function loadWorkout(userId: string, workoutId: string) {
  const workout = await row<any>("select * from planned_workouts where id=? and user_id=? limit 1", [workoutId, userId]);
  if (!workout) throw new Error("Séance introuvable");
  if (!workout.device_export_ready) throw new Error("Cette séance n’est pas compatible avec un export montre");
  return workout;
}

async function prepareOne(userId: string, workoutId: string, capability?: any) {
  const workout = await loadWorkout(userId, workoutId);
  const cap = capability || await capabilities(userId);
  const payload = buildCanonicalPayload(workout);
  const blocked = !cap.writeAvailable;
  const status = blocked ? "blocked" : "ready";
  const providerTool = cap.generateTool || cap.updateTool || null;
  const blockerCode = blocked ? "COROS_MCP_WRITE_UNAVAILABLE" : "COROS_ADAPTER_SCHEMA_REVIEW";
  const blockerMessage = blocked
    ? "COROS expose actuellement son MCP en lecture seule. Frog est prêt, mais COROS n’autorise pas encore la création ou mise à jour de plans via MCP."
    : "Un outil COROS d’écriture vient d’apparaître. Frog a détecté son schéma et doit valider l’adaptateur avant le premier envoi réel.";
  const existing = await row<any>("select id from workout_exports where planned_workout_id=? and provider='coros' and user_id=?", [workout.id, userId]);
  const id = existing?.id || randomUUID();
  if (existing) {
    await execute("update workout_exports set status=?,payload=?,provider_tool=?,blocker_code=?,blocker_message=?,updated_at=utc_timestamp(3) where id=? and user_id=?", [status, JSON.stringify(payload), providerTool, blockerCode, blockerMessage, id, userId]);
  } else {
    await execute("insert into workout_exports (id,user_id,planned_workout_id,provider,status,payload,provider_tool,blocker_code,blocker_message) values (?,?,?,'coros',?,?,?,?,?)", [id, userId, workout.id, status, JSON.stringify(payload), providerTool, blockerCode, blockerMessage]);
  }
  const exportRow = await row<any>("select * from workout_exports where id=? and user_id=?", [id, userId]);
  return { export: exportRow, capability: cap };
}

async function prepareAll(userId: string) {
  const cap = await capabilities(userId);
  const plan = await row<any>("select id from training_plans where user_id=? and status='active' order by created_at desc limit 1", [userId]);
  if (!plan) return { prepared: 0, capability: cap };
  const workouts = await rows<any>("select id from planned_workouts where user_id=? and plan_id=? and device_export_ready=1 order by scheduled_date", [userId, plan.id]);
  for (const workout of workouts) await prepareOne(userId, workout.id, cap);
  return { prepared: workouts.length, capability: cap };
}

async function exportOne(userId: string, workoutId: string) {
  const cap = await capabilities(userId);
  const prepared = await prepareOne(userId, workoutId, cap);
  const attemptCount = Number(prepared.export?.attempt_count || 0) + 1;
  const blockerCode = cap.writeAvailable ? "COROS_ADAPTER_SCHEMA_REVIEW" : "COROS_MCP_WRITE_UNAVAILABLE";
  const blockerMessage = cap.writeAvailable
    ? "L’outil d’écriture COROS est visible, mais Frog bloque le premier envoi tant que son nouveau schéma n’a pas été validé."
    : "COROS n’expose pas encore d’outil d’écriture de plan dans le MCP actif.";
  await execute("update workout_exports set status='blocked',attempt_count=?,last_attempt_at=utc_timestamp(3),blocker_code=?,blocker_message=?,updated_at=utc_timestamp(3) where id=? and user_id=?", [attemptCount, blockerCode, blockerMessage, prepared.export.id, userId]);
  return { exported: false, blocked: true, reason: blockerCode, capability: cap };
}

export async function runCorosWorkoutExport(userId: string, action: string, body: Record<string, unknown>) {
  if (action === "capabilities") return capabilities(userId);
  if (action === "prepare_all") return prepareAll(userId);
  if (action === "prepare") return prepareOne(userId, String(body.workoutId || ""));
  if (action === "export") return exportOne(userId, String(body.workoutId || ""));
  throw new Error("Action d’export COROS inconnue");
}
