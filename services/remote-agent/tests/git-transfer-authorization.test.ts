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
