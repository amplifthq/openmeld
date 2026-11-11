import { DatabaseSync } from "node:sqlite";
import {
  pluginConnectionContinuationBindingSchema,
  pluginConnectionExecutionSourceSchema,
} from "@openmeld/schemas";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import { createCloudflareSqlHarness } from "../../remote-agent/tests/helpers/cloudflare-sql-harness.test-support";
import {
  assertBoundPluginConnection,
  boundPluginConnectionPreference,
} from "../src/connectors/plugin-connection-execution-binding";
import {
  pluginConnectionSourceEnvelopeDigest,
  pluginContinuationTextDigest,
} from "../src/connectors/plugin-connection-source-fingerprint";
import type { RemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  assertPluginContinuationSource,
  pluginContinuationMessageFingerprint,
} from "../src/space/application/plugin-connection-continuation-guard";
import { PluginConnectionContinuationRepository } from "../src/space/infrastructure/sql/plugin-connection-continuation-repo";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});
function fixture() {
  const sourceEnvelope = {
    text: "Original request",
    activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
    referenceTargets: [],
  };
  const source: Extract<SignalEnvelope, { type: "signal.text" }> = {
    v: 1,
    id: "source",
    spaceId: "space",
    ts: 100,
    type: "signal.text",
    profile: { kind: "human", profileId: "human", profileName: "Maya" },
    data: {
      text: "Original request",
      messageEnvelope: sourceEnvelope,
    },
  };
  const reply: typeof source = {
    ...source,
    id: "reply",
    ts: 300,
    profile: {
      kind: "agent",
      profileId: "agt_33333333-3333-4333-8333-333333333333",
      profileName: "Helper",
    },
    data: { text: "Connect", meta: { dispatchId: "dispatch" } },
  };
  const binding = pluginConnectionContinuationBindingSchema.parse({
    v: 1,
    organizationId: "org",
    spaceId: "space",
    sourceDispatchId: "dispatch",
    source: {
      signalId: source.id,
      revision: 0,
      fingerprint: pluginContinuationMessageFingerprint(source),
    },
    reply: {
      signalId: reply.id,
      revision: 0,
      fingerprint: pluginContinuationMessageFingerprint(reply),
    },
    requesterUserId: "user",
    requesterProfileId: "human",
    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
    service: "linear",
    scope: "shared",
    connectionName: "shared-linear",
    connectionUpdatedAtMs: 42,
    continuationTextDigest: pluginContinuationTextDigest("Continue"),
    threadContext: null,
  });
  const localSource = pluginConnectionExecutionSourceSchema.parse({
    executionId: "execution",
    ownerUserId: "user",
    bindingId: "binding",
    dispatchId: "dispatch",
    spaceId: "space",
    sourceSignalId: "source",
    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
    requesterProfileId: "human",
    sourceEnvelopeDigest: pluginConnectionSourceEnvelopeDigest(sourceEnvelope),
    createdAtMs: 200,
    threadContext: null,
  });
  return {
    source,
    reply,
    binding,
    localSource,
    sourceThread: null,
    replyThread: null,
  };
}

