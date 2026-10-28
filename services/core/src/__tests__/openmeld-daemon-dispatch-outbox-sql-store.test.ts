import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  sanitizeSignalTextPreview,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createDispatchOutboxRecord,
  deleteDispatchOutboxRecord,
  hasPendingDispatchOutboxRecords,
  insertDispatchOutboxHandoffSeed,
  insertDispatchOutboxRecord,
  listActiveDispatchOutboxRecordsBySpace,
  listDispatchOutboxRecordsByClientMessageId,
  listDispatchOutboxRecoveryCandidates,
  listDispatchOutboxTargetWakeLifecycleIdentitiesByClientMessageId,
  listPendingDispatchOutboxMessages,
  markDispatchOutboxCancelled,
  markDispatchOutboxHandedOff,
  OPENMELD_DAEMON_DISPATCH_SNAPSHOT_MAX_BYTES,
  OPENMELD_DAEMON_DISPATCH_SNAPSHOT_OVERSIZE_ERROR_CODE,
  projectDispatchOutboxTargetWakeLifecycleIdentity,
  readDispatchOutboxTargetWakeLifecycleIdentityBySource,
} from "../space/infrastructure/outbox/dispatch-outbox-repo";

describe("openMeldDaemon dispatch outbox sql store", () => {
  it("creates deterministic idempotency key and insert payload", () => {
    const nowMs = Date.UTC(2026, 1, 26, 1, 0, 0);
    const replyToPreview = sanitizeSignalTextPreview(
      "  @agt-1 ping\nPlease help me  "
    );
    const record = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchOwner: {
        id: "owner-1",
        kind: "owner_account",
      },
      dispatchPolicy: "mention_only",
      spaceId: "space-1",
      sourceEventId: "evt-1",
      senderProfileId: "usr-1",
      sourceSignalSnapshot: {
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
        profileMentionLabel: "helper-2",
      },
      sourceMessageEnvelope: {
        activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
        referenceTargets: [],
        text: "@Codex Agent(wake) @agt-1 ping",
      },
      replyToSnapshot: {
        signalId: "evt-1",
        profileId: "usr-1",
        profileKind: "human",
        profileName: "Owner",
        previewText: replyToPreview ?? "fallback-preview",
      },
      targetProfileId: "agt-1",
      targetProfileMentionLabel: "claude-code-2",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      nowMs,
    });
    const identity = projectDispatchOutboxTargetWakeLifecycleIdentity(record);
    expect(record.idempotencyKey).toBe("5:evt-1|5:agt-1");
    expect(identity).toEqual({
      modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
      targetWakeLifecycleId: "twl_v1|7:space-1|5:evt-1|5:agt-1",
      spaceId: "space-1",
      sourceSignalId: "evt-1",
      clientMessageId: null,
      targetProfileId: "agt-1",
      dispatchId: record.dispatchId,
    });
    expect(record.status).toBe("pending");
    expect(record.dispatchOwner).toEqual({
      id: "owner-1",
      kind: "owner_account",
    });
    expect(record.dispatchSnapshot).toEqual({
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      targetBindingState: "bound",
      targetBindingEnabled: true,
    });
    expect(record.dispatchRulesSnapshot).toEqual({
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
    });
    expect(record.sourceSignalSnapshot).toEqual({
      text: "@agt-1 ping",
      profileId: "usr-1",
      profileKind: "human",
      profileMentionLabel: "helper-2",
    });
    expect(record.sourceMessageEnvelope).toEqual({
      activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
      referenceTargets: [],
      text: "@Codex Agent(wake) @agt-1 ping",
    });
    expect(record.replyToSnapshot).toEqual({
      signalId: "evt-1",
      profileId: "usr-1",
      profileKind: "human",
      profileName: "Owner",
      previewText: "@agt-1 ping Please help me",
    });
    expect(record.targetProfileMentionLabel).toBe("claude-code-2");
    expect(record.controllerSnapshot).toEqual({
      targetBindingState: "bound",
      targetBindingEnabled: true,
      agentControllerRef: null,
    });
    expect(typeof record.taskId).toBe("string");
    expect(record.transportMode).toBeNull();
    expect(record.contextIdMappingSpec).toBeNull();

    const exec = vi.fn().mockReturnValue({ rowsWritten: 1 });
    const sql = { exec } as unknown as SqlStorage;
    const inserted = insertDispatchOutboxRecord(sql, record);
    expect(inserted).toBe(true);
    expect(String(exec.mock.calls[0]?.[0])).toContain(
      "INSERT OR IGNORE INTO openMeldDaemon_outbox"
    );
  });

  it("drops replyToSnapshot when required display fields are missing", () => {
    const record = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      spaceId: "space-1",
      sourceEventId: "evt-reply-missing",
      senderProfileId: "usr-1",
      sourceSignalSnapshot: {
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      replyToSnapshot: {
        signalId: "evt-reply-missing",
        profileId: "usr-1",
        profileKind: "human",
        profileName: "   ",
        previewText: "   ",
      },
      targetProfileId: "agt-1",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      nowMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    });

    expect(record.replyToSnapshot).toBeUndefined();
    expect(record.payloadJson).not.toContain("replyToSnapshot");
  });

  it("marks transport handoff while preserving the legacy storage encoding", () => {
    const exec = vi.fn().mockReturnValue({ rowsWritten: 1 });
    const sql = { exec } as unknown as SqlStorage;

    markDispatchOutboxHandedOff(sql, {
      dispatchId: "dispatch-1",
      handedOffAtMs: Date.UTC(2026, 1, 26, 1, 2, 0),
    });

    expect(String(exec.mock.calls[0]?.[0])).toContain(
      "UPDATE openMeldDaemon_outbox"
    );
    expect(exec.mock.calls[0]).toEqual([
      expect.stringContaining("UPDATE openMeldDaemon_outbox"),
      "queued",
      Date.UTC(2026, 1, 26, 1, 2, 0),
      0,
      "dispatch-1",
      "pending",
      "queued",
    ]);
  });

  it("marks cancelled state without reviving completed outbox rows", () => {
    const exec = vi.fn().mockReturnValue({ rowsWritten: 1 });
    const sql = { exec } as unknown as SqlStorage;

    markDispatchOutboxCancelled(sql, {
      dispatchId: "dispatch-1",
    });

    expect(exec.mock.calls[0]).toEqual([
      expect.stringContaining("UPDATE openMeldDaemon_outbox"),
      "cancelled",
      "dispatch-1",
      "pending",
      "queued",
    ]);
  });

  it("treats an equivalent handoff seed duplicate as idempotent success", () => {
    const record = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      spaceId: "space-1",
      sourceEventId: "evt-idempotent",
      sourceClientMessageId: "client-message-1",
      senderProfileId: "usr-1",
      sourceSignalSnapshot: {
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      targetProfileId: "agt-1",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      nowMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    });
    const exec = vi.fn((query: string) => {
      if (query.includes("INSERT OR IGNORE INTO openMeldDaemon_outbox")) {
        return { rowsWritten: 0 };
      }
      if (query.includes("WHERE idempotency_key = ?")) {
        return {
          toArray: () => [
            {
              payload_json: record.payloadJson,
              status: "pending",
              created_at_ms: record.createdAtMs,
              queued_at_ms: null,
            },
          ],
        };
      }
      return { toArray: () => [] };
    });
    const sql = { exec } as unknown as SqlStorage;

    const result = insertDispatchOutboxHandoffSeed(sql, record);

    expect(result.status).toBe("idempotent_existing");
    if (result.status === "idempotent_existing") {
      expect(result.record.idempotencyKey).toBe(record.idempotencyKey);
      expect(result.record.targetProfileId).toBe(record.targetProfileId);
    }
  });

  it("keeps duplicate handoff seed preparations on one target Wake lifecycle id", () => {
    const baseInput = {
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      spaceId: "space-1",
      sourceEventId: "evt-duplicate",
      sourceClientMessageId: "client-message-duplicate",
      senderProfileId: "usr-1",
      sourceSignalSnapshot: {
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      targetProfileId: "agt-1",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      nowMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    } as const;
    const first = createDispatchOutboxRecord(baseInput);
    const duplicatePreparation = createDispatchOutboxRecord(baseInput);

    expect(first.dispatchId).not.toBe(duplicatePreparation.dispatchId);

    const firstIdentity =
      projectDispatchOutboxTargetWakeLifecycleIdentity(first);
    const duplicateIdentity =
      projectDispatchOutboxTargetWakeLifecycleIdentity(duplicatePreparation);
    expect(firstIdentity.targetWakeLifecycleId).toBe(
      duplicateIdentity.targetWakeLifecycleId
    );
    expect(firstIdentity.targetWakeLifecycleId).toBe(
      "twl_v1|7:space-1|13:evt-duplicate|5:agt-1"
    );
    expect(firstIdentity.clientMessageId).toBe("client-message-duplicate");
  });

  it("reports a handoff seed conflict when an ignored insert matches a different seed", () => {
    const record = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      spaceId: "space-1",
      sourceEventId: "evt-conflict",
      sourceClientMessageId: "client-message-1",
      senderProfileId: "usr-1",
      sourceSignalSnapshot: {
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      targetProfileId: "agt-1",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      nowMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    });
    const existingPayload = {
      ...(JSON.parse(record.payloadJson) as Record<string, unknown>),
      targetProfileId: "agt-2",
    };
    const exec = vi.fn((query: string) => {
      if (query.includes("INSERT OR IGNORE INTO openMeldDaemon_outbox")) {
        return { rowsWritten: 0 };
      }
      if (query.includes("WHERE idempotency_key = ?")) {
        return {
          toArray: () => [
            {
              payload_json: JSON.stringify(existingPayload),
              status: "pending",
              created_at_ms: record.createdAtMs,
              queued_at_ms: null,
            },
          ],
        };
      }
      return { toArray: () => [] };
    });
    const sql = { exec } as unknown as SqlStorage;

    const result = insertDispatchOutboxHandoffSeed(sql, record);

    expect(result).toEqual({
      existing: expect.objectContaining({
        targetProfileId: "agt-2",
      }),
      reasonCode: "handoff_seed_existing_mismatch",
      status: "conflict",
    });
  });

  it("reports a handoff seed conflict when an ignored insert cannot read the existing seed", () => {
    const record = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      spaceId: "space-1",
      sourceEventId: "evt-unreadable",
      sourceClientMessageId: "client-message-1",
      senderProfileId: "usr-1",
      sourceSignalSnapshot: {
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      targetProfileId: "agt-1",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      nowMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    });
    const exec = vi.fn((query: string) => {
      if (query.includes("INSERT OR IGNORE INTO openMeldDaemon_outbox")) {
        return { rowsWritten: 0 };
      }
      return { toArray: () => [] };
    });
    const sql = { exec } as unknown as SqlStorage;

    expect(insertDispatchOutboxHandoffSeed(sql, record)).toEqual({
      existing: null,
      reasonCode: "handoff_seed_existing_unreadable",
      status: "conflict",
    });
  });

  it("lists pending outbox messages", () => {
    const payload = {
      v: 2,
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      sourceEventId: "evt-1",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-1",
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
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      idempotencyKey: "5:evt-1|5:agt-1",
      enqueuedAtMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    };
    const toArray = vi
      .fn()
      .mockReturnValue([{ payload_json: JSON.stringify(payload) }]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    const messages = listPendingDispatchOutboxMessages(sql, 20);
    expect(messages).toEqual([payload]);
  });

  it("filters legacy and invalid payloads out of pending outbox reads", () => {
    const currentPayload = {
      v: 2,
      dispatchId: "dispatch-current",
      spaceId: "space-1",
      sourceEventId: "evt-current",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-current",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:current",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-current",
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
      idempotencyKey: "evt-current::agt-1",
      enqueuedAtMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    };
    const legacyPayload = {
      v: 1,
      dispatchId: "dispatch-legacy",
      spaceId: "space-1",
      sourceEventId: "evt-legacy",
      targetProfileId: "agt-legacy",
      idempotencyKey: "evt-legacy::agt-legacy",
      enqueuedAtMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    };
    const toArray = vi
      .fn()
      .mockReturnValue([
        { payload_json: JSON.stringify(legacyPayload) },
        { payload_json: "{not-json" },
        { payload_json: JSON.stringify(currentPayload) },
      ]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    const messages = listPendingDispatchOutboxMessages(sql, 20);
    expect(messages).toEqual([currentPayload]);
  });

  it("detects pending outbox rows that still need Queue delivery", () => {
    const toArray = vi.fn().mockReturnValue([{ dispatch_id: "dispatch-1" }]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    expect(hasPendingDispatchOutboxRecords(sql)).toBe(true);
    expect(exec).toHaveBeenCalledWith(expect.any(String), "pending");
  });

  it("does not count queued evidence as pending outbox work", () => {
    const toArray = vi.fn().mockReturnValue([]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    expect(hasPendingDispatchOutboxRecords(sql)).toBe(false);
    expect(exec).toHaveBeenCalledWith(expect.any(String), "pending");
  });

  it("reports empty outbox when no rows exist", () => {
    const toArray = vi.fn().mockReturnValue([]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    expect(hasPendingDispatchOutboxRecords(sql)).toBe(false);
  });

  it("fails fast when dispatchSnapshot exceeds size budget", () => {
    const oversizeReason = "x".repeat(
      OPENMELD_DAEMON_DISPATCH_SNAPSHOT_MAX_BYTES
    );
    expect(() =>
      createDispatchOutboxRecord({
        bindingEnabled: true,
        bindingState: "bound",
        dispatchPolicy: "mention_only",
        spaceId: "space-1",
        sourceEventId: "evt-oversize",
        senderProfileId: "usr-1",
        sourceSignalSnapshot: {
          text: "@agt-oversize ping",
          profileId: "usr-1",
          profileKind: "human",
        },
        targetProfileId: "agt-oversize",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: oversizeReason,
        nowMs: Date.UTC(2026, 1, 26, 1, 0, 0),
      })
    ).toThrowError(
      new RegExp(OPENMELD_DAEMON_DISPATCH_SNAPSHOT_OVERSIZE_ERROR_CODE)
    );
  });

  it("lists pending and stale handed-off outbox candidates for recovery", () => {
    const pendingPayload = {
      v: 2,
      dispatchId: "dispatch-pending",
      spaceId: "space-1",
      sourceEventId: "evt-pending",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-pending",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:pending",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-pending",
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
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      idempotencyKey: "11:evt-pending|5:agt-1",
      enqueuedAtMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    };
    const staleQueuedPayload = {
      ...pendingPayload,
      controllerSnapshot: {
        ...pendingPayload.controllerSnapshot,
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      },
      dispatchId: "dispatch-stale-queued",
      sourceEventId: "evt-stale",
      idempotencyKey: "9:evt-stale|5:agt-1",
    };
    const cancelledPayload = {
      ...pendingPayload,
      dispatchId: "dispatch-cancelled",
      sourceEventId: "evt-cancelled",
      idempotencyKey: "13:evt-cancelled|5:agt-1",
    };
    const toArray = vi.fn().mockReturnValue([
      {
        payload_json: JSON.stringify(pendingPayload),
        status: "pending",
        created_at_ms: Date.UTC(2026, 1, 26, 1, 0, 0),
        queued_at_ms: null,
      },
      {
        payload_json: JSON.stringify(staleQueuedPayload),
        status: "queued",
        created_at_ms: Date.UTC(2026, 1, 26, 1, 0, 0),
        queued_at_ms: Date.UTC(2026, 1, 26, 1, 1, 0),
      },
      {
        payload_json: JSON.stringify(cancelledPayload),
        status: "cancelled",
        created_at_ms: Date.UTC(2026, 1, 26, 1, 0, 0),
        queued_at_ms: null,
      },
    ]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    const candidates = listDispatchOutboxRecoveryCandidates(sql, {
      limit: 10,
      handedOffRedriveBeforeMs: Date.UTC(2026, 1, 26, 1, 2, 0),
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        dispatchId: "dispatch-pending",
        outboxStatus: "pending",
      }),
      expect.objectContaining({
        dispatchId: "dispatch-stale-queued",
        outboxStatus: "handed_off",
      }),
    ]);
    expect(candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dispatchId: "dispatch-cancelled" }),
      ])
    );
  });

  it("lists active outbox records for one Space without terminal rows", () => {
    const nowMs = Date.UTC(2026, 1, 26, 1, 0, 0);
    const createRecord = (input: {
      sourceEventId: string;
      sourceClientMessageId: string;
      spaceId: string;
      targetProfileId: string;
    }) =>
      createDispatchOutboxRecord({
        bindingEnabled: true,
        bindingState: "bound",
        dispatchPolicy: "mention_only",
        spaceId: input.spaceId,
        sourceEventId: input.sourceEventId,
        sourceClientMessageId: input.sourceClientMessageId,
        senderProfileId: "usr-1",
        sourceSignalSnapshot: {
          text: "@agt ping",
          profileId: "usr-1",
          profileKind: "human",
        },
        targetProfileId: input.targetProfileId,
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        nowMs,
      });
    const activePending = createRecord({
      sourceEventId: "evt-active-pending",
      sourceClientMessageId: "client-active-pending",
      spaceId: "space-1",
      targetProfileId: "agt-1",
    });
    const activeQueued = createRecord({
      sourceEventId: "evt-active-queued",
      sourceClientMessageId: "client-active-queued",
      spaceId: "space-1",
      targetProfileId: "agt-1",
    });
    const otherSpace = createRecord({
      sourceEventId: "evt-other-space",
      sourceClientMessageId: "client-other-space",
      spaceId: "space-2",
      targetProfileId: "agt-1",
    });
    const cancelled = createRecord({
      sourceEventId: "evt-cancelled-active",
      sourceClientMessageId: "client-cancelled-active",
      spaceId: "space-1",
      targetProfileId: "agt-1",
    });
    const toArray = vi.fn().mockReturnValue([
      {
        payload_json: activePending.payloadJson,
        status: "pending",
        created_at_ms: activePending.createdAtMs,
        queued_at_ms: null,
      },
      {
        payload_json: activeQueued.payloadJson,
        status: "queued",
        created_at_ms: activeQueued.createdAtMs,
        queued_at_ms: Date.UTC(2026, 1, 26, 1, 1, 0),
      },
      {
        payload_json: otherSpace.payloadJson,
        status: "pending",
        created_at_ms: otherSpace.createdAtMs,
        queued_at_ms: null,
      },
      {
        payload_json: cancelled.payloadJson,
        status: "cancelled",
        created_at_ms: cancelled.createdAtMs,
        queued_at_ms: null,
      },
    ]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    const records = listActiveDispatchOutboxRecordsBySpace(sql, {
      sourceProfileId: "usr-1",
      spaceId: "space-1",
      targetProfileId: "agt-1",
    });

    expect(records.map((record) => record.dispatchId)).toEqual([
      activePending.dispatchId,
      activeQueued.dispatchId,
    ]);
    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining("FROM openMeldDaemon_outbox"),
      "pending",
      "queued",
      "space-1",
      "agt-1",
      "usr-1",
      500
    );
    expect(String(exec.mock.calls[0]?.[0])).toContain(
      "sourceSignalSnapshot.profileId"
    );
  });

  it("limits client-message outbox scans and filters candidates in memory", () => {
    const payload = {
      v: 2,
      dispatchId: "dispatch-client-message",
      spaceId: "space-1",
      sourceEventId: "evt-client-message",
      sourceClientMessageId: "client-message-1",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-client-message",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:client",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-client-message",
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
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      idempotencyKey: "18:evt-client-message|5:agt-1",
      enqueuedAtMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    };
    const toArray = vi.fn().mockReturnValue([
      {
        payload_json: JSON.stringify(payload),
        status: "pending",
        created_at_ms: Date.UTC(2026, 1, 26, 1, 0, 0),
        queued_at_ms: null,
      },
    ]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    const candidates = listDispatchOutboxRecordsByClientMessageId(
      sql,
      "client-message-1"
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        dispatchId: "dispatch-client-message",
        sourceClientMessageId: "client-message-1",
      }),
    ]);
    const query = String(exec.mock.calls[0]?.[0]);
    expect(query).toContain("ORDER BY created_at_ms DESC");
    expect(query).toContain("LIMIT ?");
  });

  it("keeps cancelled outbox rows readable for Wake Stop selectors", () => {
    const payload = {
      v: 2,
      dispatchId: "dispatch-cancelled-client-message",
      spaceId: "space-1",
      sourceEventId: "evt-cancelled-client-message",
      sourceClientMessageId: "client-message-cancelled",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-cancelled-client-message",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:cancelled-client",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-cancelled-client-message",
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
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      idempotencyKey: "28:evt-cancelled-client-message|5:agt-1",
      enqueuedAtMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    };
    const toArray = vi.fn().mockReturnValue([
      {
        payload_json: JSON.stringify(payload),
        status: "cancelled",
        created_at_ms: Date.UTC(2026, 1, 26, 1, 0, 0),
        queued_at_ms: null,
      },
    ]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    const candidates = listDispatchOutboxRecordsByClientMessageId(
      sql,
      "client-message-cancelled"
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        dispatchId: "dispatch-cancelled-client-message",
        outboxStatus: "cancelled",
        sourceClientMessageId: "client-message-cancelled",
      }),
    ]);
  });

  it("projects client-message outbox lookup results to target Wake lifecycle identities", () => {
    const payload = {
      v: 2,
      dispatchId: "dispatch-client-message",
      spaceId: "space-1",
      sourceEventId: "evt-client-message",
      sourceClientMessageId: "client-message-1",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-client-message",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:client",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-client-message",
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
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      idempotencyKey: "18:evt-client-message|5:agt-1",
      enqueuedAtMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    };
    const toArray = vi.fn().mockReturnValue([
      {
        payload_json: JSON.stringify(payload),
        status: "pending",
        created_at_ms: Date.UTC(2026, 1, 26, 1, 0, 0),
        queued_at_ms: null,
      },
    ]);
    const exec = vi.fn().mockReturnValue({ toArray });
    const sql = { exec } as unknown as SqlStorage;

    const identities =
      listDispatchOutboxTargetWakeLifecycleIdentitiesByClientMessageId(sql, {
        clientMessageId: "client-message-1",
        targetProfileId: "agt-1",
      });

    expect(identities).toEqual([
      {
        modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
        targetWakeLifecycleId: "twl_v1|7:space-1|18:evt-client-message|5:agt-1",
        spaceId: "space-1",
        sourceSignalId: "evt-client-message",
        clientMessageId: "client-message-1",
        targetProfileId: "agt-1",
        dispatchId: "dispatch-client-message",
      },
    ]);
  });

  it("keeps the newest client-message outbox records inside the bounded scan", () => {
    const createPayload = (input: {
      createdAtMs: number;
      dispatchId: string;
      sourceClientMessageId: string;
      sourceEventId: string;
    }) => ({
      v: 2,
      dispatchId: input.dispatchId,
      spaceId: "space-1",
      sourceEventId: input.sourceEventId,
      sourceClientMessageId: input.sourceClientMessageId,
      targetProfileId: "agt-1",
      dispatchChainId: input.dispatchId,
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: `stable32:${input.dispatchId}`,
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: `task-${input.dispatchId}`,
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
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      idempotencyKey: `${input.sourceEventId}|agt-1`,
      enqueuedAtMs: input.createdAtMs,
    });
    const rows = Array.from({ length: 501 }, (_, index) => {
      const createdAtMs = Date.UTC(2026, 1, 26, 1, 0, 0) + index;
      const payload = createPayload({
        createdAtMs,
        dispatchId: `dispatch-old-${index}`,
        sourceClientMessageId: `old-client-message-${index}`,
        sourceEventId: `evt-old-${index}`,
      });
      return {
        payload_json: JSON.stringify(payload),
        status: "pending",
        created_at_ms: createdAtMs,
        queued_at_ms: null,
      };
    });
    const targetCreatedAtMs = Date.UTC(2026, 1, 26, 2, 0, 0);
    rows.push({
      payload_json: JSON.stringify(
        createPayload({
          createdAtMs: targetCreatedAtMs,
          dispatchId: "dispatch-new-client-message",
          sourceClientMessageId: "client-message-newest",
          sourceEventId: "evt-new-client-message",
        })
      ),
      status: "pending",
      created_at_ms: targetCreatedAtMs,
      queued_at_ms: null,
    });
    const exec = vi.fn(
      (query: string, _pending, _queued, _cancelled, limit: number) => {
        const sortedRows = rows.toSorted((left, right) =>
          query.includes("ORDER BY created_at_ms DESC")
            ? right.created_at_ms - left.created_at_ms
            : left.created_at_ms - right.created_at_ms
        );
        return {
          toArray: () => sortedRows.slice(0, limit),
        };
      }
    );
    const sql = { exec } as unknown as SqlStorage;

    const candidates = listDispatchOutboxRecordsByClientMessageId(
      sql,
      "client-message-newest"
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        dispatchId: "dispatch-new-client-message",
        sourceClientMessageId: "client-message-newest",
      }),
    ]);
  });

  it("does not scan outbox rows for an empty client message id", () => {
    const exec = vi.fn();
    const sql = { exec } as unknown as SqlStorage;

    expect(listDispatchOutboxRecordsByClientMessageId(sql, "   ")).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it("reads a target Wake lifecycle identity from source signal and target without client-message authority", () => {
    const record = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      spaceId: "space-1",
      sourceEventId: "evt-source-lookup",
      sourceClientMessageId: "client-message-source-lookup",
      senderProfileId: "usr-1",
      sourceSignalSnapshot: {
        text: "@agt-1 ping",
        profileId: "usr-1",
        profileKind: "human",
      },
      targetProfileId: "agt-1",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      nowMs: Date.UTC(2026, 1, 26, 1, 0, 0),
    });
    const exec = vi.fn((query: string, idempotencyKey: string) => {
      expect(idempotencyKey).toBe("17:evt-source-lookup|5:agt-1");
      if (query.includes("WHERE idempotency_key = ?")) {
        return {
          toArray: () => [
            {
              payload_json: record.payloadJson,
              status: "pending",
              created_at_ms: record.createdAtMs,
              queued_at_ms: null,
            },
          ],
        };
      }
      return { toArray: () => [] };
    });
    const sql = { exec } as unknown as SqlStorage;

    const identity = readDispatchOutboxTargetWakeLifecycleIdentityBySource(
      sql,
      {
        sourceSignalId: "evt-source-lookup",
        targetProfileId: "agt-1",
      }
    );

    expect(identity).toEqual({
      modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
      targetWakeLifecycleId: "twl_v1|7:space-1|17:evt-source-lookup|5:agt-1",
      spaceId: "space-1",
      sourceSignalId: "evt-source-lookup",
      clientMessageId: "client-message-source-lookup",
      targetProfileId: "agt-1",
      dispatchId: record.dispatchId,
    });
  });

  it("deletes outbox record by dispatch id", () => {
    const exec = vi.fn().mockReturnValue({ rowsWritten: 1 });
    const sql = { exec } as unknown as SqlStorage;
    deleteDispatchOutboxRecord(sql, {
      dispatchId: "dispatch-1",
    });
    expect(String(exec.mock.calls[0]?.[0])).toContain(
      "DELETE FROM openMeldDaemon_outbox"
    );
  });
});
