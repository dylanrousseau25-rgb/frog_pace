SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX sessions_user_idx(user_id),
  INDEX sessions_expiry_idx(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_profiles (
  user_id CHAR(36) PRIMARY KEY,
  display_name VARCHAR(140),
  timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
  onboarding_completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT user_profiles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE athlete_profiles (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL UNIQUE,
  primary_sports LONGTEXT NOT NULL DEFAULT '[]',
  experience_level VARCHAR(40),
  weekly_sessions_target INT,
  long_session_day TINYINT,
  availability LONGTEXT NOT NULL DEFAULT '{}',
  injuries_and_vigilance LONGTEXT NOT NULL DEFAULT '[]',
  equipment LONGTEXT NOT NULL DEFAULT '{}',
  training_preferences LONGTEXT NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT athlete_profiles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE provider_connections (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  provider ENUM('coros','trainingpeaks','garmin','apple','suunto','polar','fitbit') NOT NULL,
  status ENUM('disconnected','connecting','connected','expired','error') NOT NULL DEFAULT 'disconnected',
  external_user_id VARCHAR(255),
  scopes LONGTEXT NOT NULL DEFAULT '[]',
  metadata LONGTEXT NOT NULL DEFAULT '{}',
  last_sync_at DATETIME(3),
  last_error TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY provider_connections_user_provider_uq(user_id,provider),
  CONSTRAINT provider_connections_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX provider_connections_user_idx(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE provider_credentials (
  provider_connection_id CHAR(36) PRIMARY KEY,
  client_id_encrypted TEXT,
  access_token_encrypted MEDIUMTEXT,
  refresh_token_encrypted MEDIUMTEXT,
  expires_at DATETIME(3),
  scope TEXT,
  token_type VARCHAR(50),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT provider_credentials_connection_fk FOREIGN KEY (provider_connection_id) REFERENCES provider_connections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE provider_oauth_states (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  state VARCHAR(255) NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes LONGTEXT NOT NULL DEFAULT '[]',
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT provider_oauth_states_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX provider_oauth_states_user_provider_idx(user_id,provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE provider_syncs (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  sync_type VARCHAR(40) NOT NULL DEFAULT 'manual',
  status ENUM('running','success','partial','error') NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3),
  imported_activities INT NOT NULL DEFAULT 0,
  details LONGTEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  CONSTRAINT provider_syncs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX provider_syncs_user_started_idx(user_id,started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activities (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_activity_id VARCHAR(255) NOT NULL,
  sport VARCHAR(80),
  sport_type INT,
  started_at DATETIME(3),
  ended_at DATETIME(3),
  distance_m DECIMAL(14,3),
  duration_s INT,
  avg_hr INT,
  max_hr INT,
  pace_seconds_per_km DECIMAL(12,3),
  avg_speed_kmh DECIMAL(12,3),
  elevation_gain_m DECIMAL(14,3),
  training_load DECIMAL(14,3),
  training_effect LONGTEXT NOT NULL DEFAULT '{}',
  training_focus VARCHAR(255),
  avg_cadence DECIMAL(12,3),
  max_cadence DECIMAL(12,3),
  raw_provider_data LONGTEXT NOT NULL DEFAULT '{}',
  detail_provider_data LONGTEXT NOT NULL DEFAULT '{}',
  detail_sync_attempted_at DATETIME(3),
  detail_fetched_at DATETIME(3),
  detail_sync_error TEXT,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY activities_provider_uq(user_id,provider,provider_activity_id),
  CONSTRAINT activities_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX activities_user_started_idx(user_id,started_at),
  INDEX activities_user_provider_idx(user_id,provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fitness_snapshots (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  recovery DECIMAL(12,3),
  sleep LONGTEXT NOT NULL DEFAULT '{}',
  hrv LONGTEXT NOT NULL DEFAULT '{}',
  resting_hr DECIMAL(12,3),
  short_load DECIMAL(14,3),
  long_load DECIMAL(14,3),
  load_ratio DECIMAL(12,4),
  vo2max DECIMAL(12,3),
  threshold_pace VARCHAR(80),
  threshold_hr DECIMAL(12,3),
  race_predictions LONGTEXT NOT NULL DEFAULT '{}',
  raw_provider_data LONGTEXT NOT NULL DEFAULT '{}',
  CONSTRAINT fitness_snapshots_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX fitness_snapshots_user_captured_idx(user_id,captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36),
  operation VARCHAR(120) NOT NULL,
  entity_type VARCHAR(120),
  entity_id CHAR(36),
  result VARCHAR(40) NOT NULL DEFAULT 'ok',
  request_id VARCHAR(255),
  metadata LONGTEXT NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT audit_events_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX audit_events_user_created_idx(user_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE coach_memories (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  category ENUM('preference','constraint','injury','training_response','habit','equipment','schedule','coach_learning') NOT NULL,
  content VARCHAR(500) NOT NULL,
  source ENUM('user_declared','feedback','coach_inferred','activity_pattern') NOT NULL DEFAULT 'user_declared',
  confidence DECIMAL(4,3) NOT NULL DEFAULT 1.000,
  status ENUM('active','superseded','deleted') NOT NULL DEFAULT 'active',
  sensitive TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_confirmed_at DATETIME(3),
  CONSTRAINT coach_memories_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX coach_memories_user_status_idx(user_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE goals (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  parent_goal_id CHAR(36),
  goal_type ENUM('primary','secondary') NOT NULL DEFAULT 'primary',
  sport ENUM('running','trail','road_cycling','gravel') NOT NULL,
  event_name VARCHAR(140) NOT NULL,
  event_date DATE NOT NULL,
  distance_m DECIMAL(14,3) NOT NULL,
  target_duration_s INT,
  priority TINYINT NOT NULL DEFAULT 3,
  status ENUM('draft','active','completed','cancelled') NOT NULL DEFAULT 'active',
  notes TEXT,
  accepted_assessment_id CHAR(36),
  accepted_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT goals_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT goals_parent_fk FOREIGN KEY (parent_goal_id) REFERENCES goals(id) ON DELETE SET NULL,
  INDEX goals_user_date_idx(user_id,event_date),
  INDEX goals_parent_idx(parent_goal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE goal_feasibility_assessments (
  id CHAR(36) PRIMARY KEY,
  goal_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  verdict ENUM('feasible','challenging','not_recommended','insufficient_data') NOT NULL,
  score INT NOT NULL,
  confidence INT NOT NULL,
  summary TEXT NOT NULL,
  reasons LONGTEXT NOT NULL DEFAULT '[]',
  metrics LONGTEXT NOT NULL DEFAULT '{}',
  model_version VARCHAR(80) NOT NULL DEFAULT 'goal-engine-v1',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT goal_assessments_goal_fk FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  CONSTRAINT goal_assessments_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX goal_assessments_goal_created_idx(goal_id,created_at),
  INDEX goal_assessments_user_idx(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE goals ADD CONSTRAINT goals_accepted_assessment_fk FOREIGN KEY (accepted_assessment_id) REFERENCES goal_feasibility_assessments(id) ON DELETE SET NULL;

CREATE TABLE training_plans (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  goal_id CHAR(36) NOT NULL,
  assessment_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  engine_version VARCHAR(80) NOT NULL DEFAULT 'plan-engine-v1',
  status ENUM('active','superseded','cancelled') NOT NULL DEFAULT 'active',
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  sessions_per_week TINYINT NOT NULL,
  summary TEXT NOT NULL,
  generation_context LONGTEXT NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY training_plans_version_uq(user_id,goal_id,version),
  CONSTRAINT training_plans_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT training_plans_goal_fk FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  CONSTRAINT training_plans_assessment_fk FOREIGN KEY (assessment_id) REFERENCES goal_feasibility_assessments(id),
  INDEX training_plans_goal_idx(goal_id,created_at),
  INDEX training_plans_assessment_idx(assessment_id),
  INDEX training_plans_user_status_idx(user_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE training_plan_weeks (
  id CHAR(36) PRIMARY KEY,
  plan_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  week_index INT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  phase ENUM('build','taper','race') NOT NULL,
  target_sessions TINYINT NOT NULL DEFAULT 0,
  load_scale DECIMAL(8,4) NOT NULL DEFAULT 1,
  notes TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY training_plan_weeks_uq(plan_id,week_index),
  CONSTRAINT training_plan_weeks_plan_fk FOREIGN KEY (plan_id) REFERENCES training_plans(id) ON DELETE CASCADE,
  CONSTRAINT training_plan_weeks_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX training_plan_weeks_user_idx(user_id,starts_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE planned_workouts (
  id CHAR(36) PRIMARY KEY,
  plan_id CHAR(36) NOT NULL,
  plan_week_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  goal_id CHAR(36) NOT NULL,
  scheduled_date DATE NOT NULL,
  sort_order TINYINT NOT NULL DEFAULT 0,
  sport VARCHAR(80) NOT NULL,
  workout_type VARCHAR(80) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  duration_s INT,
  distance_m DECIMAL(14,3),
  intensity ENUM('recovery','easy','moderate','quality','race'),
  structured_steps LONGTEXT NOT NULL DEFAULT '[]',
  status ENUM('planned','completed','skipped','cancelled') NOT NULL DEFAULT 'planned',
  source VARCHAR(80) NOT NULL DEFAULT 'plan-engine-v1',
  workout_schema_version VARCHAR(80) NOT NULL DEFAULT 'frog-workout-v1',
  device_export_ready TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY planned_workouts_slot_uq(plan_id,scheduled_date,sort_order),
  CONSTRAINT planned_workouts_plan_fk FOREIGN KEY (plan_id) REFERENCES training_plans(id) ON DELETE CASCADE,
  CONSTRAINT planned_workouts_week_fk FOREIGN KEY (plan_week_id) REFERENCES training_plan_weeks(id) ON DELETE CASCADE,
  CONSTRAINT planned_workouts_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT planned_workouts_goal_fk FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  INDEX planned_workouts_user_date_idx(user_id,scheduled_date),
  INDEX planned_workouts_plan_idx(plan_id,scheduled_date),
  INDEX planned_workouts_goal_idx(goal_id,scheduled_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workout_exports (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  planned_workout_id CHAR(36) NOT NULL,
  provider ENUM('coros','trainingpeaks') NOT NULL,
  status ENUM('ready','blocked','pending','exported','failed') NOT NULL DEFAULT 'ready',
  payload LONGTEXT NOT NULL DEFAULT '{}',
  provider_tool VARCHAR(255),
  provider_reference VARCHAR(255),
  provider_response LONGTEXT NOT NULL DEFAULT '{}',
  blocker_code VARCHAR(255),
  blocker_message TEXT,
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt_at DATETIME(3),
  exported_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY workout_exports_uq(planned_workout_id,provider),
  CONSTRAINT workout_exports_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT workout_exports_workout_fk FOREIGN KEY (planned_workout_id) REFERENCES planned_workouts(id) ON DELETE CASCADE,
  INDEX workout_exports_user_status_idx(user_id,status,created_at),
  INDEX workout_exports_provider_status_idx(provider,status,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workout_matches (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  planned_workout_id CHAR(36) NOT NULL UNIQUE,
  activity_id CHAR(36) NOT NULL UNIQUE,
  status ENUM('suggested','confirmed','rejected') NOT NULL DEFAULT 'suggested',
  match_method ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  confidence DECIMAL(6,5) NOT NULL DEFAULT 0,
  score_breakdown LONGTEXT NOT NULL DEFAULT '{}',
  matched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT workout_matches_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT workout_matches_workout_fk FOREIGN KEY (planned_workout_id) REFERENCES planned_workouts(id) ON DELETE CASCADE,
  CONSTRAINT workout_matches_activity_fk FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  INDEX workout_matches_user_status_idx(user_id,status,matched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workout_feedback (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  match_id CHAR(36) NOT NULL UNIQUE,
  planned_workout_id CHAR(36) NOT NULL,
  activity_id CHAR(36) NOT NULL,
  perceived_effort TINYINT NOT NULL,
  feeling ENUM('very_easy','easy','as_expected','hard','very_hard') NOT NULL,
  completed_as_planned TINYINT(1) NOT NULL,
  pain_or_discomfort TINYINT(1) NOT NULL DEFAULT 0,
  health_status ENUM('normal','fatigued','ill') NOT NULL DEFAULT 'normal',
  notes TEXT,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT workout_feedback_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT workout_feedback_match_fk FOREIGN KEY (match_id) REFERENCES workout_matches(id) ON DELETE CASCADE,
  CONSTRAINT workout_feedback_workout_fk FOREIGN KEY (planned_workout_id) REFERENCES planned_workouts(id) ON DELETE CASCADE,
  CONSTRAINT workout_feedback_activity_fk FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  INDEX workout_feedback_user_idx(user_id,submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workout_analyses (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  match_id CHAR(36) NOT NULL UNIQUE,
  feedback_id CHAR(36),
  adherence_score INT NOT NULL,
  outcome ENUM('on_track','easier_than_expected','harder_than_expected','deviated') NOT NULL,
  summary TEXT NOT NULL,
  metrics LONGTEXT NOT NULL DEFAULT '{}',
  recommendations LONGTEXT NOT NULL DEFAULT '[]',
  model_version VARCHAR(80) NOT NULL DEFAULT 'post-session-v1',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT workout_analyses_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT workout_analyses_match_fk FOREIGN KEY (match_id) REFERENCES workout_matches(id) ON DELETE CASCADE,
  CONSTRAINT workout_analyses_feedback_fk FOREIGN KEY (feedback_id) REFERENCES workout_feedback(id) ON DELETE SET NULL,
  INDEX workout_analyses_user_idx(user_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE weekly_reviews (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  decision ENUM('maintain','reduce','recovery') NOT NULL,
  readiness_score INT NOT NULL,
  confidence DECIMAL(6,5) NOT NULL,
  signals LONGTEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  model_version VARCHAR(80) NOT NULL DEFAULT 'weekly-adaptation-v1',
  status ENUM('no_change','proposed','applied') NOT NULL DEFAULT 'no_change',
  applied_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY weekly_reviews_plan_week_uq(plan_id,week_start),
  CONSTRAINT weekly_reviews_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT weekly_reviews_plan_fk FOREIGN KEY (plan_id) REFERENCES training_plans(id) ON DELETE CASCADE,
  INDEX weekly_reviews_user_week_idx(user_id,week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE plan_adaptations (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  review_id CHAR(36) NOT NULL,
  planned_workout_id CHAR(36) NOT NULL,
  action ENUM('reduce','recovery') NOT NULL,
  reduction_pct DECIMAL(8,3),
  reason TEXT NOT NULL,
  before_state LONGTEXT NOT NULL,
  after_state LONGTEXT NOT NULL,
  status ENUM('proposed','applied','skipped') NOT NULL DEFAULT 'proposed',
  applied_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY plan_adaptations_uq(review_id,planned_workout_id),
  CONSTRAINT plan_adaptations_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT plan_adaptations_review_fk FOREIGN KEY (review_id) REFERENCES weekly_reviews(id) ON DELETE CASCADE,
  CONSTRAINT plan_adaptations_workout_fk FOREIGN KEY (planned_workout_id) REFERENCES planned_workouts(id) ON DELETE CASCADE,
  INDEX plan_adaptations_review_idx(review_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE race_strategies (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  goal_id CHAR(36) NOT NULL,
  plan_id CHAR(36),
  assessment_id CHAR(36),
  version INT NOT NULL,
  strategy_version VARCHAR(80) NOT NULL DEFAULT 'race-day-v1',
  status ENUM('active','superseded') NOT NULL DEFAULT 'active',
  target_duration_s INT NOT NULL,
  target_pace_s_per_km DECIMAL(12,3) NOT NULL,
  segments LONGTEXT NOT NULL DEFAULT '[]',
  fueling LONGTEXT NOT NULL DEFAULT '[]',
  checklist LONGTEXT NOT NULL DEFAULT '[]',
  context LONGTEXT NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY race_strategies_version_uq(user_id,goal_id,version),
  CONSTRAINT race_strategies_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT race_strategies_goal_fk FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  CONSTRAINT race_strategies_plan_fk FOREIGN KEY (plan_id) REFERENCES training_plans(id) ON DELETE SET NULL,
  CONSTRAINT race_strategies_assessment_fk FOREIGN KEY (assessment_id) REFERENCES goal_feasibility_assessments(id) ON DELETE SET NULL,
  INDEX race_strategies_user_goal_idx(user_id,goal_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE coach_threads (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Conversation avec Frog',
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT coach_threads_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX coach_threads_user_updated_idx(user_id,updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE coach_messages (
  id CHAR(36) PRIMARY KEY,
  thread_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role ENUM('user','assistant') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  context_snapshot LONGTEXT NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT coach_messages_thread_fk FOREIGN KEY (thread_id) REFERENCES coach_threads(id) ON DELETE CASCADE,
  CONSTRAINT coach_messages_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX coach_messages_thread_created_idx(thread_id,created_at),
  INDEX coach_messages_user_idx(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
