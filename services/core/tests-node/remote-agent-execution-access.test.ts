import { resolveRemoteAgentExecutionScope } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import type { CoreBindings } from "../src/lib/bindings";
import { authorizeRemoteAgentExecutionAccess } from "../src/remote-agent/application/remote-agent-execution-access";

const owners = vi.hoisted(() => ({
  delivery: vi.fn(),
  caller: vi.fn(),
  binding: vi.fn(),
  membership: vi.fn(),
  directory: vi.fn(),
  agent: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("../src/lib/bindings", () => ({ wakeEvidenceDb: () => ({}) }));
vi.mock(
  "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo",
  () => ({ readRemoteAgentNativeDeliveryBySubmissionId: owners.delivery })
);
vi.mock("../src/remote-agent/application/remote-agent-tool-caller", () => ({
  requireRemoteAgentToolCaller: owners.caller,
}));
vi.mock(
  "../src/agent-profile-binding/infrastructure/d1/agent-profile-binding-repo",
  () => ({ readPrimaryAgentProfileBindingRecord: owners.binding })
);
vi.mock("../src/organizations/organization-context", () => ({
  resolveOrganizationMembershipById: owners.membership,
}));
vi.mock("../src/rpc/methods", () => ({
  rpcGetSpaceMemberDirectory: owners.directory,
}));
vi.mock(
  "../src/remote-agent/application/personal-remote-agent-space-tools",
  () => ({ isActiveRemoteAgentRequesterProfile: owners.agent })
);
vi.mock("../src/connectors/plugin-access", () => ({
  requireRemotePluginConnection: owners.connection,
}));

const request = createSubmitTurnRequest();
const directory = {
  members: [
    { profileId: request.agentProfileId },
    { profileId: request.author.profileId },
  ],
};
const record = {
  organizationId: request.organizationId,
  spaceId: request.spaceId,
  profileId: request.agentProfileId,
  bindingId: request.bindingId,
  dispatchId: request.dispatchId,
  submissionId: "submission-1",
  status: "accepted",
  conversationKind: "space",
  workerSubmitRequest: request,
};
const input = {
  submissionId: "submission-1",
  context: {
    activeOrganizationId: request.organizationId,
    agentControllerConversationId: "submission-1",
    actorContext: {
      requestId: "read-1",
      profileKind: "agent",
      openMeldProfileId: request.agentProfileId,
    },
  },
};

describe("current execution access is an owner projection, not a cached grant", () => {
  beforeEach(() => {
    for (const mock of Object.values(owners)) {
      mock.mockReset();
    }
    owners.delivery.mockResolvedValue(record);
    owners.caller.mockResolvedValue({ db: {} });
    owners.binding.mockResolvedValue({
      bindingState: "enabled_primary",
      bindingId: request.bindingId,
    });
    owners.membership.mockResolvedValue({ ok: true });
    owners.directory.mockResolvedValue(directory);
    owners.connection.mockResolvedValue({ updatedAtMs: 42 });
  });

  it("derives the scope from the admitted request and rechecks current binding, membership and Space participation", async () => {
    expect(
      await authorizeRemoteAgentExecutionAccess({} as CoreBindings, input)
    ).toEqual({
      submissionId: "submission-1",
      scope: resolveRemoteAgentExecutionScope(request),
    });
    expect(owners.membership).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: request.organizationId,
        userId: "user_1",
      })
    );
    expect(owners.directory).toHaveBeenCalledWith(expect.anything(), {
      context: input.context,
      spaceId: request.spaceId,
    });
  });

  it.each([
    { status: "completed" },
    { status: "failed" },
    { submissionId: "other" },
    { organizationId: "other" },
    { profileId: "other" },
    { bindingId: "other" },
    { spaceId: "other" },
    { dispatchId: "other" },
  ])("rejects inactive or mismatched evidence: %j", async (change) => {
    owners.delivery.mockResolvedValue({ ...record, ...change });
    await expect(
      authorizeRemoteAgentExecutionAccess({} as CoreBindings, input)
    ).rejects.toThrow("execution_not_active");
    expect(owners.caller).not.toHaveBeenCalled();
  });

  it("rejects a changed binding and then revoked requester membership", async () => {
    owners.binding.mockResolvedValueOnce({
      bindingState: "enabled_primary",
      bindingId: "new-binding",
    });
    await expect(
      authorizeRemoteAgentExecutionAccess({} as CoreBindings, input)
    ).rejects.toThrow("binding_changed");
    owners.membership.mockResolvedValueOnce({
      ok: false,
      code: "membership_revoked",
    });
    await expect(
      authorizeRemoteAgentExecutionAccess({} as CoreBindings, input)
    ).rejects.toThrow("membership_revoked");
  });

  it("requires both the Agent and the original author to remain Space members", async () => {
    owners.directory.mockResolvedValueOnce({
      members: [{ profileId: request.agentProfileId }],
    });
    await expect(
      authorizeRemoteAgentExecutionAccess({} as CoreBindings, input)
    ).rejects.toThrow("space_membership_revoked");
    owners.directory.mockResolvedValueOnce({
      members: [{ profileId: request.author.profileId }],
    });
    await expect(
      authorizeRemoteAgentExecutionAccess({} as CoreBindings, input)
    ).rejects.toThrow("space_membership_revoked");
  });

  it("uses the personal execution owner's authorized directory rather than issuing an unscoped second read", async () => {
    owners.caller.mockResolvedValue({
      db: {},
      personalExecution: { directory },
    });
    await expect(
      authorizeRemoteAgentExecutionAccess({} as CoreBindings, input)
    ).resolves.toHaveProperty("submissionId", "submission-1");
    expect(owners.binding).not.toHaveBeenCalled();
    expect(owners.directory).not.toHaveBeenCalled();
  });

  it("does not let an active connection bypass current Agent access or a replacement account", async () => {
    const withSource = {
      ...input,
      sources: [
        {
          kind: "plugin_connection",
          service: "github",
          connectionName: "selected",
          connectionUpdatedAtMs: 42,
        },
      ],
    };
    await authorizeRemoteAgentExecutionAccess({} as CoreBindings, withSource);
    expect(owners.connection).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: "user_1",
        connectionName: "selected",
        effect: "read",
      })
    );
    owners.connection.mockResolvedValueOnce({ updatedAtMs: 43 });
    await expect(
      authorizeRemoteAgentExecutionAccess({} as CoreBindings, withSource)
    ).rejects.toThrow("result_connection_changed");
    owners.connection.mockRejectedValueOnce(
      new Error("plugin.action_forbidden")
    );
    await expect(
      authorizeRemoteAgentExecutionAccess({} as CoreBindings, withSource)
    ).rejects.toThrow("plugin.action_forbidden");
  });
});
