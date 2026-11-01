import { pluginConnectionContinuationBindingSchema } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import {
  readPluginConnectionExecutionBinding,
  readSpacePluginConnectionBinding,
  readSpacePluginConnectionOriginalSource,
} from "../src/connectors/plugin-connection-execution-binding";
import type { CoreBindings } from "../src/lib/bindings";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const owners = vi.hoisted(() => ({
  space: vi.fn(),
  delivery: vi.fn(),
  parent: vi.fn(),
  metadata: vi.fn(),
}));
vi.mock("../src/rpc/methods", () => ({
  rpcReadPluginConnectionContinuationBinding: owners.space,
}));
vi.mock(
  "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo",
  () => ({
    readRemoteAgentNativeDeliveryBySubmissionId: owners.delivery,
    readRemoteAgentNativeDeliveryByDeliveryId: owners.parent,
  })
);
vi.mock(
  "../src/remote-agent/infrastructure/postgresql/plugin-channel-metadata-repo",
  () => ({ readPluginChannelMetadata: owners.metadata })
);
const env = {
  OPENMELD_POSTGRESQL: {
    connectionString:
      "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
  },
} as CoreBindings;
const request = createSubmitTurnRequest();
const context = {
  activeOrganizationId: request.organizationId,
  agentControllerConversationId: "submission",
  actorContext: {
    openMeldProfileId: request.agentProfileId,
    requestId: "plugin-binding-chain",
    profileKind: "agent" as const,
  },
};
const delivery = {
  deliveryId: "latest",
  organizationId: request.organizationId,
  profileId: request.agentProfileId,
  spaceId: request.spaceId,
  status: "accepted",
  conversationKind: "slack",
  workerSubmitRequest: request,
  triggerMessageId: "plugin-channel-continue:latest",
  idempotencyKey: "plugin-channel-continue:latest",
};
const selection = {
  sourceDeliveryId: "parent",
  organizationId: request.organizationId,
  targetProfileId: request.agentProfileId,
  requesterUserId: "user_1",
  requesterProfileId: request.author.profileId,
  service: "linear",
  scope: "member",
  connectionName: "linear-me",
  connectionUpdatedAtMs: 42,
};
beforeEach(() => {
  for (const mock of Object.values(owners)) {
    mock.mockReset();
  }
  owners.delivery.mockResolvedValue(delivery);
});
describe("explicit Plugin identities survive subsequent setup without becoming a global preference", () => {
  it.each([
    false,
    true,
  ])("resolves the original goal across connection and action continuations, rejecting cycles=%s", async (cycle) => {
    const make = (sourceId: string) =>
      pluginConnectionContinuationBindingSchema.parse({
        v: 1,
        organizationId: request.organizationId,
        spaceId: request.spaceId,
        sourceDispatchId: "dispatch",
        source: {
          signalId: sourceId,
          revision: 0,
          fingerprint: "0".repeat(64),
        },
        reply: { signalId: "reply", revision: 0, fingerprint: "0".repeat(64) },
        requesterUserId: "user_1",
        requesterProfileId: request.author.profileId,
        targetProfileId: request.agentProfileId,
        service: "linear",
        scope: "member",
        connectionName: "linear-me",
        connectionUpdatedAtMs: 42,
        continuationTextDigest: "0".repeat(64),
        threadContext: null,
      });
    owners.space.mockImplementation((_env, value) => {
      if (value.signalId === "approved-action") {
        return Promise.resolve(make("connection-continued"));
      }
      if (value.signalId === "connection-continued") {
        return Promise.resolve(
          make(cycle ? "approved-action" : "original-request")
        );
      }
      return Promise.resolve(null);
    });
    const result = readSpacePluginConnectionOriginalSource(env, {
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      signalId: "approved-action",
      targetProfileId: request.agentProfileId,
      requesterUserId: "user_1",
    });
    if (cycle) {
      await expect(result).rejects.toThrow("execution_identity_changed");
    } else {
      await expect(result).resolves.toEqual({
        signalId: "original-request",
        requesterProfileId: request.author.profileId,
      });
    }
  });
  it.each([
    "space",
    "slack",
    "message_channel",
  ] as const)("keeps the frozen account after a real replay ACK in %s", async (conversationKind) => {
    const repo = await vi.importActual<
      typeof import("../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo")
    >(
      "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo"
    );
    const harness = await createPostgresHarness();

    try {
      await repo.upsertRemoteAgentNativeDeliveryRecord({
        ...delivery,
        db: harness.db,
        conversationKind,
        status: "submitted",
        nowMs: 1,
        bindingId: request.bindingId,
        dispatchId: request.dispatchId,
        attemptId: null,
        slackTeamId: conversationKind === "slack" ? "T1" : null,
        slackChannelId: conversationKind === "slack" ? "C1" : null,
        slackThreadTs: conversationKind === "slack" ? "1.1" : null,
        messageChannelLocator:
          conversationKind === "message_channel"
            ? {
                provider: "slack",
                connectionId: "T1",
                teamId: "T1",
                channelId: "C1",
                rootMessageId: "1.1",
              }
            : null,
        providerPublicationIdempotencyKey:
          conversationKind === "message_channel" ? "publication-1" : null,
      });
      await harness.query({
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET execution_recovery_submit_request_json = $1 WHERE delivery_id = $2',
        values: [JSON.stringify(request), delivery.deliveryId],
      });
      const ack = await repo.markRemoteAgentNativeDeliveryAck({
        db: harness.db,
        nowMs: 2,
        idempotencyKey: delivery.idempotencyKey,
        submissionId: "submission",
        accepted: false,
      });
      expect(ack.status).toBe("retry_observed");
      owners.delivery.mockImplementation(() =>
        repo.readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission",
        })
      );
      owners.space.mockResolvedValue(selection);
      owners.metadata.mockResolvedValue({
        kind: "continuation",
        executionSelection: selection,
      });
      await expect(
        readPluginConnectionExecutionBinding(env, context, "linear")
      ).resolves.toMatchObject(selection);
    } finally {
      await harness.close();
    }
  });
  it.each([
    "submitted",
    "completed",
    "failed",
    "callback_rejected",
  ])("still rejects %s instead of granting execution from historical binding", async (status) => {
    owners.delivery.mockResolvedValue({ ...delivery, status });
    await expect(
      readPluginConnectionExecutionBinding(env, context, "linear")
    ).rejects.toThrow("execution_identity_changed");
    expect(owners.space).not.toHaveBeenCalled();
    expect(owners.metadata).not.toHaveBeenCalled();
  });

  it("uses the closest matching native Message binding and never unrelated conversation text", async () => {
    owners.space
      .mockResolvedValueOnce({
        service: "linear",
        source: { signalId: "previous" },
      })
      .mockResolvedValueOnce({
        service: "github",
        scope: "shared",
        connectionName: "github-org",
      });
    const input = {
      organizationId: "org",
      spaceId: "space",
      signalId: "now",
      targetProfileId: "agent",
      requesterUserId: "user",
    };
    expect(
      await readSpacePluginConnectionBinding(env, input, "github")
    ).toMatchObject({ connectionName: "github-org" });
    expect(owners.space.mock.calls[1]?.[1]).toEqual({
      ...input,
      signalId: "previous",
    });
  });
  it("retains the earlier external account when a later continuation selected a different Plugin", async () => {
    owners.metadata
      .mockResolvedValueOnce({
        kind: "continuation",
        executionSelection: selection,
      })
      .mockResolvedValueOnce({
        kind: "continuation",
        executionSelection: {
          ...selection,
          service: "github",
          scope: "shared",
          connectionName: "github-org",
          sourceDeliveryId: "root",
        },
      });
    owners.parent.mockResolvedValue({ ...delivery, deliveryId: "parent" });
    expect(
      await readPluginConnectionExecutionBinding(env, context, "github")
    ).toMatchObject({
      service: "github",
      connectionName: "github-org",
      scope: "shared",
    });
  });
  it.each([
    "missing_metadata",
    "wrong_user",
    "wrong_parent",
    "cycle",
  ])("fails closed for %s instead of falling back to automatic", async (mode) => {
    owners.metadata.mockResolvedValue({
      kind: "continuation",
      executionSelection:
        mode === "wrong_user"
          ? { ...selection, requesterUserId: "other" }
          : selection,
    });
    owners.parent.mockResolvedValue({
      ...delivery,
      deliveryId: "parent",
      ...(mode === "wrong_parent" ? { spaceId: "other-space" } : {}),
    });
    if (mode === "missing_metadata") {
      owners.metadata.mockResolvedValue(null);
    }
    await expect(
      readPluginConnectionExecutionBinding(env, context, "github")
    ).rejects.toThrow("execution_identity_changed");
  });
  it("does not bind a separate ordinary task to an earlier conversation preference", async () => {
    owners.delivery.mockResolvedValue({
      ...delivery,
      triggerMessageId: "ordinary",
      idempotencyKey: "ordinary",
    });
    owners.metadata.mockResolvedValue({ kind: "source" });
    expect(
      await readPluginConnectionExecutionBinding(env, context, "github")
    ).toBeNull();
  });
});
