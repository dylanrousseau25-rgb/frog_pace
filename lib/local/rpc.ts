import { randomUUID } from "crypto";
import { execute, row, rows } from "@/lib/db";

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function num(value: unknown, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function asObject(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function asArray<T = any>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function isoDate(date = new Date()) { return date.toISOString().slice(0, 10); }
function parseDate(value: string) { return new Date(`${value}T12:00:00Z`); }
function addDays(value: string, days: number) { const d = parseDate(value); d.setUTCDate(d.getUTCDate() + days); return isoDate(d); }
function diffDays(a: string, b: string) { return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86400000); }
function mondayOf(value: string) { const d = parseDate(value); const weekday = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - weekday + 1); return isoDate(d); }
function sqlDateTime(date: Date) { return date.toISOString().slice(0, 23).replace("T", " "); }

function sportTypes(sport: string) {
  if (sport === "running") return [100,101,102,103,104];
  if (sport === "trail") return [102,104,105,100,103];
  if (sport === "road_cycling") return [200,201,202,203,204,205,299];
  if (sport === "gravel") return [203,200,201,204,205];
  return [];
}

async function assessGoal(userId: string, goalId: string) {
  const goal = await row<any>("select * from goals where id=? and user_id=? limit 1", [goalId, userId]);
  if (!goal) throw new Error("Objectif introuvable");
  const types = sportTypes(goal.sport);
  const placeholders = types.map(() => "?").join(",") || "null";
  const today = isoDate();
  const daysToGoal = diffDays(goal.event_date, today);

  const recent = await row<any>(
    `select
       sum(case when started_at>=date_sub(utc_timestamp(), interval 84 day) then 1 else 0 end) activities_12w,
       sum(case when started_at>=date_sub(utc_timestamp(), interval 28 day) then 1 else 0 end) activities_4w,
       max(case when started_at>=date_sub(utc_timestamp(), interval 84 day) then distance_m else null end) longest_12w,
       sum(case when started_at>=date_sub(utc_timestamp(), interval 28 day) then coalesce(distance_m,0) else 0 end) distance_4w,
       sum(case when started_at>=date_sub(utc_timestamp(), interval 365 day) then 1 else 0 end) activities_365d,
       max(case when started_at>=date_sub(utc_timestamp(), interval 365 day) then distance_m else null end) longest_365d,
       sum(case when started_at>=date_sub(utc_timestamp(), interval 365 day) then coalesce(distance_m,0) else 0 end) distance_365d,
       count(distinct case when started_at>=date_sub(utc_timestamp(), interval 365 day) then yearweek(started_at,3) end) active_weeks_365d,
       sum(case when started_at>=date_sub(utc_timestamp(), interval 365 day) and distance_m>=?*0.8 then 1 else 0 end) goal_like_sessions_365d
     from activities where user_id=? and provider='coros' and sport_type in (${placeholders})`,
    [num(goal.distance_m), userId, ...types]
  ) || {};

  const weeklyMax = await row<any>(
    `select max(weekly_m) max_weekly from (
       select yearweek(started_at,3) yw, sum(coalesce(distance_m,0)) weekly_m
       from activities where user_id=? and provider='coros' and started_at>=date_sub(utc_timestamp(),interval 365 day)
       and sport_type in (${placeholders}) group by yearweek(started_at,3)
     ) x`, [userId, ...types]
  );

  const snapshot = await row<any>("select captured_at,threshold_pace from fitness_snapshots where user_id=? and provider='coros' order by captured_at desc limit 1", [userId]);
  const activities12 = num(recent.activities_12w);
  const activities4 = num(recent.activities_4w);
  const longest = num(recent.longest_12w);
  const distance4 = num(recent.distance_4w);
  const frequency = Math.round((activities12 / 12) * 100) / 100;
  const weeklyDistance = Math.round(distance4 / 4);
  const distanceRatio = num(goal.distance_m) > 0 ? Math.min(2, longest / num(goal.distance_m)) : 0;
  const volumeRatio = num(goal.distance_m) > 0 ? Math.min(4, weeklyDistance / num(goal.distance_m)) : 0;
  let thresholdPace: number | null = null;
  const paceMatch = String(snapshot?.threshold_pace || "").match(/(\d+):(\d{2})/);
  if (paceMatch) thresholdPace = Number(paceMatch[1]) * 60 + Number(paceMatch[2]);
  const targetPace = goal.target_duration_s && num(goal.distance_m) >= 1000 ? num(goal.target_duration_s) / (num(goal.distance_m) / 1000) : null;

  let score = 100;
  const reasons: any[] = [];
  if (daysToGoal < 0) { score = 0; reasons.push({ tone:"warning", code:"past_date", text:"La date de l’objectif est déjà passée." }); }
  else if (daysToGoal < 14) { score -= 40; reasons.push({ tone:"warning", code:"very_short_horizon", text:"Moins de 2 semaines restent avant l’objectif." }); }
  else if (daysToGoal < 28) { score -= 25; reasons.push({ tone:"warning", code:"short_horizon", text:"Moins de 4 semaines restent avant l’objectif." }); }
  else if (daysToGoal < 56) { score -= 10; reasons.push({ tone:"info", code:"moderate_horizon", text:"Le délai est court mais laisse encore plusieurs semaines de préparation." }); }
  else reasons.push({ tone:"positive", code:"good_horizon", text:"Le calendrier laisse une fenêtre de préparation exploitable." });

  if (activities12 === 0) { score -= 40; reasons.push({ tone:"warning", code:"no_recent_history", text:"Aucune activité pertinente n’est disponible sur les 12 dernières semaines." }); }
  else if (frequency < 1) { score -= 25; reasons.push({ tone:"warning", code:"low_frequency", text:"La fréquence récente est inférieure à une séance pertinente par semaine." }); }
  else if (frequency < 2) { score -= 12; reasons.push({ tone:"info", code:"moderate_frequency", text:"La régularité récente est encore limitée pour préparer cet objectif." }); }
  else reasons.push({ tone:"positive", code:"regular_history", text:"L’historique récent montre une pratique régulière." });

  if (distanceRatio >= .8) reasons.push({ tone:"positive", code:"distance_ready", text:"Une sortie récente couvre déjà une grande partie de la distance cible." });
  else if (distanceRatio >= .6) { score -= 5; reasons.push({ tone:"info", code:"distance_close", text:"La plus longue sortie récente se rapproche de la distance cible." }); }
  else if (distanceRatio >= .4) { score -= 15; reasons.push({ tone:"warning", code:"distance_gap", text:"Il reste un écart notable entre la plus longue sortie récente et la distance cible." }); }
  else { score -= 30; reasons.push({ tone:"warning", code:"large_distance_gap", text:"La distance cible est très supérieure aux sorties récentes." }); }

  if (volumeRatio >= 1.25) reasons.push({ tone:"positive", code:"volume_base", text:"Le volume hebdomadaire récent fournit une base cohérente avec la distance cible." });
  else if (volumeRatio >= .7) { score -= 7; reasons.push({ tone:"info", code:"volume_build", text:"Le volume récent devra progresser progressivement." }); }
  else { score -= 18; reasons.push({ tone:"warning", code:"low_volume", text:"Le volume récent est faible par rapport à la distance cible." }); }

  if (goal.sport === "running" && targetPace && thresholdPace && num(goal.distance_m) >= 15000) {
    if (targetPace < thresholdPace) { score -= 25; reasons.push({ tone:"warning", code:"target_faster_than_threshold", text:"Le rythme cible est plus rapide que l’allure seuil COROS actuelle sur une distance longue." }); }
    else if (targetPace < thresholdPace * 1.05) { score -= 10; reasons.push({ tone:"info", code:"ambitious_target", text:"Le chrono cible est ambitieux au regard de l’allure seuil actuelle." }); }
    else reasons.push({ tone:"positive", code:"target_pace_plausible", text:"Le rythme cible reste cohérent avec l’allure seuil actuellement disponible." });
  }

  const annualActivities = num(recent.activities_365d);
  const annualLongest = num(recent.longest_365d);
  const activeWeeks = num(recent.active_weeks_365d);
  if (annualActivities >= 40 && activeWeeks >= 24) score += 5;
  if (annualLongest >= num(goal.distance_m) * .8) score += 4;
  score = clamp(Math.round(score), 0, 100);
  let confidence = clamp(35 + Math.min(activities12, 20) * 3 + Math.min(10, Math.floor(activeWeeks / 8)), 25, 95);
  if (!snapshot) confidence = Math.max(25, confidence - 10);
  let verdict: string;
  let summary: string;
  if (activities12 < 3) { verdict = "insufficient_data"; summary = "Frog manque encore de données récentes pour valider cet objectif avec confiance."; }
  else if (score >= 75) { verdict = "feasible"; summary = "L’objectif paraît compatible avec ta base récente et le temps disponible."; }
  else if (score >= 52) { verdict = "challenging"; summary = "L’objectif est envisageable, mais plusieurs écarts devront être gérés dans la préparation."; }
  else { verdict = "not_recommended"; summary = "Dans les conditions actuelles, Frog ne recommande pas encore de construire un plan sur cet objectif."; }

  const metrics = {
    days_to_goal: daysToGoal, activities_12w: activities12, activities_4w: activities4,
    frequency_per_week_12w: frequency, longest_recent_distance_m: Math.round(longest),
    weekly_distance_m_4w: weeklyDistance, distance_readiness_ratio: Math.round(distanceRatio*1000)/1000,
    weekly_volume_to_goal_ratio: Math.round(volumeRatio*1000)/1000,
    target_pace_seconds_per_km: targetPace, threshold_pace_seconds_per_km: thresholdPace,
    latest_fitness_snapshot_at: snapshot?.captured_at || null,
    activities_365d: annualActivities, active_weeks_365d: activeWeeks,
    longest_365d_distance_m: annualLongest, distance_365d_m: num(recent.distance_365d),
    max_weekly_distance_365d_m: num(weeklyMax?.max_weekly), goal_like_sessions_365d: num(recent.goal_like_sessions_365d),
  };
  const id = randomUUID();
  await execute(
    "insert into goal_feasibility_assessments (id,goal_id,user_id,verdict,score,confidence,summary,reasons,metrics,model_version) values (?,?,?,?,?,?,?,?,?,?)",
    [id, goalId, userId, verdict, score, confidence, summary, JSON.stringify(reasons), JSON.stringify(metrics), "goal-engine-annual-v2-mariadb"]
  );
  return id;
}

