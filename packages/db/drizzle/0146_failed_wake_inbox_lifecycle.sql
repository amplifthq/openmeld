UPDATE `inbox_items`
SET
	`attention` = 'update',
	`resolution_status` = 'not_applicable',
	`resolved_at_ms` = NULL
WHERE `source_kind` = 'space_signal'
	AND `kind` = 'wake_outcome'
	AND `attention` = 'action_required'
	AND `resolution_status` = 'open';
