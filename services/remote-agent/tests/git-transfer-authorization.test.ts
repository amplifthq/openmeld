import {
  remoteAgentExecutionScopeKey,
  remoteAgentGitTransferGrantSchema,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import { authorizeGitTransfer } from "../flue-adapter/git-transfer-authorization";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";

function fixture() {
  const request = createSubmitTurnRequest();
  const context = createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: "git-transfer-execution",
      submissionId: "git-transfer-execution",
      status: "pending",
    },
  });
  const scope = {
    ...resolveRemoteAgentExecutionScope(context),
    principal: { kind: "agent" as const, profileId: "agt_parent" },
  };
  const connection = {
    canDisconnect: true,
    connectionName: "member-github",
    createdAtMs: TEST_NOW_MS,
    disconnectedAtMs: null,
    organizationId: context.organizationId,
    ownerDisplayName: "Requester",
    scope: "member" as const,
    service: "github" as const,
    status: "active" as "active" | "disconnected",
    updatedAtMs: TEST_NOW_MS,
    userId: "user_1",
  };
  const grant = remoteAgentGitTransferGrantSchema.parse({
    operationId: "git-operation",
    organizationId: context.organizationId,
    requesterUserId: "user_1",
    owner: "acme",
    repo: "private",
    authorization: {
      context: buildRemoteAgentCoreContext(
        context,
        "git-transfer:git-operation"
      ),
      submissionId: context.submissionId,
      effect: "read",
      sources: [
        {
          kind: "plugin_connection",
          service: "github",
          connectionName: connection.connectionName,
          connectionUpdatedAtMs: connection.updatedAtMs,
        },
      ],
    },
    scopeKey: remoteAgentExecutionScopeKey(scope),
    expiresAtMs: Date.now() + 60_000,
  });
  const authorizeRemoteAgentExecutionAccess = vi.fn(async () => ({
    scope,
    submissionId: context.submissionId,
    delegatedRequesterSupported: true as const,
    delegatedRequester: {
      delegationId: "delegation-1",
      parentDeliveryId: "parent-1",
      memberId: "member_123",
      userId: "user_1",
      profileId: "human-1",
    },
  }));
  const centerAgentResolveConnectorConnection = vi.fn(async () => ({
    connection,
    selection: "requester",
    permission: "read",
  }));
  return {
    grant,
    connection,
    authorizeRemoteAgentExecutionAccess,
    centerAgentResolveConnectorConnection,
  };
}

describe("Git transfer authorization", () => {
  it("rechecks the recorded requester and exact source on each host transfer", async () => {
    const f = fixture();
    const grant = {
      ...f.grant,
      authorization: {
        ...f.grant.authorization,
        includeDelegatedRequester: true as const,
      },
    };
    await authorizeGitTransfer(f, grant);
    expect(f.authorizeRemoteAgentExecutionAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        includeDelegatedRequester: true,
        sources: grant.authorization.sources,
      })
    );
    expect(f.centerAgentResolveConnectorConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        includeDelegatedRequester: true,
        requesterUserId: "user_1",
      })
    );
    f.authorizeRemoteAgentExecutionAccess.mockRejectedValue(
      new Error("member revoked")
    );
    await expect(authorizeGitTransfer(f, grant)).rejects.toThrow(
      "member revoked"
    );
    expect(f.centerAgentResolveConnectorConnection).toHaveBeenCalledTimes(1);
  });

  it.each([
    "old_core",
    "changed_requester",
    "changed_connection",
    "changed_version",
  ])("rejects delegated transfer after %s", async (denial) => {
    const f = fixture();
    const grant = {
      ...f.grant,
      authorization: {
        ...f.grant.authorization,
        includeDelegatedRequester: true as const,
      },
    };
    if (denial === "old_core" || denial === "changed_requester") {
      const original = await f.authorizeRemoteAgentExecutionAccess();
      f.authorizeRemoteAgentExecutionAccess.mockResolvedValue({
        ...original,
        ...(denial === "old_core"
          ? {
              delegatedRequesterSupported: undefined,
              delegatedRequester: undefined,
            }
          : {
              delegatedRequester: {
                ...original.delegatedRequester,
                userId: "another-user",
              },
            }),
      } as typeof original);
    } else {
      f.centerAgentResolveConnectorConnection.mockResolvedValue({
        connection: {
          ...f.connection,
          ...(denial === "changed_connection"
            ? { connectionName: "replacement" }
            : { updatedAtMs: TEST_NOW_MS + 1 }),
        },
        selection: "requester",
        permission: "read",
      });
    }
    await expect(authorizeGitTransfer(f, grant)).rejects.toThrow();
  });

  it("accepts the original requester on an active Center Agent execution", async () => {
    const f = fixture();
    await authorizeGitTransfer(f, f.grant);
    expect(f.authorizeRemoteAgentExecutionAccess).toHaveBeenCalledWith({
      context: f.grant.authorization.context,
      submissionId: f.grant.authorization.submissionId,
      effect: "read",
    });
    expect(f.centerAgentResolveConnectorConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: "user_1",
        connectionPreference: "requester",
        service: "github",
      })
    );
  });

  it("rejects a disconnected requester connection", async () => {
    const f = fixture();
    f.centerAgentResolveConnectorConnection.mockResolvedValueOnce({
      connection: { ...f.connection, status: "disconnected" },
      selection: "requester",
      permission: "read",
    });
    await expect(authorizeGitTransfer(f, f.grant)).rejects.toThrow(
      "github.checkout.requester_connection_changed"
    );
  });

  it("rejects a mismatched execution scope before resolving a connection", async () => {
    const f = fixture();
    await expect(
      authorizeGitTransfer(f, { ...f.grant, scopeKey: "another-execution" })
    ).rejects.toThrow("github.checkout.transfer_audience_mismatch");
    expect(f.centerAgentResolveConnectorConnection).not.toHaveBeenCalled();
  });
});