async function acceptGoalAssessment(userId: string, goalId: string, assessmentId: string) {
  const assessment = await row<any>("select verdict from goal_feasibility_assessments where id=? and goal_id=? and user_id=?", [assessmentId, goalId, userId]);
  if (!assessment) throw new Error("Évaluation introuvable");
  if (!["feasible","challenging"].includes(assessment.verdict)) throw new Error("Cette évaluation ne peut pas être validée");
  await execute("update goals set accepted_assessment_id=?,accepted_at=utc_timestamp(3) where id=? and user_id=? and status='active'", [assessmentId, goalId, userId]);
  return null;
}

async function cancelPrimaryGoal(userId: string, goalId: string) {
  const goal = await row<any>("select id from goals where id=? and user_id=? and goal_type='primary' and status='active'", [goalId,userId]);
  if (!goal) throw new Error("Objectif principal introuvable");
  await execute("update goals set status='cancelled' where user_id=? and (id=? or parent_goal_id=?) and status='active'", [userId,goalId,goalId]);
  const plans = await rows<any>("select id from training_plans where user_id=? and goal_id=? and status='active'", [userId,goalId]);
  for (const plan of plans) {
    await execute("update training_plans set status='cancelled' where id=? and user_id=?", [plan.id,userId]);
    await execute("update planned_workouts set status='cancelled' where plan_id=? and user_id=? and status='planned'", [plan.id,userId]);
  }
  return null;
}

