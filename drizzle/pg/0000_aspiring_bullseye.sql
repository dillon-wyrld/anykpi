CREATE TABLE IF NOT EXISTS "accounts" (
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"entity" text,
	"seats" integer DEFAULT 0,
	"activated" integer DEFAULT 0,
	"mrr" double precision DEFAULT 0,
	"renewal_date" integer,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	CONSTRAINT "accounts_workspace_id_account_id_pk" PRIMARY KEY("workspace_id","account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" text NOT NULL,
	"timestamp" integer NOT NULL,
	"event_name" text NOT NULL,
	"event_class" text NOT NULL,
	"platform" text,
	"external_id" text,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "annotations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "annotations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" integer NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"hashed_key" text NOT NULL,
	"name" text NOT NULL,
	"workspace_id" text DEFAULT 'live' NOT NULL,
	"created_at" integer NOT NULL,
	"last_used_at" integer,
	"scope" text DEFAULT 'write' NOT NULL,
	"legacy" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" text DEFAULT 'live' NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "balance_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"as_of" integer NOT NULL,
	"cash_balance" double precision NOT NULL,
	"monthly_burn" double precision NOT NULL,
	"runway_months" double precision NOT NULL,
	"source" text DEFAULT 'demo' NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cal_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cal_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"source_name" text NOT NULL,
	"source_color" text NOT NULL,
	"type" text NOT NULL,
	"emoji" text NOT NULL,
	"title" text NOT NULL,
	"badge" text NOT NULL,
	"event_date" integer NOT NULL,
	"is_future" integer DEFAULT 0,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config" (
	"key" text NOT NULL,
	"value" text NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	CONSTRAINT "config_workspace_id_key_pk" PRIMARY KEY("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metric_defs" (
	"metric_id" text NOT NULL,
	"name" text NOT NULL,
	"section" text NOT NULL,
	"section_order" text NOT NULL,
	"owner" text NOT NULL,
	"type" text NOT NULL,
	"unit" text,
	"target" double precision,
	"good_dir" text NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	CONSTRAINT "metric_defs_workspace_id_metric_id_pk" PRIMARY KEY("workspace_id","metric_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metric_points" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "metric_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"metric_id" text NOT NULL,
	"timestamp" integer NOT NULL,
	"value" double precision,
	"grain" text NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mrr_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mrr_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"period" integer NOT NULL,
	"grain" text NOT NULL,
	"mrr" double precision NOT NULL,
	"subscriber_count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'demo' NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'live' NOT NULL,
	"person_id" text NOT NULL,
	"body" text NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"approved_by" text,
	"created_at" integer NOT NULL,
	"approved_at" integer,
	"sent_at" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_delivery" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outreach_delivery_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"outreach_id" text NOT NULL,
	"workspace_id" text DEFAULT 'live' NOT NULL,
	"recipient" text NOT NULL,
	"approved_by" text NOT NULL,
	"sent_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_revenue" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "person_revenue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" text NOT NULL,
	"account_id" text,
	"status" text NOT NULL,
	"plan" text,
	"mrr" double precision DEFAULT 0 NOT NULL,
	"ltv" double precision DEFAULT 0 NOT NULL,
	"first_paid_at" integer,
	"last_charge_at" integer,
	"charge_count" integer DEFAULT 0 NOT NULL,
	"last_charge_amount" double precision,
	"currency" text DEFAULT 'usd' NOT NULL,
	"source" text DEFAULT 'demo' NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" text NOT NULL,
	"person_id" text NOT NULL,
	"role" text,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" text DEFAULT 'live' NOT NULL,
	"source" text NOT NULL,
	"config" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscription_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" text NOT NULL,
	"account_id" text,
	"event_type" text NOT NULL,
	"occurred_at" integer NOT NULL,
	"mrr_delta" double precision DEFAULT 0 NOT NULL,
	"plan" text,
	"source" text DEFAULT 'demo' NOT NULL,
	"source_event_id" text NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_state" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_state_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"source_name" text NOT NULL,
	"last_sync" integer,
	"status" text NOT NULL,
	"error" text,
	"workspace_id" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tombstones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tombstones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" text NOT NULL,
	"external_id" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"person_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"avatar" text,
	"emoji" text,
	"platform" text,
	"country" text,
	"income_band" text,
	"traits" text,
	"signup_date" integer,
	"cluster" text,
	"account_id" text,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	CONSTRAINT "users_workspace_id_person_id_pk" PRIMARY KEY("workspace_id","person_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" integer NOT NULL,
	"archived_at" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_workspace_idx" ON "accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_person_timestamp_idx" ON "activity" USING btree ("person_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_workspace_idx" ON "activity" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activity_workspace_external_id_uidx" ON "activity" USING btree ("workspace_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "annotations_target_idx" ON "annotations" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "annotations_workspace_idx" ON "annotations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_workspace_created_idx" ON "audit_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_workspace_actor_created_idx" ON "audit_log" USING btree ("workspace_id","actor","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "balance_snapshots_workspace_idx" ON "balance_snapshots" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "balance_snapshots_workspace_as_of_uidx" ON "balance_snapshots" USING btree ("workspace_id","as_of");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cal_events_date_idx" ON "cal_events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cal_events_workspace_idx" ON "cal_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_workspace_idx" ON "config" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_defs_workspace_idx" ON "metric_defs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_points_metric_timestamp_idx" ON "metric_points" USING btree ("metric_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_points_workspace_idx" ON "metric_points" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mrr_snapshots_workspace_idx" ON "mrr_snapshots" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mrr_snapshots_workspace_grain_period_uidx" ON "mrr_snapshots" USING btree ("workspace_id","grain","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_workspace_idx" ON "outreach" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_workspace_person_idx" ON "outreach" USING btree ("workspace_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_workspace_state_idx" ON "outreach" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_delivery_workspace_sent_idx" ON "outreach_delivery" USING btree ("workspace_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_delivery_outreach_idx" ON "outreach_delivery" USING btree ("outreach_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_revenue_workspace_idx" ON "person_revenue" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "person_revenue_workspace_person_uidx" ON "person_revenue" USING btree ("workspace_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seats_account_idx" ON "seats" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seats_workspace_idx" ON "seats" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_workspace_idx" ON "sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sources_workspace_source_uidx" ON "sources" USING btree ("workspace_id","source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_events_workspace_idx" ON "subscription_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_events_person_idx" ON "subscription_events" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_events_occurred_idx" ON "subscription_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_events_workspace_source_event_uidx" ON "subscription_events" USING btree ("workspace_id","source","source_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_state_workspace_idx" ON "sync_state" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_state_workspace_source_uidx" ON "sync_state" USING btree ("workspace_id","source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tombstones_workspace_idx" ON "tombstones" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tombstones_workspace_external_uidx" ON "tombstones" USING btree ("workspace_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_workspace_idx" ON "users" USING btree ("workspace_id");