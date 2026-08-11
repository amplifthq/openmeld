import { describe, expect, it } from "vitest";
import {
  SETUP_PLAN_AGENT_VIEW_CODE,
  SETUP_PLAN_AGENT_VIEW_SCHEMA_VERSION,
  setupPlanAgentViewEventSchema,
  setupPlanAgentViewPayloadSchema,
} from "../../src/index";

const VALID_FACTS = {
  auth: {
    signedIn: true,
    userId: "user-setup-plan",
    actingProfileId: "11111111-1111-4111-8111-111111111111",
    actingDisplayName: "Felix",
  },
  accountProfiles: [
    {
      profileId: "11111111-1111-4111-8111-111111111111",
      kind: "human",
      name: "Felix",
      active: true,
    },
    {
      profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "agent",
      name: "Codex",
      active: true,
    },
  ],
  space: {
    spaceId: "0000000000000000000000000000000000000000000000000000000000000001",
    actingProfileIsMember: true,
    memberAgentProfileIds: [],
  },
  device: {
    status: "not_connected",
  },
  context: {
    kind: "none",
  },
} as const;

const VALID_PLAN = {
  summary: "actions_pending",
  decisions: [
    {
      id: "sign_in",
      status: "done",
      blocking: true,
      reason: "auth.signed_in",
      run: null,
      afterRun: null,
    },
    {
      id: "connect_this_computer",
      status: "available",
      blocking: false,
      reason: "computer.not_connected",
      run: "openmeld setup --view agent",
      afterRun: "rerun_setup",
    },
  ],
} as const;

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SETUP_PLAN_AGENT_VIEW_SCHEMA_VERSION,
    readOnly: false,
    facts: VALID_FACTS,
    plan: VALID_PLAN,
    ...overrides,
  };
}

describe("agent-view setup.plan schema", () => {
  it("accepts the canonical setup.plan payload", () => {
    const result = setupPlanAgentViewPayloadSchema.safeParse(createPayload());

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toEqual(createPayload());
  });

  it("accepts the canonical setup.plan agent-view event", () => {
    const result = setupPlanAgentViewEventSchema.safeParse({
      type: "result",
      code: SETUP_PLAN_AGENT_VIEW_CODE,
      payload: createPayload({ readOnly: true }),
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown onboarding action ids through the shared plan schema", () => {
    const result = setupPlanAgentViewPayloadSchema.safeParse(
      createPayload({
        plan: {
          ...VALID_PLAN,
          decisions: [
            {
              ...VALID_PLAN.decisions[0],
              id: "launch_rocket",
            },
          ],
        },
      })
    );

    expect(result.success).toBe(false);
  });

  it("rejects payloads missing required facts or plan fields", () => {
    const missingFacts = setupPlanAgentViewPayloadSchema.safeParse({
      schemaVersion: SETUP_PLAN_AGENT_VIEW_SCHEMA_VERSION,
      readOnly: false,
      plan: VALID_PLAN,
    });
    const missingPlan = setupPlanAgentViewPayloadSchema.safeParse({
      schemaVersion: SETUP_PLAN_AGENT_VIEW_SCHEMA_VERSION,
      readOnly: false,
      facts: VALID_FACTS,
    });

    expect(missingFacts.success).toBe(false);
    expect(missingPlan.success).toBe(false);
  });

  it("rejects non-boolean readOnly values", () => {
    const result = setupPlanAgentViewPayloadSchema.safeParse(
      createPayload({
        readOnly: "false",
      })
    );

    expect(result.success).toBe(false);
  });

  it("rejects drift fields at the payload and event boundaries", () => {
    const payload = setupPlanAgentViewPayloadSchema.safeParse(
      createPayload({
        privateCliState: true,
      })
    );
    const event = setupPlanAgentViewEventSchema.safeParse({
      type: "result",
      code: "setup.plan",
      payload: createPayload(),
      privateCliState: true,
    });

    expect(payload.success).toBe(false);
    expect(event.success).toBe(false);
  });
});
