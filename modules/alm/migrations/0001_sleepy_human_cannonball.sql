ALTER TABLE "alm"."repositories" ADD COLUMN "branches" jsonb;--> statement-breakpoint
ALTER TABLE "alm"."repositories" ADD COLUMN "pull_requests" jsonb;--> statement-breakpoint
ALTER TABLE "alm"."repositories" ADD COLUMN "synced_at" timestamp with time zone;