CREATE TABLE "core"."db_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"engine" varchar(16) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer,
	"database" varchar(128),
	"username" varchar(128) NOT NULL,
	"password_sealed" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"purposes" text[] DEFAULT '{data}'::text[] NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"pool_max" integer DEFAULT 5 NOT NULL,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"max_rows" integer DEFAULT 10000 NOT NULL,
	"status" varchar(16) DEFAULT 'unknown' NOT NULL,
	"server_version" varchar(300),
	"last_checked_at" timestamp with time zone,
	"last_latency_ms" integer,
	"last_error" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "db_connections_engine_ck" CHECK ("core"."db_connections"."engine" in ('mssql', 'postgres', 'mysql', 'oracle')),
	CONSTRAINT "db_connections_purposes_ck" CHECK ("core"."db_connections"."purposes" <@ array['data', 'admin']::text[] and cardinality("core"."db_connections"."purposes") > 0)
);
--> statement-breakpoint
ALTER TABLE "core"."db_connections" ADD CONSTRAINT "db_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."db_connections" ADD CONSTRAINT "db_connections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "db_connections_key_uq" ON "core"."db_connections" USING btree ("key");