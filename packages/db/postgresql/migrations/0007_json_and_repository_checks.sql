ALTER TABLE "openmeld"."center_agent_context_load_receipts" DROP CONSTRAINT "center_agent_context_load_receipts_json_check";--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_context_manifest_materializations" DROP CONSTRAINT "center_agent_context_manifest_materializations_json_check";--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_context_manifests" DROP CONSTRAINT "center_agent_context_manifests_json_check";--> statement-breakpoint
ALTER TABLE "openmeld"."connector_app_requests" DROP CONSTRAINT "connector_app_requests_capabilities_length_check";--> statement-breakpoint
ALTER TABLE "openmeld"."desktop_update_installations" DROP CONSTRAINT "desktop_update_installations_json_check";--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" DROP CONSTRAINT "inbox_items_source_target_json_check";--> statement-breakpoint
ALTER TABLE "openmeld"."organization_opportunities" DROP CONSTRAINT "organization_opportunities_evidence_check";--> statement-breakpoint
ALTER TABLE "openmeld"."projects" DROP CONSTRAINT "projects_repository_url_shape_check";--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_context_load_receipts" ADD CONSTRAINT "center_agent_context_load_receipts_json_check" CHECK ("selected_entries_json" is json array);--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_context_manifest_materializations" ADD CONSTRAINT "center_agent_context_manifest_materializations_json_check" CHECK ("entries_json" is json array);--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_context_manifests" ADD CONSTRAINT "center_agent_context_manifests_json_check" CHECK ("truncation_reasons_json" is json array and "source_refs_json" is json array);--> statement-breakpoint
ALTER TABLE "openmeld"."connector_app_requests" ADD CONSTRAINT "connector_app_requests_capabilities_length_check" CHECK (length("requested_capabilities") between 2 and 2000 and "requested_capabilities" is json array);--> statement-breakpoint
ALTER TABLE "openmeld"."desktop_update_installations" ADD CONSTRAINT "desktop_update_installations_json_check" CHECK ("observation_json" is json object);--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" ADD CONSTRAINT "inbox_items_source_target_json_check" CHECK (length("source_target_json") between 2 and 2048 and "source_target_json" is json object);--> statement-breakpoint
ALTER TABLE "openmeld"."organization_opportunities" ADD CONSTRAINT "organization_opportunities_evidence_check" CHECK (length("evidence_json") between 3 and 8192 and case when "evidence_json" is json array then json_array_length("evidence_json"::json) between 1 and 8 else false end);--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD CONSTRAINT "projects_repository_url_shape_check" CHECK ("repository_url" is null or (
        "repository_url" ilike 'https://%'
        and "repository_url" not like '%@%'
        and "repository_url" not like '%?%'
        and "repository_url" not like '%#%'
      ));