CREATE TABLE "openmeld"."openMeldRemoteAgent_message_channel_unaddressed_messages" (
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"connection_id" text NOT NULL,
	"connection_generation" bigint,
	"conversation_key" text NOT NULL,
	"message_id" text NOT NULL,
	"root_message_id" text NOT NULL,
	"thread_id" text,
	"sender_id" text NOT NULL,
	"sender_tenant_key" text,
	"message_text" text NOT NULL,
	"provider_files_json" text DEFAULT '[]' NOT NULL,
	"sent_at_ms" bigint NOT NULL,
	"observed_at_ms" bigint NOT NULL,
	"source" text NOT NULL,
	"batch_key" text NOT NULL,
	"state" text NOT NULL,
	"batch_id" text,
	"claim_expires_at_ms" bigint,
	"route" text,
	"native_delivery_id" text,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "openMeldRemoteAgent_message_channel_unaddressed_messages_pk" PRIMARY KEY("provider","connection_id","message_id"),
	CONSTRAINT "openMeldRemoteAgent_message_channel_unaddressed_provider_check" CHECK ("provider" in ('slack', 'lark', 'feishu')),
	CONSTRAINT "openMeldRemoteAgent_message_channel_unaddressed_source_check" CHECK ("source" in ('push', 'backfill')),
	CONSTRAINT "openMeldRemoteAgent_message_channel_unaddressed_state_check" CHECK ("state" in ('pending', 'routing', 'archived', 'routed')),
	CONSTRAINT "openMeldRemoteAgent_message_channel_unaddressed_route_check" CHECK ("route" is null
          or "route" in ('follow_up', 'new_request', 'chatter', 'unrouted')),
	CONSTRAINT "openMeldRemoteAgent_message_channel_unaddressed_claim_check" CHECK ("state" <> 'routing'
          or ("batch_id" is not null and "claim_expires_at_ms" is not null)),
	CONSTRAINT "openMeldRemoteAgent_message_channel_unaddressed_identity_check" CHECK (length(trim("organization_id")) > 0
          and length(trim("connection_id")) > 0
          and length(trim("conversation_key")) > 0
          and length(trim("message_id")) > 0
          and length(trim("root_message_id")) > 0
          and length(trim("sender_id")) > 0
          and length(trim("batch_key")) > 0),
	CONSTRAINT "openMeldRemoteAgent_message_channel_unaddressed_times_check" CHECK ("sent_at_ms" >= 0
          and "observed_at_ms" >= 0
          and "updated_at_ms" >= "observed_at_ms")
);
--> statement-breakpoint
ALTER TABLE "openmeld"."openMeldRemoteAgent_message_channel_unaddressed_messages" ADD CONSTRAINT "openMeldRemoteAgent_message_channel_unaddressed_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_openMeldRemoteAgent_message_channel_unaddressed_batch" ON "openmeld"."openMeldRemoteAgent_message_channel_unaddressed_messages" USING btree ("provider","connection_id","conversation_key","batch_key","state");--> statement-breakpoint
CREATE INDEX "idx_openMeldRemoteAgent_message_channel_unaddressed_recent" ON "openmeld"."openMeldRemoteAgent_message_channel_unaddressed_messages" USING btree ("provider","connection_id","conversation_key","sent_at_ms" desc);