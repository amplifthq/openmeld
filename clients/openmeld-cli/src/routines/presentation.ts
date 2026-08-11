import { formatStoredRoutineSchedule } from "@openmeld/routine-schedule";
import type {
  CenterAgentRoutine,
  CenterAgentRoutineRun,
  CreateCenterAgentRoutineResponse,
  DeleteCenterAgentRoutineResponse,
  ListCenterAgentRoutineRunsResponse,
  ListCenterAgentRoutinesResponse,
} from "@openmeld/schemas/types";
import type { CenterAgentCommandContext } from "../center-agent/command-context";
import { renderInfoCard } from "../ui/info-card";
import { RoutineCommandError } from "./errors";

const ROUTINE_RUN_STATUS_LABELS: Readonly<Record<string, string>> = {
  claimed: "Claimed",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  submitted: "Submitted",
};

export function renderRoutinesList(input: {
  context: CenterAgentCommandContext;
  response: ListCenterAgentRoutinesResponse;
}): void {
  if (input.context.runtime.resolvedView === "agent") {
    input.context.presenter.data({
      code: "routines.list",
      payload: input.response,
    });
    return;
  }

  const { routines } = input.response;
  if (routines.length === 0) {
    renderInfoCard({
      codePrefix: "routines.list.card",
      minContentWidth: 72,
      presenter: input.context.presenter,
      rows: [
        {
          label: "Status",
          value: `No Routines are configured for ${input.context.activeOrganization.name}.`,
        },
        {
          label: "Next Step",
          value:
            'Run `openmeld routines create --name "Daily brief" --instructions "..." --daily 09:00 --timezone America/Los_Angeles --target-space <space-id>`.',
        },
      ],
      sanitize: true,
      title: "No Routines Yet",
    });
    return;
  }

  renderInfoCard({
    codePrefix: "routines.list.card",
    minContentWidth: 72,
    presenter: input.context.presenter,
    rows: routines.map((routine) => ({
      label: routine.name,
      value: formatRoutineListSummary(routine),
    })),
    sanitize: true,
    title: `Routines (${routines.length})`,
  });
}

export function renderRoutineMutation(input: {
  code:
    | "routines.create"
    | "routines.pause"
    | "routines.resume"
    | "routines.update";
  context: CenterAgentCommandContext;
  response: CreateCenterAgentRoutineResponse;
  title: string;
}): void {
  if (input.context.runtime.resolvedView === "agent") {
    input.context.presenter.data({ code: input.code, payload: input.response });
    return;
  }

  const { routine } = input.response;
  renderInfoCard({
    codePrefix: "routines.mutation.card",
    minContentWidth: 72,
    presenter: input.context.presenter,
    rows: [
      { label: "Name", value: routine.name },
      { label: "Routine ID", value: routine.id },
      {
        label: "Schedule",
        value: formatRoutineSchedule(routine),
      },
      {
        label: "Status",
        value: formatRoutineStatus(routine.status),
      },
      { label: "Destination", value: formatRoutineDestination(routine) },
    ],
    sanitize: true,
    title: input.title,
  });
}

export function renderRoutineConfiguration(input: {
  context: CenterAgentCommandContext;
  response: CreateCenterAgentRoutineResponse;
}): void {
  if (input.context.runtime.resolvedView === "agent") {
    input.context.presenter.data({
      code: "routines.show",
      payload: input.response,
    });
    return;
  }

  const { routine } = input.response;
  renderInfoCard({
    codePrefix: "routines.show.card",
    minContentWidth: 72,
    presenter: input.context.presenter,
    rows: [
      { label: "Name", value: routine.name },
      { label: "Routine ID", value: routine.id },
      { label: "Instructions", value: routine.instructions },
      {
        label: "Schedule",
        value: formatRoutineSchedule(routine),
      },
      { label: "Raw Cron", value: routine.cronExpression ?? "Not applicable" },
      { label: "Timezone", value: routine.timezone ?? "Not applicable" },
      {
        label: "Status",
        value: formatRoutineStatus(routine.status),
      },
      { label: "Destination", value: formatRoutineDestination(routine) },
      {
        label: "Next Run",
        value: routine.nextDueAt
          ? formatRoutineTimestamp(routine.nextDueAt, routine.timezone ?? "UTC")
          : "Not scheduled",
      },
    ],
    sanitize: true,
    title: "Routine Configuration",
  });
}

