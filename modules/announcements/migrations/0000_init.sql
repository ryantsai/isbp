CREATE SCHEMA "announcements";
--> statement-breakpoint
CREATE TABLE "announcements"."posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements"."posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_feed_idx" ON "announcements"."posts" USING btree ("status","pinned","published_at");--> statement-breakpoint
CREATE INDEX "posts_ends_idx" ON "announcements"."posts" USING btree ("ends_at") WHERE "announcements"."posts"."status" = 'published';--> statement-breakpoint
CREATE INDEX "posts_author_idx" ON "announcements"."posts" USING btree ("author_id");