function workoutSteps(type: string, durationS: number | null, distanceM: number | null, targetPace: number | null) {
  const duration = durationS || 2700;
  if (["quality","intervals","sharpening"].includes(type)) {
    const work = 180; const recovery = 120; const reps = clamp(Math.round((duration - 1200) / (work + recovery)), 3, 8);
    return [
      { kind:"warmup", duration_s:600, intensity:"easy", label:"Échauffement" },
      { kind:"repeat", repetitions:reps, work_duration_s:work, recovery_duration_s:recovery, target_pace_seconds_per_km:targetPace, label:"Bloc qualité" },
      { kind:"cooldown", duration_s:600, intensity:"easy", label:"Retour au calme" },
    ];
  }
  if (type === "long") return [{ kind:"steady", distance_m:distanceM, intensity:"easy", label:"Sortie longue facile" }, { kind:"guidance", target_pace_seconds_per_km:targetPace ? Math.round(targetPace*1.15) : null, label:"Repère d’allure" }];
  if (type === "strength") return [{ kind:"activation", duration_s:180, label:"Activation" }, { kind:"circuit", rounds:3, label:"Circuit principal", exercises:[{name:"Squat vers une chaise",reps:10},{name:"Fente arrière alternée",reps_each_side:8},{name:"Montées sur pointes",reps:15},{name:"Dead bug",reps_each_side:8},{name:"Gainage latéral",duration_s_each_side:25}] }, { kind:"mobility", duration_s:180, label:"Mobilité finale" }];
  return [{ kind:"warmup", duration_s:300, intensity:"easy", label:"Mise en route" }, { kind:"steady", duration_s:Math.max(300,duration-600), intensity:"easy", label:"Endurance facile" }, { kind:"cooldown", duration_s:300, intensity:"easy", label:"Retour au calme" }];
}

