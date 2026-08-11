ALTER TABLE `routine_runs` ADD `continuation_delegation_id` text;--> statement-breakpoint
ALTER TABLE `routines` ADD `authorized_actions_json` text DEFAULT '[]' NOT NULL;