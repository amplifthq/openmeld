import type { Command } from "commander";

export type RoutineOutputOptions = {
  json?: boolean;
};

export function resolveRoutinesCliOutputMode(input: {
  json?: boolean;
  view?: string;
}): {
  json: boolean;
  jsonOutput: boolean;
  view?: string;
} {
  if (input.json === true) {
    return { json: true, jsonOutput: true, view: "agent" };
  }
  return {
    json: false,
    jsonOutput: false,
    ...(input.view === undefined ? {} : { view: input.view }),
  };
}

export type RoutineCreateOptions = RoutineOutputOptions & {
  cron?: string;
  daily?: string;
  instructions?: string;
  name?: string;
  runAt?: string;
  targetSpace?: string;
  timezone?: string;
};

export type RoutineUpdateOptions = RoutineCreateOptions;

export type RoutineDeleteOptions = RoutineOutputOptions & {
  yes?: boolean;
};

export type RoutineRunsOptions = RoutineOutputOptions & {
  beforeScheduledFor?: string;
  limit?: string;
};

export type RoutinesCommandHandlers = {
  create: (options: RoutineCreateOptions) => Promise<void>;
  delete: (routineId: string, options: RoutineDeleteOptions) => Promise<void>;
  list: (options: RoutineOutputOptions) => Promise<void>;
  pause: (routineId: string, options: RoutineOutputOptions) => Promise<void>;
  resume: (routineId: string, options: RoutineOutputOptions) => Promise<void>;
  runs: (routineId: string, options: RoutineRunsOptions) => Promise<void>;
  show: (routineId: string, options: RoutineOutputOptions) => Promise<void>;
  update: (routineId: string, options: RoutineUpdateOptions) => Promise<void>;
};

export function registerRoutinesCommands(
  program: Command,
  handlers: RoutinesCommandHandlers
): Command {
  const routines = program
    .command("routines")
    .description("Manage scheduled Center Agent Routines.");

  routines
    .command("list")
    .description("List Routines in the active organization.")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(async (options: RoutineOutputOptions) => {
      await handlers.list(options);
    });

  routines
    .command("create")
    .description("Create a scheduled Center Agent Routine.")
    .option("--name <name>", "Human-readable Routine name")
    .option("--instructions <text>", "Instructions for the Center Agent")
    .option("--cron <expression>", "Raw five-field cron expression")
    .option("--daily <HH:MM>", "Daily time in strict 24-hour HH:MM format")
    .option(
      "--run-at <ISO-8601>",
      "Run once at an ISO-8601 timestamp with a timezone"
    )
    .option("--timezone <timezone>", "Required explicit IANA timezone")
    .option(
      "--target-space <space-id>",
      "Required target Space for published results"
    )
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(async (options: RoutineCreateOptions) => {
      await handlers.create(options);
    });

  routines
    .command("show")
    .description("Show one Routine configuration.")
    .argument("<routine-id>", "Routine ID")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(async (routineId: string, options: RoutineOutputOptions) => {
      await handlers.show(routineId, options);
    });

  routines
    .command("update")
    .description("Update explicitly selected Routine fields.")
    .argument("<routine-id>", "Routine ID")
    .option("--name <name>", "New human-readable Routine name")
    .option("--instructions <text>", "New Center Agent instructions")
    .option("--cron <expression>", "New raw five-field cron expression")
    .option("--daily <HH:MM>", "New daily time in strict 24-hour HH:MM format")
    .option("--run-at <ISO-8601>", "Replace the schedule with one future run")
    .option("--timezone <timezone>", "Explicit IANA timezone")
    .option("--target-space <space-id>", "New target Space for results")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(async (routineId: string, options: RoutineUpdateOptions) => {
      await handlers.update(routineId, options);
    });

  routines
    .command("pause")
    .description("Pause future Runs for a Routine.")
    .argument("<routine-id>", "Routine ID")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(async (routineId: string, options: RoutineOutputOptions) => {
      await handlers.pause(routineId, options);
    });

  routines
    .command("resume")
    .description("Resume future Runs for a paused Routine.")
    .argument("<routine-id>", "Routine ID")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(async (routineId: string, options: RoutineOutputOptions) => {
      await handlers.resume(routineId, options);
    });

  routines
    .command("delete")
    .description("Permanently delete a Routine.")
    .argument("<routine-id>", "Routine ID")
    .option("--yes", "Skip destructive confirmation", false)
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(async (routineId: string, options: RoutineDeleteOptions) => {
      await handlers.delete(routineId, options);
    });

  routines
    .command("runs")
    .description("List recent Runs for a Routine.")
    .argument("<routine-id>", "Routine ID")
    .option("--limit <count>", "Maximum Runs to return (1-100)")
    .option(
      "--before-scheduled-for <timestamp-ms>",
      "Return Runs scheduled before this timestamp in milliseconds"
    )
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(async (routineId: string, options: RoutineRunsOptions) => {
      await handlers.runs(routineId, options);
    });

  return routines;
}
