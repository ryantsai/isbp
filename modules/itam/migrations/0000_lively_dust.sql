CREATE SCHEMA "itam";
--> statement-breakpoint
CREATE SEQUENCE "itam"."asset_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "itam"."contract_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "itam"."license_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "itam"."asset_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"from_value" varchar(200),
	"to_value" varchar(200),
	"user_id" uuid,
	"actor_id" uuid,
	"actor_name" varchar(200),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itam"."assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('itam.asset_number_seq') NOT NULL,
	"name" varchar(200) NOT NULL,
	"category" varchar(20) NOT NULL,
	"model_id" uuid,
	"serial_number" varchar(100),
	"status" varchar(20) DEFAULT 'in_stock' NOT NULL,
	"assigned_to" uuid,
	"assigned_at" timestamp with time zone,
	"location" varchar(200),
	"department_id" uuid,
	"ci_id" uuid,
	"vendor_id" uuid,
	"purchase_date" date,
	"purchase_cost" numeric(12, 2),
	"currency" char(3) DEFAULT 'TWD' NOT NULL,
	"invoice_number" varchar(64),
	"warranty_end" date,
	"retire_on" date,
	"notes" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disposed_at" timestamp with time zone,
	"disposal_note" text,
	"disposal_instance_id" uuid,
	"warranty_notified_for" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itam"."contract_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"asset_id" uuid,
	"license_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_items_one_target" CHECK (("itam"."contract_items"."asset_id" is null) <> ("itam"."contract_items"."license_id" is null))
);
--> statement-breakpoint
CREATE TABLE "itam"."contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('itam.contract_number_seq') NOT NULL,
	"title" varchar(300) NOT NULL,
	"vendor_id" uuid,
	"kind" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"notice_days" integer DEFAULT 60 NOT NULL,
	"cost" numeric(12, 2),
	"currency" char(3) DEFAULT 'TWD' NOT NULL,
	"billing" varchar(20) DEFAULT 'annual' NOT NULL,
	"owner_id" uuid,
	"notes" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_reminder_for" date,
	"last_reminded_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_notice_days" CHECK ("itam"."contracts"."notice_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "itam"."license_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"license_id" uuid NOT NULL,
	"user_id" uuid,
	"asset_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_assignments_one_target" CHECK (("itam"."license_assignments"."user_id" is null) <> ("itam"."license_assignments"."asset_id" is null))
);
--> statement-breakpoint
CREATE TABLE "itam"."licenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('itam.license_number_seq') NOT NULL,
	"product" varchar(200) NOT NULL,
	"publisher" varchar(200),
	"vendor_id" uuid,
	"license_type" varchar(20) NOT NULL,
	"quantity" integer,
	"cost" numeric(12, 2),
	"currency" char(3) DEFAULT 'TWD' NOT NULL,
	"billing" varchar(20) DEFAULT 'annual' NOT NULL,
	"start_date" date,
	"end_date" date,
	"contract_id" uuid,
	"license_key_sealed" text,
	"compliance_state" varchar(20) DEFAULT 'compliant' NOT NULL,
	"notes" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licenses_quantity" CHECK ("itam"."licenses"."quantity" is null or "itam"."licenses"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "itam"."models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category" varchar(20) NOT NULL,
	"manufacturer" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"part_number" varchar(100),
	"lifespan_months" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_lifespan_positive" CHECK ("itam"."models"."lifespan_months" > 0)
);
--> statement-breakpoint
CREATE TABLE "itam"."software_installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"product" varchar(200) NOT NULL,
	"publisher" varchar(200),
	"version" varchar(64),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(10) DEFAULT 'manual' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itam"."vendors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"website" varchar(500),
	"contact_name" varchar(200),
	"contact_email" varchar(320),
	"phone" varchar(50),
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itam"."asset_events" ADD CONSTRAINT "asset_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "itam"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."asset_events" ADD CONSTRAINT "asset_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."asset_events" ADD CONSTRAINT "asset_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD CONSTRAINT "assets_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "itam"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD CONSTRAINT "assets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD CONSTRAINT "assets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD CONSTRAINT "assets_ci_id_cis_id_fk" FOREIGN KEY ("ci_id") REFERENCES "cmdb"."cis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD CONSTRAINT "assets_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "itam"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."contract_items" ADD CONSTRAINT "contract_items_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "itam"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."contract_items" ADD CONSTRAINT "contract_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "itam"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."contract_items" ADD CONSTRAINT "contract_items_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "itam"."licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."contracts" ADD CONSTRAINT "contracts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "itam"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."contracts" ADD CONSTRAINT "contracts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."license_assignments" ADD CONSTRAINT "license_assignments_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "itam"."licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."license_assignments" ADD CONSTRAINT "license_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."license_assignments" ADD CONSTRAINT "license_assignments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "itam"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."license_assignments" ADD CONSTRAINT "license_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."licenses" ADD CONSTRAINT "licenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "itam"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."licenses" ADD CONSTRAINT "licenses_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "itam"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."software_installations" ADD CONSTRAINT "software_installations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "itam"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_events_asset_idx" ON "itam"."asset_events" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_number_uq" ON "itam"."assets" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_serial_uq" ON "itam"."assets" USING btree (lower("serial_number")) WHERE "itam"."assets"."serial_number" is not null;--> statement-breakpoint
CREATE INDEX "assets_status_category_idx" ON "itam"."assets" USING btree ("status","category");--> statement-breakpoint
CREATE INDEX "assets_assigned_to_idx" ON "itam"."assets" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "assets_department_idx" ON "itam"."assets" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "assets_warranty_end_idx" ON "itam"."assets" USING btree ("warranty_end");--> statement-breakpoint
CREATE INDEX "assets_model_idx" ON "itam"."assets" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "assets_vendor_idx" ON "itam"."assets" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "assets_ci_idx" ON "itam"."assets" USING btree ("ci_id");--> statement-breakpoint
CREATE INDEX "assets_updated_idx" ON "itam"."assets" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "assets_name_idx" ON "itam"."assets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "assets_name_trgm" ON "itam"."assets" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "assets_serial_trgm" ON "itam"."assets" USING gin ("serial_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "assets_location_idx" ON "itam"."assets" USING btree ("location");--> statement-breakpoint
CREATE INDEX "assets_attributes_gin" ON "itam"."assets" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "contract_items_asset_uq" ON "itam"."contract_items" USING btree ("contract_id","asset_id") WHERE "itam"."contract_items"."asset_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_items_license_uq" ON "itam"."contract_items" USING btree ("contract_id","license_id") WHERE "itam"."contract_items"."license_id" is not null;--> statement-breakpoint
CREATE INDEX "contract_items_asset_idx" ON "itam"."contract_items" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "contract_items_license_idx" ON "itam"."contract_items" USING btree ("license_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_number_uq" ON "itam"."contracts" USING btree ("number");--> statement-breakpoint
CREATE INDEX "contracts_status_end_idx" ON "itam"."contracts" USING btree ("status","end_date");--> statement-breakpoint
CREATE INDEX "contracts_end_idx" ON "itam"."contracts" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "contracts_vendor_idx" ON "itam"."contracts" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "contracts_owner_idx" ON "itam"."contracts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "contracts_kind_idx" ON "itam"."contracts" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "contracts_updated_idx" ON "itam"."contracts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "contracts_title_trgm" ON "itam"."contracts" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contracts_attributes_gin" ON "itam"."contracts" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "license_assignments_user_uq" ON "itam"."license_assignments" USING btree ("license_id","user_id") WHERE "itam"."license_assignments"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "license_assignments_asset_uq" ON "itam"."license_assignments" USING btree ("license_id","asset_id") WHERE "itam"."license_assignments"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "license_assignments_user_idx" ON "itam"."license_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "license_assignments_asset_idx" ON "itam"."license_assignments" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_number_uq" ON "itam"."licenses" USING btree ("number");--> statement-breakpoint
CREATE INDEX "licenses_product_idx" ON "itam"."licenses" USING btree (lower("product"));--> statement-breakpoint
CREATE INDEX "licenses_product_trgm" ON "itam"."licenses" USING gin ("product" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "licenses_compliance_idx" ON "itam"."licenses" USING btree ("compliance_state");--> statement-breakpoint
CREATE INDEX "licenses_end_idx" ON "itam"."licenses" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "licenses_vendor_idx" ON "itam"."licenses" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "licenses_contract_idx" ON "itam"."licenses" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "licenses_updated_idx" ON "itam"."licenses" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "models_manufacturer_name_uq" ON "itam"."models" USING btree (lower("manufacturer"),lower("name"));--> statement-breakpoint
CREATE INDEX "models_category_idx" ON "itam"."models" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "software_installations_asset_product_uq" ON "itam"."software_installations" USING btree ("asset_id",lower("product"));--> statement-breakpoint
CREATE INDEX "software_installations_product_idx" ON "itam"."software_installations" USING btree (lower("product"));--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_uq" ON "itam"."vendors" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "vendors_name_trgm" ON "itam"."vendors" USING gin ("name" gin_trgm_ops);