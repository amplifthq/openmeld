UPDATE `inbox_items`
SET
	`attention` = 'update',
	`resolution_status` = 'not_applicable',
	`resolved_at_ms` = NULL,
	`source_target_json` = json_remove(`source_target_json`, '$.signalId')
WHERE `source_kind` = 'space_signal'
	AND `kind` = 'wake_outcome'
	AND `attention` = 'action_required'
	AND `resolution_status` = 'open';
