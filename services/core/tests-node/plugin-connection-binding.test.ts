import { DatabaseSync } from "node:sqlite";
import { pluginConnectionContinuationBindingSchema } from "@openmeld/schemas";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import { createCloudflareSqlHarness } from "../../remote-agent/tests/helpers/cloudflare-sql-harness.test-support";
import {
  assertBoundPluginConnection,
  boundPluginConnectionPreference,
} from "../src/connectors/plugin-connection-execution-binding";
import {
  assertPluginContinuationSource,
  pluginContinuationMessageFingerprint,
  pluginContinuationTextDigest,
} from "../src/space/application/plugin-connection-continuation-guard";
import type { OpenMeldDaemonDispatchOutboxRecoveryCandidate } from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { PluginConnectionContinuationRepository } from "../src/space/infrastructure/sql/plugin-connection-continuation-repo";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});
function fixture() {
  const source: Extract<SignalEnvelope, { type: "signal.text" }> = {
    v: 1,
    id: "source",
    spaceId: "space",
    ts: 100,
    type: "signal.text",
    profile: { kind: "human", profileId: "human", profileName: "Maya" },
    data: {
      text: "Original request",
      messageEnvelope: {
        text: "Original request",
        activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
        referenceTargets: [],
      },
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
  const dispatch = {
    dispatchId: "dispatch",
    organizationId: "org",
    spaceId: "space",
    sourceEventId: "source",
    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
    sourceSignalSnapshot: { profileId: "human" },
    sourceMessageEnvelope: source.data.messageEnvelope,
    outboxStatus: "handed_off",
    createdAtMs: 200,
  } as OpenMeldDaemonDispatchOutboxRecoveryCandidate;
  return {
    source,
    reply,
    binding,
    dispatch,
    sourceThread: null,
    replyThread: null,
  };
}

describe("Plugin continuation source and identity constraints", () => {
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

  it("persists one binding across reload/retry and cannot change the account or refresh an old source revision", () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const sql = createCloudflareSqlHarness(database) as unknown as SqlStorage;
    const repo = new PluginConnectionContinuationRepository(sql);
    const { binding } = fixture();
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
    expect(() =>
      reopened.accept("plugin-continue:one", "second-message")
    ).toThrow();
    expect(reopened.read("plugin-continue:one")?.signalId).toBe("new-message");
  });
});
