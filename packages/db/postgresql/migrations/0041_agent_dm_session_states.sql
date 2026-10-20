CREATE TABLE "openmeld"."direct_message_session_states" (
	"space_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"archived_at_ms" bigint,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "direct_message_session_states_archived_check" CHECK ("archived_at_ms" IS NULL OR "archived_at_ms" > 0)
);
