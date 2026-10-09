ALTER TABLE "scheduler"."runs" ADD COLUMN "summary_params" jsonb;--> statement-breakpoint
ALTER TABLE "scheduler"."runs" ADD COLUMN "problem" jsonb;