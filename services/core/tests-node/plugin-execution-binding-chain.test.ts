import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import {
  readPluginConnectionExecutionBinding,
  readSpacePluginConnectionBinding,
} from "../src/connectors/plugin-connection-execution-binding";
import type { CoreBindings } from "../src/lib/bindings";

const owners = vi.hoisted(() => ({
  space: vi.fn(),
  delivery: vi.fn(),
  parent: vi.fn(),
  metadata: vi.fn(),
}));
vi.mock("../src/rpc/methods", () => ({
  rpcReadPluginConnectionContinuationBinding: owners.space,
}));
vi.mock("../src/lib/bindings", () => ({ wakeEvidenceDb: () => ({}) }));
vi.mock(
  "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo",
  () => ({
    readRemoteAgentNativeDeliveryBySubmissionId: owners.delivery,
    readRemoteAgentNativeDeliveryByDeliveryId: owners.parent,
  })
);
vi.mock(
  "../src/remote-agent/infrastructure/d1/plugin-channel-metadata-repo",
  () => ({ readPluginChannelMetadata: owners.metadata })
);
const env = {} as CoreBindings;
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
