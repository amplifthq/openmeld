import { PostgresDatabase } from "@openmeld/db/postgresql";
import { resolveRemoteAgentExecutionScope } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import { centerAgentWorkTarget } from "../src/center-agent/application/work-target";
import type { CoreBindings } from "../src/lib/bindings";
import { authorizeRemoteAgentExecutionAccess } from "../src/remote-agent/application/remote-agent-execution-access";
import { rpcRemoteAgentReadMessages } from "../src/search/message-read";

const owners = vi.hoisted(() => ({
  delivery: vi.fn(),
  caller: vi.fn(),
  binding: vi.fn(),
  membership: vi.fn(),
  directory: vi.fn(),
  agent: vi.fn(),
  connection: vi.fn(),
  delegated: vi.fn(),
  computer: vi.fn(),
  workTarget: vi.fn(),
}));
vi.mock("../src/rpc/space-ref", () => ({
  resolveSpaceStub: () => ({ rpcCenterAgentWorkTarget: owners.workTarget }),
}));
vi.mock("../src/computer/personal-computer", () => ({
  ensurePersonalComputer: owners.computer,
}));
vi.mock(
  "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo",
  () => ({ readRemoteAgentNativeDeliveryBySubmissionId: owners.delivery })
);
vi.mock("../src/remote-agent/application/remote-agent-tool-caller", () => ({
  requireRemoteAgentToolCaller: owners.caller,
}));
vi.mock(
  "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo",
  () => ({ readPrimaryAgentProfileBindingRecord: owners.binding })
);
vi.mock("../src/organizations/organization-context", () => ({
  resolveOrganizationMembershipById: owners.membership,
}));
vi.mock("../src/rpc/methods", () => ({
  rpcGetSpaceMemberDirectory: owners.directory,
  rpcListSignals: vi.fn(),
}));
vi.mock(
  "../src/remote-agent/application/personal-remote-agent-space-tools",
  () => ({ isActiveRemoteAgentRequesterProfile: owners.agent })
);
vi.mock("../src/connectors/plugin-access", () => ({
  requireRemotePluginConnection: owners.connection,
}));
vi.mock("../src/remote-agent/application/delegated-requester", () => ({
  readRemoteAgentDelegatedRequester: owners.delegated,
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
    owners.workTarget.mockResolvedValue(null);
    owners.caller.mockResolvedValue({
      db: new PostgresDatabase({
        connectionString:
          "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
      }),
    });
    owners.binding.mockResolvedValue({
      bindingState: "enabled_primary",
      bindingId: request.bindingId,
    });
    owners.membership.mockResolvedValue({ ok: true });
    owners.directory.mockResolvedValue(directory);
    owners.connection.mockResolvedValue({ updatedAtMs: 42 });
    owners.delegated.mockResolvedValue(null);
    owners.computer.mockImplementation(
      async (_db, ownerUserId) =>
        await Promise.resolve({
          id: `computer-${ownerUserId}`,
          ownerUserId,
          provider: "cloudflare",
          createdAtMs: 1,
        })
    );
  });

  it.each([
    {
      taskId: undefined,
      conversationId: "center-space:tonebird:root:walkthrough",
    },
    {
      taskId: "task-tonebird",
      conversationId: "center-space:tonebird:root:walkthrough",
    },
    { taskId: undefined, conversationId: undefined },
  ])("derives work-target scope from the active admission, never a model-selected Space or Task (%j)", async ({
    taskId,
    conversationId,
  }) => {
    owners.delivery.mockResolvedValue({
      ...record,
      triggerMessageId: request.triggerMessageId,
      createdAtMs: 123,
      workerSubmitRequest: {
        ...request,
        conversationId,
        ...(taskId ? { taskId } : {}),
      },
    });
    const env = {
      OPENMELD_POSTGRESQL: {
        connectionString:
          "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
      },
    } as CoreBindings;
    expect(
      await centerAgentWorkTarget(env, { context: input.context })
    ).toEqual({ record: null, selectionRequired: true });
    expect(owners.workTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKey: taskId
          ? `task:${taskId}`
          : `conversation:${conversationId ?? request.spaceId}`,
        sourceSignalId: request.triggerMessageId,
        requesterProfileId: request.author.profileId,
      })
    );
    await expect(
      centerAgentWorkTarget(env, {
        context: input.context,
        scopeKey: "task:another-member",
      })
    ).rejects.toMatchObject({ code: "center_agent.work_target.invalid_input" });
    owners.delivery.mockResolvedValue({
      ...record,
      workerSubmitRequest: {
        ...request,
        conversationId: "root",
        sourceClientMessageId: "plugin-continue:approval",
      },
    });
    await expect(
      centerAgentWorkTarget(env, {
        context: input.context,
        selection: { expectedRevision: 0, choice: { kind: "inherit" } },
      })
    ).rejects.toThrow("human_source_required");
  });

  it.each([
    undefined,
    "another-space",
  ])("refuses personal message reads outside the admitted Space (%s)", async (spaceId) => {
    const context = {
      ...input.context,
      actorContext: {
        ...input.context.actorContext,
        profileKind: "agent" as const,
        callerPrincipalId: "remote-owner",
        ownerUserId: "remote-owner",
      },
    };
    owners.caller.mockResolvedValue({
      db: {},
      context,
      activeOrganization: { organizationId: request.organizationId },
      personalExecution: { directory },
    });
    await expect(
      rpcRemoteAgentReadMessages(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        {
          context,
          spaceId,
          q: "private decision",
          mode: "preview",
          limit: 30,
          maxBytes: 4096,
          includeSystem: false,
        }
      )
    ).rejects.toMatchObject({ code: "space.read.execution_scope_required" });
  });

  it.each([
    { personal: false, agentSender: false, expectedOwner: "user_1" },
    { personal: true, agentSender: false, expectedOwner: "remote-owner" },
    { personal: true, agentSender: true, expectedOwner: "remote-owner" },
    { personal: false, agentSender: true, expectedOwner: null },
  ])("resolves the Computer from trusted execution ownership: %j", async ({
    personal,
    agentSender,
    expectedOwner,
  }) => {
    const executionRequest = {
      ...request,
      agentProfileOwnerUserId: "remote-owner",
      turnEnvelope: {
        ...request.turnEnvelope,
        ...(agentSender
          ? {
              sender: {
                kind: "agent_profile",
                id: request.author.profileId,
                profileId: request.author.profileId,
                verified: true,
                displayName: "Requester",
              },
            }
          : {}),
      },
    };
    owners.delivery.mockResolvedValue({
      ...record,
      workerSubmitRequest: executionRequest,
    });
    if (personal) {
      owners.caller.mockResolvedValue({
        db: {},
        personalExecution: { directory },
      });
    }
    owners.agent.mockResolvedValue(true);
    const response = await authorizeRemoteAgentExecutionAccess(
      {
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
        },
      } as CoreBindings,
      { ...input, includeComputer: true }
    );
    expect(response.computer).toEqual(
      expectedOwner
        ? {
            id: `computer-${expectedOwner}`,
            ownerUserId: expectedOwner,
            provider: "cloudflare",
            createdAtMs: 1,
          }
        : null
    );
    if (!expectedOwner) {
      expect(owners.computer).not.toHaveBeenCalled();
    }
  });

  it.each([
    "accepted",
    "retry_observed",
  ])("derives the scope for %s and rechecks current binding, membership and Space participation", async (status) => {
    owners.delivery.mockResolvedValue({ ...record, status });
    expect(
      await authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        input
      )
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
    { status: "submitted" },
    { status: "callback_rejected" },
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
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        input
      )
    ).rejects.toThrow("execution_not_active");
    expect(owners.caller).not.toHaveBeenCalled();
  });

  it("rejects a changed binding and then revoked requester membership", async () => {
    owners.binding.mockResolvedValueOnce({
      bindingState: "enabled_primary",
      bindingId: "new-binding",
    });
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        input
      )
    ).rejects.toThrow("binding_changed");
    owners.membership.mockResolvedValueOnce({
      ok: false,
      code: "membership_revoked",
    });
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        input
      )
    ).rejects.toThrow("membership_revoked");
  });

  it("requires both the Agent and the original author to remain Space members", async () => {
    owners.directory.mockResolvedValueOnce({
      members: [{ profileId: request.agentProfileId }],
    });
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        input
      )
    ).rejects.toThrow("space_membership_revoked");
    owners.directory.mockResolvedValueOnce({
      members: [{ profileId: request.author.profileId }],
    });
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        input
      )
    ).rejects.toThrow("space_membership_revoked");
  });

  it("keeps the actual Agent audience while exposing opted-in delegated identity and authorizing only source reads", async () => {
    const delegatedRequester = {
      delegationId: "delegation-1",
      parentDeliveryId: "parent-1",
      memberId: "member_123",
      userId: "user_1",
      profileId: "human-1",
    };
    const delegatedRequest = {
      ...request,
      turnEnvelope: {
        ...request.turnEnvelope,
        sender: {
          kind: "agent_profile",
          id: request.author.profileId,
          profileId: request.author.profileId,
          verified: true,
          displayName: "Center",
        },
      },
    };
    owners.delivery.mockResolvedValue({
      ...record,
      workerSubmitRequest: delegatedRequest,
    });
    owners.caller.mockResolvedValue({
      db: new PostgresDatabase({
        connectionString:
          "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
      }),
      personalExecution: { directory },
    });
    owners.agent.mockResolvedValue(true);
    owners.delegated.mockResolvedValue(delegatedRequester);
    const source = {
      kind: "plugin_connection",
      service: "github",
      connectionName: "exact-account",
      connectionUpdatedAtMs: 42,
    };
    const response = await authorizeRemoteAgentExecutionAccess(
      {
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
        },
      } as CoreBindings,
      { ...input, includeDelegatedRequester: true, sources: [source] }
    );
    expect(response.delegatedRequester).toEqual(delegatedRequester);
    expect(response.delegatedRequesterSupported).toBe(true);
    expect(response.scope.principal).toEqual({
      kind: "agent",
      profileId: request.author.profileId,
    });
    expect(owners.connection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requesterUserId: "user_1",
        connectionName: "exact-account",
        effect: "read",
      })
    );
    const legacy = await authorizeRemoteAgentExecutionAccess(
      {
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
        },
      } as CoreBindings,
      input
    );
    expect(legacy).not.toHaveProperty("delegatedRequester");
    expect(legacy).not.toHaveProperty("delegatedRequesterSupported");
    owners.connection.mockClear();
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        {
          ...input,
          includeDelegatedRequester: true,
          effect: "write",
          sources: [source],
        }
      )
    ).rejects.toThrow("delegated_read_only");
    expect(owners.connection).not.toHaveBeenCalled();
    owners.delegated.mockResolvedValue(null);
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        {
          ...input,
          includeDelegatedRequester: true,
          sources: [source],
        }
      )
    ).rejects.toThrow("delegated_requester_unavailable");
    expect(owners.connection).not.toHaveBeenCalled();
  });

  it("uses the personal execution owner's authorized directory rather than issuing an unscoped second read", async () => {
    owners.caller.mockResolvedValue({
      db: new PostgresDatabase({
        connectionString:
          "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
      }),
      personalExecution: { directory },
    });
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        input
      )
    ).resolves.toHaveProperty("submissionId", "submission-1");
    expect(owners.binding).not.toHaveBeenCalled();
    expect(owners.directory).not.toHaveBeenCalled();
  });

  it("passes private Git write requirements to the existing permission owner instead of treating read access as write access", async () => {
    owners.connection.mockImplementation(async (value) => {
      if (value.effect === "write") {
        throw new Error("plugin.action_forbidden");
      }
      return await Promise.resolve({ updatedAtMs: 42 });
    });
    const source = {
      kind: "plugin_connection",
      service: "github",
      connectionName: "selected",
      connectionUpdatedAtMs: 42,
    };
    await authorizeRemoteAgentExecutionAccess(
      {
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
        },
      } as CoreBindings,
      {
        ...input,
        sources: [source],
      }
    );
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        {
          ...input,
          sources: [source],
          effect: "write",
        }
      )
    ).rejects.toThrow("plugin.action_forbidden");
    expect(owners.connection).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectionName: "selected", effect: "write" })
    );
  });

  it.each([
    "accepted",
    "retry_observed",
  ])("does not let %s bypass current Agent access or a replacement account", async (status) => {
    owners.delivery.mockResolvedValue({ ...record, status });
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
    await authorizeRemoteAgentExecutionAccess(
      {
        OPENMELD_POSTGRESQL: {
          connectionString:
            "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
        },
      } as CoreBindings,
      withSource
    );
    expect(owners.connection).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: "user_1",
        connectionName: "selected",
        effect: "read",
      })
    );
    owners.connection.mockResolvedValueOnce({ updatedAtMs: 43 });
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        withSource
      )
    ).rejects.toThrow("result_connection_changed");
    owners.connection.mockRejectedValueOnce(
      new Error("plugin.action_forbidden")
    );
    await expect(
      authorizeRemoteAgentExecutionAccess(
        {
          OPENMELD_POSTGRESQL: {
            connectionString:
              "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
          },
        } as CoreBindings,
        withSource
      )
    ).rejects.toThrow("plugin.action_forbidden");
  });
});
