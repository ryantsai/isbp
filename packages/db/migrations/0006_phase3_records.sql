CREATE TABLE "core"."files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"record_type" varchar(120) NOT NULL,
	"record_id" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"content_type" varchar(150) NOT NULL,
	"size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage" varchar(16) NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "core"."record_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"a_type" varchar(120) NOT NULL,
	"a_id" varchar(64) NOT NULL,
	"b_type" varchar(120) NOT NULL,
	"b_id" varchar(64) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_links_order_ck" CHECK (("core"."record_links"."a_type" || ':' || "core"."record_links"."a_id") collate "C" < ("core"."record_links"."b_type" || ':' || "core"."record_links"."b_id") collate "C")
);
--> statement-breakpoint
ALTER TABLE "core"."files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."files" ADD CONSTRAINT "files_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."record_links" ADD CONSTRAINT "record_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_record_idx" ON "core"."files" USING btree ("record_type","record_id","created_at") WHERE "core"."files"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_pair_uq" ON "core"."record_links" USING btree ("a_type","a_id","b_type","b_id");--> statement-breakpoint
CREATE INDEX "record_links_b_idx" ON "core"."record_links" USING btree ("b_type","b_id");