async function generateTrainingPlan(userId: string, force: boolean) {
  const goal = await row<any>("select * from goals where user_id=? and goal_type='primary' and status='active' order by created_at desc limit 1", [userId]);
  if (!goal) throw new Error("Aucun objectif principal actif");
  if (!goal.accepted_assessment_id) throw new Error("Valide d’abord l’analyse de faisabilité");
  const latest = await row<any>("select * from goal_feasibility_assessments where goal_id=? and user_id=? order by created_at desc limit 1", [goal.id,userId]);
  if (!latest || latest.id !== goal.accepted_assessment_id) throw new Error("La dernière analyse doit être validée avant de générer le plan");
  if (!["feasible","challenging"].includes(latest.verdict)) throw new Error("L’évaluation validée ne permet pas de générer un plan");
  if (goal.event_date <= isoDate()) throw new Error("La date de l’objectif doit être dans le futur");
  const profile = await row<any>("select * from athlete_profiles where user_id=?", [userId]);
  if (!profile) throw new Error("Profil athlète introuvable");
  const existing = await row<any>("select * from training_plans where user_id=? and status='active' order by created_at desc limit 1", [userId]);
  if (existing && !force && existing.assessment_id === latest.id) return existing.id;
  if (existing) await execute("update training_plans set status='superseded' where id=? and user_id=?", [existing.id,userId]);

  const sessions = clamp(num(profile.weekly_sessions_target,4),2,6);
  const availability = asObject(profile.availability);
  let days = asArray<number>(availability.days).map(Number).filter((d) => d>=1&&d<=7).sort();
  if (!days.length) days=[2,4,6,7];
  let longDay = num(profile.long_session_day,7); if (!days.includes(longDay)) longDay=days[days.length-1];
  const prefs = asObject(profile.training_preferences);
  const strength = Boolean(prefs.strength);
  const cross = Boolean(prefs.crossTraining);
  const metrics = asObject(latest.metrics);
  const targetPace = num(metrics.target_pace_seconds_per_km) || (goal.target_duration_s ? num(goal.target_duration_s)/(num(goal.distance_m)/1000) : null);
  const recentLong = num(metrics.longest_recent_distance_m, num(goal.distance_m)*.55);
  const versionRow = await row<any>("select coalesce(max(version),0) version from training_plans where user_id=? and goal_id=?", [userId,goal.id]);
  const version = num(versionRow?.version)+1;
  const planId=randomUUID();
  await execute(
    "insert into training_plans (id,user_id,goal_id,assessment_id,version,engine_version,status,starts_on,ends_on,sessions_per_week,summary,generation_context) values (?,?,?,?,?,'plan-engine-v1-mariadb','active',?,?,?,?,?)",
    [planId,userId,goal.id,latest.id,version,isoDate(),goal.event_date,sessions,`Préparation ${goal.event_name} jusqu’au ${goal.event_date}. Priorité à la régularité et à une montée progressive de la charge.`,JSON.stringify({weekly_sessions_target:sessions,availability_days:days,long_session_day:longDay,strength_enabled:strength,cross_training_enabled:cross,recent_long_distance_m:recentLong,target_pace_seconds_per_km:targetPace})]
  );

  let weekStart=mondayOf(isoDate()); let weekIndex=0;
  while (weekStart <= goal.event_date && weekIndex < 80) {
    const weekEnd = addDays(weekStart,6) < goal.event_date ? addDays(weekStart,6) : goal.event_date;
    const daysToEvent = diffDays(goal.event_date,weekStart);
    const phase = goal.event_date>=weekStart && goal.event_date<=addDays(weekStart,6) ? "race" : daysToEvent<=14 ? "taper" : "build";
    const loadScale = phase==="race"?.4:phase==="taper"?.7:(weekIndex>0&&weekIndex%4===3?.85:Math.min(1.1,.92+weekIndex*.05));
    const weekId=randomUUID();
    await execute("insert into training_plan_weeks (id,plan_id,user_id,week_index,starts_on,ends_on,phase,target_sessions,load_scale,notes) values (?,?,?,?,?,?,?,?,?,?)", [weekId,planId,userId,weekIndex,weekStart < isoDate()?isoDate():weekStart,weekEnd,phase,0,loadScale,phase==="race"?"Semaine de course : réduire le volume et arriver frais.":phase==="taper"?"Réduire le volume tout en gardant quelques rappels d’allure.":"Construire la régularité avec qualité contrôlée, endurance facile et sortie longue."]);

    let created=0; let qualityUsed=false;
    const dates = days.map((day)=>addDays(weekStart,day-1)).filter((date)=>date>=isoDate()&&date<=goal.event_date);
    if (goal.event_date>=weekStart&&goal.event_date<=addDays(weekStart,6)&&!dates.includes(goal.event_date)) dates.push(goal.event_date);
    dates.sort();
    for (const date of dates) {
      if (created>=sessions && date!==goal.event_date) break;
      let workoutType="easy", title="Endurance facile", sport=goal.sport, intensity="easy", duration=2700, distance:number|null=null;
      if (date===goal.event_date) { workoutType="race"; title=goal.event_name; intensity="race"; duration=num(goal.target_duration_s)||null as any; distance=num(goal.distance_m); }
      else {
        const weekday=(parseDate(date).getUTCDay()||7);
        if (weekday===longDay) { workoutType="long"; title="Sortie longue"; intensity="easy"; const progress=clamp((weekIndex+1)/Math.max(4,Math.ceil(diffDays(goal.event_date,isoDate())/7)-2),0,1); distance=Math.round(Math.min(num(goal.distance_m)*.9,recentLong+(num(goal.distance_m)*.9-recentLong)*progress)*loadScale/100)*100; duration=targetPace&&distance?Math.round((distance/1000)*targetPace*1.15):Math.round(5400*loadScale); }
        else if (!qualityUsed && phase!=="race") { qualityUsed=true; workoutType=phase==="taper"?"sharpening":"quality"; title=phase==="taper"?"Rappel d’allure":"Séance qualité"; intensity="quality"; duration=Math.round((phase==="taper"?2400:3000)*loadScale); }
        else if (strength && created===sessions-1 && phase==="build") { workoutType="strength"; title="Renforcement"; sport="strength"; intensity="moderate"; duration=1800; }
        else if (cross && created===sessions-1 && phase==="build") { workoutType="cross_training"; title="Endurance croisée"; sport=goal.sport==="running"||goal.sport==="trail"?"road_cycling":goal.sport; intensity="easy"; duration=3600; }
      }
      const workoutId=randomUUID(); const steps=workoutType==="race"?[{kind:"race",distance_m:distance,target_pace_seconds_per_km:targetPace,label:"Jour J"}]:workoutSteps(workoutType,duration,distance,targetPace);
      const exportReady=["running","trail","road_cycling","gravel"].includes(sport)&&workoutType!=="race";
      await execute("insert into planned_workouts (id,plan_id,plan_week_id,user_id,goal_id,scheduled_date,sort_order,sport,workout_type,title,description,duration_s,distance_m,intensity,structured_steps,status,source,workout_schema_version,device_export_ready) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned','plan-engine-v1-mariadb','frog-workout-v1',?)", [workoutId,planId,weekId,userId,goal.id,date,created,sport,workoutType,title,workoutType==="quality"?"Séance de qualité contrôlée adaptée à l’objectif.":workoutType==="long"?"Sortie longue en endurance facile.":null,duration,distance,intensity,JSON.stringify(steps),exportReady?1:0]);
      created++;
    }
    await execute("update training_plan_weeks set target_sessions=? where id=?", [created,weekId]);
    weekIndex++;
    weekStart=addDays(weekStart,7);
  }
  return planId;
}

async function confirmWorkoutMatch(userId:string, plannedWorkoutId:string, activityId:string) {
  const workout=await row<any>("select id from planned_workouts where id=? and user_id=?",[plannedWorkoutId,userId]);
  const activity=await row<any>("select id from activities where id=? and user_id=?",[activityId,userId]);
  if(!workout||!activity) throw new Error("Séance ou activité introuvable");
  await execute("delete from workout_matches where user_id=? and (planned_workout_id=? or activity_id=?)",[userId,plannedWorkoutId,activityId]);
  const id=randomUUID();
  await execute("insert into workout_matches (id,user_id,planned_workout_id,activity_id,status,match_method,confidence,score_breakdown) values (?,?,?,?,'confirmed','manual',1,'{}')",[id,userId,plannedWorkoutId,activityId]);
  await execute("update planned_workouts set status='completed' where id=? and user_id=?",[plannedWorkoutId,userId]);
  return id;
}

