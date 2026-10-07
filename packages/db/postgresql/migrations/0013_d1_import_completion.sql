CREATE SCHEMA "openmeld_migration";
--> statement-breakpoint
CREATE TABLE "openmeld_migration"."d1_import_completion" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"record" jsonb NOT NULL,
	CONSTRAINT "single_import" CHECK ("openmeld_migration"."d1_import_completion"."singleton")
);
