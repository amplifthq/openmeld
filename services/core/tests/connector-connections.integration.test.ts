import { env } from "cloudflare:test";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { prepareCenterAgentRepresentedMemberRequest } from "../src/center-agent/application/represented-member-request";
import { recordCenterAgentConnectorActionOperation } from "../src/center-agent/connector-action-operation-repository";
import {
  createConnectorConnectionName,
  createSharedConnectorConnectionName,
  selectActiveConnectorConnection,
} from "../src/connectors/connector-connection-repository";
import { requirePluginPermission } from "../src/connectors/plugin-access";
import {
  rpcListPluginAccess,
  rpcUpdatePluginAccess,
} from "../src/connectors/plugin-access-rpc";
import type { CoreBindings } from "../src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  rpcAuthorizeConnectorDisconnect,
  rpcBeginCurrentMemberConnectorAuthorization,
  rpcBeginCurrentOrganizationGitHubAppInstallation,
  rpcBeginCurrentOrganizationSharedConnectorAuthorization,
  rpcBeginGitHubAppInstallationVerification,
  rpcCenterAgentReadConnectorActionOperation,
  rpcCenterAgentRecordConnectorActionOperation,
  rpcCenterAgentResolveConnectorConnection,
  rpcCompleteConnectorDisconnect,
  rpcCompleteGitHubAppInstallation,
  rpcListCenterAgentAuditJournal,
  rpcReadPendingGitHubAppInstallation,
  rpcReconcileCurrentOrganizationConnectorConnections,
} from "../src/rpc/methods";

const CONNECTOR_CONNECTION_NAME_PATTERN =
  /^org_[A-Za-z0-9_-]{18}__user_[A-Za-z0-9_-]{18}__github$/u;
const SHARED_CONNECTOR_CONNECTION_NAME_PATTERN =
  /^org_[A-Za-z0-9_-]{18}__shared__github$/u;
const OPENCONNECTOR_CONNECTION_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

