CREATE INDEX "users_employee_id_idx" ON "core"."users" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "users_sync_updated_idx" ON "core"."users" USING btree ("updated_at","id");