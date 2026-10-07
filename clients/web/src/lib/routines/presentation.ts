const ROUTINE_TIMESTAMP_OPTIONS = {
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
} as const satisfies Intl.DateTimeFormatOptions;
const ROUTINE_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(
	"en-US",
	ROUTINE_TIMESTAMP_OPTIONS
);
const ROUTINE_TIMESTAMP_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
	...ROUTINE_TIMESTAMP_OPTIONS,
	year: "numeric",
});

export function formatRoutineTimestamp(timestampMs: number): string {
	const date = new Date(timestampMs);
	const formatter =
		date.getFullYear() === new Date().getFullYear()
			? ROUTINE_TIMESTAMP_FORMATTER
			: ROUTINE_TIMESTAMP_WITH_YEAR_FORMATTER;
	return formatter.format(date);
}
