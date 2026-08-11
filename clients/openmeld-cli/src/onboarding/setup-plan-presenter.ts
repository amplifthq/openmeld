import {
  SETUP_PLAN_AGENT_VIEW_CODE,
  SETUP_PLAN_AGENT_VIEW_SCHEMA_VERSION,
  setupPlanAgentViewEventSchema,
  setupPlanAgentViewPayloadSchema,
} from "@openmeld/schemas";
import type {
  OnboardingFacts,
  OnboardingPlan,
  SetupPlanAgentViewEvent,
  SetupPlanAgentViewPayload,
} from "@openmeld/schemas/types";
import type { Presenter } from "../runtime/presenter/types";

export type SetupPlanPresenterMode = "apply" | "read_only";

export type BuildSetupPlanAgentViewPayloadInput = {
  facts: OnboardingFacts;
  mode: SetupPlanPresenterMode;
  plan: OnboardingPlan;
};

export type EmitSetupPlanAgentViewInput =
  BuildSetupPlanAgentViewPayloadInput & {
    presenter: Pick<Presenter, "data">;
  };

export function buildSetupPlanAgentViewPayload(
  input: BuildSetupPlanAgentViewPayloadInput
): SetupPlanAgentViewPayload {
  const payload = {
    schemaVersion: SETUP_PLAN_AGENT_VIEW_SCHEMA_VERSION,
    readOnly: input.mode === "read_only",
    facts: input.facts,
    plan: input.plan,
  };

  const result = setupPlanAgentViewPayloadSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `Invalid setup.plan payload: ${formatValidationIssues(result.error.issues)}`
    );
  }

  return result.data;
}

export function buildSetupPlanAgentViewEvent(
  input: BuildSetupPlanAgentViewPayloadInput
): SetupPlanAgentViewEvent {
  const event = {
    type: "result",
    code: SETUP_PLAN_AGENT_VIEW_CODE,
    payload: buildSetupPlanAgentViewPayload(input),
  };

  const result = setupPlanAgentViewEventSchema.safeParse(event);
  if (!result.success) {
    throw new Error(
      `Invalid setup.plan event: ${formatValidationIssues(result.error.issues)}`
    );
  }

  return result.data;
}

export function emitSetupPlanAgentView(
  input: EmitSetupPlanAgentViewInput
): SetupPlanAgentViewPayload {
  const event = buildSetupPlanAgentViewEvent(input);

  input.presenter.data({
    code: event.code,
    payload: event.payload,
  });

  return event.payload;
}

function formatValidationIssues(
  issues: readonly {
    message: string;
    path: PropertyKey[];
  }[]
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
