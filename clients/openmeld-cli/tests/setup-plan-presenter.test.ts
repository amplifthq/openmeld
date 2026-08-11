import {
  SETUP_PLAN_AGENT_VIEW_CODE,
  setupPlanAgentViewEventSchema,
  setupPlanAgentViewPayloadSchema,
} from "@openmeld/schemas";
import { buildOnboardingPlan } from "@openmeld/start";
import { joinedWithAddableAgentOnboardingFacts } from "@openmeld/start/testing";
import { describe, expect, it, vi } from "vitest";
import {
  buildSetupPlanAgentViewEvent,
  buildSetupPlanAgentViewPayload,
  emitSetupPlanAgentView,
} from "../src/onboarding/setup-plan-presenter";

function createPlanInput() {
  const facts = joinedWithAddableAgentOnboardingFacts();
  return {
    facts,
    plan: buildOnboardingPlan(facts),
  };
}

describe("setup plan presenter", () => {
  it("builds a schema-valid setup.plan payload for apply mode", () => {
    const input = createPlanInput();

    const payload = buildSetupPlanAgentViewPayload({
      ...input,
      mode: "apply",
    });

    expect(setupPlanAgentViewPayloadSchema.safeParse(payload).success).toBe(
      true
    );
    expect(payload.readOnly).toBe(false);
    expect(payload.facts).toEqual(input.facts);
    expect(payload.plan).toEqual(input.plan);
  });

  it("builds a schema-valid setup.plan payload for read-only mode", () => {
    const input = createPlanInput();

    const payload = buildSetupPlanAgentViewPayload({
      ...input,
      mode: "read_only",
    });

    expect(setupPlanAgentViewPayloadSchema.safeParse(payload).success).toBe(
      true
    );
    expect(payload.readOnly).toBe(true);
  });

  it("builds the stable setup.plan agent-view event", () => {
    const event = buildSetupPlanAgentViewEvent({
      ...createPlanInput(),
      mode: "read_only",
    });

    expect(setupPlanAgentViewEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      type: "result",
      code: SETUP_PLAN_AGENT_VIEW_CODE,
      payload: {
        readOnly: true,
      },
    });
  });

  it("emits setup.plan through presenter.data without changing the payload", () => {
    const input = createPlanInput();
    const presenter = {
      data: vi.fn(),
    };

    const payload = emitSetupPlanAgentView({
      ...input,
      mode: "apply",
      presenter,
    });

    expect(presenter.data).toHaveBeenCalledTimes(1);
    expect(presenter.data).toHaveBeenCalledWith({
      code: SETUP_PLAN_AGENT_VIEW_CODE,
      payload,
    });
    expect(setupPlanAgentViewPayloadSchema.safeParse(payload).success).toBe(
      true
    );
  });

  it("rejects invalid facts before emitting agent-view data", () => {
    const input = createPlanInput();
    const invalidFacts = {
      ...input.facts,
      device: {
        status: "locally_good_enough",
      },
    } as unknown as typeof input.facts;

    expect(() =>
      buildSetupPlanAgentViewPayload({
        ...input,
        facts: invalidFacts,
        mode: "apply",
      })
    ).toThrow("Invalid setup.plan payload");
  });
});
