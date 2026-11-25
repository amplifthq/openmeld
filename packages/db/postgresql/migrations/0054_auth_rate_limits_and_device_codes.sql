CREATE TABLE "openmeld"."rate_limits" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"key" text NOT NULL,
	"count" bigint NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCodes_deviceCode_uidx" ON "openmeld"."device_codes" USING btree ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCodes_userCode_uidx" ON "openmeld"."device_codes" USING btree ("user_code");