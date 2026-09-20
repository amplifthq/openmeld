ALTER TABLE `openMeldRemoteAgent_lark_platform_registration_attempts` ADD `application_version_id` text;
--> statement-breakpoint
-- Earlier Webhook connections never verified a published application version.
-- Keep their app and credentials for the existing authorized repair flow.
UPDATE `openMeldRemoteAgent_lark_platform_channel_connections`
SET `status` = 'repair_required',
    `failure_reason_code` = `provider` || '.application_publication_required'
WHERE `transport` = 'webhook' AND `status` = 'connected';
