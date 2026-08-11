export type RoutinesCommandInput = {
  json?: boolean;
  view?: string;
};

export type RunRoutinesCreateInput = RoutinesCommandInput & {
  cronExpression?: string;
  dailyTime?: string;
  instructions?: string;
  name?: string;
  runAtIso?: string;
  targetSpaceId?: string;
  timezone?: string;
};

export type RunRoutinesShowInput = RoutinesCommandInput & {
  routineId?: string;
};

export type RunRoutinesUpdateInput = RunRoutinesShowInput & {
  cronExpression?: string;
  dailyTime?: string;
  instructions?: string;
  name?: string;
  runAtIso?: string;
  targetSpaceId?: string;
  timezone?: string;
};

export type RunRoutinesDeleteInput = RunRoutinesShowInput & {
  yes?: boolean;
};

export type RunRoutinesRunsInput = RunRoutinesShowInput & {
  beforeScheduledFor?: number | string;
  limit?: number | string;
};

export type RoutineOperation =
  | "create"
  | "delete"
  | "list"
  | "pause"
  | "resume"
  | "runs"
  | "show"
  | "update";