describe("Plugin continuation source and identity constraints", () => {
  it("accepts completed native work after the Space dispatch conveyor has retired", () => {
    const f = fixture();
    const nativeSource = nativeFixture(f);
    expect(() =>
      assertPluginContinuationSource({ ...f, nativeSource })
    ).not.toThrow();
    expect(() =>
      assertPluginContinuationSource({ ...f, localSource: undefined })
    ).toThrow("original request");
  });
  it("keeps a native main request separate from its published reply Thread", () => {
    const f = fixture();
    const nativeSource = nativeFixture(f);
    const replyThread = {
      threadId: "thr_11111111-1111-4111-8111-111111111111",
      rootSignalId: f.source.id,
    };
    f.binding.threadContext = replyThread;
    expect(() =>
      assertPluginContinuationSource({
        ...f,
        nativeSource,
        replyThread,
      })
    ).not.toThrow();
    expect(() =>
      assertPluginContinuationSource({
        ...f,
        nativeSource,
        replyThread: { ...replyThread, rootSignalId: "another-request" },
      })
    ).toThrow("original request");
  });
  it.each([
    "missing-request",
    "wrong-requester",
    "wrong-dispatch",
    "active",
    "stopped",
    "edited",
    "recalled",
    "reply-changed",
  ])("rejects stale or mismatched native evidence: %s", (kind) => {
    const f = fixture();
    const nativeSource = nativeFixture(f);
    if (kind === "missing-request") {
      nativeSource.executionRecoverySubmitRequest = null;
    }
    if (kind === "wrong-requester") {
      f.binding.requesterUserId = "other-user";
    }
    if (kind === "wrong-dispatch") {
      nativeSource.dispatchId = "other-dispatch";
    }
    if (kind === "active") {
      nativeSource.status = "accepted";
    }
    if (kind === "stopped") {
      nativeSource.failureCode = "remote_agent.execution_cancelled";
    }
    if (kind === "edited") {
      f.source.data.meta = { editedAt: 250, messageRevision: 1 };
      f.binding.source = {
        signalId: f.source.id,
        revision: 1,
        fingerprint: pluginContinuationMessageFingerprint(f.source),
      };
    }
    if (kind === "recalled") {
      f.source.data.meta = { recalledAt: 250 };
    }
    if (kind === "reply-changed") {
      f.reply.data.text = "Different connection";
    }
    expect(() =>
      assertPluginContinuationSource({ ...f, nativeSource })
    ).toThrow("original request");
  });
  it.each([
    "shared",
    "member",
  ] as const)("pins %s even when automatic selection could choose another account", (scope) => {
    const binding = { ...fixture().binding, scope };
    expect(
      boundPluginConnectionPreference(binding, "linear", "automatic")
    ).toBe(scope === "shared" ? "shared" : "requester");
    expect(() =>
      boundPluginConnectionPreference(
        binding,
        "linear",
        scope === "shared" ? "requester" : "shared"
      )
    ).toThrow("execution_identity_changed");
    expect(() =>
      assertBoundPluginConnection(binding, "linear", {
        connectionName: binding.connectionName,
        updatedAtMs: 42,
      })
    ).not.toThrow();
    for (const connection of [
      null,
      { connectionName: "other", updatedAtMs: 42 },
      { connectionName: binding.connectionName, updatedAtMs: 43 },
    ]) {
      expect(() =>
        assertBoundPluginConnection(binding, "linear", connection)
      ).toThrow("execution_identity_changed");
    }
    expect(
      boundPluginConnectionPreference(binding, "notion", "automatic")
    ).toBe("automatic");
  });

  it.each([
    "edited-before-preview",
    "edited-after-preview",
    "edit-and-revert-before-delivery",
    "recalled",
    "author",
    "thread",
    "missing",
  ])("rejects an invalid original request: %s", (kind) => {
    const f = fixture();
    if (kind.startsWith("edited")) {
      f.source = {
        ...f.source,
        data: {
          ...f.source.data,
          text: "Changed",
          meta: { editedAt: 250, messageRevision: 1 },
        },
      };
    }
    if (kind === "edited-before-preview") {
      f.binding.source = {
        ...f.binding.source,
        revision: 1,
        fingerprint: pluginContinuationMessageFingerprint(f.source),
      };
    }
    if (kind === "edit-and-revert-before-delivery") {
      f.localSource.createdAtMs = 300;
      f.source.data.meta = { editedAt: 250, messageRevision: 2 };
      f.binding.source = {
        ...f.binding.source,
        revision: 2,
        fingerprint: pluginContinuationMessageFingerprint(f.source),
      };
    }
    if (kind === "recalled") {
      f.source.data.meta = { recalledAt: 250 };
    }
    if (kind === "author") {
      f.source.profile.profileId = "other-human";
    }
    expect(() =>
      assertPluginContinuationSource({
        ...f,
        source: kind === "missing" ? null : f.source,
        sourceThread:
          kind === "thread"
            ? { threadId: "moved", rootSignalId: "other" }
            : null,
      })
    ).toThrow("original request");
  });

  it("accepts a main-conversation request whose Agent reply correctly created a Thread", () => {
    const f = fixture();
    const thread = { threadId: "reply-thread", rootSignalId: f.source.id };
    expect(() =>
      assertPluginContinuationSource({
        ...f,
        binding: { ...f.binding, threadContext: thread },
        replyThread: thread,
      })
    ).not.toThrow();
  });

  it.each([
    "missing",
    "different-request",
    "different-envelope",
  ])("rejects missing or mismatched retained Local evidence: %s", (kind) => {
    const f = fixture();
    if (kind === "different-request") {
      f.localSource.sourceSignalId = "another-source";
    }
    if (kind === "different-envelope") {
      f.localSource.sourceEnvelopeDigest = "a".repeat(64);
    }
    expect(() =>
      assertPluginContinuationSource({
        ...f,
        localSource: kind === "missing" ? undefined : f.localSource,
      })
    ).toThrow("original request");
  });

  it("persists one binding across reload/retry and cannot change the account or refresh an old source revision", () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const sql = createCloudflareSqlHarness(database) as unknown as SqlStorage;
    const repo = new PluginConnectionContinuationRepository(sql);
    const { binding } = fixture();
    binding.approvedActionRequestId = "11111111-1111-4111-8111-111111111111";
    repo.reserve("plugin-continue:one", binding);
    const changedPreview = {
      ...binding,
      source: { ...binding.source, revision: 2, fingerprint: "b".repeat(64) },
    };
    expect(
      repo.reserve("plugin-continue:one", changedPreview).binding.source
        .revision
    ).toBe(0);
    repo.accept("plugin-continue:one", "new-message");
    const reopened = new PluginConnectionContinuationRepository(sql);
    expect(
      reopened.reserve("plugin-continue:one", changedPreview).signalId
    ).toBe("new-message");
    expect(() =>
      reopened.reserve("plugin-continue:one", { ...binding, scope: "member" })
    ).toThrow();
    for (const approvedActionRequestId of [
      undefined,
      "22222222-2222-4222-8222-222222222222",
    ]) {
      expect(() =>
        reopened.reserve("plugin-continue:one", {
          ...binding,
          approvedActionRequestId,
        })
      ).toThrow();
    }
    expect(() =>
      reopened.accept("plugin-continue:one", "second-message")
    ).toThrow();
    expect(reopened.read("plugin-continue:one")?.signalId).toBe("new-message");
  });
});

