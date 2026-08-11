type RoutineScheduleModule = typeof import("@openmeld/routine-schedule");

let routineScheduleModulePromise: Promise<RoutineScheduleModule> | null = null;

/**
 * Loads the calendar engine only when a Routine schedule is evaluated.
 *
 * The schedule package includes the Temporal polyfill. Keeping it behind this
 * boundary avoids evaluating the full calendar implementation during every
 * Core Worker isolate startup while preserving the same canonical engine.
 */
export function loadRoutineSchedule(): Promise<RoutineScheduleModule> {
  routineScheduleModulePromise ??= import("@openmeld/routine-schedule");
  return routineScheduleModulePromise;
}
