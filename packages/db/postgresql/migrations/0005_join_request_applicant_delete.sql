ALTER TABLE "openmeld"."organization_join_requests" DROP CONSTRAINT "organization_join_requests_applicant_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "openmeld"."organization_join_requests" ADD CONSTRAINT "organization_join_requests_applicant_user_id_users_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "openmeld"."users"("id") ON DELETE no action ON UPDATE no action;