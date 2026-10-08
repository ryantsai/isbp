CREATE TABLE "knowledge"."guide_articles" (
	"slug" varchar(64) NOT NULL,
	"locale" varchar(10) NOT NULL,
	"article_id" uuid NOT NULL,
	"hash" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_articles_slug_locale_pk" PRIMARY KEY("slug","locale")
);
--> statement-breakpoint
ALTER TABLE "knowledge"."guide_articles" ADD CONSTRAINT "guide_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "knowledge"."articles"("id") ON DELETE cascade ON UPDATE no action;