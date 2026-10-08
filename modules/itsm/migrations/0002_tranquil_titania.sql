ALTER TABLE "itsm"."changes" ADD COLUMN "acceptance" varchar(12);--> statement-breakpoint
ALTER TABLE "itsm"."changes" ADD COLUMN "acceptance_note" text;--> statement-breakpoint
ALTER TABLE "itsm"."changes" ADD COLUMN "acceptance_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "itsm"."changes" ADD COLUMN "acceptance_by" uuid;--> statement-breakpoint
ALTER TABLE "itsm"."tickets" ADD COLUMN "sign_off_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "itsm"."changes" ADD CONSTRAINT "changes_acceptance_by_users_id_fk" FOREIGN KEY ("acceptance_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_sign_off_idx" ON "itsm"."tickets" USING btree ("sign_off_instance_id") WHERE "itsm"."tickets"."sign_off_instance_id" is not null;