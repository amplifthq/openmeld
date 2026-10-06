const ROUTINE_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
});

export function formatRoutineTimestamp(timestampMs: number): string {
	return ROUTINE_TIMESTAMP_FORMATTER.format(new Date(timestampMs));
}
