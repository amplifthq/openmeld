import { describe, expect, it } from "vitest";
import {
  MENTION_DISPATCH_ERROR_CODES,
  planTargetDispatchDecisions,
} from "../../src";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const READY_AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const MISSING_AGENT_PROFILE_ID = "agt_44444444-4444-4444-8444-444444444444";

describe("planTargetDispatchDecisions", () => {
  it("returns dispatch_ready for a valid activation target", () => {
    const decisions = planTargetDispatchDecisions({
      resolveTargetProfile: (targetProfileId) =>
        targetProfileId === READY_AGENT_PROFILE_ID
          ? {
              bindingState: "bound",
              enabled: true,
              targetProfileId,
            }
          : null,
      senderProfileId: HUMAN_PROFILE_ID,
      sourceEventId: "evt-ready",
      targetProfileIds: [READY_AGENT_PROFILE_ID],
    });

    expect(decisions).toEqual([
      expect.objectContaining({
        status: "dispatch_ready",
        sourceEventId: "evt-ready",
        targetProfileId: READY_AGENT_PROFILE_ID,
      }),
    ]);
  });

  it("keeps explicit activation targets dispatchable under listen_all", () => {
    const decisions = planTargetDispatchDecisions({
      dispatchPolicy: "listen_all",
      resolveTargetProfile: (targetProfileId) => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId,
      }),
      senderProfileId: HUMAN_PROFILE_ID,
      sourceEventId: "evt-listen-all",
      targetProfileIds: [READY_AGENT_PROFILE_ID],
    });

    expect(decisions).toEqual([
      expect.objectContaining({
        status: "dispatch_ready",
        sourceEventId: "evt-listen-all",
        targetProfileId: READY_AGENT_PROFILE_ID,
      }),
    ]);
  });

  it("blocks self-triggered activation targets", () => {
    const decisions = planTargetDispatchDecisions({
      resolveTargetProfile: (targetProfileId) => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId,
      }),
      senderProfileId: READY_AGENT_PROFILE_ID,
      sourceEventId: "evt-self",
      targetProfileIds: [READY_AGENT_PROFILE_ID],
    });

    expect(decisions).toEqual([
      expect.objectContaining({
        status: "blocked",
        sourceEventId: "evt-self",
        targetProfileId: READY_AGENT_PROFILE_ID,
        errorCode: MENTION_DISPATCH_ERROR_CODES.selfTrigger,
      }),
    ]);
  });

  it("fails invalid activation targets when no target resolution exists", () => {
    const decisions = planTargetDispatchDecisions({
      resolveTargetProfile: () => null,
      senderProfileId: HUMAN_PROFILE_ID,
      sourceEventId: "evt-invalid",
      targetProfileIds: [MISSING_AGENT_PROFILE_ID],
    });

    expect(decisions).toEqual([
      expect.objectContaining({
        status: "failed",
        sourceEventId: "evt-invalid",
        targetProfileId: MISSING_AGENT_PROFILE_ID,
        errorCode: MENTION_DISPATCH_ERROR_CODES.invalidTarget,
        ruleReason: "profile target cannot be resolved",
      }),
    ]);
  });

  it("returns no decisions when activationTargets is empty", () => {
    expect(
      planTargetDispatchDecisions({
        resolveTargetProfile: () => null,
        senderProfileId: HUMAN_PROFILE_ID,
        sourceEventId: "evt-empty",
        targetProfileIds: [],
      })
    ).toEqual([]);
  });
});
