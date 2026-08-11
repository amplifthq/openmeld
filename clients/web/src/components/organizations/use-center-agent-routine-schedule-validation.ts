"use client";

import {
	formatStoredRoutineSchedule,
	type RoutineSchedule,
	RoutineScheduleValidationError,
	validateRoutineSchedule,
} from "@openmeld/routine-schedule";
import { type RefObject, useState } from "react";

type ScheduleField = "cron" | "timezone";

type ScheduleError = RoutineSchedule & {
	field: ScheduleField;
	message: string;
};

export type RoutineScheduleValidator = (
	schedule: RoutineSchedule
) => RoutineSchedule;

export function useCenterAgentRoutineScheduleValidation(input: {
	scheduleInputRef: RefObject<HTMLInputElement | null>;
	timezoneInputRef: RefObject<HTMLInputElement | null>;
	validateSchedule?: RoutineScheduleValidator;
	values: RoutineSchedule;
}) {
	const [admissionError, setAdmissionError] = useState<ScheduleError | null>(
		null
	);
	const presentation = resolveSchedulePresentation(input.values);
	const currentAdmissionError = matchesScheduleValues(
		admissionError,
		input.values
	)
		? admissionError
		: null;
	const scheduleError = resolveFieldError(
		"cron",
		presentation.error,
		currentAdmissionError
	);
	const timezoneError = resolveFieldError(
		"timezone",
		presentation.error,
		currentAdmissionError
	);

	const admitSchedule = (
		focusInvalidField: boolean
	): RoutineSchedule | null => {
		if (!presentation.valid) {
			if (focusInvalidField) {
				focusScheduleField(presentation.error?.field ?? "cron", {
					scheduleInput: input.scheduleInputRef.current,
					timezoneInput: input.timezoneInputRef.current,
				});
			}
			return null;
		}
		try {
			const schedule = (input.validateSchedule ?? validateRoutineSchedule)(
				input.values
			);
			setAdmissionError(null);
			return schedule;
		} catch (error) {
			const nextError = resolveScheduleError(error, input.values);
			setAdmissionError(nextError);
			if (focusInvalidField) {
				focusScheduleField(nextError.field, {
					scheduleInput: input.scheduleInputRef.current,
					timezoneInput: input.timezoneInputRef.current,
				});
			}
			return null;
		}
	};

	return {
		admitSchedule,
		presentation,
		scheduleError,
		timezoneError,
		valid: presentation.valid && currentAdmissionError === null,
	};
}

function resolveFieldError(
	field: ScheduleField,
	immediateError: ScheduleError | null,
	admissionError: ScheduleError | null
): ScheduleError | null {
	if (immediateError?.field === field) {
		return immediateError;
	}
	return admissionError?.field === field ? admissionError : null;
}

function resolveSchedulePresentation(values: RoutineSchedule): {
	error: ScheduleError | null;
	message: string;
	valid: boolean;
} {
	try {
		return {
			error: null,
			message: formatStoredRoutineSchedule(values),
			valid: true,
		};
	} catch (error) {
		const scheduleError = resolveScheduleError(error, values);
		return {
			error: scheduleError,
			message:
				scheduleError.field === "timezone"
					? "Enter a valid timezone to see a schedule preview."
					: "Enter a valid five-field schedule to see a preview.",
			valid: false,
		};
	}
}

function resolveScheduleError(
	error: unknown,
	values: RoutineSchedule
): ScheduleError {
	const validationError =
		error instanceof RoutineScheduleValidationError ? error : null;
	return {
		cronExpression: values.cronExpression,
		field:
			validationError?.code === "routine.schedule.invalid_timezone"
				? "timezone"
				: "cron",
		message:
			validationError?.message ??
			"Enter a valid five-field cron schedule and IANA timezone.",
		timezone: values.timezone,
	};
}

function matchesScheduleValues(
	error: ScheduleError | null,
	values: RoutineSchedule
): error is ScheduleError {
	return (
		error !== null &&
		error.cronExpression === values.cronExpression &&
		error.timezone === values.timezone
	);
}

function focusScheduleField(
	field: ScheduleField,
	inputs: {
		scheduleInput: HTMLInputElement | null;
		timezoneInput: HTMLInputElement | null;
	}
): void {
	(field === "timezone" ? inputs.timezoneInput : inputs.scheduleInput)?.focus();
}