describe("Core connector connection ownership", () => {
  it("persists owner-managed Agent access with an atomic revision and audit history", async () => {
    const fixture = await seedConnectorFixture();
    const request = {
      context: connectorRequestContext({
        organizationId: fixture.organizationA,
        userId: fixture.memberA,
      }),
      expectedOrganizationId: fixture.organizationA,
      service: "github" as const,
    };
    const initial = await rpcListPluginAccess(connectorCoreEnv(), request);
    expect(initial.connections).toContainEqual({
      connectionName: fixture.connectionA,
      canManage: true,
      revision: 0,
      policy: {
        center_agent: "write",
        local_agent: "none",
        remote_agent: "none",
      },
    });
    const update = {
      ...request,
      connectionName: fixture.connectionA,
      expectedRevision: 0,
      policy: {
        center_agent: "read",
        local_agent: "read",
        remote_agent: "none",
      } as const,
    };
    expect(
      await rpcUpdatePluginAccess(connectorCoreEnv(), update)
    ).toMatchObject({ revision: 1, policy: update.policy });
    await expect(
      rpcUpdatePluginAccess(connectorCoreEnv(), update)
    ).rejects.toThrow("Plugin access changed");
    const access = {
      db: env.OPENMELD_DB,
      organizationId: fixture.organizationA,
      connectionName: fixture.connectionA,
      consumer: "local_agent" as const,
    };
    await expect(
      requirePluginPermission({ ...access, effect: "read" })
    ).resolves.toBe("read");
    await expect(
      requirePluginPermission({ ...access, effect: "write" })
    ).rejects.toThrow("permission");
    const events = await env.OPENMELD_DB.prepare(
      "SELECT actor_user_id, revision, previous_policy, policy FROM connector_access_events WHERE connection_name = ?"
    )
      .bind(fixture.connectionA)
      .all();
    expect(events.results).toEqual([
      {
        actor_user_id: fixture.memberA,
        revision: 1,
        previous_policy: JSON.stringify(initial.connections[0]?.policy),
        policy: JSON.stringify(update.policy),
      },
    ]);
  });

  it("denies personal access grants to other members and admins and shared grants to members", async () => {
    const fixture = await seedConnectorFixture();
    const shared = await seedSharedConnectorConnection(fixture);
    for (const [userId, connectionName] of [
      [fixture.otherMemberA, fixture.connectionA],
      [fixture.ownerA, fixture.connectionA],
      [fixture.memberA, shared],
    ] as const) {
      await expect(
        rpcUpdatePluginAccess(connectorCoreEnv(), {
          context: connectorRequestContext({
            organizationId: fixture.organizationA,
            userId,
          }),
          expectedOrganizationId: fixture.organizationA,
          service: "github",
          connectionName,
          expectedRevision: 0,
          policy: {
            center_agent: "write",
            local_agent: "write",
            remote_agent: "write",
          },
        })
      ).rejects.toThrow("Only the account owner");
    }
  });

  it("owns connector action retries and terminal outcomes in one durable operation", async () => {
    const fixture = await seedConnectorFixture();
    const baseInput = {
      actionId: "github.create_issue",
      actorProfileId: fixture.ownerProfileId,
      attribution: {
        actorProfileId: fixture.ownerProfileId,
        onBehalfOf: {
          displayName: "Connector owner",
          profileId: fixture.ownerProfileId,
          userId: fixture.ownerA,
        },
      },
      connectionName: fixture.connectionA,
      db: env.OPENMELD_DB,
      executionConnection: {
        connectionName: fixture.connectionA,
        ownerDisplayName: fixture.memberA,
        ownerUserId: fixture.memberA,
        scope: "member",
        service: "github",
      },
      operationId: `connector-operation-${crypto.randomUUID()}`,
      organizationId: fixture.organizationA,
      providerExecutionId: null,
      requester: {
        kind: "represented_member",
        representedUserId: fixture.ownerA,
      },
      requestSignature: "a".repeat(64),
      service: "github",
      sourceSpaceId: "space-authorized",
    } as const;

    const claimed = await recordCenterAgentConnectorActionOperation({
      ...baseInput,
      nowMs: Date.now(),
      outcome: "attempted",
    });
    const replayedClaim = await recordCenterAgentConnectorActionOperation({
      ...baseInput,
      nowMs: Date.now() + 1,
      outcome: "attempted",
    });

    expect(claimed).toMatchObject({
      operation: { status: "pending" },
      replayed: false,
    });
    expect(replayedClaim).toMatchObject({
      operation: { status: "pending" },
      replayed: true,
    });
    await expect(
      recordCenterAgentConnectorActionOperation({
        ...baseInput,
        nowMs: Date.now() + 2,
        outcome: "attempted",
        requestSignature: "b".repeat(64),
      })
    ).rejects.toMatchObject({
      code: "center_agent.connector_action_operation_conflict",
      status: 409,
    });

    const completed = await recordCenterAgentConnectorActionOperation({
      ...baseInput,
      nowMs: Date.now() + 3,
      outcome: "completed",
      providerExecutionId: "provider-execution-1",
      sourceSpaceId: "space-retry",
    });
    const replayedCompletion = await recordCenterAgentConnectorActionOperation({
      ...baseInput,
      nowMs: Date.now() + 4,
      outcome: "completed",
      providerExecutionId: "provider-execution-1",
    });

    expect(completed).toMatchObject({
      operation: {
        providerExecutionId: "provider-execution-1",
        status: "completed",
      },
      replayed: false,
    });
    expect(replayedCompletion.replayed).toBe(true);
    await expect(
      recordCenterAgentConnectorActionOperation({
        ...baseInput,
        nowMs: Date.now() + 5,
        outcome: "failed",
        providerExecutionId: "provider-execution-2",
      })
    ).rejects.toMatchObject({
      code: "center_agent.connector_action_operation_conflict",
      status: 409,
    });

    const auditCount = await env.OPENMELD_DB.prepare(
      `
        SELECT count(*) AS count
        FROM center_agent_audit_journal
        WHERE resource_id = ?
      `
    )
      .bind(
        `${baseInput.service}:${baseInput.actionId}:${baseInput.operationId}`
      )
      .first<{ count: number }>();
    expect(Number(auditCount?.count ?? 0)).toBe(2);
    const sourceSpaces = await env.OPENMELD_DB.prepare(
      `
        SELECT source_space_id
        FROM center_agent_audit_journal
        WHERE resource_id = ?
        ORDER BY created_at ASC
      `
    )
      .bind(
        `${baseInput.service}:${baseInput.actionId}:${baseInput.operationId}`
      )
      .all<{ source_space_id: string | null }>();
    expect(sourceSpaces.results).toEqual([
      { source_space_id: "space-authorized" },
      { source_space_id: "space-authorized" },
    ]);
    const auditContext = connectorRequestContext({
      organizationId: fixture.organizationA,
      userId: fixture.ownerA,
    });
    const v19Audit = await rpcListCenterAgentAuditJournal(connectorCoreEnv(), {
      actionSet: "v19",
      context: auditContext,
      limit: 25,
    });
    const v20Audit = await rpcListCenterAgentAuditJournal(connectorCoreEnv(), {
      actionSet: "v20",
      context: auditContext,
      limit: 25,
    });
    expect(
      v19Audit.entries.find(
        (entry) =>
          entry.resource?.id ===
          `${baseInput.service}:${baseInput.actionId}:${baseInput.operationId}`
      )
    ).not.toHaveProperty("sourceSpaceId");
    expect(
      v20Audit.entries.find(
        (entry) =>
          entry.resource?.id ===
          `${baseInput.service}:${baseInput.actionId}:${baseInput.operationId}`
      )
    ).toMatchObject({ sourceSpaceId: "space-authorized" });

    const concurrentInput = {
      ...baseInput,
      operationId: `connector-operation-race-${crypto.randomUUID()}`,
    };
    await recordCenterAgentConnectorActionOperation({
      ...concurrentInput,
      nowMs: Date.now() + 6,
      outcome: "attempted",
    });
    const terminalRace = await Promise.allSettled([
      recordCenterAgentConnectorActionOperation({
        ...concurrentInput,
        nowMs: Date.now() + 7,
        outcome: "completed",
        providerExecutionId: "provider-race-completed",
      }),
      recordCenterAgentConnectorActionOperation({
        ...concurrentInput,
        nowMs: Date.now() + 8,
        outcome: "failed",
        providerExecutionId: "provider-race-failed",
      }),
    ]);
    expect(
      terminalRace.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      terminalRace.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    const raceAuditRows = await env.OPENMELD_DB.prepare(
      `
        SELECT action
        FROM center_agent_audit_journal
        WHERE resource_id = ?
        ORDER BY created_at ASC
      `
    )
      .bind(
        `${concurrentInput.service}:${concurrentInput.actionId}:${concurrentInput.operationId}`
      )
      .all<{ action: string }>();
    expect(raceAuditRows.results).toHaveLength(2);
    expect(raceAuditRows.results[0]?.action).toBe("execute_connector_action");
    expect(["complete_connector_action", "fail_connector_action"]).toContain(
      raceAuditRows.results[1]?.action
    );
  });

  it("uses the native delivery as the only requester for a connected Message Channel member", async () => {
    const fixture = await seedConnectorFixture();
    const sharedConnection = await seedSharedConnectorConnection(
      fixture,
      "gmail"
    );
    const sourceNativeDeliveryId = `delivery-${crypto.randomUUID()}`;
    const operationId = `connector-channel-member-${crypto.randomUUID()}`;

    const result = await recordCenterAgentConnectorActionOperation({
      actionId: "gmail.fetch_emails",
      actorProfileId: fixture.ownerProfileId,
      attribution: {
        actorProfileId: fixture.ownerProfileId,
        onBehalfOf: null,
      },
      connectionName: sharedConnection,
      db: env.OPENMELD_DB,
      executionConnection: {
        connectionName: sharedConnection,
        ownerDisplayName: fixture.ownerA,
        ownerUserId: fixture.ownerA,
        scope: "shared",
        service: "gmail",
      },
      nowMs: Date.now(),
      operationId,
      organizationId: fixture.organizationA,
      outcome: "attempted",
      providerExecutionId: null,
      requester: {
        kind: "connected_message_channel_member",
        sourceNativeDeliveryId,
      },
      requestSignature: "e".repeat(64),
      service: "gmail",
    });

    expect(result.operation).toMatchObject({
      representedUserId: null,
      requesterAttributionKey: `delivery:${sourceNativeDeliveryId}`,
      sourceNativeDeliveryId,
      status: "pending",
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT on_behalf_of_user_id, source_native_delivery_id
          FROM center_agent_audit_journal
          WHERE resource_id = ?
        `
      )
        .bind(`gmail:gmail.fetch_emails:${operationId}`)
        .first()
    ).resolves.toEqual({
      on_behalf_of_user_id: null,
      source_native_delivery_id: sourceNativeDeliveryId,
    });
  });

  it("authorizes the represented member and selected connection before recording an operation", async () => {
    const fixture = await seedConnectorFixture();
    const sharedConnection = await seedSharedConnectorConnection(fixture);
    const centerAgentProfileId =
      `agt_${crypto.randomUUID()}` as `agt_${string}`;
    const representedProfileId = crypto.randomUUID();
    const centerAgentMemberId = `member-center-agent-${crypto.randomUUID()}`;
    const nowMs = Date.now();
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        `
          INSERT INTO openmeld_profiles (
            profile_id, profile_name, profile_handle, profile_kind, is_default,
            status, organization_id, owner_user_id, created_by_user_id, source,
            managed_role, created_at, updated_at
          ) VALUES (?, 'Center Agent', ?, 'agent', 0, 'active', ?, NULL, ?, 'auth_bootstrap', 'center_agent', ?, ?)
        `
      ).bind(
        centerAgentProfileId,
        `center-agent-${crypto.randomUUID()}`,
        fixture.organizationA,
        fixture.ownerA,
        nowMs,
        nowMs
      ),
      env.OPENMELD_DB.prepare(
        `
          INSERT INTO openmeld_profiles (
            profile_id, profile_name, profile_handle, profile_kind, is_default,
            status, organization_id, owner_user_id, created_by_user_id, source,
            created_at, updated_at
          ) VALUES (?, 'Represented member', ?, 'human', 1, 'active', NULL, ?, ?, 'auth_bootstrap', ?, ?)
        `
      ).bind(
        representedProfileId,
        `represented-${crypto.randomUUID()}`,
        fixture.memberA,
        fixture.memberA,
        nowMs,
        nowMs
      ),
      env.OPENMELD_DB.prepare(
        `
          INSERT INTO center_agent_designations (
            organization_id, agent_profile_id, duty, designated_by, created_at
          ) VALUES (?, ?, NULL, ?, ?)
        `
      ).bind(
        fixture.organizationA,
        centerAgentProfileId,
        fixture.ownerA,
        nowMs
      ),
    ]);

    const context = {
      activeOrganizationId: fixture.organizationA,
      actorContext: {
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        callerPrincipalId: centerAgentProfileId,
        profileKind: "agent" as const,
        requestId: `req-${crypto.randomUUID()}`,
        openMeldProfileId: centerAgentProfileId,
      },
    };
    const operationId = `connector-rpc-${crypto.randomUUID()}`;
    const body = {
      actionId: "github.create_issue",
      connectionName: fixture.connectionA,
      context,
      operationId,
      providerExecutionId: null,
      requestSignature: "c".repeat(64),
      service: "github" as const,
      speakerMember: {
        memberId: fixture.memberAId,
        userId: fixture.memberA,
      },
    };
    const resolveUserDisplayName = vi.fn(async (input: { userId: string }) => ({
      displayName: "Connector owner from Auth",
      ok: true as const,
      userId: input.userId,
    }));
    const coreEnv = {
      OPENMELD_AUTH_WORKER: { resolveUserDisplayName },
      OPENMELD_DB: env.OPENMELD_DB,
    } as unknown as CoreBindings;

    await expect(
      rpcCenterAgentRecordConnectorActionOperation(coreEnv, {
        ...body,
        outcome: "attempted",
      })
    ).resolves.toMatchObject({
      attribution: {
        actorProfileId: centerAgentProfileId,
        onBehalfOf: {
          profileId: representedProfileId,
          userId: fixture.memberA,
        },
      },
      operationId,
      replayed: false,
      status: "pending",
      executionConnection: {
        connectionName: fixture.connectionA,
        ownerDisplayName: "Represented member",
        ownerUserId: fixture.memberA,
        scope: "member",
        service: "github",
      },
    });
    expect(resolveUserDisplayName).not.toHaveBeenCalled();
    const sharedOperationId = `connector-rpc-shared-${crypto.randomUUID()}`;
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(coreEnv, {
        ...body,
        connectionName: sharedConnection,
        operationId: sharedOperationId,
        outcome: "attempted",
      })
    ).resolves.toMatchObject({
      executionConnection: {
        connectionName: sharedConnection,
        ownerDisplayName: "Connector owner from Auth",
        ownerUserId: fixture.ownerA,
        scope: "shared",
        service: "github",
      },
      operationId: sharedOperationId,
    });
    expect(resolveUserDisplayName).toHaveBeenCalledWith({
      userId: fixture.ownerA,
    });
    for (const invalidAuthResult of [
      {
        displayName: "Wrong owner",
        ok: true,
        userId: "different-user",
      },
      { ok: true },
    ]) {
      resolveUserDisplayName.mockResolvedValueOnce(invalidAuthResult as never);
      const rejectedOperationId = `connector-rpc-rejected-${crypto.randomUUID()}`;
      await expect(
        rpcCenterAgentRecordConnectorActionOperation(coreEnv, {
          ...body,
          connectionName: sharedConnection,
          operationId: rejectedOperationId,
          outcome: "attempted",
        })
      ).rejects.toThrow("connector.connection_owner_unavailable");
      await expect(
        env.OPENMELD_DB.prepare(
          `
            SELECT operation_id
            FROM center_agent_connector_action_operations
            WHERE operation_id = ?
          `
        )
          .bind(rejectedOperationId)
          .first()
      ).resolves.toBeNull();
    }
    resolveUserDisplayName.mockRejectedValueOnce(
      new Error("Auth identity storage failed")
    );
    const unrelatedFailureOperationId = `connector-rpc-auth-failure-${crypto.randomUUID()}`;
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(coreEnv, {
        ...body,
        connectionName: sharedConnection,
        operationId: unrelatedFailureOperationId,
        outcome: "attempted",
      })
    ).rejects.toThrow("Auth identity storage failed");
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT operation_id
          FROM center_agent_connector_action_operations
          WHERE operation_id = ?
        `
      )
        .bind(unrelatedFailureOperationId)
        .first()
    ).resolves.toBeNull();

    resolveUserDisplayName.mockRejectedValueOnce(
      new Error(
        'The RPC receiver does not implement the method "resolveUserDisplayName".'
      )
    );
    const missingMethodOperationId = `connector-rpc-auth-skew-${crypto.randomUUID()}`;
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(coreEnv, {
        ...body,
        connectionName: sharedConnection,
        operationId: missingMethodOperationId,
        outcome: "attempted",
      })
    ).rejects.toThrow("connector.connection_owner_unavailable");
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT operation_id
          FROM center_agent_connector_action_operations
          WHERE operation_id = ?
        `
      )
        .bind(missingMethodOperationId)
        .first()
    ).resolves.toBeNull();

    await expect(
      rpcCenterAgentRecordConnectorActionOperation(coreEnv, {
        ...body,
        operationId: `connector-rpc-foreign-${crypto.randomUUID()}`,
        outcome: "attempted",
        speakerMember: {
          memberId: centerAgentMemberId,
          userId: fixture.ownerA,
        },
      })
    ).rejects.toMatchObject({
      code: "center_agent.member_actor_required",
      status: 403,
    });

    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        `
          UPDATE connector_connections
          SET status = 'disconnected', disconnected_at_ms = ?, updated_at_ms = ?
          WHERE connection_name = ?
        `
      ).bind(nowMs + 1, nowMs + 1, fixture.connectionA),
      env.OPENMELD_DB.prepare(
        "DELETE FROM members WHERE id = ? AND organization_id = ?"
      ).bind(fixture.memberAId, fixture.organizationA),
      env.OPENMELD_DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(
        "Changed connector owner",
        fixture.memberA
      ),
    ]);
    await expect(
      rpcCenterAgentReadConnectorActionOperation(coreEnv, body)
    ).rejects.toThrow("center_agent.member_actor_required");
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(coreEnv, {
        ...body,
        outcome: "completed",
        providerExecutionId: "provider-execution-rpc",
      })
    ).rejects.toThrow("center_agent.member_actor_required");
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT provider_execution_id, status
          FROM center_agent_connector_action_operations
          WHERE operation_id = ?
        `
      )
        .bind(operationId)
        .first()
    ).resolves.toEqual({
      provider_execution_id: null,
      status: "pending",
    });
  });

  it("uses the represented user as the only requester for a linked native-delivery action", async () => {
    const fixture = await seedConnectorFixture();
    const centerAgent = await seedDesignatedCenterAgent(fixture);
    const representedProfileId = crypto.randomUUID();
    const submissionId = `submission-${crypto.randomUUID()}`;
    const idempotencyKey = `delivery-${crypto.randomUUID()}`;
    const deliveryId = crypto.randomUUID();
    const operationId = `connector-linked-delivery-${crypto.randomUUID()}`;
    const nowMs = Date.now();
    const gmailConnection = await createConnectorConnectionName({
      organizationId: fixture.organizationA,
      service: "gmail",
      userId: fixture.memberA,
    });
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          created_at, updated_at
        ) VALUES (?, 'Represented member', ?, 'human', 1, 'active', NULL, ?, ?, 'auth_bootstrap', ?, ?)
      `
    )
      .bind(
        representedProfileId,
        `represented-${crypto.randomUUID()}`,
        fixture.memberA,
        fixture.memberA,
        nowMs,
        nowMs
      )
      .run();
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO connector_connections (
          connection_name, organization_id, user_id, service, status,
          created_at_ms, updated_at_ms, disconnected_at_ms
        ) VALUES (?, ?, ?, 'gmail', 'active', ?, ?, NULL)
      `
    )
      .bind(
        gmailConnection,
        fixture.organizationA,
        fixture.memberA,
        nowMs,
        nowMs
      )
      .run();
    const sourceSpaceId = `space-${crypto.randomUUID()}`;
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId: null,
      bindingId: `binding-${crypto.randomUUID()}`,
      db: env.OPENMELD_DB,
      deliveryId,
      dispatchId: `dispatch-${crypto.randomUUID()}`,
      idempotencyKey,
      nowMs,
      onBehalfOfDisplayName: "Represented member",
      onBehalfOfProfileId: representedProfileId,
      onBehalfOfUserId: fixture.memberA,
      organizationId: fixture.organizationA,
      profileId: centerAgent.profileId,
      spaceId: sourceSpaceId,
      status: "submitted",
      triggerMessageId: `message-${crypto.randomUUID()}`,
    });
    await markRemoteAgentNativeDeliveryAck({
      accepted: true,
      db: env.OPENMELD_DB,
      idempotencyKey,
      nowMs: nowMs + 1,
      submissionId,
    });

    const input = {
      actionId: "gmail.fetch_emails",
      connectionName: gmailConnection,
      context: {
        ...centerAgent.context,
        agentControllerConversationId: submissionId,
      },
      operationId,
      outcome: "attempted" as const,
      providerExecutionId: null,
      requestSignature: "d".repeat(64),
      service: "gmail" as const,
      speakerMember: {
        memberId: fixture.memberAId,
        userId: fixture.memberA,
      },
    };

    await expect(
      rpcCenterAgentRecordConnectorActionOperation(connectorCoreEnv(), input)
    ).resolves.toMatchObject({
      attribution: {
        onBehalfOf: {
          profileId: representedProfileId,
          userId: fixture.memberA,
        },
      },
      operationId,
      status: "pending",
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT requester_attribution_key, represented_user_id, source_native_delivery_id
          FROM center_agent_connector_action_operations
          WHERE operation_id = ?
        `
      )
        .bind(operationId)
        .first()
    ).resolves.toEqual({
      represented_user_id: fixture.memberA,
      requester_attribution_key: `user:${fixture.memberA}`,
      source_native_delivery_id: null,
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT source_space_id
          FROM center_agent_audit_journal
          WHERE resource_id = ?
        `
      )
        .bind(`gmail:gmail.fetch_emails:${operationId}`)
        .first()
    ).resolves.toEqual({ source_space_id: sourceSpaceId });
    await expect(
      rpcCenterAgentReadConnectorActionOperation(connectorCoreEnv(), input)
    ).resolves.toMatchObject({
      operation: { operationId, status: "pending" },
    });
  });

  it.each([
    "slack",
    "message_channel",
  ] as const)("does not treat a %s conversation identity as a source Space", async (conversationKind) => {
    const fixture = await seedConnectorFixture();
    const centerAgent = await seedDesignatedCenterAgent(fixture);
    const representedProfileId = crypto.randomUUID();
    const submissionId = `submission-${crypto.randomUUID()}`;
    const idempotencyKey = `delivery-${crypto.randomUUID()}`;
    const deliveryId = crypto.randomUUID();
    const nowMs = Date.now();
    const externalConversationId = `${conversationKind}-${crypto.randomUUID()}`;
    await env.OPENMELD_DB.prepare(
      `
          INSERT INTO openmeld_profiles (
            profile_id, profile_name, profile_handle, profile_kind, is_default,
            status, organization_id, owner_user_id, created_by_user_id, source,
            created_at, updated_at
          ) VALUES (?, 'Represented member', ?, 'human', 1, 'active', NULL, ?, ?, 'auth_bootstrap', ?, ?)
        `
    )
      .bind(
        representedProfileId,
        `represented-${crypto.randomUUID()}`,
        fixture.memberA,
        fixture.memberA,
        nowMs,
        nowMs
      )
      .run();
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId: null,
      bindingId: `binding-${crypto.randomUUID()}`,
      conversationKind,
      db: env.OPENMELD_DB,
      deliveryId,
      dispatchId: `dispatch-${crypto.randomUUID()}`,
      idempotencyKey,
      ...(conversationKind === "slack"
        ? {
            slackChannelId: "C123",
            slackTeamId: "T123",
            slackThreadTs: externalConversationId,
          }
        : {
            messageChannelLocator: {
              appId: "app-123",
              chatId: "chat-123",
              connectionId: "connection-123",
              provider: "lark" as const,
              rootMessageId: externalConversationId,
              tenantKey: "tenant-123",
              threadId: null,
            },
            providerPublicationIdempotencyKey: `publication-${crypto.randomUUID()}`,
          }),
      nowMs,
      onBehalfOfDisplayName: "Represented member",
      onBehalfOfProfileId: representedProfileId,
      onBehalfOfUserId: fixture.memberA,
      organizationId: fixture.organizationA,
      profileId: centerAgent.profileId,
      spaceId: externalConversationId,
      status: "submitted",
      triggerMessageId: `message-${crypto.randomUUID()}`,
    });
    await markRemoteAgentNativeDeliveryAck({
      accepted: true,
      db: env.OPENMELD_DB,
      idempotencyKey,
      nowMs: nowMs + 1,
      submissionId,
    });

    await expect(
      prepareCenterAgentRepresentedMemberRequest(
        connectorCoreEnv(),
        {
          ...centerAgent.context,
          agentControllerConversationId: submissionId,
        },
        {
          memberId: fixture.memberAId,
          userId: fixture.memberA,
        }
      )
    ).resolves.toMatchObject({
      sourceNativeDeliveryId: deliveryId,
      sourceSpaceId: null,
    });
  });

  it("rejects a connector write when the page organization no longer matches the active session", async () => {
    const fixture = await seedConnectorFixture();

    await expect(
      rpcBeginCurrentMemberConnectorAuthorization(connectorCoreEnv(), {
        context: connectorRequestContext({
          organizationId: fixture.organizationA,
          userId: fixture.memberA,
        }),
        expectedOrganizationId: fixture.organizationB,
        service: "github",
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "connector.organization_context_changed",
        status: 409,
      }),
    });
    await expect(
      env.OPENMELD_DB.prepare(
        "SELECT status FROM connector_connections WHERE connection_name = ?"
      )
        .bind(fixture.connectionA)
        .first()
    ).resolves.toMatchObject({ status: "active" });
  });

  it("creates deterministic OpenConnector-safe names without exposing raw ids", async () => {
    const organizationId = "org_12345678-1234-4234-8234-123456789012";
    const userId = "user_12345678-1234-4234-8234-123456789012";
    const first = await createConnectorConnectionName({
      organizationId,
      service: "github",
      userId,
    });
    const second = await createConnectorConnectionName({
      organizationId,
      service: "github",
      userId,
    });

    expect(first).toBe(second);
    expect(first).toMatch(CONNECTOR_CONNECTION_NAME_PATTERN);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(first).not.toContain(organizationId);
    expect(first).not.toContain(userId);
  });

  it("keeps long provider service names within the OpenConnector name limit", async () => {
    const connectionName = await createConnectorConnectionName({
      organizationId: "org_12345678-1234-4234-8234-123456789012",
      service: "cloudflare_browser_rendering",
      userId: "user_12345678-1234-4234-8234-123456789012",
    });

    expect(connectionName.length).toBeLessThanOrEqual(64);
    expect(connectionName).toMatch(OPENCONNECTOR_CONNECTION_NAME_PATTERN);
  });

  it("creates one deterministic shared connection name per organization and service", async () => {
    const organizationId = "org_12345678-1234-4234-8234-123456789012";
    const first = await createSharedConnectorConnectionName({
      organizationId,
      service: "github",
    });
    const second = await createSharedConnectorConnectionName({
      organizationId,
      service: "github",
    });

    expect(first).toBe(second);
    expect(first).toMatch(SHARED_CONNECTOR_CONNECTION_NAME_PATTERN);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(first).not.toContain(organizationId);
  });

  it("selects only active connections registered to the requested organization", async () => {
    const fixture = await seedConnectorFixture();
    const selectedForA = await selectActiveConnectorConnection({
      db: env.OPENMELD_DB,
      organizationId: fixture.organizationA,
      preference: "automatic",
      requesterUserId: fixture.memberA,
      service: "github",
    });
    const selectedForB = await selectActiveConnectorConnection({
      db: env.OPENMELD_DB,
      organizationId: fixture.organizationB,
      preference: "automatic",
      requesterUserId: fixture.ownerB,
      service: "github",
    });

    expect(selectedForA?.connection.organizationId).toBe(fixture.organizationA);
    expect(selectedForA?.connection.connectionName).toBe(fixture.connectionA);
    expect(selectedForB).toBeNull();
  });

  it("resolves requester membership and connection owner identity through their owner boundaries", async () => {
    const fixture = await seedConnectorFixture();
    const centerAgent = await seedDesignatedCenterAgent(fixture);
    const resolveUserDisplayName = vi.fn(async (input: { userId: string }) => ({
      displayName: "Member from Auth",
      ok: true as const,
      userId: input.userId,
    }));
    const coreEnv = {
      OPENMELD_AUTH_WORKER: { resolveUserDisplayName },
      OPENMELD_DB: env.OPENMELD_DB,
    } as unknown as CoreBindings;
    const input = {
      connectionPreference: "requester" as const,
      context: centerAgent.context,
      requesterUserId: fixture.memberA,
      service: "github" as const,
    };

    await expect(
      rpcCenterAgentResolveConnectorConnection(coreEnv, input)
    ).resolves.toMatchObject({
      connection: {
        connectionName: fixture.connectionA,
        ownerDisplayName: "Member from Auth",
        userId: fixture.memberA,
      },
      selection: "requester",
    });
    expect(resolveUserDisplayName).toHaveBeenCalledWith({
      userId: fixture.memberA,
    });

    await env.OPENMELD_DB.prepare(
      "DELETE FROM members WHERE organization_id = ? AND user_id = ?"
    )
      .bind(fixture.organizationA, fixture.memberA)
      .run();

    await expect(
      rpcCenterAgentResolveConnectorConnection(coreEnv, input)
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "connector.requester_org_mismatch",
        status: 403,
      }),
    });
  });

  it("makes registered connections absent from each successful provider inventory ineligible", async () => {
    const fixture = await seedConnectorFixture();
    const availableConnection = await createConnectorConnectionName({
      organizationId: fixture.organizationA,
      service: "github",
      userId: fixture.otherMemberA,
    });
    const unknownConnection = await createConnectorConnectionName({
      organizationId: fixture.organizationA,
      service: "github",
      userId: fixture.ownerA,
    });
    const nowMs = Date.now();
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO connector_connections (
          connection_name, organization_id, user_id, service, status,
          created_at_ms, updated_at_ms, disconnected_at_ms
        ) VALUES (?, ?, ?, 'github', 'pending', ?, ?, NULL)
      `
    )
      .bind(
        availableConnection,
        fixture.organizationA,
        fixture.otherMemberA,
        nowMs,
        nowMs
      )
      .run();
    const context = connectorRequestContext({
      organizationId: fixture.organizationA,
      profileId: fixture.ownerProfileId,
      userId: fixture.ownerA,
    });

    const partialInventory =
      await rpcReconcileCurrentOrganizationConnectorConnections(
        connectorCoreEnv(),
        {
          availableConnectionNames: [availableConnection, unknownConnection],
          context,
          expectedOrganizationId: fixture.organizationA,
          service: "github",
        }
      );

    expect(partialInventory.connections).toHaveLength(2);
    expect(partialInventory.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectionName: fixture.connectionA,
          status: "pending",
        }),
        expect.objectContaining({
          connectionName: availableConnection,
          status: "active",
        }),
      ])
    );

    const emptyInventory =
      await rpcReconcileCurrentOrganizationConnectorConnections(
        connectorCoreEnv(),
        {
          availableConnectionNames: [],
          context,
          expectedOrganizationId: fixture.organizationA,
          service: "github",
        }
      );

    expect(emptyInventory.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectionName: fixture.connectionA,
          status: "pending",
        }),
        expect.objectContaining({
          connectionName: availableConnection,
          status: "pending",
        }),
      ])
    );
  });

  it("never lends a member connection to another organization member", async () => {
    const fixture = await seedConnectorFixture();

    await expect(
      selectActiveConnectorConnection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationA,
        preference: "automatic",
        requesterUserId: fixture.otherMemberA,
        service: "github",
      })
    ).resolves.toBeNull();
  });

  it("uses a shared connection only when the requester has no member connection", async () => {
    const fixture = await seedConnectorFixture();
    const sharedConnection = await seedSharedConnectorConnection(fixture);

    await expect(
      selectActiveConnectorConnection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationA,
        preference: "automatic",
        requesterUserId: fixture.memberA,
        service: "github",
      })
    ).resolves.toMatchObject({
      connection: { connectionName: fixture.connectionA, scope: "member" },
      selection: "requester",
    });
    await expect(
      selectActiveConnectorConnection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationA,
        preference: "automatic",
        requesterUserId: fixture.otherMemberA,
        service: "github",
      })
    ).resolves.toMatchObject({
      connection: { connectionName: sharedConnection, scope: "shared" },
      selection: "shared",
    });
  });

  it("selects exactly the requested GitHub identity without fallback", async () => {
    const fixture = await seedConnectorFixture();
    const sharedConnection = await seedSharedConnectorConnection(fixture);

    await expect(
      selectActiveConnectorConnection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationA,
        preference: "requester",
        requesterUserId: fixture.memberA,
        service: "github",
      })
    ).resolves.toMatchObject({
      connection: { connectionName: fixture.connectionA, scope: "member" },
      selection: "requester",
    });
    await expect(
      selectActiveConnectorConnection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationA,
        preference: "shared",
        requesterUserId: fixture.memberA,
        service: "github",
      })
    ).resolves.toMatchObject({
      connection: { connectionName: sharedConnection, scope: "shared" },
      selection: "shared",
    });
    await expect(
      selectActiveConnectorConnection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationA,
        preference: "requester",
        requesterUserId: fixture.otherMemberA,
        service: "github",
      })
    ).resolves.toBeNull();
    await env.OPENMELD_DB.prepare(
      `
        UPDATE connector_connections
        SET status = 'disconnected',
            disconnected_at_ms = updated_at_ms + 1,
            updated_at_ms = updated_at_ms + 1
        WHERE organization_id = ?
          AND connection_name = ?
      `
    )
      .bind(fixture.organizationA, sharedConnection)
      .run();
    await expect(
      selectActiveConnectorConnection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationA,
        preference: "shared",
        requesterUserId: fixture.memberA,
        service: "github",
      })
    ).resolves.toBeNull();
  });

  it("allows unattended work to resolve only a shared connection", async () => {
    const fixture = await seedConnectorFixture();
    const sharedConnection = await seedSharedConnectorConnection(fixture);

    await expect(
      selectActiveConnectorConnection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationA,
        preference: "automatic",
        requesterUserId: null,
        service: "github",
      })
    ).resolves.toMatchObject({
      connection: { connectionName: sharedConnection, scope: "shared" },
      selection: "shared",
    });
  });

  it("leaves requester membership decisions outside connector storage", async () => {
    const fixture = await seedConnectorFixture();

    await env.OPENMELD_DB.prepare(
      "DELETE FROM members WHERE organization_id = ? AND user_id = ?"
    )
      .bind(fixture.organizationA, fixture.memberA)
      .run();

    await expect(
      selectActiveConnectorConnection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationA,
        preference: "requester",
        requesterUserId: fixture.memberA,
        service: "github",
      })
    ).resolves.toMatchObject({
      connection: { connectionName: fixture.connectionA },
      selection: "requester",
    });
  });

  it("allows disconnect only for the connection owner or an organization owner or admin", async () => {
    const fixture = await seedConnectorFixture();
    const coreEnv = connectorCoreEnv();

    await expect(
      rpcAuthorizeConnectorDisconnect(coreEnv, {
        context: connectorRequestContext({
          organizationId: fixture.organizationA,
          profileId: fixture.ownerProfileId,
          userId: fixture.otherMemberA,
        }),
        expectedOrganizationId: fixture.organizationA,
        service: "github",
        userId: fixture.memberA,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "connector.disconnect_forbidden",
        status: 403,
      }),
    });

    await expect(
      rpcAuthorizeConnectorDisconnect(coreEnv, {
        context: connectorRequestContext({
          organizationId: fixture.organizationA,
          userId: fixture.memberA,
        }),
        expectedOrganizationId: fixture.organizationA,
        service: "github",
        userId: fixture.memberA,
      })
    ).resolves.toMatchObject({
      connectionName: fixture.connectionA,
      userId: fixture.memberA,
    });

    await expect(
      rpcAuthorizeConnectorDisconnect(coreEnv, {
        context: connectorRequestContext({
          organizationId: fixture.organizationA,
          profileId: fixture.ownerProfileId,
          userId: fixture.ownerA,
        }),
        expectedOrganizationId: fixture.organizationA,
        service: "github",
        userId: fixture.memberA,
      })
    ).resolves.toMatchObject({
      connectionName: fixture.connectionA,
      userId: fixture.memberA,
    });
  });

  it("reserves shared app management for organization owners and admins", async () => {
    const fixture = await seedConnectorFixture();
    const coreEnv = connectorCoreEnv();

    await expect(
      rpcBeginCurrentOrganizationSharedConnectorAuthorization(coreEnv, {
        context: connectorRequestContext({
          organizationId: fixture.organizationA,
          profileId: fixture.ownerProfileId,
          userId: fixture.otherMemberA,
        }),
        expectedOrganizationId: fixture.organizationA,
        service: "github",
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "connector.shared.manage_forbidden",
        status: 403,
      }),
    });

    const ownerContext = connectorRequestContext({
      organizationId: fixture.organizationA,
      profileId: fixture.ownerProfileId,
      userId: fixture.ownerA,
    });
    const sharedConnection =
      await rpcBeginCurrentOrganizationSharedConnectorAuthorization(coreEnv, {
        context: ownerContext,
        expectedOrganizationId: fixture.organizationA,
        service: "github",
      });
    expect(sharedConnection).toMatchObject({
      scope: "shared",
      userId: fixture.ownerA,
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT action, actor_profile_id, resource_type
          FROM center_agent_audit_journal
          WHERE organization_id = ?
            AND action = 'start_shared_app_authorization'
          LIMIT 1
        `
      )
        .bind(fixture.organizationA)
        .first()
    ).resolves.toMatchObject({
      action: "start_shared_app_authorization",
      actor_profile_id: fixture.ownerProfileId,
      resource_type: "app_connection",
    });

    await expect(
      rpcCompleteConnectorDisconnect(coreEnv, {
        connectionName: sharedConnection.connectionName,
        context: ownerContext,
        expectedOrganizationId: fixture.organizationA,
        scope: "shared",
        service: "github",
      })
    ).resolves.toMatchObject({
      scope: "shared",
      status: "disconnected",
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT action
          FROM center_agent_audit_journal
          WHERE organization_id = ?
            AND action = 'disconnect_shared_app'
          LIMIT 1
        `
      )
        .bind(fixture.organizationA)
        .first()
    ).resolves.toMatchObject({ action: "disconnect_shared_app" });
  });

  it("rechecks shared app management permission before reading or completing a GitHub App installation", async () => {
    const fixture = await seedConnectorFixture();
    const coreEnv = connectorCoreEnv();
    const ownerContext = connectorRequestContext({
      organizationId: fixture.organizationA,
      profileId: fixture.ownerProfileId,
      userId: fixture.ownerA,
    });
    const installation = await rpcBeginCurrentOrganizationGitHubAppInstallation(
      coreEnv,
      {
        context: ownerContext,
        expectedOrganizationId: fixture.organizationA,
      }
    );
    const verification = await rpcBeginGitHubAppInstallationVerification(
      coreEnv,
      {
        installationId: "987654",
        state: installation.state,
      }
    );
    if (verification.status !== "valid") {
      throw new Error("Expected a valid GitHub App installation state.");
    }

    await env.OPENMELD_DB.prepare(
      "UPDATE members SET role = 'member' WHERE organization_id = ? AND user_id = ?"
    )
      .bind(fixture.organizationA, fixture.ownerA)
      .run();

    await expect(
      rpcReadPendingGitHubAppInstallation(coreEnv, {
        context: ownerContext,
        expectedOrganizationId: fixture.organizationA,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "connector.shared.manage_forbidden",
        status: 403,
      }),
    });
    await expect(
      rpcCompleteGitHubAppInstallation(coreEnv, {
        context: ownerContext,
        expectedOrganizationId: fixture.organizationA,
        installationId: verification.installationId,
        targetConnectionName: verification.targetConnectionName,
        verificationConnectionName: verification.verificationConnectionName,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "connector.shared.manage_forbidden",
        status: 403,
      }),
    });
  });
});

async function seedConnectorFixture() {
  const suffix = crypto.randomUUID();
  const organizationA = `org_connector_a_${suffix}`;
  const organizationB = `org_connector_b_${suffix}`;
  const ownerA = `user_connector_owner_a_${suffix}`;
  const memberA = `user_connector_member_a_${suffix}`;
  const memberAId = `member_connector_member_a_${suffix}`;
  const otherMemberA = `user_connector_other_a_${suffix}`;
  const ownerB = `user_connector_owner_b_${suffix}`;
  const ownerProfileId = crypto.randomUUID();
  const nowMs = Date.now();
  const users = [ownerA, memberA, otherMemberA, ownerB];
  for (const userId of users) {
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `
    )
      .bind(userId, userId, `${userId}@example.com`, nowMs, nowMs)
      .run();
  }
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
    ).bind(organizationA, "Connector A", `connector-a-${suffix}`, nowMs),
    env.OPENMELD_DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
    ).bind(organizationB, "Connector B", `connector-b-${suffix}`, nowMs),
  ]);
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO openmeld_profiles (
        profile_id, profile_name, profile_handle, profile_kind, is_default,
        status, organization_id, owner_user_id, created_by_user_id, source,
        created_at, updated_at
      ) VALUES (?, 'Connector owner', ?, 'human', 1, 'active', NULL, ?, ?, 'auth_bootstrap', ?, ?)
    `
  )
    .bind(
      ownerProfileId,
      `connector-owner-${suffix}`,
      ownerA,
      ownerA,
      nowMs,
      nowMs
    )
    .run();
  await env.OPENMELD_DB.batch([
    memberStatement({
      id: `member_connector_owner_a_${suffix}`,
      organizationId: organizationA,
      role: "owner",
      userId: ownerA,
    }),
    memberStatement({
      id: memberAId,
      organizationId: organizationA,
      role: "member",
      userId: memberA,
    }),
    memberStatement({
      id: `member_connector_other_a_${suffix}`,
      organizationId: organizationA,
      role: "member",
      userId: otherMemberA,
    }),
    memberStatement({
      id: `member_connector_owner_b_${suffix}`,
      organizationId: organizationB,
      role: "owner",
      userId: ownerB,
    }),
  ]);
  const connectionA = await createConnectorConnectionName({
    organizationId: organizationA,
    service: "github",
    userId: memberA,
  });
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO connector_connections (
        connection_name, organization_id, user_id, service, status,
        created_at_ms, updated_at_ms, disconnected_at_ms
      ) VALUES (?, ?, ?, 'github', 'active', ?, ?, NULL)
    `
  )
    .bind(connectionA, organizationA, memberA, nowMs, nowMs)
    .run();
  return {
    connectionA,
    memberA,
    memberAId,
    organizationA,
    organizationB,
    otherMemberA,
    ownerA,
    ownerB,
    ownerProfileId,
  };
}

