CREATE SCHEMA "assistant";
--> statement-breakpoint
CREATE SEQUENCE "assistant"."change_set_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "assistant"."change_set_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"change_set_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"ref" varchar(40),
	"kind" varchar(100) NOT NULL,
	"op" varchar(10) NOT NULL,
	"target_id" varchar(200),
	"label" varchar(200) NOT NULL,
	"value" jsonb,
	"note" text,
	"base_version" varchar(64),
	"check" jsonb,
	"applied_id" varchar(200),
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."change_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('assistant.change_set_number_seq') NOT NULL,
	"title" varchar(200) NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_by_type" varchar(10) NOT NULL,
	"created_by_id" uuid,
	"created_by_name" varchar(200) NOT NULL,
	"conversation_id" uuid,
	"workflow_instance_id" uuid,
	"review_requested_at" timestamp with time zone,
	"review_note" text,
	"checked_at" timestamp with time zone,
	"applied_by_id" uuid,
	"applied_by_name" varchar(200),
	"applied_at" timestamp with time zone,
	"rolled_back_by_id" uuid,
	"rolled_back_by_name" varchar(200),
	"rolled_back_at" timestamp with time zone,
	"last_error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) DEFAULT '' NOT NULL,
	"change_set_id" uuid,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" varchar(10) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"page" jsonb,
	"native" jsonb,
	"tool_calls" jsonb,
	"tool_call_id" varchar(200),
	"tool_name" varchar(150),
	"confirmation" jsonb,
	"is_error" boolean DEFAULT false NOT NULL,
	"mode" varchar(10),
	"model" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant"."change_set_items" ADD CONSTRAINT "change_set_items_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "assistant"."change_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."change_sets" ADD CONSTRAINT "change_sets_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."change_sets" ADD CONSTRAINT "change_sets_rolled_back_by_id_users_id_fk" FOREIGN KEY ("rolled_back_by_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."conversations" ADD CONSTRAINT "conversations_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "assistant"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "assistant"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "change_set_items_position_uq" ON "assistant"."change_set_items" USING btree ("change_set_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "change_set_items_ref_uq" ON "assistant"."change_set_items" USING btree ("change_set_id","ref") WHERE "assistant"."change_set_items"."ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "change_sets_number_uq" ON "assistant"."change_sets" USING btree ("number");--> statement-breakpoint
CREATE INDEX "change_sets_creator_idx" ON "assistant"."change_sets" USING btree ("created_by_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "change_sets_status_idx" ON "assistant"."change_sets" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "change_sets_instance_idx" ON "assistant"."change_sets" USING btree ("workflow_instance_id");--> statement-breakpoint
CREATE INDEX "assistant_conversations_user_idx" ON "assistant"."conversations" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_messages_conversation_seq_uq" ON "assistant"."messages" USING btree ("conversation_id","seq");