async function removeWorkoutMatch(userId:string, activityId:string) {
  const match=await row<any>("select planned_workout_id from workout_matches where user_id=? and activity_id=?",[userId,activityId]);
  if(match) {
    await execute("delete from workout_matches where user_id=? and activity_id=?",[userId,activityId]);
    await execute("update planned_workouts set status='planned' where id=? and user_id=?",[match.planned_workout_id,userId]);
  }
  return null;
}

async function analyzeWorkoutFeedback(userId:string, matchId:string) {
  const data=await row<any>(`select m.id match_id,m.planned_workout_id,m.activity_id,f.id feedback_id,f.perceived_effort,f.feeling,f.completed_as_planned,f.pain_or_discomfort,f.health_status,
    p.distance_m planned_distance,p.duration_s planned_duration,p.workout_type,a.distance_m actual_distance,a.duration_s actual_duration
    from workout_matches m join workout_feedback f on f.match_id=m.id and f.user_id=m.user_id
    join planned_workouts p on p.id=m.planned_workout_id join activities a on a.id=m.activity_id
    where m.id=? and m.user_id=? and m.status='confirmed' limit 1`,[matchId,userId]);
  if(!data) throw new Error("Feedback ou rapprochement introuvable");
  let adherence=100;
  const metrics:any={rpe:num(data.perceived_effort),feeling:data.feeling,pain_or_discomfort:Boolean(data.pain_or_discomfort),health_status:data.health_status};
  let deviation:number|null=null;
  if(num(data.planned_distance)>0&&num(data.actual_distance)>0) deviation=Math.abs(num(data.actual_distance)-num(data.planned_distance))/num(data.planned_distance);
  else if(num(data.planned_duration)>0&&num(data.actual_duration)>0) deviation=Math.abs(num(data.actual_duration)-num(data.planned_duration))/num(data.planned_duration);
  if(deviation!=null){ metrics.metric_deviation=deviation; adherence-=Math.min(45,Math.round(deviation*100)); }
  if(!data.completed_as_planned) adherence-=15;
  adherence=clamp(adherence,0,100);
  let outcome="on_track";
  if(!data.completed_as_planned||adherence<60) outcome="deviated";
  else if(num(data.perceived_effort)>=8||["hard","very_hard"].includes(data.feeling)) outcome="harder_than_expected";
  else if(num(data.perceived_effort)<=3||["easy","very_easy"].includes(data.feeling)) outcome="easier_than_expected";
  const recommendations:string[]=[];
  if(outcome==="harder_than_expected") recommendations.push("Surveille la récupération avant la prochaine séance exigeante.");
  if(outcome==="easier_than_expected") recommendations.push("La séance a été bien maîtrisée ; Frog conserve ce signal sans augmenter automatiquement la charge.");
  if(data.pain_or_discomfort) recommendations.push("Un inconfort a été signalé : ce signal sera pris en compte dans le prochain bilan.");
  if(data.health_status==="ill") recommendations.push("Tu as indiqué être malade : ce signal sera transmis au bilan d’adaptation.");
  else if(data.health_status==="fatigued") recommendations.push("Une fatigue générale inhabituelle a été signalée et sera suivie dans le bilan.");
  const summary=outcome==="on_track"?"Séance globalement conforme au plan.":outcome==="harder_than_expected"?"La séance a été ressentie plus difficilement que prévu.":outcome==="easier_than_expected"?"La séance a été ressentie plus facilement que prévu.":"La réalisation s’écarte du plan prévu.";
  const existing=await row<any>("select id from workout_analyses where match_id=? and user_id=?",[matchId,userId]);
  const id=existing?.id||randomUUID();
  if(existing) await execute("update workout_analyses set feedback_id=?,adherence_score=?,outcome=?,summary=?,metrics=?,recommendations=?,model_version='post-session-v1-mariadb' where id=? and user_id=?",[data.feedback_id,adherence,outcome,summary,JSON.stringify(metrics),JSON.stringify(recommendations),id,userId]);
  else await execute("insert into workout_analyses (id,user_id,match_id,feedback_id,adherence_score,outcome,summary,metrics,recommendations,model_version) values (?,?,?,?,?,?,?,?,?,'post-session-v1-mariadb')",[id,userId,matchId,data.feedback_id,adherence,outcome,summary,JSON.stringify(metrics),JSON.stringify(recommendations)]);
  try { await generateWeeklyReview(userId); } catch {}
  return id;
}

