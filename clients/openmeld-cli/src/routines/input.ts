import {
  createDailyRoutineSchedule,
  validateRoutineSchedule,
} from "@openmeld/routine-schedule";
import { CENTER_AGENT_ROUTINE_RUN_LIST_MAX_LIMIT } from "@openmeld/schemas";
import type {
  CreateCenterAgentRoutineBody,
  UpdateCenterAgentRoutineBody,
} from "@openmeld/schemas/types";
import { RoutineCommandError } from "./errors";
import type {
  RunRoutinesCreateInput,
  RunRoutinesRunsInput,
  RunRoutinesUpdateInput,
} from "./types";

const INTEGER_OPTION_PATTERN = /^\d+$/u;
const ISO_TIMESTAMP_WITH_TIMEZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const SIGNED_INTEGER_OPTION_PATTERN = /^-?\d+$/u;

export function buildCreateRoutineBody(
  input: RunRoutinesCreateInput
): CreateCenterAgentRoutineBody {
  assertScheduleInputsDoNotConflict(input);
  const name = requireCommandValue(input.name, {
    code: "routine.name_required",
    label: "Routine name",
    nextStep: "Pass `--name <name>`.",
  });
  const instructions = requireCommandValue(input.instructions, {
    code: "routine.instructions_required",
    label: "Routine instructions",
    nextStep: "Pass `--instructions <text>`.",
  });
  const targetSpaceId = requireCommandValue(input.targetSpaceId, {
    code: "routine.target_space_required",
    label: "Target Space",
    nextStep: "Pass `--target-space <space-id>`.",
  });
  const schedule = buildRequiredRoutineSchedule(input);
  return {
    ...schedule,
    destinationKind: "space",
    instructions,
    name,
    slackChannelId: null,
    slackConversationId: null,
    slackTeamId: null,
    slackThreadLabel: null,
    slackThreadTs: null,
    targetSpaceId,
  };
}

export function buildUpdateRoutineBody(
  input: RunRoutinesUpdateInput
): UpdateCenterAgentRoutineBody {
  assertScheduleInputsDoNotConflict(input);
  const body: UpdateCenterAgentRoutineBody = {};

  addOptionalUpdateText(body, "name", input.name, {
    code: "routine.name_required",
    label: "Routine name",
    nextStep: "Pass a non-empty value to `--name`.",
  });
  addOptionalUpdateText(body, "instructions", input.instructions, {
    code: "routine.instructions_required",
    label: "Routine instructions",
    nextStep: "Pass a non-empty value to `--instructions`.",
  });
  if (input.targetSpaceId !== undefined) {
    body.destinationKind = "space";
    body.slackChannelId = null;
    body.slackConversationId = null;
    body.slackTeamId = null;
    body.slackThreadLabel = null;
    body.slackThreadTs = null;
    body.targetSpaceId = requireCommandValue(input.targetSpaceId, {
      code: "routine.target_space_required",
      label: "Target Space",
      nextStep: "Pass a non-empty Space ID to `--target-space`.",
    });
  }

  if (
    input.cronExpression !== undefined ||
    input.dailyTime !== undefined ||
    input.runAtIso !== undefined
  ) {
    const schedule = buildRequiredRoutineSchedule(input);
    body.cronExpression = schedule.cronExpression;
    body.runAtMs = schedule.runAtMs;
    body.scheduleKind = schedule.scheduleKind;
    body.timezone = schedule.timezone;
  } else if (input.timezone !== undefined) {
    const timezone = requireCommandValue(input.timezone, {
      code: "routine.schedule.timezone_required",
      label: "Routine timezone",
      nextStep: "Pass a non-empty IANA timezone to `--timezone`.",
    });
    body.timezone = validateRoutineSchedule({
      cronExpression: "0 0 * * *",
      timezone,
    }).timezone;
  }

  if (Object.keys(body).length === 0) {
    throw new RoutineCommandError({
      code: "routine.update.fields_required",
      message: "At least one Routine field must be updated.",
      nextStep:
        "Pass one or more of `--name`, `--instructions`, `--target-space`, `--run-at`, `--cron`, `--daily`, or `--timezone`.",
      title: "Routine Update Required",
    });
  }
  return body;
}

export function buildRoutineRunsQuery(input: RunRoutinesRunsInput): {
  beforeScheduledFor?: number;
  limit?: number;
} {
  const limit = normalizeRoutineIntegerOption(input.limit, {
    code: "routine.runs.limit_invalid",
    maximum: CENTER_AGENT_ROUTINE_RUN_LIST_MAX_LIMIT,
    message: `Run limit must be an integer between 1 and ${CENTER_AGENT_ROUTINE_RUN_LIST_MAX_LIMIT}.`,
    minimum: 1,
    nextStep: "Pass `--limit 25` or omit the option.",
    title: "Run Limit Invalid",
  });
  const beforeScheduledFor = normalizeRoutineIntegerOption(
    input.beforeScheduledFor,
    {
      code: "routine.runs.before_invalid",
      maximum: Number.MAX_SAFE_INTEGER,
      message: "Run cursor must be a safe integer timestamp in milliseconds.",
      minimum: Number.MIN_SAFE_INTEGER,
      nextStep:
        "Pass `--before-scheduled-for <timestamp-ms>` or omit the option.",
      pattern: SIGNED_INTEGER_OPTION_PATTERN,
      title: "Run Cursor Invalid",
    }
  );
  return {
    ...(beforeScheduledFor === undefined ? {} : { beforeScheduledFor }),
    ...(limit === undefined ? {} : { limit }),
  };
}

