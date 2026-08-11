-- full-shared-schema-only
WITH `interaction_sources` AS (
	SELECT
		`execution`.`runtime_coordinator_execution_id` AS `execution_id`,
		`dispatch`.`source_event_id` AS `source_signal_id`
	FROM `openMeldDaemon_runtime_coordinator_executions` AS `execution`
	INNER JOIN `openMeldDaemon_dispatch_ledger` AS `dispatch`
		ON `dispatch`.`dispatch_id` = `execution`.`dispatch_id`
		AND `dispatch`.`space_id` = `execution`.`space_id`
		AND `dispatch`.`target_profile_id` = `execution`.`target_profile_id`
	WHERE length(trim(`dispatch`.`source_event_id`)) > 0
)
UPDATE `inbox_items`
SET `source_target_json` = json_object(
	'kind',
	'space',
	'signalId',
	(
		SELECT `source_signal_id`
		FROM `interaction_sources`
		WHERE `execution_id` = json_extract(
			`inbox_items`.`source_target_json`,
			'$.runtimeCoordinatorExecutionId'
		)
		LIMIT 1
	),
	'spaceId',
	json_extract(`source_target_json`, '$.spaceId')
)
WHERE `source_kind` = 'runtime_coordinator_interaction'
	AND `resolution_status` = 'resolved'
	AND json_extract(`source_target_json`, '$.kind') = 'agent_interaction'
	AND EXISTS (
		SELECT 1
		FROM `interaction_sources`
		WHERE `execution_id` = json_extract(
			`inbox_items`.`source_target_json`,
			'$.runtimeCoordinatorExecutionId'
		)
	);
