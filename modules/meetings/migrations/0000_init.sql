CREATE SCHEMA "meetings";
--> statement-breakpoint
CREATE SEQUENCE "meetings"."meeting_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "meetings"."action_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"owner_id" uuid,
	"due_date" date,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"destination" varchar(10) DEFAULT 'meeting' NOT NULL,
	"project_id" uuid,
	"target_type" varchar(40),
	"target_id" uuid,
	"target_reference" varchar(40),
	"target_state" varchar(10),
	"route_error" varchar(20),
	"note" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"reminded_due_date" date,
	"overdue_reminded_at" timestamp with time zone,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings"."attendees" (
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendees_pk" PRIMARY KEY("meeting_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meetings"."meetings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('meetings.meeting_number_seq') NOT NULL,
	"title" varchar(200) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" smallint DEFAULT 60 NOT NULL,
	"location" varchar(300),
	"visibility" varchar(10) DEFAULT 'private' NOT NULL,
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"organizer_id" uuid,
	"guests" varchar(500),
	"notes" text,
	"summary" text,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"previous_id" uuid,
	"organised_mode" varchar(10),
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings"."action_items" ADD CONSTRAINT "action_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "meetings"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."action_items" ADD CONSTRAINT "action_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."action_items" ADD CONSTRAINT "action_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."action_items" ADD CONSTRAINT "action_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."attendees" ADD CONSTRAINT "attendees_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "meetings"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."attendees" ADD CONSTRAINT "attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."meetings" ADD CONSTRAINT "meetings_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."meetings" ADD CONSTRAINT "meetings_previous_id_meetings_id_fk" FOREIGN KEY ("previous_id") REFERENCES "meetings"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."meetings" ADD CONSTRAINT "meetings_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings"."meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_items_meeting_idx" ON "meetings"."action_items" USING btree ("meeting_id","sort");--> statement-breakpoint
CREATE INDEX "action_items_owner_idx" ON "meetings"."action_items" USING btree ("owner_id","status","due_date");--> statement-breakpoint
CREATE INDEX "action_items_target_idx" ON "meetings"."action_items" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "attendees_user_idx" ON "meetings"."attendees" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_number_uq" ON "meetings"."meetings" USING btree ("number");--> statement-breakpoint
CREATE INDEX "meetings_starts_idx" ON "meetings"."meetings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "meetings_organizer_idx" ON "meetings"."meetings" USING btree ("organizer_id","starts_at");--> statement-breakpoint
CREATE INDEX "meetings_previous_idx" ON "meetings"."meetings" USING btree ("previous_id");--> statement-breakpoint
CREATE INDEX "meetings_status_idx" ON "meetings"."meetings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meetings_title_trgm" ON "meetings"."meetings" USING gin ("title" gin_trgm_ops);