async function generateWeeklyReview(userId:string) {
  const plan=await row<any>("select * from training_plans where user_id=? and status='active' order by created_at desc limit 1",[userId]);
  if(!plan) throw new Error("Aucun plan actif");
  const weekStart=mondayOf(isoDate()), weekEnd=addDays(weekStart,6), lookback=addDays(isoDate(),-6);
  const fit=await row<any>("select recovery,load_ratio,hrv from fitness_snapshots where user_id=? order by captured_at desc limit 1",[userId]);
  const feedback=await row<any>(`select count(*) feedback_count,avg(perceived_effort) avg_rpe,sum(pain_or_discomfort=1) discomfort,sum(health_status='fatigued') fatigued,sum(health_status='ill') ill from workout_feedback where user_id=? and date(submitted_at) between ? and ?`,[userId,lookback,isoDate()])||{};
  const analyses=await row<any>(`select avg(wa.adherence_score) avg_adherence,sum(wa.outcome='harder_than_expected') harder,sum(wa.outcome='deviated') deviated from workout_analyses wa where wa.user_id=? and date(wa.created_at) between ? and ?`,[userId,lookback,isoDate()])||{};
  const due=await row<any>(`select count(*) planned_due from planned_workouts where plan_id=? and user_id=? and scheduled_date between ? and ? and scheduled_date<=?`,[plan.id,userId,weekStart,weekEnd,isoDate()]);
  const matched=await row<any>(`select count(*) confirmed from workout_matches m join planned_workouts p on p.id=m.planned_workout_id where m.user_id=? and p.plan_id=? and p.scheduled_date between ? and ? and m.status='confirmed'`,[userId,plan.id,weekStart,weekEnd]);
  const plannedDue=num(due?.planned_due), confirmed=num(matched?.confirmed), completion=plannedDue?confirmed/plannedDue:null;
  let risk=0, confidence=.45;
  const recovery=fit?.recovery==null?null:num(fit.recovery), loadRatio=fit?.load_ratio==null?null:num(fit.load_ratio), avgRpe=feedback.avg_rpe==null?null:num(feedback.avg_rpe);
  if(recovery!=null&&recovery<50) risk+=2; else if(recovery!=null&&recovery<65) risk+=1;
  if(loadRatio!=null&&loadRatio>1.5) risk+=2; else if(loadRatio!=null&&loadRatio>1.3) risk+=1;
  if(avgRpe!=null&&avgRpe>=8) risk+=2; else if(avgRpe!=null&&avgRpe>=7) risk+=1;
  if(num(feedback.discomfort)>0) risk+=2;
  if(num(feedback.ill)>0){risk+=3;confidence+=.05;} else if(num(feedback.fatigued)>0){risk+=1;confidence+=.03;}
  if(num(analyses.harder)>0) risk+=1; if(num(analyses.deviated)>0) risk+=1;
  if(num(feedback.feedback_count)>0) confidence+=.15; if(fit) confidence+=.15; if(num(analyses.avg_adherence)>0) confidence+=.1;
  confidence=clamp(confidence,.25,.95);
  const decision=risk>=5?"recovery":risk>=3?"reduce":"maintain";
  const readiness=clamp(100-risk*10,20,100);
  const signals={recovery,loadRatio,avgRpe,feedbackCount:num(feedback.feedback_count),discomfortSignals:num(feedback.discomfort),generalFatigueSignals:num(feedback.fatigued),illnessSignals:num(feedback.ill),harderThanExpected:num(analyses.harder),deviated:num(analyses.deviated),avgAdherence:analyses.avg_adherence==null?null:num(analyses.avg_adherence),completionRatio:completion};
  const summary=decision==="maintain"?"Les signaux disponibles ne justifient pas d’alléger la semaine.":decision==="reduce"?"Plusieurs signaux suggèrent de réduire la charge d’une prochaine séance exigeante.":"Les signaux récents donnent la priorité à la récupération.";
  const recommendation=decision==="maintain"?"Maintenir le plan actuel et continuer à renseigner les retours post-séance.":decision==="reduce"?"Alléger une prochaine séance de qualité sans modifier sa date.":"Transformer une prochaine séance exigeante en récupération facile, après validation.";
  let review=await row<any>("select id from weekly_reviews where plan_id=? and week_start=?",[plan.id,weekStart]);
  const reviewId=review?.id||randomUUID();
  await execute("delete from plan_adaptations where review_id=? and status='proposed'",[reviewId]);
  let status="no_change";
  if(decision!=="maintain") {
    const candidate=await row<any>("select * from planned_workouts where plan_id=? and user_id=? and status='planned' and scheduled_date>=? and intensity in ('quality','moderate') order by scheduled_date limit 1",[plan.id,userId,isoDate()]);
    if(candidate){
      const reduction=decision==="recovery"?40:20;
      const after={title:decision==="recovery"?"Récupération facile":candidate.title,duration_s:Math.max(1200,Math.round(num(candidate.duration_s,2400)*(1-reduction/100))),distance_m:candidate.distance_m?Math.round(num(candidate.distance_m)*(1-reduction/100)):null,intensity:decision==="recovery"?"recovery":"easy",structured_steps:decision==="recovery"?workoutSteps("easy",Math.max(1200,Math.round(num(candidate.duration_s,2400)*(1-reduction/100))),null,null):candidate.structured_steps};
      await execute("insert into plan_adaptations (id,user_id,review_id,planned_workout_id,action,reduction_pct,reason,before_state,after_state,status) values (?,?,?,?,?,?,?,?,?,'proposed')",[randomUUID(),userId,reviewId,candidate.id,decision==="recovery"?"recovery":"reduce",reduction,recommendation,JSON.stringify(candidate),JSON.stringify(after)]);
      status="proposed";
    }
  }
  if(review) await execute("update weekly_reviews set week_end=?,decision=?,readiness_score=?,confidence=?,signals=?,summary=?,recommendation=?,model_version='weekly-adaptation-v1-mariadb',status=? where id=? and user_id=?",[weekEnd,decision,readiness,confidence,JSON.stringify(signals),summary,recommendation,status,reviewId,userId]);
  else await execute("insert into weekly_reviews (id,user_id,plan_id,week_start,week_end,decision,readiness_score,confidence,signals,summary,recommendation,model_version,status) values (?,?,?,?,?,?,?,?,?,?,?,'weekly-adaptation-v1-mariadb',?)",[reviewId,userId,plan.id,weekStart,weekEnd,decision,readiness,confidence,JSON.stringify(signals),summary,recommendation,status]);
  return {id:reviewId,decision,status};
}

