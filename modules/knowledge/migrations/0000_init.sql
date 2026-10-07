CREATE SCHEMA "knowledge";
--> statement-breakpoint
CREATE SEQUENCE "knowledge"."article_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "knowledge"."article_reads" (
	"article_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"viewed_on" date NOT NULL,
	CONSTRAINT "article_reads_article_id_user_id_pk" PRIMARY KEY("article_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge"."article_versions" (
	"article_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(300) NOT NULL,
	"summary" varchar(500) DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	CONSTRAINT "article_versions_article_id_version_pk" PRIMARY KEY("article_id","version")
);
--> statement-breakpoint
CREATE TABLE "knowledge"."articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('knowledge.article_number_seq') NOT NULL,
	"title" varchar(300) NOT NULL,
	"summary" varchar(500) DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"translation_group_id" uuid NOT NULL,
	"audience" varchar(20) DEFAULT 'everyone' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"published_version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"review_at" date,
	"review_notified_at" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"not_helpful_count" integer DEFAULT 0 NOT NULL,
	"source" jsonb,
	"review_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge"."categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"icon" varchar(64) DEFAULT 'book-open' NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge"."feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"article_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"helpful" boolean NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge"."article_reads" ADD CONSTRAINT "article_reads_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "knowledge"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."article_reads" ADD CONSTRAINT "article_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."article_versions" ADD CONSTRAINT "article_versions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "knowledge"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."article_versions" ADD CONSTRAINT "article_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."articles" ADD CONSTRAINT "articles_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "knowledge"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."articles" ADD CONSTRAINT "articles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "knowledge"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."feedback" ADD CONSTRAINT "feedback_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "knowledge"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_number_uq" ON "knowledge"."articles" USING btree ("number");--> statement-breakpoint
CREATE INDEX "articles_status_category_idx" ON "knowledge"."articles" USING btree ("status","category_id");--> statement-breakpoint
CREATE INDEX "articles_locale_idx" ON "knowledge"."articles" USING btree ("locale");--> statement-breakpoint
CREATE INDEX "articles_title_trgm_idx" ON "knowledge"."articles" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "articles_summary_trgm_idx" ON "knowledge"."articles" USING gin ("summary" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "articles_owner_idx" ON "knowledge"."articles" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "articles_translation_group_idx" ON "knowledge"."articles" USING btree ("translation_group_id");--> statement-breakpoint
CREATE INDEX "articles_status_updated_idx" ON "knowledge"."articles" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "articles_status_views_idx" ON "knowledge"."articles" USING btree ("status","views");--> statement-breakpoint
CREATE INDEX "articles_review_idx" ON "knowledge"."articles" USING btree ("review_at") WHERE "knowledge"."articles"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "categories_key_uq" ON "knowledge"."categories" USING btree ("key");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "knowledge"."categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_article_user_uq" ON "knowledge"."feedback" USING btree ("article_id","user_id");--> statement-breakpoint
CREATE INDEX "feedback_article_created_idx" ON "knowledge"."feedback" USING btree ("article_id","created_at");