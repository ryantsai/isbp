CREATE TABLE "helpdesk_ai"."published_chats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"token" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"access" varchar(20) DEFAULT 'signed_in' NOT NULL,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"category_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"title" varchar(120) DEFAULT '' NOT NULL,
	"welcome" text DEFAULT '' NOT NULL,
	"session_minutes" integer DEFAULT 240 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helpdesk_ai"."conversations" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "helpdesk_ai"."conversations" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "helpdesk_ai"."conversations" ADD COLUMN "visitor_id" varchar(64);--> statement-breakpoint
ALTER TABLE "helpdesk_ai"."published_chats" ADD CONSTRAINT "published_chats_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "published_chats_token_uq" ON "helpdesk_ai"."published_chats" USING btree ("token");--> statement-breakpoint
ALTER TABLE "helpdesk_ai"."conversations" ADD CONSTRAINT "conversations_channel_id_published_chats_id_fk" FOREIGN KEY ("channel_id") REFERENCES "helpdesk_ai"."published_chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_channel_idx" ON "helpdesk_ai"."conversations" USING btree ("channel_id","created_at");