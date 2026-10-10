CREATE TABLE "openmeld"."conversation_history_deletions" (
	"space_id" text NOT NULL,
	"user_id" text NOT NULL,
	"through_position" bigint NOT NULL,
	"deleted_at_ms" bigint NOT NULL,
	CONSTRAINT "conversation_history_deletions_space_id_user_id_pk" PRIMARY KEY("space_id","user_id"),
	CONSTRAINT "conversation_history_deletions_boundary_check" CHECK ("through_position" >= 0 AND "deleted_at_ms" > 0)
);
--> statement-breakpoint
ALTER TABLE "openmeld"."conversation_history_deletions" ADD CONSTRAINT "conversation_history_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;