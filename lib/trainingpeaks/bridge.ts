import { randomBytes, randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { execute, row, rows } from "@/lib/db";

const PROVIDER = "trainingpeaks";
const TP_API = "https://api.trainingpeaks.com";
const TP_OAUTH = "https://oauth.trainingpeaks.com";
const TP_SCOPES = "workouts:plan workouts:read athlete:profile";

type TrainingPeaksAction = "status" | "start" | "finish" | "disconnect" | "prepare" | "export" | "export_plan";

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Erreur"))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 2000);
}

function partnerConfig() {
  const clientId = process.env.TRAININGPEAKS_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.TRAININGPEAKS_CLIENT_SECRET?.trim() || null;
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function validateRedirectUri(value: unknown) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.hostname !== "frogpace.kumazel.fr" || url.pathname !== "/api/trainingpeaks/callback") {
    throw new Error("URL de retour Frog Pace invalide");
  }
  return url.toString();
}

async function readResponse(response: Response, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) {
    const error = new Error(`${label}: ${body?.error_description || body?.error || body?.message || text || response.status}`) as Error & { status?: number; body?: any };
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function exchangeToken(form: Record<string, string>) {
  const response = await fetch(`${TP_OAUTH}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form),
    cache: "no-store",
  });
  return readResponse(response, "Token TrainingPeaks");
}

async function connectionFor(userId: string) {
  return row<any>("select * from provider_connections where user_id=? and provider='trainingpeaks' limit 1", [userId]);
}

async function startOAuth(userId: string, redirectInput: unknown) {
  const config = partnerConfig();
  if (!config.configured) {
    return { available: false, blockerCode: "TRAININGPEAKS_PARTNER_ACCESS_REQUIRED", blockerMessage: "Les identifiants API partenaire TrainingPeaks ne sont pas encore configurés dans Frog Pace." };
  }
  const redirectUri = validateRedirectUri(redirectInput);
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await execute("delete from provider_oauth_states where user_id=? and provider='trainingpeaks'", [userId]);
  await execute("insert into provider_oauth_states (id,user_id,provider,state,client_id,code_verifier,redirect_uri,scopes,expires_at) values (?,?, 'trainingpeaks', ?,?,'',?,?,?)", [randomUUID(), userId, state, config.clientId, redirectUri, JSON.stringify(TP_SCOPES.split(" ")), expiresAt]);

  const existing = await connectionFor(userId);
  if (existing) await execute("update provider_connections set status='connecting',scopes=?,last_error=null,metadata=? where id=? and user_id=?", [JSON.stringify(TP_SCOPES.split(" ")), JSON.stringify({ api_base: TP_API, oauth_base: TP_OAUTH, bridge_version: 2 }), existing.id, userId]);
  else await execute("insert into provider_connections (id,user_id,provider,status,scopes,metadata) values (?,?,'trainingpeaks','connecting',?,?)", [randomUUID(), userId, JSON.stringify(TP_SCOPES.split(" ")), JSON.stringify({ api_base: TP_API, oauth_base: TP_OAUTH, bridge_version: 2 })]);

  const params = new URLSearchParams({ response_type: "code", client_id: config.clientId!, scope: TP_SCOPES, redirect_uri: redirectUri, state });
  return { available: true, authorizationUrl: `${TP_OAUTH}/OAuth/Authorize?${params.toString()}` };
}

async function storeCredentials(connectionId: string, clientId: string, token: any) {
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000);
  const existing = await row<any>("select * from provider_credentials where provider_connection_id=?", [connectionId]);
  const refresh = token.refresh_token ? encryptSecret(token.refresh_token) : existing?.refresh_token_encrypted || null;
  const values = [encryptSecret(clientId), encryptSecret(token.access_token || null), refresh, expiresAt, token.scope || TP_SCOPES, token.token_type || "Bearer"];
  if (existing) await execute("update provider_credentials set client_id_encrypted=?,access_token_encrypted=?,refresh_token_encrypted=?,expires_at=?,scope=?,token_type=? where provider_connection_id=?", [...values, connectionId]);
  else await execute("insert into provider_credentials (provider_connection_id,client_id_encrypted,access_token_encrypted,refresh_token_encrypted,expires_at,scope,token_type) values (?,?,?,?,?,?,?)", [connectionId, ...values]);
}

async function finishOAuth(userId: string, codeInput: unknown, stateInput: unknown) {
  const code = String(codeInput || ""), state = String(stateInput || "");
  if (!code || !state) throw new Error("Réponse OAuth TrainingPeaks incomplète");
  const config = partnerConfig();
  if (!config.configured) throw new Error("Accès partenaire TrainingPeaks non configuré");
  const pending = await row<any>("select * from provider_oauth_states where user_id=? and provider='trainingpeaks' and state=? limit 1", [userId, state]);
  if (!pending) throw new Error("Session TrainingPeaks introuvable ou déjà utilisée");
  if (new Date(String(pending.expires_at).replace(" ", "T") + "Z").getTime() < Date.now()) throw new Error("Session TrainingPeaks expirée");

  const token = await exchangeToken({ client_id: pending.client_id, client_secret: config.clientSecret!, grant_type: "authorization_code", code, redirect_uri: pending.redirect_uri });
  if (!token.access_token || !token.refresh_token) throw new Error("TrainingPeaks n’a pas renvoyé les jetons attendus");
  const profile = await readResponse(await fetch(`${TP_API}/v1/athlete/profile`, { headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json", "user-agent": "FrogPace/2.0" }, cache: "no-store" }), "Profil TrainingPeaks");
  const athleteId = String(profile?.Id || profile?.id || "");
  if (!athleteId) throw new Error("TrainingPeaks n’a pas renvoyé l’identifiant athlète");

  const connection = await connectionFor(userId);
  const connectionId = connection?.id || randomUUID();
  const scopes = JSON.stringify(String(token.scope || TP_SCOPES).split(/\s+/).filter(Boolean));
  if (connection) await execute("update provider_connections set status='connected',external_user_id=?,scopes=?,last_error=null,metadata=? where id=? and user_id=?", [athleteId, scopes, JSON.stringify({ api_base: TP_API, oauth_base: TP_OAUTH, bridge_version: 2 }), connectionId, userId]);
  else await execute("insert into provider_connections (id,user_id,provider,status,external_user_id,scopes,metadata) values (?,?,'trainingpeaks','connected',?,?,?)", [connectionId, userId, athleteId, scopes, JSON.stringify({ api_base: TP_API, oauth_base: TP_OAUTH, bridge_version: 2 })]);
  await storeCredentials(connectionId, pending.client_id, token);
  await execute("delete from provider_oauth_states where id=? and user_id=?", [pending.id, userId]);
  return { connected: true, athleteId };
}

async function loadAccessToken(connectionId: string) {
  const config = partnerConfig();
  if (!config.configured) throw new Error("Accès partenaire TrainingPeaks non configuré");
  const credentials = await row<any>("select * from provider_credentials where provider_connection_id=?", [connectionId]);
  if (!credentials) throw new Error("Identifiants TrainingPeaks introuvables");
  const clientId = decryptSecret(credentials.client_id_encrypted);
  const refresh = decryptSecret(credentials.refresh_token_encrypted);
  const access = decryptSecret(credentials.access_token_encrypted);
  if (!clientId || !refresh) throw new Error("Identifiants TrainingPeaks incomplets");
  const expiry = credentials.expires_at ? new Date(String(credentials.expires_at).replace(" ", "T") + "Z").getTime() : 0;
  if (access && expiry > Date.now() + 60_000) return access;
  const token = await exchangeToken({ client_id: clientId, client_secret: config.clientSecret!, grant_type: "refresh_token", refresh_token: refresh });
  if (!token.access_token) throw new Error("TrainingPeaks n’a pas renouvelé le jeton d’accès");
  await storeCredentials(connectionId, clientId, token);
  return String(token.access_token);
}

function paceSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const match = String(value || "").match(/(\d+)\s*:\s*(\d{1,2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function paceTarget(targetPace: unknown, thresholdPace: number | null, fallbackRpe = 4) { const target=paceSeconds(targetPace); if(target&&thresholdPace){const pct=clamp(Math.round((thresholdPace/target)*100),50,150);return{Unit:"PercentOfThresholdSpeed",Value:pct,MinValue:clamp(pct-2,50,150),MaxValue:clamp(pct+2,50,150)};}return{Unit:"Rpe",Value:fallbackRpe}; }
function lengthFor(step:any){if(Number(step?.duration_s)>0)return{Unit:"Second",Value:Math.round(Number(step.duration_s))};if(Number(step?.distance_m)>0)return{Unit:"Meter",Value:Math.round(Number(step.distance_m))};return null;}
function buildStructure(rawSteps:any[],thresholdPace:number|null){const result:any[]=[];for(let i=0;i<rawSteps.length;i++){const step=rawSteps[i]||{},kind=String(step.kind||""),next=rawSteps[i+1]||{};if(kind==="guidance")continue;if(kind==="repeat"){const reps=Math.max(1,Math.round(Number(step.repetitions)||1));result.push({Type:"Repetition",Length:{Unit:"Repetition",Value:reps},Steps:[{IntensityClass:"Active",Name:"Effort Frog",Length:{Unit:"Second",Value:Math.max(1,Math.round(Number(step.work_duration_s)||1))},Type:"Step",IntensityTarget:paceTarget(step.target_pace_seconds_per_km,thresholdPace,7)},{IntensityClass:"Rest",Name:"Récupération",Length:{Unit:"Second",Value:Math.max(1,Math.round(Number(step.recovery_duration_s)||1))},Type:"Step",IntensityTarget:{Unit:"Rpe",Value:2}}]});continue;}const length=lengthFor(step);if(!length)continue;const guidance=String(next.kind||"")==="guidance"?next.target_pace_seconds_per_km:null;if(kind==="warmup")result.push({IntensityClass:"WarmUp",Name:"Échauffement",Length:length,Type:"Step",IntensityTarget:{Unit:"Rpe",Value:3}});else if(kind==="cooldown")result.push({IntensityClass:"CoolDown",Name:"Retour au calme",Length:length,Type:"Step",IntensityTarget:{Unit:"Rpe",Value:2}});else if(kind==="steady"||kind==="activation"){const target=step.target_pace_seconds_per_km||guidance;result.push({IntensityClass:"Active",Name:kind==="activation"?"Activation":"Endurance Frog",Length:length,Type:"Step",IntensityTarget:target?paceTarget(target,thresholdPace,4):{Unit:"Rpe",Value:3}});}}return result;}
function workoutType(sport:string){if(sport==="running"||sport==="trail")return"run";if(sport==="road_cycling"||sport==="gravel")return"bike";if(sport==="strength")return"strength";return"other";}

async function prepareExport(userId:string,workoutId:string){
  const config=partnerConfig(); const connection=await connectionFor(userId);
  const workout=await row<any>("select * from planned_workouts where id=? and user_id=? limit 1",[workoutId,userId]); if(!workout)throw new Error("Séance introuvable"); if(!workout.device_export_ready)throw new Error("Cette séance n’est pas compatible avec un export montre"); if(workout.status!=="planned")throw new Error("Seules les séances planifiées peuvent être exportées");
  const fitness=await row<any>("select threshold_pace from fitness_snapshots where user_id=? order by captured_at desc limit 1",[userId]); const thresholdPace=paceSeconds(fitness?.threshold_pace); const structure=buildStructure(Array.isArray(workout.structured_steps)?workout.structured_steps:[],thresholdPace);
  let status="ready",blockerCode:null|string=null,blockerMessage:null|string=null; if(!config.configured){status="blocked";blockerCode="TRAININGPEAKS_PARTNER_ACCESS_REQUIRED";blockerMessage="Les identifiants API partenaire TrainingPeaks doivent encore être approuvés et configurés.";}else if(!connection||connection.status!=="connected"||!connection.external_user_id){status="blocked";blockerCode="TRAININGPEAKS_NOT_CONNECTED";blockerMessage="Connecte ton compte TrainingPeaks à Frog Pace avant l’envoi.";}
  const payload={AthleteId:connection?.external_user_id||null,Title:workout.title,Description:`${workout.description||""}${workout.description?"\n\n":""}Planifié par Frog Pace.`.trim(),WorkoutDay:workout.scheduled_date,WorkoutType:workoutType(workout.sport),TotalTimePlanned:workout.duration_s?Number((Number(workout.duration_s)/3600).toFixed(4)):undefined,DistancePlanned:workout.distance_m?Number(workout.distance_m):undefined,Structure:structure.length?JSON.stringify(structure):undefined,StructureDisplayUnit:"kilometer",Tags:["Frog Pace"]};
  const existing=await row<any>("select * from workout_exports where user_id=? and planned_workout_id=? and provider='trainingpeaks'",[userId,workoutId]); const id=existing?.id||randomUUID();
  if(existing)await execute("update workout_exports set status=?,payload=?,provider_tool='/v2/workouts/plan',blocker_code=?,blocker_message=?,last_attempt_at=utc_timestamp(3) where id=? and user_id=?",[status,JSON.stringify(payload),blockerCode,blockerMessage,id,userId]); else await execute("insert into workout_exports (id,user_id,planned_workout_id,provider,status,payload,provider_tool,blocker_code,blocker_message,last_attempt_at) values (?,?,?,'trainingpeaks',?,?,'/v2/workouts/plan',?,?,utc_timestamp(3))",[id,userId,workoutId,status,JSON.stringify(payload),blockerCode,blockerMessage]);
  return row<any>("select * from workout_exports where id=? and user_id=?",[id,userId]);
}

async function exportWorkout(userId:string,workoutId:string){let exportRow=await prepareExport(userId,workoutId);if(exportRow.status==="blocked")return exportRow;const connection=await connectionFor(userId);if(!connection?.id||!connection.external_user_id)throw new Error("Connexion TrainingPeaks manquante");const token=await loadAccessToken(connection.id);const payload={...(exportRow.payload||{}),AthleteId:connection.external_user_id};await execute("update workout_exports set status='pending',payload=?,blocker_code=null,blocker_message=null,attempt_count=attempt_count+1,last_attempt_at=utc_timestamp(3) where id=? and user_id=?",[JSON.stringify(payload),exportRow.id,userId]);const updating=Boolean(exportRow.provider_reference);const endpoint=updating?`${TP_API}/v2/workouts/plan/${encodeURIComponent(exportRow.provider_reference)}`:`${TP_API}/v2/workouts/plan`;try{const result=await readResponse(await fetch(endpoint,{method:updating?"PUT":"POST",headers:{authorization:`Bearer ${token}`,accept:"application/json","content-type":"application/json","user-agent":"FrogPace/2.0"},body:JSON.stringify(updating?{...payload,Id:Number(exportRow.provider_reference)||exportRow.provider_reference}:payload),cache:"no-store"}),updating?"Mise à jour TrainingPeaks":"Export TrainingPeaks");const reference=String(result?.Id||result?.id||exportRow.provider_reference||"");await execute("update workout_exports set status='exported',provider_reference=?,provider_response=?,blocker_code=null,blocker_message=null,exported_at=utc_timestamp(3) where id=? and user_id=?",[reference||null,JSON.stringify(result||{}),exportRow.id,userId]);}catch(error:any){const is403=Number(error?.status)===403;await execute("update workout_exports set status=?,blocker_code=?,blocker_message=?,provider_response=? where id=? and user_id=?",[is403?"blocked":"failed",is403?"TRAININGPEAKS_PREMIUM_OR_PERMISSION_REQUIRED":"TRAININGPEAKS_EXPORT_FAILED",is403?"TrainingPeaks a refusé la planification future. Vérifie le niveau du compte et les permissions workouts:plan.":safeMessage(error),JSON.stringify(error?.body||{}),exportRow.id,userId]);}return row<any>("select * from workout_exports where id=? and user_id=?",[exportRow.id,userId]);}

async function exportActivePlan(userId:string){const plan=await row<any>("select id from training_plans where user_id=? and status='active' order by created_at desc limit 1",[userId]);if(!plan)throw new Error("Aucun plan actif");const workouts=await rows<any>("select id from planned_workouts where user_id=? and plan_id=? and status='planned' and device_export_ready=1 and scheduled_date>=current_date order by scheduled_date",[userId,plan.id]);const results:any[]=[];for(const workout of workouts)results.push(await exportWorkout(userId,workout.id));return{total:results.length,exported:results.filter((item)=>item.status==="exported").length,blocked:results.filter((item)=>item.status==="blocked").length,failed:results.filter((item)=>item.status==="failed").length,results};}

async function disconnect(userId:string){const connection=await connectionFor(userId);if(connection?.id){try{const token=await loadAccessToken(connection.id);await fetch(`${TP_OAUTH}/oauth/deauthorize`,{method:"POST",headers:{authorization:`Bearer ${token}`}});}catch{}await execute("delete from provider_credentials where provider_connection_id=?",[connection.id]);await execute("update provider_connections set status='disconnected',external_user_id=null,last_error=null where id=? and user_id=?",[connection.id,userId]);}await execute("delete from provider_oauth_states where user_id=? and provider='trainingpeaks'",[userId]);return{disconnected:true};}

async function status(userId:string){const config=partnerConfig(),connection=await connectionFor(userId),exports=await rows<any>("select status from workout_exports where user_id=? and provider='trainingpeaks'",[userId]);return{partnerConfigured:config.configured,connected:connection?.status==="connected",connectionStatus:connection?.status||"disconnected",scopes:connection?.scopes||[],exports:{total:exports.length,exported:exports.filter((x)=>x.status==="exported").length,blocked:exports.filter((x)=>x.status==="blocked").length},blockerCode:config.configured?null:"TRAININGPEAKS_PARTNER_ACCESS_REQUIRED"};}

export async function callTrainingPeaksBridge(action: TrainingPeaksAction, payload: Record<string, unknown> = {}) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Session Frog Pace expirée. Reconnecte-toi.");
  if (action === "status") return status(user.id);
  if (action === "start") return startOAuth(user.id, payload.redirectUri);
  if (action === "finish") return finishOAuth(user.id, payload.code, payload.state);
  if (action === "disconnect") return disconnect(user.id);
  if (action === "prepare") return { export: await prepareExport(user.id, String(payload.workoutId || "")) };
  if (action === "export") return { export: await exportWorkout(user.id, String(payload.workoutId || "")) };
  if (action === "export_plan") return exportActivePlan(user.id);
  throw new Error("Action TrainingPeaks inconnue");
}
