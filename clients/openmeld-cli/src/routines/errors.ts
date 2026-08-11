import {
  type StructuredApiClientFailure,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { RoutineScheduleValidationError } from "@openmeld/routine-schedule";
import type { CenterAgentCommandContext } from "../center-agent/command-context";
import { emitCliErrorJson } from "../runtime/cli-error-json";
import { renderInfoCard } from "../ui/info-card";
import type { RoutineOperation } from "./types";

type ClassifiedRoutineFailure = {
  code: string;
  message: string;
  nextStep: string;
  title: string;
};

export class RoutineCommandError extends Error {
  readonly code: string;
  readonly nextStep: string;
  readonly title: string;

  constructor(input: ClassifiedRoutineFailure) {
    super(input.message);
    this.name = "RoutineCommandError";
    this.code = input.code;
    this.nextStep = input.nextStep;
    this.title = input.title;
  }
}

export function emitRoutineCommandError(input: {
  context: CenterAgentCommandContext;
  error: unknown;
  operation: RoutineOperation;
}): void {
  const localFailure = classifyLocalRoutineFailure(input.error);
  if (localFailure) {
    emitClassifiedRoutineError({
      classified: localFailure,
      context: input.context,
    });
    return;
  }

  const failure = toStructuredApiClientFailure(input.error);
  emitClassifiedRoutineError({
    classified: classifyRoutineApiFailure(failure, input.operation),
    context: input.context,
    failure,
  });
}

function emitClassifiedRoutineError(input: {
  classified: ClassifiedRoutineFailure;
  context: CenterAgentCommandContext;
  failure?: StructuredApiClientFailure;
}): void {
  process.exitCode = 1;

  if (input.context.cliJsonOutput) {
    emitCliErrorJson({
      code: input.classified.code,
      message: formatRoutineCliJsonErrorMessage({
        classified: input.classified,
        failure: input.failure,
      }),
      requestId: input.failure?.requestId,
    });
    return;
  }

  if (input.context.runtime.resolvedView === "agent") {
    input.context.presenter.event(
      "error",
      "routines.error",
      {
        message: input.classified.message,
        status: "error",
        organization: { active: input.context.activeOrganization },
        error: {
          code: input.classified.code,
          message: input.classified.message,
          nextStep: input.classified.nextStep,
        },
        ...(input.failure
          ? { failure: buildSafeFailureEvidence(input.failure) }
          : {}),
      },
      { code: input.classified.code }
    );
    return;
  }

  renderInfoCard({
    codePrefix: "routines.error.card",
    minContentWidth: 72,
    presenter: input.context.presenter,
    rows: [
      { label: "Reason", value: input.classified.message },
      { label: "Next Step", value: input.classified.nextStep },
      ...buildFailureDetails(input.failure),
    ],
    sanitize: true,
    title: input.classified.title,
  });
}

function formatRoutineCliJsonErrorMessage(input: {
  classified: ClassifiedRoutineFailure;
  failure?: StructuredApiClientFailure;
}): string {
  const baseMessage = `${input.classified.message} Next: ${input.classified.nextStep}`;
  if (!input.failure) {
    return baseMessage;
  }

  const schemaIssue = formatSchemaIssue(input.failure);
  const evidence = [
    ...(input.failure.status === null
      ? []
      : [`HTTP status ${input.failure.status}`]),
    ...(input.failure.upstreamCode
      ? [`upstream code ${input.failure.upstreamCode}`]
      : []),
    ...(schemaIssue ? [`schema issue ${schemaIssue}`] : []),
  ];
  if (evidence.length === 0) {
    return baseMessage;
  }
  return `${baseMessage} Diagnostic evidence: ${evidence.join("; ")}.`;
}

function classifyLocalRoutineFailure(
  error: unknown
): ClassifiedRoutineFailure | null {
  if (error instanceof RoutineCommandError) {
    return error;
  }
  if (error instanceof RoutineScheduleValidationError) {
    return {
      code: error.code,
      message: error.message,
      nextStep: scheduleValidationNextStep(error.code),
      title: "Routine Schedule Invalid",
    };
  }
  return null;
}

function scheduleValidationNextStep(code: string): string {
  if (code === "routine.schedule.invalid_daily_time") {
    return "Pass a strict 24-hour time such as `--daily 09:00`.";
  }
  if (code === "routine.schedule.invalid_timezone") {
    return "Pass an explicit IANA timezone such as `--timezone America/Los_Angeles`.";
  }
  if (code === "routine.schedule.too_frequent") {
    return "Choose a schedule whose Runs are always at least five minutes apart.";
  }
  return "Pass a valid five-field expression with `--cron` and an explicit IANA timezone.";
}

function classifyRoutineApiFailure(
  failure: StructuredApiClientFailure,
  operation: RoutineOperation
): ClassifiedRoutineFailure {
  if (hasFailureCode(failure, "routine.forbidden")) {
    return {
      code: "routine.forbidden",
      message:
        "Your organization role cannot manage this Routine. Ask an organization owner to make this change.",
      nextStep:
        "Run `openmeld org current`, then contact an organization owner if your role is not Owner.",
      title: "Routine Permission Required",
    };
  }
  if (hasFailureCode(failure, "routine.not_found")) {
    return {
      code: "routine.not_found",
      message: "This Routine was not found in the active organization.",
      nextStep: "Run `openmeld routines list` to find an available Routine.",
      title: "Routine Not Found",
    };
  }
  if (hasFailureCode(failure, "routine.status_conflict")) {
    return {
      code: "routine.status_conflict",
      message: "This Routine is already in the requested state.",
      nextStep: "Run `openmeld routines show <routine-id>` to inspect it.",
      title: "Routine State Unchanged",
    };
  }
  if (hasFailureCode(failure, "routine.center_agent_required")) {
    return {
      code: "routine.center_agent_required",
      message:
        "The active organization needs a Center Agent before Routines can run.",
      nextStep:
        "Run `openmeld center-agent status`, then designate a Center Agent if needed.",
      title: "Center Agent Required",
    };
  }
  if (hasFailureCode(failure, "routine.member_actor_required")) {
    return {
      code: "routine.member_actor_required",
      message:
        "Your signed-in account is not an active member of this organization.",
      nextStep:
        "Run `openmeld org current`, then ask an organization owner to restore your membership.",
      title: "Organization Membership Required",
    };
  }
  if (
    hasFailureCode(
      failure,
      "routine.target_space_not_found",
      "routine.target_space_org_mismatch",
      "routine.target_space_publication_unavailable"
    )
  ) {
    return targetSpaceFailure(failure);
  }
  if (hasFailureCode(failure, "routine.total_limit_reached")) {
    return {
      code: "routine.total_limit_reached",
      message: "This organization has reached its Routine limit.",
      nextStep: "Delete an unused Routine, then retry.",
      title: "Routine Limit Reached",
    };
  }
  if (hasFailureCode(failure, "routine.store_unavailable")) {
    return {
      code: "routine.store_unavailable",
      message: "OpenMeld could not reach the Routine store.",
      nextStep: "Retry after OpenMeld is healthy.",
      title: "Routines Unavailable",
    };
  }
  if (failure.code === "gateway.invalid_response") {
    return {
      code: failure.code,
      message: failure.message,
      nextStep: "Retry after OpenMeld Gateway is updated and healthy.",
      title: "Routine Response Invalid",
    };
  }
  if (failure.code === "gateway.http_error") {
    return {
      code: failure.code,
      message: formatSafeFailureMessage(failure),
      nextStep: "Check OpenMeld Gateway health, then retry this command.",
      title: "Routine Command Failed",
    };
  }
  if (failure.code) {
    return {
      code: failure.code,
      message: failure.message,
      nextStep: "Check the diagnostic evidence, then retry this command.",
      title: "Routine Command Failed",
    };
  }
  return {
    code: `routine.${operation}_failed`,
    message: failure.message,
    nextStep: "Check your connection, then retry this command.",
    title: "Routine Command Failed",
  };
}

function buildFailureDetails(
  failure: StructuredApiClientFailure | undefined
): Array<{ label: string; value: string }> {
  if (!failure) {
    return [];
  }
  const schemaIssue = formatSchemaIssue(failure);
  return [
    ...(failure.status === null
      ? []
      : [{ label: "HTTP Status", value: String(failure.status) }]),
    ...(failure.upstreamCode
      ? [{ label: "Upstream Code", value: failure.upstreamCode }]
      : []),
    ...(schemaIssue ? [{ label: "Schema Issue", value: schemaIssue }] : []),
    ...(failure.requestId
      ? [{ label: "Request ID", value: failure.requestId }]
      : []),
  ];
}

function buildSafeFailureEvidence(
  failure: StructuredApiClientFailure
): StructuredApiClientFailure {
  return {
    code: failure.code,
    message: formatSafeFailureMessage(failure),
    requestId: failure.requestId,
    status: failure.status,
    upstreamCode: failure.upstreamCode,
    ...(failure.schemaIssueMessage
      ? { schemaIssueMessage: failure.schemaIssueMessage }
      : {}),
    ...(failure.schemaIssuePath
      ? { schemaIssuePath: failure.schemaIssuePath }
      : {}),
  };
}

function formatSafeFailureMessage(failure: StructuredApiClientFailure): string {
  if (failure.code !== "gateway.http_error") {
    return failure.message;
  }
  if (failure.status === null) {
    return "OpenMeld Gateway returned an unreadable error response.";
  }
  return `OpenMeld Gateway request failed with HTTP ${failure.status}.`;
}

function formatSchemaIssue(failure: StructuredApiClientFailure): string | null {
  if (!(failure.schemaIssuePath || failure.schemaIssueMessage)) {
    return null;
  }
  if (failure.schemaIssuePath && failure.schemaIssueMessage) {
    return `${failure.schemaIssuePath}: ${failure.schemaIssueMessage}`;
  }
  return failure.schemaIssuePath ?? failure.schemaIssueMessage ?? null;
}

function targetSpaceFailure(
  failure: StructuredApiClientFailure
): ClassifiedRoutineFailure {
  let code = "routine.target_space_publication_unavailable";
  if (hasFailureCode(failure, "routine.target_space_not_found")) {
    code = "routine.target_space_not_found";
  } else if (hasFailureCode(failure, "routine.target_space_org_mismatch")) {
    code = "routine.target_space_org_mismatch";
  }
  return {
    code,
    message:
      "The selected target Space is unavailable for this organization's Routine.",
    nextStep:
      "Choose a publishable Space in the active organization and retry with `--target-space <space-id>`.",
    title: "Target Space Unavailable",
  };
}

function hasFailureCode(
  failure: StructuredApiClientFailure,
  ...codes: string[]
): boolean {
  return codes.some(
    (code) => failure.code === code || failure.upstreamCode === code
  );
}
