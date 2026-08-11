import { describe, expect, it } from "vitest";
import {
  buildTargetWakeLifecycleId,
  projectTargetWakeLifecycleIdentity,
  TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
  targetWakeLifecycleIdentitySchema,
} from "../../src/index";

describe("target Wake lifecycle identity", () => {
  it("builds identity from durable source signal and target, not client or dispatch ids", () => {
    const first = projectTargetWakeLifecycleIdentity({
      spaceId: "space-1",
      sourceSignalId: "sig-source-1",
      clientMessageId: "client-message-1",
      targetProfileId: "agt-1",
      dispatchId: "dispatch-1",
    });
    const duplicateDelivery = projectTargetWakeLifecycleIdentity({
      spaceId: "space-1",
      sourceSignalId: "sig-source-1",
      clientMessageId: "client-message-duplicate",
      targetProfileId: "agt-1",
      dispatchId: "dispatch-duplicate",
    });

    expect(first.targetWakeLifecycleId).toBe(
      duplicateDelivery.targetWakeLifecycleId
    );
    expect(first.targetWakeLifecycleId).toBe(
      buildTargetWakeLifecycleId({
        spaceId: "space-1",
        sourceSignalId: "sig-source-1",
        targetProfileId: "agt-1",
      })
    );
    expect(first.clientMessageId).toBe("client-message-1");
    expect(duplicateDelivery.clientMessageId).toBe("client-message-duplicate");
    expect(first.dispatchId).toBe("dispatch-1");
    expect(duplicateDelivery.dispatchId).toBe("dispatch-duplicate");
  });

  it("creates separate identities for separate targets in the same Wake message", () => {
    const first = projectTargetWakeLifecycleIdentity({
      spaceId: "space-1",
      sourceSignalId: "sig-source-1",
      clientMessageId: "client-message-1",
      targetProfileId: "agt-1",
      dispatchId: "dispatch-1",
    });
    const second = projectTargetWakeLifecycleIdentity({
      spaceId: "space-1",
      sourceSignalId: "sig-source-1",
      clientMessageId: "client-message-1",
      targetProfileId: "agt-2",
      dispatchId: "dispatch-2",
    });

    expect(first.targetWakeLifecycleId).not.toBe(second.targetWakeLifecycleId);
    expect(first.sourceSignalId).toBe(second.sourceSignalId);
    expect(first.clientMessageId).toBe(second.clientMessageId);
  });

  it("keeps reused client message ids from collapsing distinct source signals", () => {
    const first = projectTargetWakeLifecycleIdentity({
      spaceId: "space-1",
      sourceSignalId: "sig-source-1",
      clientMessageId: "client-message-1",
      targetProfileId: "agt-1",
      dispatchId: "dispatch-1",
    });
    const laterSignal = projectTargetWakeLifecycleIdentity({
      spaceId: "space-1",
      sourceSignalId: "sig-source-2",
      clientMessageId: "client-message-1",
      targetProfileId: "agt-1",
      dispatchId: "dispatch-2",
    });

    expect(first.targetWakeLifecycleId).not.toBe(
      laterSignal.targetWakeLifecycleId
    );
  });

  it("rejects identity records whose id does not match the durable source", () => {
    const parsed = targetWakeLifecycleIdentitySchema.safeParse({
      modelVersion: TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
      targetWakeLifecycleId: buildTargetWakeLifecycleId({
        spaceId: "space-1",
        sourceSignalId: "sig-source-1",
        targetProfileId: "agt-other",
      }),
      spaceId: "space-1",
      sourceSignalId: "sig-source-1",
      clientMessageId: "client-message-1",
      targetProfileId: "agt-1",
      dispatchId: "dispatch-1",
    });

    expect(parsed.success).toBe(false);
  });

  it("fails closed when required identity fields are not strings", () => {
    expect(() =>
      projectTargetWakeLifecycleIdentity({
        spaceId: 123,
        sourceSignalId: "sig-source-1",
        clientMessageId: "client-message-1",
        targetProfileId: "agt-1",
        dispatchId: "dispatch-1",
      })
    ).toThrow("spaceId must be a string");

    expect(() =>
      projectTargetWakeLifecycleIdentity({
        spaceId: "space-1",
        sourceSignalId: "sig-source-1",
        clientMessageId: "client-message-1",
        targetProfileId: false,
        dispatchId: "dispatch-1",
      })
    ).toThrow("targetProfileId must be a string");
  });

  it("fails closed when optional identity link fields are present but not strings", () => {
    expect(() =>
      projectTargetWakeLifecycleIdentity({
        spaceId: "space-1",
        sourceSignalId: "sig-source-1",
        clientMessageId: 123,
        targetProfileId: "agt-1",
        dispatchId: "dispatch-1",
      })
    ).toThrow("clientMessageId must be a string");

    expect(() =>
      projectTargetWakeLifecycleIdentity({
        spaceId: "space-1",
        sourceSignalId: "sig-source-1",
        clientMessageId: "client-message-1",
        targetProfileId: "agt-1",
        dispatchId: 123,
      })
    ).toThrow("value must be a string");
  });
});
