CREATE TABLE "openmeld"."openMeldDaemon_runtime_harness_presence" (
	"openmeld_service_runtime_id" text NOT NULL,
	"agent_controller_ref" text NOT NULL,
	"last_report_observed_at_ms" bigint NOT NULL,
	"last_detected_at_ms" bigint,
	"undetected_report_count" integer DEFAULT 0 NOT NULL,
	"first_undetected_at_ms" bigint,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "openMeldDaemon_runtime_harness_presence_runtime_id_non_empty_check" CHECK (length(trim("openmeld_service_runtime_id")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_harness_presence_controller_ref_non_empty_check" CHECK (length(trim("agent_controller_ref")) > 0),
	CONSTRAINT "openMeldDaemon_runtime_harness_presence_undetected_count_check" CHECK ("undetected_report_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "openMeldDaemon_runtime_harness_presence_runtime_controller_unique" ON "openmeld"."openMeldDaemon_runtime_harness_presence" USING btree ("openmeld_service_runtime_id","agent_controller_ref");