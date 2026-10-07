CREATE SCHEMA "helpdesk_ai";
--> statement-breakpoint
CREATE TABLE "helpdesk_ai"."conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) DEFAULT '' NOT NULL,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"ticket_id" uuid,
	"ticket_ref" varchar(40),
	"deflected" boolean DEFAULT false NOT NULL,
	"mode" varchar(10) DEFAULT 'builtin' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"outcome_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helpdesk_ai"."insights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"ticket_ref" varchar(40) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" double precision,
	"mode" varchar(10) NOT NULL,
	"model" varchar(150),
	"status" varchar(20) DEFAULT 'suggested' NOT NULL,
	"feedback" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helpdesk_ai"."messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" varchar(10) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposal" jsonb,
	"native" jsonb,
	"tool_calls" jsonb,
	"tool_call_id" varchar(200),
	"is_error" boolean DEFAULT false NOT NULL,
	"mode" varchar(10),
	"model" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helpdesk_ai"."conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpdesk_ai"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "helpdesk_ai"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "helpdesk_ai"."conversations" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_created_idx" ON "helpdesk_ai"."conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "helpdesk_ai"."conversations" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "insights_ticket_kind_uq" ON "helpdesk_ai"."insights" USING btree ("ticket_id","kind");--> statement-breakpoint
CREATE INDEX "insights_kind_created_idx" ON "helpdesk_ai"."insights" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_seq_uq" ON "helpdesk_ai"."messages" USING btree ("conversation_id","seq");