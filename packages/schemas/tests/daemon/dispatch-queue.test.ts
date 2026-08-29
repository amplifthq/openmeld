import { describe, expect, it } from "vitest";
import {
  agentTaskContinuationQueueMessageSchema,
  openMeldDaemonDispatchQueueLegacyMessageSchemaV1,
  openMeldDaemonDispatchQueueMessageSchema,
  parseOpenMeldDaemonDispatchQueueIngress,
  remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema,
} from "../../src/schemas/daemon/dispatch-queue";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

describe("openMeldDaemonDispatchQueueMessageSchema", () => {
  it("accepts a valid queue message", () => {
    const parsed = openMeldDaemonDispatchQueueMessageSchema.safeParse({
      v: 2,
      dispatchId: "dsp-1",
      spaceId: "space-1",
      organizationId: "org-1",
      sourceEventId: "evt-1",
      sourceClientMessageId: "client-1",
      dispatchOwner: {
        id: "owner-1",
        kind: "owner_account",
      },
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-chain-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111111",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-1",
      transportMode: null,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: null,
      },
      contextIdMappingSpec: null,
      sourceSignalSnapshot: {
        centerAgentInteractionSource: {
          client: "codex",
          kind: "local_agent",
          sessionId: "codex-thread-1",
        },
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
        text: "Continue the launch review.",
      },
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      deliveryRecoveryReason: "hosted_admission_incomplete",
      idempotencyKey: "evt-1::agt-1",
      enqueuedAtMs: Date.now(),
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.sourceClientMessageId).toBe("client-1");
    expect(parsed.data.organizationId).toBe("org-1");
    expect(parsed.data.dispatchOwner).toEqual({
      id: "owner-1",
      kind: "owner_account",
    });
    expect(parsed.data.deliveryRecoveryReason).toBe(
      "hosted_admission_incomplete"
    );
    expect(
      parsed.data.sourceSignalSnapshot?.centerAgentInteractionSource
    ).toEqual({
      client: "codex",
      kind: "local_agent",
      sessionId: "codex-thread-1",
    });
  });

  it("parses current v2 queue ingress through the shared parser", () => {
    const parsed = parseOpenMeldDaemonDispatchQueueIngress({
      v: 2,
      dispatchId: "dsp-current-1",
      spaceId: "space-1",
      sourceEventId: "evt-current-1",
      targetProfileId: "agt-current-1",
      dispatchChainId: "dispatch-chain-current-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:current",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-current-1",
      transportMode: null,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: null,
      },
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "evt-current-1::agt-current-1",
      enqueuedAtMs: Date.now(),
    });

    expect(parsed.kind).toBe("current_v2");
    if (parsed.kind !== "current_v2") {
      return;
    }
    expect(parsed.receivedQueueSchemaVersion).toBe(2);
    expect(parsed.message.organizationId).toBeUndefined();
  });

  it("parses legacy v1 queue ingress through the shared parser", () => {
    const parsed = parseOpenMeldDaemonDispatchQueueIngress({
      v: 1,
      dispatchId: "dsp-legacy-1",
      spaceId: "space-1",
      sourceEventId: "evt-legacy-1",
      targetProfileId: "agt-legacy-1",
      idempotencyKey: "evt-legacy-1::agt-legacy-1",
      enqueuedAtMs: Date.now(),
    });

    expect(parsed.kind).toBe("legacy_v1");
    if (parsed.kind !== "legacy_v1") {
      return;
    }
    expect(parsed.receivedQueueSchemaVersion).toBe(1);
  });

  it("parses Remote Agent native delivery deadline probes through the shared parser", () => {
    const probe = {
      v: 3,
      kind: "remote_agent_native_delivery_deadline_probe",
      submissionId: "sub_1",
      idempotencyKey: "space_1:dispatch_1",
      organizationId: "org_1",
      spaceId: "space_1",
      dispatchId: "dispatch_1",
      enqueuedAtMs: 1000,
      deadlineAtMs: 241_000,
    };

    expect(
      remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema.parse(probe)
    ).toEqual(probe);

    const parsed = parseOpenMeldDaemonDispatchQueueIngress(probe);
    expect(parsed.kind).toBe("remote_agent_deadline_probe");
    if (parsed.kind !== "remote_agent_deadline_probe") {
      return;
    }
    expect(parsed.receivedQueueSchemaVersion).toBe(3);
    expect(parsed.message.submissionId).toBe("sub_1");
  });

  it("parses Agent Task continuation events through the shared parser", () => {
    const continuation = {
      enqueuedAtMs: 1000,
      idempotencyKey: "agent-task-continuation-event:subscription-1",
      kind: "agent_task_continuation",
      subscriptionId: "subscription-1",
      v: 4,
    };

    expect(agentTaskContinuationQueueMessageSchema.parse(continuation)).toEqual(
      continuation
    );

    const parsed = parseOpenMeldDaemonDispatchQueueIngress(continuation);
    expect(parsed.kind).toBe("agent_task_continuation");
    if (parsed.kind !== "agent_task_continuation") {
      return;
    }
    expect(parsed.receivedQueueSchemaVersion).toBe(4);
    expect(parsed.message.subscriptionId).toBe("subscription-1");
  });

  it("marks malformed queue ingress as invalid and preserves received version", () => {
    const parsed = parseOpenMeldDaemonDispatchQueueIngress({
      v: 2,
      dispatchId: "dsp-invalid-1",
      sourceEventId: "evt-invalid-1",
    });

    expect(parsed.kind).toBe("invalid");
    if (parsed.kind !== "invalid") {
      return;
    }
    expect(parsed.receivedQueueSchemaVersion).toBe(2);
    expect(parsed.issues).not.toEqual([]);
  });

  it("accepts optional observability snapshots", () => {
    const parsed = openMeldDaemonDispatchQueueMessageSchema.safeParse({
      v: 2,
      dispatchId: "dsp-obs-1",
      spaceId: "space-1",
      sourceEventId: "evt-obs-1",
      targetProfileId: "agt-obs-1",
      targetProfileMentionLabel: "codex",
      dispatchChainId: "dispatch-chain-obs-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:33333333",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-obs-1",
      transportMode: null,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: null,
      },
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      sourceSignalSnapshot: {
        text: "hello from ops",
        profileId: "human-1",
        profileKind: "human",
      },
      sourceMessageEnvelope: {
        activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
        referenceTargets: [],
        text: "@Codex Agent(wake) hello from ops",
      },
      spaceNameSnapshot: "ops-room",
      sourceProfileNameSnapshot: "Felix",
      targetProfileNameSnapshot: "Codex Agent",
      idempotencyKey: "evt-obs-1::agt-obs-1",
      enqueuedAtMs: Date.now(),
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.sourceMessageEnvelope).toEqual({
      activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
      referenceTargets: [],
      text: "@Codex Agent(wake) hello from ops",
    });
  });

  it("accepts an optional replyToSnapshot", () => {
    const parsed = openMeldDaemonDispatchQueueMessageSchema.safeParse({
      v: 2,
      dispatchId: "dsp-reply-1",
      spaceId: "space-1",
      sourceEventId: "evt-reply-1",
      targetProfileId: "agt-reply-1",
      dispatchChainId: "dispatch-chain-reply-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:44444444",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-reply-1",
      transportMode: null,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: null,
      },
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      replyToSnapshot: {
        signalId: "evt-source-1",
        profileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        profileName: "Ops Bot",
        previewText: "Please check the deploy logs",
      },
      idempotencyKey: "evt-reply-1::agt-reply-1",
      enqueuedAtMs: Date.now(),
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    expect(parsed.data.replyToSnapshot).toEqual({
      signalId: "evt-source-1",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "Ops Bot",
      previewText: "Please check the deploy logs",
    });
  });

  it("rejects invalid payload", () => {
    const parsed = openMeldDaemonDispatchQueueMessageSchema.safeParse({
      v: 2,
      dispatchId: "",
      sourceEventId: "evt-1",
      targetProfileId: "agt-1",
      dispatchContractVersion: 0,
      dispatchPolicy: "invalid_policy",
      ruleSource: "registry",
      ruleId: "",
      ruleReason: "",
      taskId: "",
      transportMode: null,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: null,
      },
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "",
        ruleReason: "",
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "",
        ruleReason: "",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "evt-1::agt-1",
      enqueuedAtMs: -1,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects payload when dispatchSnapshot fields drift from top-level fields", () => {
    const parsed = openMeldDaemonDispatchQueueMessageSchema.safeParse({
      v: 2,
      dispatchId: "dsp-2",
      spaceId: "space-1",
      sourceEventId: "evt-2",
      targetProfileId: "agt-2",
      dispatchChainId: "dispatch-chain-2",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:22222222",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "space",
      ruleId: "space.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-2",
      transportMode: null,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: null,
      },
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "space",
        ruleId: "space.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "registry fallback",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "evt-2::agt-2",
      enqueuedAtMs: Date.now(),
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects payload when replyToSnapshot is missing a required field", () => {
    const parsed = openMeldDaemonDispatchQueueMessageSchema.safeParse({
      v: 2,
      dispatchId: "dsp-reply-invalid-1",
      spaceId: "space-1",
      sourceEventId: "evt-reply-invalid-1",
      targetProfileId: "agt-reply-1",
      dispatchChainId: "dispatch-chain-reply-invalid-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:55555555",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-reply-invalid-1",
      transportMode: null,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: null,
      },
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      replyToSnapshot: {
        signalId: "evt-source-1",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Ops Bot",
      },
      idempotencyKey: "evt-reply-invalid-1::agt-reply-1",
      enqueuedAtMs: Date.now(),
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts legacy v1 payload for explicit unsupported-version handling", () => {
    const parsed = openMeldDaemonDispatchQueueLegacyMessageSchemaV1.safeParse({
      v: 1,
      dispatchId: "dsp-legacy-1",
      spaceId: "space-1",
      sourceEventId: "evt-legacy-1",
      targetProfileId: "agt-1",
      idempotencyKey: "evt-legacy-1::agt-1",
      enqueuedAtMs: Date.now(),
    });

    expect(parsed.success).toBe(true);
  });
});
