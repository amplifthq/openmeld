CREATE TABLE `eval_reports` (
	`organization_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`metrics_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `period_start`, `period_end`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "eval_reports_period_order_check" CHECK("eval_reports"."period_end" > "eval_reports"."period_start")
);
--> statement-breakpoint
CREATE INDEX `eval_reports_organization_period_end_idx` ON `eval_reports` (`organization_id`,`period_end`);