export function requireRoutineId(value: string | undefined): string {
  return requireCommandValue(value, {
    code: "routine.id_required",
    label: "Routine ID",
    nextStep: "Run `openmeld routines list`, then pass a Routine ID.",
  });
}

export function routineNotFoundError(routineId: string): RoutineCommandError {
  return new RoutineCommandError({
    code: "routine.not_found",
    message: `Routine ${routineId} was not found in the active organization.`,
    nextStep: "Run `openmeld routines list` to find an available Routine.",
    title: "Routine Not Found",
  });
}

function buildRequiredRoutineSchedule(
  input: Pick<
    RunRoutinesCreateInput,
    "cronExpression" | "dailyTime" | "runAtIso" | "timezone"
  >
): {
  cronExpression: string | null;
  runAtMs: number | null;
  scheduleKind: "cron" | "once";
  timezone: string | null;
} {
  if (input.runAtIso !== undefined) {
    return {
      cronExpression: null,
      runAtMs: parseFutureRunAt(input.runAtIso),
      scheduleKind: "once",
      timezone: null,
    };
  }
  const timezone = requireCommandValue(input.timezone, {
    code: "routine.schedule.timezone_required",
    label: "Routine timezone",
    nextStep: "Pass an explicit IANA timezone with `--timezone <timezone>`.",
  });
  if (input.dailyTime !== undefined) {
    const schedule = createDailyRoutineSchedule({
      dailyTime: input.dailyTime,
      timezone,
    });
    return {
      ...schedule,
      runAtMs: null,
      scheduleKind: "cron",
    };
  }
  const cronExpression = requireCommandValue(input.cronExpression, {
    code: "routine.schedule.required",
    label: "Routine schedule",
    nextStep: 'Pass `--cron "<five-field expression>"` or `--daily <HH:MM>`.',
  });
  return {
    ...validateRoutineSchedule({ cronExpression, timezone }),
    runAtMs: null,
    scheduleKind: "cron",
  };
}

function assertScheduleInputsDoNotConflict(input: {
  cronExpression?: string;
  dailyTime?: string;
  runAtIso?: string;
  timezone?: string;
}): void {
  const scheduleSelectorCount = [
    input.cronExpression,
    input.dailyTime,
    input.runAtIso,
  ].filter((value) => value !== undefined).length;
  if (
    scheduleSelectorCount > 1 ||
    (input.runAtIso !== undefined && input.timezone !== undefined)
  ) {
    throw new RoutineCommandError({
      code: "routine.schedule.input_conflict",
      message:
        "One-time, raw cron, and daily schedule options cannot be combined.",
      nextStep:
        "Pass `--run-at` by itself, or pass either `--cron` or `--daily` with `--timezone`.",
      title: "Routine Schedule Conflict",
    });
  }
}

function parseFutureRunAt(value: string): number {
  const normalized = requireCommandValue(value, {
    code: "routine.schedule.run_at_invalid",
    label: "One-time Routine timestamp",
    nextStep: "Pass an ISO-8601 timestamp such as `2026-07-16T09:00:00-07:00`.",
  });
  const timestampMs = ISO_TIMESTAMP_WITH_TIMEZONE_PATTERN.test(normalized)
    ? Date.parse(normalized)
    : Number.NaN;
  if (!Number.isSafeInteger(timestampMs)) {
    throw new RoutineCommandError({
      code: "routine.schedule.run_at_invalid",
      message:
        "One-time Routine timestamp must be a valid ISO-8601 time with a timezone.",
      nextStep: "Pass a timestamp such as `2026-07-16T09:00:00-07:00`.",
      title: "Routine Time Invalid",
    });
  }
  if (timestampMs <= Date.now()) {
    throw new RoutineCommandError({
      code: "routine.schedule.run_at_past",
      message: "One-time Routine timestamp must be in the future.",
      nextStep: "Pass a future time with `--run-at <ISO-8601>`.",
      title: "Routine Time Has Passed",
    });
  }
  return timestampMs;
}

function addOptionalUpdateText<K extends "instructions" | "name">(
  body: UpdateCenterAgentRoutineBody,
  key: K,
  value: string | undefined,
  error: { code: string; label: string; nextStep: string }
): void {
  if (value !== undefined) {
    body[key] = requireCommandValue(value, error);
  }
}

function normalizeRoutineIntegerOption(
  value: number | string | undefined,
  input: {
    code: string;
    maximum: number;
    message: string;
    minimum: number;
    nextStep: string;
    pattern?: RegExp;
    title: string;
  }
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  let normalized: number;
  if (typeof value === "number") {
    normalized = value;
  } else {
    const text = value.trim();
    normalized = (input.pattern ?? INTEGER_OPTION_PATTERN).test(text)
      ? Number(text)
      : Number.NaN;
  }
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < input.minimum ||
    normalized > input.maximum
  ) {
    throw new RoutineCommandError(input);
  }
  return normalized;
}

function requireCommandValue(
  value: string | undefined,
  input: { code: string; label: string; nextStep: string }
): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length > 0) {
    return normalized;
  }
  throw new RoutineCommandError({
    code: input.code,
    message: `${input.label} is required.`,
    nextStep: input.nextStep,
    title: `${input.label} Required`,
  });
}
