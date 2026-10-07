import type {
	CreateCenterAgentRoutineBody,
	RoutineManagement,
	UpdateCenterAgentRoutineBody,
} from "@openmeld/schemas/types";

const SPACE_PATTERN = /\s+/;
const NUMBER_PATTERN = /^\d+$/;
const WEEKDAY_PATTERN = /^[0-6]$/;

export type RoutineRepeat =
	| "daily"
	| "weekdays"
	| "weekly"
	| "monthly"
	| "once"
	| "custom";

export function readRoutineScheduleFields(
	initial?: Partial<CreateCenterAgentRoutineBody>
) {
	const fields = {
		repeat: "daily" as RoutineRepeat,
		time: "09:00",
		day: "1",
		cron: initial?.cronExpression ?? "0 9 * * *",
	};
	if (initial?.scheduleKind === "once") {
		return { ...fields, repeat: "once" as const };
	}
	if (!initial?.cronExpression) {
		return fields;
	}
	fields.repeat = "custom";
	const [minute, hour, date, month, weekday] = initial.cronExpression
		.trim()
		.split(SPACE_PATTERN);
	if (
		!(NUMBER_PATTERN.test(minute ?? "") && NUMBER_PATTERN.test(hour ?? "")) ||
		month !== "*"
	) {
		return fields;
	}
	if (date === "*" && weekday === "*") {
		fields.repeat = "daily";
	} else if (date === "*" && weekday === "1-5") {
		fields.repeat = "weekdays";
	} else if (date === "*" && WEEKDAY_PATTERN.test(weekday ?? "")) {
		fields.repeat = "weekly";
		fields.day = weekday ?? "1";
	} else if (
		weekday === "*" &&
		NUMBER_PATTERN.test(date ?? "") &&
		Number(date) >= 1 &&
		Number(date) <= 28
	) {
		fields.repeat = "monthly";
		fields.day = date ?? "1";
	}
	fields.time = `${hour?.padStart(2, "0")}:${minute?.padStart(2, "0")}`;
	return fields;
}

// An instruction edit must not reschedule a run or clear capabilities that
// the compact form does not own.
export function routineFormUpdate(
	current: RoutineManagement,
	body: CreateCenterAgentRoutineBody
): UpdateCenterAgentRoutineBody {
	const { scope: _scope, agentProfileId: _agent, ...fields } = body;
	return Object.fromEntries(
		Object.entries(fields).filter(
			([key, value]) =>
				JSON.stringify(current[key as keyof RoutineManagement]) !==
				JSON.stringify(value)
		)
	) as UpdateCenterAgentRoutineBody;
}
