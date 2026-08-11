import { describe, expect, it } from "vitest";
import {
  OPENMELD_DAEMON_MENTION_DISPATCH_RESULT_SCHEMA_VERSION,
  openMeldDaemonMentionDispatchResultEnvelopeSchema,
} from "../../src/index";

describe("daemon mention-dispatch-result schema", () => {
  it("accepts dispatch_ready envelope", () => {
    const result = openMeldDaemonMentionDispatchResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_MENTION_DISPATCH_RESULT_SCHEMA_VERSION,
      code: "service.mention_dispatch_result",
      payload: {
        sourceEventId: "evt-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agt-1",
        status: "dispatch_ready",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts blocked envelope with errorCode", () => {
    const result = openMeldDaemonMentionDispatchResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_MENTION_DISPATCH_RESULT_SCHEMA_VERSION,
      code: "service.mention_dispatch_result",
      payload: {
        sourceEventId: "evt-2",
        dispatchId: "dispatch-2",
        targetProfileId: "agt-self",
        status: "blocked",
        errorCode: "dispatch.blocked.self_trigger",
        ruleSource: "system",
        ruleId: "system.self_trigger.guard",
        ruleReason: "sender and target are the same profile",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects blocked envelope without errorCode", () => {
    const result = openMeldDaemonMentionDispatchResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_MENTION_DISPATCH_RESULT_SCHEMA_VERSION,
      code: "service.mention_dispatch_result",
      payload: {
        sourceEventId: "evt-3",
        dispatchId: "dispatch-3",
        targetProfileId: "agt-self",
        status: "blocked",
        ruleSource: "system",
        ruleId: "system.self_trigger.guard",
        ruleReason: "sender and target are the same profile",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects failed envelope without errorCode", () => {
    const result = openMeldDaemonMentionDispatchResultEnvelopeSchema.safeParse({
      v: OPENMELD_DAEMON_MENTION_DISPATCH_RESULT_SCHEMA_VERSION,
      code: "service.mention_dispatch_result",
      payload: {
        sourceEventId: "evt-4",
        dispatchId: "dispatch-4",
        targetProfileId: "agt-x",
        status: "failed",
        ruleSource: "system",
        ruleId: "system.target_resolution.invalid",
        ruleReason: "mention target cannot be resolved",
      },
    });

    expect(result.success).toBe(false);
  });
});