async function applyWeeklyAdaptation(userId:string, reviewId:string) {
  const review=await row<any>("select * from weekly_reviews where id=? and user_id=?",[reviewId,userId]); if(!review) throw new Error("Bilan introuvable");
  const adaptations=await rows<any>("select * from plan_adaptations where review_id=? and user_id=? and status='proposed'",[reviewId,userId]);
  for(const adaptation of adaptations){ const after=asObject(adaptation.after_state); const fields=["title","duration_s","distance_m","intensity","structured_steps"].filter((k)=>after[k]!==undefined); if(fields.length){ const values=fields.map((k)=>k==="structured_steps"?JSON.stringify(after[k]):after[k]); await execute(`update planned_workouts set ${fields.map((k)=>`\`${k}\`=?`).join(",")} where id=? and user_id=?`,[...values,adaptation.planned_workout_id,userId]); } await execute("update plan_adaptations set status='applied',applied_at=utc_timestamp(3) where id=? and user_id=?",[adaptation.id,userId]); }
  await execute("update weekly_reviews set status='applied',applied_at=utc_timestamp(3) where id=? and user_id=?",[reviewId,userId]);
  return null;
}

async function progressDashboard(userId:string) {
  const plan=await row<any>("select id,goal_id from training_plans where user_id=? and status='active' order by created_at desc limit 1",[userId]);
  async function agg(days:number,offset=0){ return await row<any>(`select count(*) activities,coalesce(sum(case when sport_type between 100 and 199 then distance_m else 0 end),0) runningDistanceM,coalesce(sum(duration_s),0) durationS,coalesce(sum(elevation_gain_m),0) elevationM,coalesce(sum(training_load),0) trainingLoad,coalesce(max(case when sport_type between 100 and 199 then distance_m else 0 end),0) longestRunM from activities where user_id=? and started_at>=date_sub(utc_timestamp(),interval ? day) ${offset?"and started_at<date_sub(utc_timestamp(),interval ? day)":""}`,[userId,days+offset,...(offset?[offset]:[])]); }
  const current28=await agg(28), previous28=await agg(28,28), last90=await agg(90), year=await agg(365);
  const activeWeeks=await row<any>("select count(distinct yearweek(started_at,3)) activeWeeks from activities where user_id=? and started_at>=date_sub(utc_timestamp(),interval 365 day)",[userId]); year.activeWeeks=num(activeWeeks?.activeWeeks);
  const weekly=await rows<any>(`select date_format(date_sub(date(started_at),interval weekday(started_at) day),'%Y-%m-%d') weekStart,count(*) activities,coalesce(sum(case when sport_type between 100 and 199 then distance_m else 0 end),0) runningDistanceM,coalesce(sum(duration_s),0) durationS,coalesce(sum(training_load),0) trainingLoad from activities where user_id=? and started_at>=date_sub(utc_timestamp(),interval 12 week) group by weekStart order by weekStart`,[userId]);
  const fitness=await row<any>("select captured_at capturedAt,recovery,short_load shortLoad,long_load longLoad,load_ratio loadRatio,vo2max,threshold_pace thresholdPace,threshold_hr thresholdHr,hrv,resting_hr restingHr from fitness_snapshots where user_id=? order by captured_at desc limit 1",[userId])||{};
  let planStats:any={}; if(plan){ planStats=await row<any>("select sum(scheduled_date<=current_date) plannedDue,sum(scheduled_date<=current_date and status='completed') completedDue,sum(scheduled_date>current_date) remaining from planned_workouts where plan_id=? and user_id=?",[plan.id,userId])||{}; }
  const feedback=await row<any>("select count(*) count,avg(perceived_effort) avgRpe from workout_feedback where user_id=?",[userId])||{};
  const analyses=await row<any>("select count(*) count,avg(adherence_score) avgAdherence from workout_analyses where user_id=?",[userId])||{};
  const adaptations=await row<any>("select sum(status='applied') applied from plan_adaptations where user_id=?",[userId])||{};
  return {generatedAt:new Date().toISOString(),goalId:plan?.goal_id||null,planId:plan?.id||null,current28,previous28,last90,year,weekly,fitness,plan:planStats,feedback,analyses,adaptations};
}

async function generateRaceStrategy(userId:string) {
  const goal=await row<any>("select * from goals where user_id=? and goal_type='primary' and status='active' order by created_at desc limit 1",[userId]); if(!goal) throw new Error("Aucun objectif principal actif");
  if(!goal.target_duration_s||num(goal.distance_m)<=0) throw new Error("L’objectif doit avoir une distance et un chrono cible");
  const plan=await row<any>("select * from training_plans where user_id=? and goal_id=? and status='active' order by created_at desc limit 1",[userId,goal.id]);
  const distanceKm=num(goal.distance_m)/1000, q=distanceKm/4, targetPace=num(goal.target_duration_s)/distanceKm;
  const p1=targetPace+4,p2=targetPace+1,p3=targetPace,c1=q*p1,c2=c1+q*p2,c3=c2+q*p3,p4=Math.max(targetPace-12,(num(goal.target_duration_s)-c3)/q);
  const segments=[{fromKm:0,toKm:+q.toFixed(1),paceSecondsPerKm:Math.round(p1),cumulativeTargetS:Math.round(c1),instruction:"Départ contrôlé. Laisser passer les accélérations et trouver le rythme."},{fromKm:+q.toFixed(1),toKm:+(q*2).toFixed(1),paceSecondsPerKm:Math.round(p2),cumulativeTargetS:Math.round(c2),instruction:"Stabiliser l’allure et courir relâché."},{fromKm:+(q*2).toFixed(1),toKm:+(q*3).toFixed(1),paceSecondsPerKm:Math.round(p3),cumulativeTargetS:Math.round(c3),instruction:"Tenir l’allure cible et vérifier la qualité de foulée."},{fromKm:+(q*3).toFixed(1),toKm:+distanceKm.toFixed(1),paceSecondsPerKm:Math.round(p4),cumulativeTargetS:num(goal.target_duration_s),instruction:"Accélération progressive seulement si les sensations restent maîtrisées."}];
  const fueling=num(goal.target_duration_s)>=5400?[{when:"Avant le départ",instruction:"Petit-déjeuner et hydratation déjà testés à l’entraînement."},{when:"Vers 40–45 min",instruction:"Premier apport uniquement avec un produit déjà toléré, accompagné d’eau."},{when:"Vers 80–85 min",instruction:"Deuxième apport si cela correspond à ta routine testée."}]:[{when:"Avant le départ",instruction:"Utiliser uniquement une routine déjà testée à l’entraînement."},{when:"Pendant",instruction:"Hydratation selon les conditions et les ravitaillements."}];
  const checklist=[{phase:"J-1",items:["Préparer tenue, dossard et matériel","Ne pas compenser une séance manquée","Repas et hydratation habituels"]},{phase:"Avant départ",items:["Routine habituelle","Échauffement court et progressif","Se placer sans partir au rythme des autres"]},{phase:"Pendant",items:["Contrôler les premiers kilomètres","Suivre les segments plutôt que l’allure instantanée","N’accélérer franchement qu’en fin de course si les sensations le permettent"]},{phase:"Plan B",items:["Si l’effort est anormalement élevé tôt, ralentir immédiatement","Prioriser une course régulière plutôt qu’un chrono forcé","En cas de douleur inhabituelle ou malaise, arrêter l’effort et demander de l’aide"]}];
  await execute("update race_strategies set status='superseded' where user_id=? and goal_id=? and status='active'",[userId,goal.id]);
  const v=await row<any>("select coalesce(max(version),0)+1 version from race_strategies where user_id=? and goal_id=?",[userId,goal.id]); const id=randomUUID();
  await execute("insert into race_strategies (id,user_id,goal_id,plan_id,assessment_id,version,strategy_version,status,target_duration_s,target_pace_s_per_km,segments,fueling,checklist,context) values (?,?,?,?,?,?,'race-day-v1-mariadb','active',?,?,?,?,?,?)",[id,userId,goal.id,plan?.id||null,goal.accepted_assessment_id||null,num(v?.version,1),num(goal.target_duration_s),targetPace,JSON.stringify(segments),JSON.stringify(fueling),JSON.stringify(checklist),JSON.stringify({generatedAt:new Date().toISOString()})]);
  return {id};
}

async function coachContext(userId:string) {
  const goal=await row<any>("select * from goals where user_id=? and goal_type='primary' and status='active' order by created_at desc limit 1",[userId]);
  const fitness=await row<any>("select * from fitness_snapshots where user_id=? order by captured_at desc limit 1",[userId])||{};
  const weeklyReview=await row<any>("select * from weekly_reviews where user_id=? order by created_at desc limit 1",[userId])||{};
  const plan=await row<any>("select id from training_plans where user_id=? and status='active' order by created_at desc limit 1",[userId]);
  const today=isoDate();
  const todayWorkout=plan?await row<any>("select * from planned_workouts where plan_id=? and user_id=? and scheduled_date=? and status='planned' order by sort_order limit 1",[plan.id,userId,today]):null;
  const nextWorkout=plan?await row<any>("select * from planned_workouts where plan_id=? and user_id=? and scheduled_date>=? and status='planned' order by scheduled_date,sort_order limit 1",[plan.id,userId,today]):null;
  const progress=await progressDashboard(userId);
  const raceStrategy=goal?await row<any>("select * from race_strategies where user_id=? and goal_id=? and status='active' order by version desc limit 1",[userId,goal.id]):null;
  const memories=await rows<any>("select category,content,source,confidence from coach_memories where user_id=? and status='active' order by created_at desc limit 25",[userId]);
  return {goal,fitness,weeklyReview,todayWorkout,nextWorkout,progress,raceStrategy,memories};
}

async function appendCoachMessage(userId:string, threadId:string, content:string, context:unknown) {
  const thread=await row<any>("select id from coach_threads where id=? and user_id=?",[threadId,userId]); if(!thread) throw new Error("Conversation introuvable");
  await execute("insert into coach_messages (id,thread_id,user_id,role,content,context_snapshot) values (?,?,?,'assistant',?,?)",[randomUUID(),threadId,userId,content,JSON.stringify(context||{})]);
  await execute("update coach_threads set updated_at=utc_timestamp(3) where id=? and user_id=?",[threadId,userId]);
  return null;
}

export async function runRpc(userId:string,name:string,args:Record<string,any>={}) {
  switch(name){
    case "assess_goal_feasibility": return assessGoal(userId,String(args.p_goal_id||""));
    case "accept_goal_assessment": return acceptGoalAssessment(userId,String(args.p_goal_id||""),String(args.p_assessment_id||""));
    case "cancel_primary_goal": return cancelPrimaryGoal(userId,String(args.p_goal_id||""));
    case "generate_training_plan": return generateTrainingPlan(userId,Boolean(args.p_force));
    case "confirm_workout_match": return confirmWorkoutMatch(userId,String(args.p_planned_workout_id||""),String(args.p_activity_id||""));
    case "remove_workout_match": return removeWorkoutMatch(userId,String(args.p_activity_id||""));
    case "analyze_workout_feedback": return analyzeWorkoutFeedback(userId,String(args.p_match_id||""));
    case "generate_weekly_review": return generateWeeklyReview(userId);
    case "apply_weekly_adaptation": return applyWeeklyAdaptation(userId,String(args.p_review_id||""));
    case "get_progress_dashboard": return progressDashboard(userId);
    case "generate_race_strategy": return generateRaceStrategy(userId);
    case "get_coach_context": return coachContext(userId);
    case "append_coach_assistant_message": return appendCoachMessage(userId,String(args.p_thread_id||""),String(args.p_content||""),args.p_context);
    default: throw new Error(`RPC locale non migrée: ${name}`);
  }
}