function nativeFixture(
  f: ReturnType<typeof fixture>
): RemoteAgentNativeDeliveryRecord {
  const request = createSubmitTurnRequest({
    organizationId: f.binding.organizationId,
    spaceId: f.binding.spaceId,
    dispatchId: f.binding.sourceDispatchId,
    triggerMessageId: f.source.id,
    agentProfileId: f.binding.targetProfileId,
    author: {
      profileKind: "human",
      profileId: f.binding.requesterProfileId,
      displayName: "Maya",
    },
  });
  request.turnEnvelope.sender = {
    kind: "member",
    id: "member",
    displayName: "Maya",
    ownerUserId: f.binding.requesterUserId,
    profileId: f.binding.requesterProfileId,
    role: "owner",
    verified: true,
  };
  return {
    organizationId: request.organizationId,
    spaceId: request.spaceId,
    dispatchId: request.dispatchId,
    profileId: request.agentProfileId,
    triggerMessageId: request.triggerMessageId,
    bindingId: request.bindingId,
    conversationKind: "space",
    routineRunId: null,
    status: "completed",
    failureCode: null,
    createdAtMs: 200,
    completedAtMs: 300,
    publishedSignalId: f.reply.id,
    threadContext: null,
    workerSubmitRequest: null,
    executionRecoverySubmitRequest: request,
  } as RemoteAgentNativeDeliveryRecord;
}