export function renderRoutineRuns(input: {
  context: CenterAgentCommandContext;
  response: ListCenterAgentRoutineRunsResponse;
}): void {
  if (input.context.runtime.resolvedView === "agent") {
    input.context.presenter.data({
      code: "routines.runs",
      payload: input.response,
    });
    return;
  }

  const { routineId, runs } = input.response;
  if (runs.length === 0) {
    renderInfoCard({
      codePrefix: "routines.runs.card",
      minContentWidth: 72,
      presenter: input.context.presenter,
      rows: [
        { label: "Routine ID", value: routineId },
        { label: "Status", value: "This Routine has no Runs yet." },
        {
          label: "Next Step",
          value:
            "Wait for the next scheduled Run, or check `openmeld routines show <routine-id>`.",
        },
      ],
      sanitize: true,
      title: "No Routine Runs Yet",
    });
    return;
  }

  renderInfoCard({
    codePrefix: "routines.runs.card",
    minContentWidth: 72,
    presenter: input.context.presenter,
    rows: runs.map((run) => ({
      label: run.id,
      value: formatRoutineRunSummary(run),
    })),
    sanitize: true,
    title: `Routine Runs (${runs.length})`,
  });
}

export function renderRoutineDeleted(input: {
  context: CenterAgentCommandContext;
  response: DeleteCenterAgentRoutineResponse;
}): void {
  if (input.context.runtime.resolvedView === "agent") {
    input.context.presenter.data({
      code: "routines.delete",
      payload: input.response,
    });
    return;
  }

  renderInfoCard({
    codePrefix: "routines.delete.card",
    minContentWidth: 72,
    presenter: input.context.presenter,
    rows: [
      { label: "Routine ID", value: input.response.routineId },
      { label: "Status", value: "Deleted" },
    ],
    sanitize: true,
    title: "Routine Deleted",
  });
}

export function formatRoutineListSummary(routine: CenterAgentRoutine): string {
  const schedule = formatRoutineSchedule(routine);
  const status = formatRoutineStatus(routine.status);
  const nextRun = routine.nextDueAt
    ? formatRoutineTimestamp(routine.nextDueAt, routine.timezone ?? "UTC")
    : "Not scheduled";
  return [
    schedule,
    status,
    formatRoutineDestination(routine),
    `Next run: ${nextRun}`,
    `Last run: ${formatRoutineLastRun(routine.lastRun)}`,
  ].join(" · ");
}

function formatRoutineSchedule(routine: CenterAgentRoutine): string {
  if (routine.scheduleKind === "once" && routine.runAtMs !== null) {
    return `Once on ${formatRoutineTimestamp(routine.runAtMs, "UTC")}`;
  }
  return formatStoredRoutineSchedule({
    cronExpression: routine.cronExpression ?? "",
    timezone: routine.timezone ?? "UTC",
  });
}

function formatRoutineStatus(status: CenterAgentRoutine["status"]): string {
  if (status === "enabled") {
    return "Enabled";
  }
  if (status === "paused") {
    return "Paused";
  }
  return "Completed";
}

function formatRoutineDestination(routine: CenterAgentRoutine): string {
  if (routine.destinationKind === "slack_thread") {
    return routine.slackThreadLabel ?? `Slack thread ${routine.slackThreadTs}`;
  }
  return `OpenMeld Space ${routine.targetSpaceId}`;
}

function formatRoutineLastRun(lastRun: CenterAgentRoutine["lastRun"]): string {
  if (lastRun === null) {
    return "No Runs yet";
  }
  return formatRoutineRunStatus(lastRun.status);
}

function formatRoutineRunSummary(run: CenterAgentRoutineRun): string {
  const parts = [
    formatRoutineRunStatus(run.status),
    `Scheduled: ${new Date(run.scheduledFor).toISOString()}`,
  ];
  if (run.failureCode) {
    parts.push(`Code: ${run.failureCode}`);
  }
  if (run.failureDetail) {
    parts.push(`Detail: ${run.failureDetail}`);
  }
  return parts.join(" · ");
}

function formatRoutineRunStatus(status: string): string {
  const label = ROUTINE_RUN_STATUS_LABELS[status];
  if (!label) {
    throw new RoutineCommandError({
      code: "routine.response_invalid",
      message: `OpenMeld returned an unknown Routine Run status: ${status}.`,
      nextStep: "Retry after OpenMeld Gateway and CLI are updated.",
      title: "Routine Response Invalid",
    });
  }
  return label;
}

function formatRoutineTimestamp(timestampMs: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: timezone,
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(timestampMs));
}
