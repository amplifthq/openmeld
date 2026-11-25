CREATE TABLE "openmeld"."feishu_group_history_settings" (
	"connection_id" text NOT NULL,
	"generation" bigint NOT NULL,
	"chat_id" text NOT NULL,
	CONSTRAINT "feishu_group_history_settings_connection_id_generation_chat_id_pk" PRIMARY KEY("connection_id","generation","chat_id")
);
--> statement-breakpoint
ALTER TABLE "openmeld"."feishu_group_history_settings" ADD CONSTRAINT "feishu_group_history_settings_connection_id_openMeldRemoteAgent_lark_platform_channel_connections_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"("connection_id") ON DELETE cascade ON UPDATE no action;