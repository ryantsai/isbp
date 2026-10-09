ALTER TABLE "core"."access_requests" DROP CONSTRAINT "access_requests_role_id_roles_id_fk";
--> statement-breakpoint
ALTER TABLE "core"."access_requests" ADD CONSTRAINT "access_requests_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE restrict ON UPDATE no action;