async function seedSharedConnectorConnection(
  fixture: Awaited<ReturnType<typeof seedConnectorFixture>>,
  service: Parameters<
    typeof createSharedConnectorConnectionName
  >[0]["service"] = "github"
) {
  const connectionName = await createSharedConnectorConnectionName({
    organizationId: fixture.organizationA,
    service,
  });
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO connector_connections (
        connection_name, organization_id, user_id, scope, service, status,
        created_at_ms, updated_at_ms, disconnected_at_ms
      ) VALUES (?, ?, ?, 'shared', ?, 'active', ?, ?, NULL)
    `
  )
    .bind(
      connectionName,
      fixture.organizationA,
      fixture.ownerA,
      service,
      Date.now(),
      Date.now()
    )
    .run();
  return connectionName;
}

async function seedDesignatedCenterAgent(
  fixture: Awaited<ReturnType<typeof seedConnectorFixture>>
) {
  const profileId = `agt_${crypto.randomUUID()}`;
  const nowMs = Date.now();
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES (?, 'Center Agent', ?, 'agent', 0, 'active', ?, NULL, ?, 'auth_bootstrap', 'center_agent', ?, ?)
      `
    ).bind(
      profileId,
      `center-agent-${crypto.randomUUID()}`,
      fixture.organizationA,
      fixture.ownerA,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO center_agent_designations (
          organization_id, agent_profile_id, duty, designated_by, created_at
        ) VALUES (?, ?, NULL, ?, ?)
      `
    ).bind(fixture.organizationA, profileId, fixture.ownerA, nowMs),
  ]);
  return {
    context: {
      activeOrganizationId: fixture.organizationA,
      actorContext: {
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        callerPrincipalId: profileId,
        profileKind: "agent" as const,
        requestId: `req-${crypto.randomUUID()}`,
        openMeldProfileId: profileId,
      },
    },
    profileId,
  };
}

function connectorCoreEnv(): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: {
      resolveUserDisplayName: async (input: { userId: string }) => {
        const row = await env.OPENMELD_DB.prepare(
          `
            SELECT id, name, email
            FROM users
            WHERE id = ?
            LIMIT 1
          `
        )
          .bind(input.userId)
          .first<{ email: string; id: string; name: string | null }>();
        const displayName = row?.name?.trim() || row?.email.trim();
        return row?.id === input.userId && displayName
          ? { displayName, ok: true as const, userId: row.id }
          : {
              code: "user_not_found",
              message: "User identity was not found.",
              ok: false as const,
            };
      },
    },
    OPENMELD_DB: env.OPENMELD_DB,
  } as unknown as CoreBindings;
}

function memberStatement(input: {
  id: string;
  organizationId: string;
  role: string;
  userId: string;
}): D1PreparedStatement {
  return env.OPENMELD_DB.prepare(
    `
      INSERT INTO members (id, organization_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).bind(input.id, input.organizationId, input.userId, input.role, Date.now());
}

function connectorRequestContext(input: {
  organizationId: string;
  profileId?: string;
  userId: string;
}) {
  return {
    activeOrganizationId: input.organizationId,
    actorContext: {
      callerPrincipalId: input.userId,
      ownerUserId: input.userId,
      profileKind: "human" as const,
      requestId: `req-${input.userId}`,
      openMeldProfileId:
        input.profileId ?? "11111111-1111-4111-8111-111111111111",
    },
  };
}
