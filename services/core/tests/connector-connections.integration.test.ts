import { runInDurableObject } from "cloudflare:test";
import type { QueryResult } from "@openmeld/db/postgresql";
import {
  getPostgresDatabase,
  PostgresDatabase,
  type QueryConfig,
} from "@openmeld/db/postgresql";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
} from "@openmeld/schemas";
import type {
  AuthRpcResolveProfileByIdResult,
  PluginActionRpcInput,
  PluginRuntimeRequest,
  PluginRuntimeResponse,
} from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequestV2,
} from "../../remote-agent/tests/fixtures";
import capturedActions from "../../remote-agent/tests/fixtures/openconnector-runtime-actions.json";
import {
  activateAgentDelegationChildren,
  createAgentDelegation,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-delegation-repo";
import { prepareDelegatedPluginActions } from "../src/center-agent/application/delegated-plugin-authorization";
import { prepareCenterAgentRepresentedMemberRequest } from "../src/center-agent/application/represented-member-request";
import { recordCenterAgentConnectorActionOperation } from "../src/center-agent/connector-action-operation-repository";
import { prepareCenterAgentWakePublicationRecord } from "../src/center-agent/infrastructure/postgresql/center-agent-wake-publication-repo";
import {
  createConnectorConnectionName,
  createSharedConnectorConnectionName,
  selectActiveConnectorConnection,
} from "../src/connectors/connector-connection-repository";
import {
  requirePluginPermission,
  requireRemotePluginConnection,
  updatePluginAccess,
} from "../src/connectors/plugin-access";
import {
  rpcListPluginAccess,
  rpcUpdatePluginAccess,
} from "../src/connectors/plugin-access-rpc";
import { rpcPluginActionRequest } from "../src/connectors/plugin-action-requests";
import { rpcPluginAction } from "../src/connectors/plugin-actions";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { rpcGetInboxItem } from "../src/inbox/transport/rpc/inbox-rpc";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcResolveProjectIssueAction } from "../src/projects/project-rpc";
import { authorizeRemoteAgentExecutionAccess } from "../src/remote-agent/application/remote-agent-execution-access";
import {
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  rpcAuthorizeConnectorDisconnect,
  rpcBeginCurrentMemberConnectorAuthorization,
  rpcBeginCurrentOrganizationGitHubAppInstallation,
  rpcBeginCurrentOrganizationSharedConnectorAuthorization,
  rpcBeginGitHubAppInstallationVerification,
  rpcCenterAgentListConnectorServices,
  rpcCenterAgentReadConnectorActionOperation,
  rpcCenterAgentRecordConnectorActionAudit,
  rpcCenterAgentRecordConnectorActionOperation,
  rpcCenterAgentResolveConnectorConnection,
  rpcCompleteConnectorDisconnect,
  rpcCompleteGitHubAppInstallation,
  rpcListCenterAgentAuditJournal,
  rpcReadPendingGitHubAppInstallation,
  rpcReconcileCurrentOrganizationConnectorConnections,
} from "../src/rpc/methods";
import { issueRuntimeCoordinatorExecutionToken } from "../src/runtime-transport/application/runtime-coordinator-execution-token";
import { writeRuntimeCoordinatorTokenAuthorityToStorage } from "../src/runtime-transport/application/runtime-coordinator-storage";
import type { RuntimeTransportHub } from "../src/runtime-transport/transport/do/runtime-transport-hub";
import { deleteConversationHistoryForUser } from "../src/space/application/conversation-history";
import { upsertSpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import type { Space } from "../src/space/transport/do/space";
import { observePostgresDatabase } from "../test-support/postgresql-query.test-support";
import { env } from "../test-support/worker-env";

const CONNECTOR_CONNECTION_NAME_PATTERN =
  /^org_[A-Za-z0-9_-]{18}__user_[A-Za-z0-9_-]{18}__github$/u;

describe("Local Plugin human request authority", () => {
  it("distinguishes proposed dashboard names without disclosing bodies or secrets", async () => {
    const f = await seedHumanPluginRequestFixture();
    const captured = capturedActions.data[1];
    if (!captured) {
      throw new Error("Missing captured dashboard action");
    }
    const metadata = { ...captured, effect: "write" as const };
    f.runtime.mockImplementation(async () => ({
      status: "catalog",
      actions: [metadata] as (typeof f.metadata)[],
    }));
    const views: { label: string; value: string }[][] = [];
    for (const name of ["Intended dashboard", "Unrequested dashboard"]) {
      f.input.request.action = {
        ...f.action,
        actionId: metadata.id,
        operationId: name,
        input: { name, body: "private-body-canary", token: "secret-canary" },
      };
      const request = await f.pending();
      expect(request.targets).toEqual([
        { label: "Dashboard name", value: name },
      ]);
      expect(JSON.stringify(request)).not.toContain("private-body-canary");
      expect(JSON.stringify(request)).not.toContain("secret-canary");
      views.push(request.targets);
    }
    expect(views[0]).not.toEqual(views[1]);
    expect(f.executions()).toHaveLength(0);
  });

  it("requires the owner account principal and executes two independently approved manual requests", async () => {
    const f = await seedHumanPluginRequestFixture();
    const first = await f.pending();
    expect(f.executions()).toHaveLength(0);
    for (const callerPrincipalId of [undefined, "delegated-agent-principal"]) {
      await expect(
        rpcPluginActionRequest(f.core, {
          ...f.command(first.requestId),
          context: {
            ...f.command(first.requestId).context,
            actorContext: {
              ...f.command(first.requestId).context.actorContext,
              callerPrincipalId,
            },
          },
          command: { operation: "approve", requestId: first.requestId },
        })
      ).rejects.toThrow();
    }
    await expect(
      rpcPluginActionRequest(f.core, {
        ...f.command(first.requestId),
        context: f.input.context,
        command: {
          operation: "approve",
          requestId: first.requestId,
        },
      })
    ).rejects.toThrow();
    const approved = await Promise.all([
      f.decide(first.requestId, "approve"),
      f.decide(first.requestId, "approve"),
    ]);
    expect(approved.map((request) => request.requestId)).toEqual([
      first.requestId,
      first.requestId,
    ]);
    expect((await f.decide(first.requestId, "approve")).state).toBe("approved");
    await Promise.all([
      rpcPluginAction(f.core, f.input),
      rpcPluginAction(f.core, f.input),
    ]);
    expect(f.executions()).toHaveLength(1);
    f.input.request.action = {
      ...f.action,
      operationId: "explicit-second-request",
    };
    const second = await f.pending();
    expect(second.requestId).not.toBe(first.requestId);
    expect(f.executions()).toHaveLength(1);
    await f.decide(second.requestId, "approve");
    await rpcPluginAction(f.core, f.input);
    expect(f.executions()).toHaveLength(2);
    const rows = await getPostgresDatabase(env).query<{ state: string }>({
      text: 'SELECT state FROM "openmeld"."plugin_action_requests" WHERE organization_id = $1',
      values: [f.organizationA],
    });
    expect(rows.rows.map((row) => row.state)).toEqual(["approved", "approved"]);
  });

  it("retains old unknown results while omitted dispatch, new IDs, and cold clients cannot issue replacement writes", async () => {
    const f = await seedHumanPluginRequestFixture();
    f.runtime.mockImplementation(async (request) =>
      request.operation === "list"
        ? { status: "catalog", actions: [f.metadata] }
        : {
            status: "outcome_unknown",
            providerExecutionId: null,
            error: "Synthetic lost provider response",
          }
    );
    const original = await f.pending();
    await f.decide(original.requestId, "approve");
    await rpcPluginAction(f.core, f.input);
    expect(f.executions()).toHaveLength(1);
    // A retained pre-contract unknown has no request/root record. Do not
    // fabricate a backfill from its irreversible signature.
    await getPostgresDatabase(env).query({
      text: 'DELETE FROM "openmeld"."plugin_action_requests" WHERE id = $1',
      values: [original.requestId],
    });
    for (const label of [
      "resume",
      "fork",
      "cold-start",
      "child-without-dispatch",
    ]) {
      const reply = await rpcPluginAction(
        { ...f.core },
        {
          ...f.input,
          request: {
            includeRecoveryReceipt: true,
            includeRequestAuthorization: true,
            action: { ...f.action, operationId: label },
          },
        }
      );
      expect(reply.kind).toBe("authorization_required");
    }
    const receipt = await rpcPluginAction(f.core, {
      ...f.input,
      request: { ...f.input.request, action: { ...f.action, replay: true } },
    });
    expect(receipt).toMatchObject({
      kind: "execution",
      status: "outcome_unknown",
      replay: { allowed: false },
    });
    expect(f.executions()).toHaveLength(1);
    expect(
      (
        await getPostgresDatabase(env)
          .query<{ status: string }>({
            text: 'SELECT status FROM "openmeld"."center_agent_connector_action_operations" WHERE organization_id = $1',
            values: [f.organizationA],
          })
          .then((result) => result.rows[0] ?? null)
      )?.status
    ).toBe("outcome_unknown");
  });

  it.each([
    "reject",
    "expire",
    "revoke",
    "input",
    "account",
  ] as const)("refuses %s changes without a provider call", async (mode) => {
    const f = await seedHumanPluginRequestFixture();
    const pending = await f.pending();
    if (mode === "reject") {
      await f.decide(pending.requestId, "reject");
    } else if (mode === "expire") {
      await getPostgresDatabase(env).query({
        text: 'UPDATE "openmeld"."plugin_action_requests" SET expires_at_ms = 1 WHERE id = $1',
        values: [pending.requestId],
      });
    } else if (mode === "revoke") {
      await getPostgresDatabase(env).query({
        text: 'UPDATE "openmeld"."connector_connections" SET access_revision = access_revision + 1 WHERE connection_name = $1',
        values: [f.connection],
      });
    } else {
      await f.decide(pending.requestId, "approve");
      if (mode === "input") {
        f.input.request.action = {
          ...f.action,
          input: { project: "different-target" },
        };
      } else {
        await getPostgresDatabase(env).query({
          text: 'UPDATE "openmeld"."connector_connections" SET updated_at_ms = updated_at_ms + 1 WHERE connection_name = $1',
          values: [f.connection],
        });
      }
    }
    if (mode === "reject" || mode === "expire") {
      expect(await rpcPluginAction(f.core, f.input)).toMatchObject({
        kind: "authorization_required",
        request: { state: mode === "reject" ? "rejected" : "expired" },
      });
    } else {
      await expect(rpcPluginAction(f.core, f.input)).rejects.toThrow();
    }
    expect(f.executions()).toHaveLength(0);
  });

  it("keeps request details and Inbox recipients private and rejects approval after permission changes", async () => {
    const f = await seedHumanPluginRequestFixture();
    f.input.request.action = {
      ...f.action,
      input: {
        project: "synthetic-target",
        secret: "synthetic-private-secret",
      },
    };
    const pending = await f.pending();
    const other = {
      ...f.command(pending.requestId),
      context: {
        ...f.input.context,
        actorContext: {
          ...f.input.context.actorContext,
          ownerUserId: f.otherMemberA,
          callerPrincipalId: f.otherMemberA,
          openMeldProfileId: f.requesterProfileId,
          profileKind: "human" as const,
        },
      },
    };
    await expect(rpcPluginActionRequest(f.core, other)).rejects.toThrow();
    await expect(
      rpcGetInboxItem(f.core, {
        context: other.context,
        itemId: pending.inboxItemId,
      })
    ).rejects.toThrow();
    expect(
      (
        await rpcGetInboxItem(f.core, {
          context: f.command(pending.requestId).context,
          itemId: pending.inboxItemId,
        })
      ).item.sourceTarget
    ).toEqual({ kind: "plugin_action_request", requestId: pending.requestId });
    const inbox = await getPostgresDatabase(env)
      .query({
        text: 'SELECT recipient_user_id, preview, source_target_json FROM "openmeld"."inbox_items" WHERE id = $1',
        values: [pending.inboxItemId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(inbox).toMatchObject({ recipient_user_id: f.ownerA });
    expect(JSON.stringify(inbox)).not.toContain("synthetic-private-secret");
    expect(JSON.stringify(pending)).not.toContain("synthetic-private-secret");
    await getPostgresDatabase(env).query({
      text: 'UPDATE "openmeld"."connector_connections" SET access_revision = access_revision + 1 WHERE connection_name = $1',
      values: [f.connection],
    });
    await expect(f.decide(pending.requestId, "approve")).rejects.toThrow();
    expect(f.executions()).toHaveLength(0);
  });
});

async function seedHumanPluginRequestFixture(
  effect: "write" | "destructive" = "write"
) {
  const f = await seedLocalPluginFixture(effect, "write");
  f.input.request.includeRequestAuthorization = true;
  f.input.request.includeRecoveryReceipt = true;
  const command = (requestId: string) => ({
    expectedOrganizationId: f.organizationA,
    context: {
      ...f.input.context,
      actorContext: {
        ...f.input.context.actorContext,
        profileKind: "human" as const,
        openMeldProfileId: f.ownerProfileId,
        callerPrincipalId: f.ownerA,
      },
    },
    command: { operation: "read" as const, requestId },
  });
  return {
    ...f,
    command,
    executions: () =>
      f.runtime.mock.calls.filter(
        ([request]) => request.operation === "execute"
      ),
    pending: async () => {
      const reply = await rpcPluginAction(f.core, f.input);
      if (reply.kind !== "authorization_required") {
        throw new Error("Expected a pending request");
      }
      return reply.request;
    },
    decide: (requestId: string, operation: "approve" | "reject") =>
      rpcPluginActionRequest(f.core, {
        ...command(requestId),
        command: { operation, requestId },
      }),
  };
}

async function seedApprovalSpace(
  f: Awaited<ReturnType<typeof seedConnectorFixture>>
) {
  const db = getPostgresDatabase(env);
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const stub = namespace.get(namespace.newUniqueId());
  const spaceId = stub.id.toString();
  const now = Date.now();
  await runInDurableObject(stub, (_instance, state) => {
    upsertSpaceMetaRecord(state.storage.sql, {
      v: 1,
      spaceId,
      organizationId: f.organizationA,
      visibility: "private",
      accessMode: "members_only",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
  });
  await db.query({
    text: `INSERT INTO "openmeld"."space_index_spaces" (space_id, organization_id, organization_visibility, status, source_updated_at_ms, projected_at_ms, projection_event_id)
      VALUES ($1, $2, 'private', 'active', $3, $3, $4)`,
    values: [spaceId, f.organizationA, now, crypto.randomUUID()],
  });
  await db.query({
    text: `INSERT INTO "openmeld"."space_index_memberships" (space_id, profile_id, profile_kind_snapshot, profile_name_snapshot, owner_user_id_snapshot, status, member_source, added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id)
      VALUES ($1, $2, 'human', 'Requester', $3, 'active', 'joined_directly', $4, $4, $4, $5)`,
    values: [spaceId, f.ownerProfileId, f.ownerA, now, crypto.randomUUID()],
  });
  return spaceId;
}

describe("Project issue destination confirmation", () => {
  it.each([
    false,
    true,
  ])("uses the human approval flow for a Local issue (Space source: %s)", async (scoped) => {
    const f = await seedHumanPluginRequestFixture();
    const db = getPostgresDatabase(env);
    const sourceSpaceId = scoped ? await seedApprovalSpace(f) : null;
    if (sourceSpaceId) {
      const dispatchId = crypto.randomUUID();
      const sourceSignalId = crypto.randomUUID();
      const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
      f.core.OPENMELD_SPACES = namespace;
      await runInDurableObject(
        namespace.get(namespace.idFromString(sourceSpaceId)),
        (_instance, state) => {
          insertSignalRecord(state.storage.sql, {
            v: 1,
            id: sourceSignalId,
            spaceId: sourceSpaceId,
            ts: Date.now(),
            type: "signal.text",
            profile: {
              kind: "human",
              profileId: f.ownerProfileId,
              profileName: "Requester",
            },
            data: { text: "Create an issue for this request" },
          });
        }
      );
      await db.query({
        text: `INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger" (idempotency_key, dispatch_id, space_id, source_event_id, source_profile_id, target_profile_id, status, first_seen_at_ms, last_attempt_at_ms, attempt_count)
          VALUES ($1,$1,$2,$3,$4,$5,'accepted',$6,$6,1)`,
        values: [
          dispatchId,
          sourceSpaceId,
          sourceSignalId,
          f.ownerProfileId,
          f.actor,
          Date.now(),
        ],
      });
      f.input.request.dispatchId = dispatchId;
    }
    const connectionName = await seedSharedConnectorConnection(f, "github");
    await getPostgresDatabase(env).query({
      text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1 WHERE connection_name = $2',
      values: [
        JSON.stringify({
          local_agent: "write",
          center_agent: "none",
          remote_agent: "none",
        }),
        connectionName,
      ],
    });
    f.metadata.id = "github.create_issue";
    f.metadata.service = "github";
    const action = {
      ...f.action,
      service: "github" as const,
      actionId: "github.create_issue",
      input: { owner: "acme", repo: "payments", title: "Track a bug" },
    };
    f.input.request.action = action;
    const pending = await f.pending();
    const inbox = createInboxService({ db });
    const scope = {
      organizationId: f.organizationA,
      recipientUserId: f.ownerA,
    };
    expect((await inbox.spaceSummary(scope)).attention).toEqual(
      sourceSpaceId
        ? [
            {
              spaceId: sourceSpaceId,
              unresolvedActionCount: 1,
              unreadUrgentUpdateCount: 0,
            },
          ]
        : []
    );
    expect(f.executions()).toHaveLength(0);
    expect(pending.targets).toEqual(
      expect.arrayContaining([
        { label: "owner", value: "acme" },
        { label: "repo", value: "payments" },
      ])
    );
    await f.decide(pending.requestId, "approve");
    expect((await inbox.spaceSummary(scope)).attention).toEqual([]);
    f.input.request.action = {
      ...action,
      input: { ...action.input, repo: "other" },
    };
    await expect(rpcPluginAction(f.core, f.input)).rejects.toMatchObject({
      code: "plugin.request_changed",
    });
    expect(f.executions()).toHaveLength(0);
    f.input.request.action = action;
    await expect(rpcPluginAction(f.core, f.input)).resolves.toMatchObject({
      kind: "execution",
      status: "completed",
    });
    expect(f.executions()).toHaveLength(1);
  });
  it.each([
    ["github", undefined, false],
    ["linear", undefined, false],
    ["github", "explicit_request", true],
    ["github", "explicit_request", false],
    ["github", undefined, true],
    ["github", "explicit_request", "unverified"],
    ["github", "explicit_request", "other_member"],
    ["github", "explicit_request", "agent_sender"],
    ["github", "explicit_request", "routine"],
    ["github", "explicit_request", "membership_revoked"],
    ["github", "explicit_request", "binding_disabled"],
  ] as const)("admits %s destinations with authority %s and verified request %s", async (service, issueDestinationAuthority, verifiedRequest) => {
    const f = await seedConnectorFixture();
    const center = await seedDesignatedCenterAgent(f);
    const connectionName = await seedSharedConnectorConnection(f, service);
    const db = getPostgresDatabase(env);
    await db.query({
      text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1, access_revision = 1 WHERE connection_name = $2',
      values: [
        JSON.stringify({
          center_agent: "write",
          remote_agent: "none",
          local_agent: "none",
        }),
        connectionName,
      ],
    });
    const member = (
      await db.query<{ id: string }>({
        text: 'SELECT id FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [f.organizationA, f.ownerA],
      })
    ).rows[0];
    if (!member) {
      throw new Error("Missing requester member");
    }
    const sourceSpaceId = await seedApprovalSpace(f);
    const directMessage = service === "linear";
    if (directMessage) {
      await db.query({
        text: 'UPDATE "openmeld"."space_index_spaces" SET space_purpose = $2 WHERE space_id = $1',
        values: [sourceSpaceId, OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE],
      });
    }
    const submissionId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const nowMs = Date.now();
    await upsertRemoteAgentNativeDeliveryRecord({
      db,
      attemptId: null,
      bindingId: crypto.randomUUID(),
      deliveryId: crypto.randomUUID(),
      dispatchId: crypto.randomUUID(),
      idempotencyKey,
      nowMs,
      onBehalfOfDisplayName: "Requester",
      onBehalfOfProfileId: f.ownerProfileId,
      onBehalfOfUserId: f.ownerA,
      organizationId: f.organizationA,
      profileId: center.profileId,
      spaceId: sourceSpaceId,
      status: "submitted",
      triggerMessageId: crypto.randomUUID(),
    });
    if (verifiedRequest) {
      const defaults = createSubmitTurnRequestV2();
      const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db,
        idempotencyKey,
      });
      if (!delivery?.bindingId) {
        throw new Error("Missing issue request delivery");
      }
      await db.query({
        text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
          binding_id, owner_kind, owner_id, agent_profile_id,
          openmeld_service_runtime_id, runtime_kind, hosted_runtime_identity_json,
          agent_controller_ref, binding_state, created_at_ms, updated_at_ms
        ) VALUES ($1, 'organization', $2, $3, $4, 'hosted_center_agent', $5, $6,
          'enabled_primary', $7, $7)`,
        values: [
          delivery.bindingId,
          f.organizationA,
          center.profileId,
          HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
          JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
          HOSTED_CENTER_AGENT_CONTROLLER_REF,
          nowMs,
        ],
      });
      const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
      await runInDurableObject(
        namespace.get(namespace.idFromString(sourceSpaceId)),
        (_instance, state) => {
          const now = new Date(nowMs).toISOString();
          for (const [profileId, kind] of [
            [f.ownerProfileId, "human"],
            [center.profileId, "agent"],
          ] as const) {
            upsertSpaceMemberRecord(state.storage.sql, {
              spaceId: sourceSpaceId,
              profileId,
              profileKindSnapshot: kind,
              profileNameSnapshot: kind,
              ownerUserIdSnapshot: kind === "human" ? f.ownerA : null,
              ownerNameSnapshot: null,
              controllerRefSnapshot:
                kind === "agent" ? HOSTED_CENTER_AGENT_CONTROLLER_REF : null,
              status: "active",
              memberSource: "joined_directly",
              addedAt: now,
              removedAt: null,
              addedByProfileId: null,
              addedByOwnerUserId: null,
              addedByDisplayNameSnapshot: null,
              removedByProfileId: null,
              removedByOwnerUserId: null,
              removalReason: null,
              firstEnteredAt: now,
              lastEnteredAt: now,
              createdAt: now,
              updatedAt: now,
            });
          }
          insertSignalRecord(state.storage.sql, {
            v: 1,
            id: delivery.triggerMessageId,
            spaceId: sourceSpaceId,
            ts: nowMs,
            type: "signal.text",
            profile: {
              kind: "human",
              profileId: f.ownerProfileId,
              profileName: "Requester",
            },
            data: {
              text: issueDestinationAuthority
                ? "Create an issue in acme/payments"
                : "Track this issue",
            },
          });
        }
      );
      await persistRemoteAgentWorkerSubmitRequest({
        db,
        idempotencyKey,
        nowMs,
        workerSubmitRequest: createSubmitTurnRequestV2({
          organizationId: f.organizationA,
          agentProfileId: center.profileId,
          spaceId: sourceSpaceId,
          idempotencyKey,
          bindingId: delivery.bindingId,
          dispatchId: delivery.dispatchId,
          triggerMessageId: delivery.triggerMessageId,
          author: {
            profileId: f.ownerProfileId,
            profileKind: "human",
            displayName: "Requester",
          },
          turnEnvelope: {
            ...defaults.turnEnvelope,
            organization: {
              ...defaults.turnEnvelope.organization,
              id: f.organizationA,
            },
            space: { ...defaults.turnEnvelope.space, id: sourceSpaceId },
            ...(verifiedRequest === "routine"
              ? {
                  trigger: createRoutineTurnEnvelope({
                    destination: { kind: "space", spaceId: sourceSpaceId },
                  }).trigger,
                }
              : {}),
            sender:
              verifiedRequest === "routine"
                ? {
                    kind: "routine",
                    routineId: "routine_1",
                    createdByUserId: f.ownerA,
                    delegatedBy: {
                      id: member.id,
                      verified: true,
                      profileId: f.ownerProfileId,
                      ownerUserId: f.ownerA,
                      displayName: "Requester",
                      role: "owner",
                    },
                  }
                : {
                    kind:
                      verifiedRequest === "agent_sender"
                        ? "agent_profile"
                        : "member",
                    id:
                      verifiedRequest === "other_member"
                        ? crypto.randomUUID()
                        : member.id,
                    verified: verifiedRequest !== "unverified",
                    profileId: f.ownerProfileId,
                    ownerUserId: f.ownerA,
                    displayName: "Requester",
                    role: "owner",
                  },
          },
        }),
      });
    }
    await markRemoteAgentNativeDeliveryAck({
      db,
      idempotencyKey,
      nowMs,
      accepted: true,
      submissionId,
    });
    const issueDestination =
      service === "github"
        ? { provider: "github" as const, owner: "acme", repo: "payments" }
        : {
            provider: "linear" as const,
            teamId: "a86813e7-c458-4af2-8cfa-73a796d81201",
            projectId: "ef7c6509-3077-4d49-999e-0ee1c41eaef1",
          };
    const proposal = {
      actionId:
        service === "github"
          ? "github.create_issue"
          : "linear.create_linear_issue",
      service,
      connectionName,
      context: {
        ...center.context,
        agentControllerConversationId: submissionId,
      },
      effect: "write" as const,
      operationId: crypto.randomUUID(),
      includeExecutionPermit: true as const,
      outcome: "attempted" as const,
      providerExecutionId: null,
      requestSignature: "a".repeat(64),
      speakerMember: { memberId: member.id, userId: f.ownerA },
      issueDestinationAuthority,
    };
    const core = connectorCoreEnv();
    core.OPENMELD_SPACES = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, proposal)
    ).rejects.toMatchObject({ code: "project.issue_target_required" });
    if (
      verifiedRequest === "membership_revoked" ||
      verifiedRequest === "binding_disabled"
    ) {
      await expect(
        authorizeRemoteAgentExecutionAccess(core, {
          context: proposal.context,
          submissionId,
          effect: "write",
        })
      ).resolves.toMatchObject({ submissionId });
      if (verifiedRequest === "membership_revoked") {
        const namespace = core.OPENMELD_SPACES;
        await runInDurableObject(
          namespace.get(namespace.idFromString(sourceSpaceId)),
          (_instance, state) => {
            state.storage.sql.exec(
              "UPDATE space_members SET status = 'removed', removed_at = ? WHERE profile_id = ?",
              Date.now(),
              f.ownerProfileId
            );
          }
        );
      } else {
        await db.query({
          text: `UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET binding_state = 'disabled_historical', disabled_at_ms = $1 WHERE agent_profile_id = $2`,
          values: [Date.now(), center.profileId],
        });
      }
      const reason =
        verifiedRequest === "membership_revoked"
          ? "remote_agent.space_membership_revoked"
          : "remote_agent.execution_binding_changed";
      await expect(
        rpcResolveProjectIssueAction(core, {
          context: proposal.context,
          proposedDestination: issueDestination,
        })
      ).rejects.toThrow(reason);
      await expect(
        rpcCenterAgentRecordConnectorActionOperation(core, {
          ...proposal,
          issueDestination,
        })
      ).rejects.toThrow(reason);
      for (const query of [
        {
          text: 'SELECT id FROM "openmeld"."center_agent_connector_action_operations" WHERE operation_id = $1',
          values: [proposal.operationId],
        },
        {
          text: 'SELECT id FROM "openmeld"."center_agent_audit_journal" WHERE resource_id = $1',
          values: [`github:github.create_issue:${proposal.operationId}`],
        },
        {
          text: 'SELECT id FROM "openmeld"."plugin_action_requests" WHERE operation_id = $1',
          values: [proposal.operationId],
        },
      ]) {
        expect((await db.query(query)).rows).toEqual([]);
      }
      return;
    }
    if (verifiedRequest === true && issueDestinationAuthority) {
      await expect(
        rpcCenterAgentRecordConnectorActionOperation(core, {
          ...proposal,
          issueDestination,
        })
      ).resolves.toMatchObject({
        executionAllowed: true,
        status: "pending",
        replayed: false,
      });
      expect(
        (
          await db.query({
            text: 'SELECT id FROM "openmeld"."plugin_action_requests" WHERE operation_id = $1',
            values: [proposal.operationId],
          })
        ).rows
      ).toEqual([]);
      await expect(
        rpcCenterAgentRecordConnectorActionOperation(core, {
          ...proposal,
          issueDestination,
          requestSignature: "b".repeat(64),
        })
      ).rejects.toThrow();
      const racedProposal = {
        ...proposal,
        issueDestination,
        operationId: crypto.randomUUID(),
        requestSignature: "c".repeat(64),
      };
      const transaction = PostgresDatabase.prototype.transaction;
      const concurrentRequest = vi
        .spyOn(PostgresDatabase.prototype, "transaction")
        .mockImplementationOnce(async (callback) => {
          await expect(
            rpcCenterAgentRecordConnectorActionOperation(core, {
              ...racedProposal,
              issueDestinationAuthority: undefined,
            })
          ).rejects.toMatchObject({
            code: "project.issue_confirmation_required",
          });
          return transaction.call(db, callback);
        });
      try {
        await expect(
          rpcCenterAgentRecordConnectorActionOperation(core, racedProposal)
        ).rejects.toThrow();
      } finally {
        concurrentRequest.mockRestore();
      }
      expect(
        (
          await db.query({
            text: 'SELECT id FROM "openmeld"."center_agent_connector_action_operations" WHERE operation_id = $1',
            values: [racedProposal.operationId],
          })
        ).rows
      ).toEqual([]);
      expect(
        (
          await db.query({
            text: 'SELECT id FROM "openmeld"."center_agent_audit_journal" WHERE resource_id = $1',
            values: [`github:github.create_issue:${racedProposal.operationId}`],
          })
        ).rows
      ).toEqual([]);
      await db.query({
        text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1 WHERE connection_name = $2',
        values: [
          JSON.stringify({
            center_agent: "read",
            remote_agent: "none",
            local_agent: "none",
          }),
          connectionName,
        ],
      });
      await expect(
        rpcCenterAgentRecordConnectorActionOperation(core, {
          ...proposal,
          issueDestination,
          operationId: crypto.randomUUID(),
        })
      ).rejects.toMatchObject({ code: "plugin.action_forbidden" });
      return;
    }
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, {
        ...proposal,
        issueDestination,
      })
    ).rejects.toMatchObject({ code: "project.issue_confirmation_required" });
    if (verifiedRequest) {
      await expect(
        rpcCenterAgentRecordConnectorActionOperation(core, {
          ...proposal,
          issueDestination,
          issueDestinationAuthority: "explicit_request",
          requestSignature: "b".repeat(64),
        })
      ).rejects.toMatchObject({ code: "plugin.request_changed" });
    }
    // A retry before approval must recover the same recipient-owned request.
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, {
        ...proposal,
        issueDestination,
      })
    ).rejects.toMatchObject({ code: "project.issue_confirmation_required" });
    expect(
      (
        await db.query({
          text: 'SELECT id FROM "openmeld"."plugin_action_requests" WHERE operation_id = $1',
          values: [proposal.operationId],
        })
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await db.query({
          text: 'SELECT id FROM "openmeld"."center_agent_connector_action_operations" WHERE operation_id = $1',
          values: [proposal.operationId],
        })
      ).rows
    ).toEqual([]);
    const requestId = (
      await db.query<{ id: string }>({
        text: 'SELECT id FROM "openmeld"."plugin_action_requests" WHERE operation_id = $1',
        values: [proposal.operationId],
      })
    ).rows[0]?.id;
    if (!requestId) {
      throw new Error("Missing issue confirmation request");
    }
    const inbox = createInboxService({ db });
    const scope = {
      organizationId: f.organizationA,
      recipientUserId: f.ownerA,
    };
    const expectedAttention = [
      {
        spaceId: sourceSpaceId,
        unresolvedActionCount: 1,
        unreadUrgentUpdateCount: 0,
      },
    ];
    expect((await inbox.spaceSummary(scope)).attention).toEqual(
      expectedAttention
    );
    expect((await inbox.spaceSummary(scope)).chatUnresolvedActionCount).toBe(
      directMessage ? 1 : 0
    );
    expect(
      (await inbox.spaceSummary({ ...scope, recipientUserId: f.memberA }))
        .attention
    ).toEqual([]);
    const requestItem = (
      await inbox.list({ ...scope, view: "needs_action" })
    ).items.find((item) => item.sourceTarget.kind === "plugin_action_request");
    if (!requestItem) {
      throw new Error("Missing Plugin request Inbox item");
    }
    // Older strict receivers still get the same request target. Space association
    // is consumed by the shared summary, not a second navigation destination.
    expect(requestItem.sourceTarget).toEqual({
      kind: "plugin_action_request",
      requestId,
    });
    await inbox.markRead({ ...scope, itemId: requestItem.id, read: true });
    expect((await inbox.spaceSummary(scope)).attention).toEqual(
      expectedAttention
    );
    await db.query({
      text: 'UPDATE "openmeld"."space_index_memberships" SET status = \'removed\' WHERE space_id = $1 AND profile_id = $2',
      values: [sourceSpaceId, f.ownerProfileId],
    });
    expect((await inbox.spaceSummary(scope)).attention).toEqual([]);
    expect((await inbox.spaceSummary(scope)).chatUnresolvedActionCount).toBe(0);
    // Losing access to the conversation must not remove a recipient-owned
    // approval from Inbox. Delegated child Spaces need not contain the Human.
    expect(
      (await inbox.list({ ...scope, view: "needs_action" })).items.map(
        (item) => item.id
      )
    ).toContain(requestItem.id);
    await db.query({
      text: 'UPDATE "openmeld"."space_index_memberships" SET status = \'active\' WHERE space_id = $1 AND profile_id = $2',
      values: [sourceSpaceId, f.ownerProfileId],
    });
    expect((await inbox.spaceSummary(scope)).attention).toEqual(
      expectedAttention
    );
    await deleteConversationHistoryForUser(db, {
      spaceId: sourceSpaceId,
      userId: f.ownerA,
      throughPosition: 0,
      deletedAt: Date.now(),
    });
    expect((await inbox.spaceSummary(scope)).attention).toEqual([]);
    expect((await inbox.spaceSummary(scope)).chatUnresolvedActionCount).toBe(0);
    expect(
      (await inbox.list({ ...scope, view: "needs_action" })).items.map(
        (item) => item.id
      )
    ).toContain(requestItem.id);
    const confirmation = {
      expectedOrganizationId: f.organizationA,
      context: connectorRequestContext({
        organizationId: f.organizationA,
        userId: f.ownerA,
        profileId: f.ownerProfileId,
      }),
      command: { operation: "approve" as const, requestId },
    };
    await expect(
      rpcPluginActionRequest(core, {
        ...confirmation,
        context: connectorRequestContext({
          organizationId: f.organizationA,
          userId: f.memberA,
        }),
      })
    ).rejects.toMatchObject({ code: "plugin.request_not_found" });
    const approved = await rpcPluginActionRequest(core, confirmation);
    expect(approved.state).toBe("approved");
    expect((await inbox.spaceSummary(scope)).attention).toEqual([]);
    expect(approved.targets).toEqual(
      expect.arrayContaining(
        issueDestination.provider === "github"
          ? [
              { label: "owner", value: "acme" },
              { label: "repo", value: "payments" },
            ]
          : [
              { label: "teamId", value: issueDestination.teamId },
              { label: "projectId", value: issueDestination.projectId },
            ]
      )
    );
    const changed =
      issueDestination.provider === "github"
        ? {
            ...issueDestination,
            provider: "github" as const,
            owner: "acme",
            repo: "other",
          }
        : {
            ...issueDestination,
            provider: "linear" as const,
            teamId: "a86813e7-c458-4af2-8cfa-73a796d81201",
            projectId: "8220185c-3f49-4a8f-8d02-96b190fdd205",
          };
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, {
        ...proposal,
        issueDestination: changed,
      })
    ).rejects.toMatchObject({ code: "plugin.request_changed" });
    expect(
      (
        await db.query({
          text: 'SELECT id FROM "openmeld"."center_agent_connector_action_operations" WHERE operation_id = $1',
          values: [proposal.operationId],
        })
      ).rows
    ).toEqual([]);
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, {
        ...proposal,
        issueDestination,
      })
    ).resolves.toMatchObject({
      executionAllowed: true,
      status: "pending",
      replayed: false,
    });
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, {
        ...proposal,
        issueDestination,
        effect: "read",
      })
    ).rejects.toMatchObject({ code: "project.issue_target_required" });
    await rpcCenterAgentRecordConnectorActionOperation(core, {
      ...proposal,
      outcome: "completed",
      providerExecutionId: "confirmed-provider-effect",
    });
    // Earlier accepted receipts may predate stored connection generations.
    // Reading their terminal result must not require a new target approval.
    await db.query({
      text: 'UPDATE "openmeld"."center_agent_connector_action_operations" SET connection_updated_at_ms = NULL WHERE operation_id = $1',
      values: [proposal.operationId],
    });
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, proposal)
    ).resolves.toMatchObject({
      status: "completed",
      executionAllowed: false,
      providerExecutionId: "confirmed-provider-effect",
    });
    for (const state of ["rejected", "expired"] as const) {
      const terminalProposal = {
        ...proposal,
        issueDestination,
        operationId: crypto.randomUUID(),
      };
      await expect(
        rpcCenterAgentRecordConnectorActionOperation(core, terminalProposal)
      ).rejects.toMatchObject({ code: "project.issue_confirmation_required" });
      const terminalId = (
        await db.query<{ id: string }>({
          text: 'SELECT id FROM "openmeld"."plugin_action_requests" WHERE operation_id = $1',
          values: [terminalProposal.operationId],
        })
      ).rows[0]?.id;
      if (!terminalId) {
        throw new Error("Missing terminal confirmation fixture");
      }
      if (state === "rejected") {
        await rpcPluginActionRequest(core, {
          ...confirmation,
          command: { operation: "reject", requestId: terminalId },
        });
      } else {
        await db.query({
          text: 'UPDATE "openmeld"."plugin_action_requests" SET expires_at_ms = $1 WHERE id = $2',
          values: [Date.now() - 1, terminalId],
        });
      }
      await expect(
        rpcCenterAgentRecordConnectorActionOperation(core, terminalProposal)
      ).rejects.toMatchObject({
        code: "project.issue_confirmation_unavailable",
      });
    }
  });
});

describe("Local Agent plugin admission", () => {
  it("fences a Project issue default change in the connector operation claim", async () => {
    const fixture = await seedConnectorFixture();
    const projectId = `project_${crypto.randomUUID()}`;
    const destination = {
      provider: "github" as const,
      owner: "acme",
      repo: "payments",
    };
    await getPostgresDatabase(env).query({
      text: `INSERT INTO "openmeld"."projects" (
        id, organization_id, name, slug, repository_fingerprint,
        created_by_user_id, created_at_ms, updated_at_ms, archived_at_ms,
        issue_destination_json, issue_destination_revision
      ) VALUES ($1, $2, 'Payments', $3, NULL, $4, 1, 1, NULL, $5, 1)`,
      values: [
        projectId,
        fixture.organizationA,
        `payments-${crypto.randomUUID()}`,
        fixture.ownerA,
        JSON.stringify(destination),
      ],
    });
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
      db: getPostgresDatabase(env),
      executionConnection: {
        connectionName: fixture.connectionA,
        ownerDisplayName: fixture.memberA,
        ownerUserId: fixture.memberA,
        scope: "member" as const,
        service: "github",
      },
      issueRoutingDecision: { projectId, revision: 1, destination },
      organizationId: fixture.organizationA,
      outcome: "attempted" as const,
      providerExecutionId: null,
      requester: {
        kind: "represented_member" as const,
        representedUserId: fixture.ownerA,
      },
      requestSignature: "a".repeat(64),
      service: "github",
    } as const;
    const acceptedOperationId = `accepted-${crypto.randomUUID()}`;
    await expect(
      recordCenterAgentConnectorActionOperation({
        ...baseInput,
        operationId: acceptedOperationId,
        nowMs: Date.now(),
      })
    ).resolves.toMatchObject({ replayed: false });
    await getPostgresDatabase(env).query({
      text: 'UPDATE "openmeld"."projects" SET issue_destination_revision = 2, issue_destination_json = $1 WHERE id = $2',
      values: [
        JSON.stringify({ provider: "github", owner: "acme", repo: "other" }),
        projectId,
      ],
    });
    const staleOperationId = `stale-${crypto.randomUUID()}`;
    await expect(
      recordCenterAgentConnectorActionOperation({
        ...baseInput,
        operationId: staleOperationId,
        nowMs: Date.now(),
      })
    ).rejects.toMatchObject({
      code: "project.issue_destination_changed",
      status: 409,
    });
    const staleRows = await getPostgresDatabase(env)
      .query<{ count: number }>({
        text: `SELECT COUNT(*) AS count FROM "openmeld"."center_agent_connector_action_operations"
       WHERE organization_id = $1 AND operation_id = $2`,
        values: [fixture.organizationA, staleOperationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(staleRows?.count).toBe(0);
    const staleAudit = await getPostgresDatabase(env)
      .query<{ count: number }>({
        text: `SELECT COUNT(*) AS count FROM "openmeld"."center_agent_audit_journal"
       WHERE resource_id = $1`,
        values: [`github:github.create_issue:${staleOperationId}`],
      })
      .then((result) => result.rows[0] ?? null);
    expect(staleAudit?.count).toBe(0);
    await expect(
      recordCenterAgentConnectorActionOperation({
        ...baseInput,
        operationId: acceptedOperationId,
        nowMs: Date.now(),
      })
    ).resolves.toMatchObject({ replayed: true });
  });

  it.each([
    "read_failure",
    "missing_submission",
    "missing_row",
  ] as const)("preserves the task fence and recovery when provenance has %s", async (failure) => {
    const fixture = await seedConnectorFixture();
    const center = await seedDesignatedCenterAgent(fixture);
    const connectionName = await seedSharedConnectorConnection(
      fixture,
      "posthog"
    );
    const member = await getPostgresDatabase(env)
      .query<{ id: string }>({
        text: 'SELECT id FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [fixture.organizationA, fixture.ownerA],
      })
      .then((result) => result.rows[0] ?? null);
    if (!member) {
      throw new Error("Missing requester member");
    }
    const core = connectorCoreEnv();
    const body = {
      actionId: "posthog.create_dashboard",
      connectionName,
      context: center.context,
      effect: "write" as const,
      operationId: `provenance-${crypto.randomUUID()}`,
      includeExecutionPermit: true as const,
      outcome: "attempted" as const,
      providerExecutionId: null,
      requestSignature: "a".repeat(64),
      service: "posthog" as const,
      speakerMember: { memberId: member.id, userId: fixture.ownerA },
    };
    expect(
      await rpcCenterAgentRecordConnectorActionOperation(core, body)
    ).toMatchObject({ executionAllowed: true });
    await rpcCenterAgentRecordConnectorActionOperation(core, {
      ...body,
      outcome: "outcome_unknown",
    });
    const replacement = {
      ...body,
      operationId: `${body.operationId}-replacement`,
    };
    expect(
      await rpcCenterAgentRecordConnectorActionOperation(core, replacement)
    ).toMatchObject({
      executionAllowed: false,
      operationId: body.operationId,
      status: "outcome_unknown",
    });
    let failNextRead = false;
    const nativeQuery = PostgresDatabase.prototype.query;
    const querySpy = vi
      .spyOn(PostgresDatabase.prototype, "query")
      .mockImplementation(async function (
        this: PostgresDatabase,
        query,
        values
      ) {
        const text = typeof query === "string" ? query : query.text;
        if (
          failNextRead &&
          text.includes(
            'FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"'
          )
        ) {
          failNextRead = false;
          throw new Error("Injected provenance storage outage");
        }
        return await nativeQuery.call(this, query, values);
      });
    onTestFinished(() => querySpy.mockRestore());
    const unavailable = () => {
      failNextRead = failure === "read_failure";
      return core;
    };
    const submissions = {
      read_failure: body.context.agentControllerConversationId,
      missing_submission: undefined,
      missing_row: "absent-submission",
    };
    const context = {
      ...body.context,
      agentControllerConversationId: submissions[failure],
    };
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(unavailable(), {
        ...replacement,
        context,
      })
    ).rejects.toThrow("plugin.task_provenance_unavailable");
    expect(
      await rpcCenterAgentReadConnectorActionOperation(unavailable(), {
        ...body,
        context,
      })
    ).toMatchObject({
      operation: { operationId: body.operationId, status: "outcome_unknown" },
    });
    expect(
      await rpcCenterAgentRecordConnectorActionOperation(unavailable(), {
        ...body,
        context,
        outcome: "completed",
        providerExecutionId: "original-provider-result",
      })
    ).toMatchObject({ status: "completed", executionAllowed: false });
    expect(
      await rpcCenterAgentRecordConnectorActionOperation(unavailable(), {
        ...replacement,
        context,
        actionId: "posthog.list_projects",
        effect: "read",
      })
    ).toMatchObject({ executionAllowed: true });
    const rows = await getPostgresDatabase(env).query({
      text: 'SELECT operation_id, status FROM "openmeld"."center_agent_connector_action_operations" WHERE organization_id = $1 AND action_id = $2',
      values: [fixture.organizationA, body.actionId],
    });
    expect(rows.rows).toEqual([
      { operation_id: body.operationId, status: "completed" },
    ]);
  });
  it.each([
    false,
    true,
  ])("refuses execution after a denied legacy receipt (reconnected: %s)", async (reconnected) => {
    const fixture = await seedConnectorFixture();
    const center = await seedDesignatedCenterAgent(fixture);
    const connectionName = await seedSharedConnectorConnection(
      fixture,
      "posthog"
    );
    const member = await getPostgresDatabase(env)
      .query<{ id: string }>({
        text: 'SELECT id FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [fixture.organizationA, fixture.ownerA],
      })
      .then((result) => result.rows[0] ?? null);
    if (!member) {
      throw new Error("Missing requester member");
    }
    const body = {
      actionId: "posthog.create_project",
      connectionName,
      context: center.context,
      effect: "write" as const,
      operationId: `legacy-${crypto.randomUUID()}`,
      includeExecutionPermit: true as const,
      includeRecoveryWindow: true as const,
      outcome: "attempted" as const,
      providerExecutionId: null,
      requestSignature: "a".repeat(64),
      service: "posthog" as const,
      speakerMember: { memberId: member.id, userId: fixture.ownerA },
    };
    const core = connectorCoreEnv();
    await rpcCenterAgentRecordConnectorActionOperation(core, body);
    await rpcCenterAgentRecordConnectorActionOperation(core, {
      ...body,
      outcome: "outcome_unknown",
    });
    await getPostgresDatabase(env).query({
      text: 'UPDATE "openmeld"."center_agent_connector_action_operations" SET connection_updated_at_ms = NULL WHERE operation_id = $1',
      values: [body.operationId],
    });
    if (reconnected) {
      await getPostgresDatabase(env).query({
        text: 'UPDATE "openmeld"."connector_connections" SET updated_at_ms = updated_at_ms + 1 WHERE connection_name = $1',
        values: [connectionName],
      });
    }
    const receipt = await rpcCenterAgentReadConnectorActionOperation(
      core,
      body
    );
    expect(receipt.operation?.replay).toEqual({
      allowed: false,
      reason: "original_account_unverified",
    });
    for (const claim of await Promise.all([
      rpcCenterAgentRecordConnectorActionOperation(core, body),
      rpcCenterAgentRecordConnectorActionOperation(core, body),
    ])) {
      expect(claim).toMatchObject({
        executionAllowed: false,
        status: "outcome_unknown",
        operationId: body.operationId,
      });
    }
    expect(
      (await rpcCenterAgentReadConnectorActionOperation(core, body)).operation
        ?.replay
    ).toEqual({ allowed: false, reason: "original_account_unverified" });
    expect(
      await getPostgresDatabase(env)
        .query({
          text: 'SELECT audit.id FROM "openmeld"."center_agent_audit_journal" audit JOIN "openmeld"."center_agent_connector_action_operations" operation ON audit.id = operation.id || \':replay_attempted\' WHERE operation.operation_id = $1',
          values: [body.operationId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toBeNull();
  });

  it("executes a recorded one-hop write and its verification through current Local admission", async () => {
    const fixture = await seedHumanPluginRequestFixture();
    const delegated = await seedLocalRecordedDelegation(fixture);
    const readAction = {
      ...fixture.metadata,
      id: "fixture.verify",
      effect: "read" as const,
    };
    const effects = new Map<string, unknown>();
    fixture.runtime.mockImplementation((request) => {
      if (request.operation === "list") {
        return Promise.resolve({
          status: "catalog",
          actions: [fixture.metadata, readAction],
        });
      }
      if (request.actionId === fixture.action.actionId) {
        effects.set(request.idempotencyKey, request.input);
      }
      return Promise.resolve({
        status: "completed",
        providerExecutionId: "isolated-provider-result",
        data:
          request.actionId === readAction.id
            ? [...effects.values()]
            : request.input,
        outputSchema: {},
      });
    });
    const input: PluginActionRpcInput = {
      ...fixture.input,
      request: {
        ...delegated.request,
        includeRecoveryReceipt: true,
        action: {
          ...fixture.action,
          input: { target: "isolated-A", text: "synthetic selection" },
        },
      },
    };
    const executeCalls = () =>
      fixture.runtime.mock.calls.filter(
        ([request]) => request.operation === "execute"
      );
    for (const changed of [
      {
        ...input.request,
        executionTokenEcho: {
          ...delegated.request.executionTokenEcho,
          executionToken: `rcet_v1_${"b".repeat(64)}`,
        },
      },
      {
        ...input.request,
        action: { ...fixture.action, input: { target: "isolated-B" } },
      },
      {
        ...input.request,
        action: { ...fixture.action, account: "personal" as const },
      },
    ]) {
      await expect(
        rpcPluginAction(fixture.core, { ...input, request: changed })
      ).rejects.toThrow();
      expect(executeCalls()).toHaveLength(0);
      expect(effects.size).toBe(0);
    }
    expect(await rpcPluginAction(fixture.core, input)).toMatchObject({
      status: "completed",
      replayed: false,
      data: { target: "isolated-A", text: "synthetic selection" },
    });
    expect(effects.size).toBe(1);
    const verification: PluginActionRpcInput = {
      ...input,
      request: {
        ...input.request,
        action: {
          ...fixture.action,
          actionId: readAction.id,
          operationId: "target-check",
          input: { target: "isolated-A" },
          verificationOf: {
            actionId: fixture.action.actionId,
            operationId: fixture.action.operationId,
          },
        },
      },
    };
    expect(await rpcPluginAction(fixture.core, verification)).toMatchObject({
      status: "completed",
      data: [{ target: "isolated-A", text: "synthetic selection" }],
      verificationOf: {
        operationId: fixture.action.operationId,
        interpretation: "read_evidence_only",
      },
    });
    expect(executeCalls()).toHaveLength(2);
    await getPostgresDatabase(env).query({
      text: 'UPDATE "openmeld"."agent_delegations" SET state = \'cancelled\' WHERE delegation_id = $1',
      values: [delegated.delegationId],
    });
    await expect(rpcPluginAction(fixture.core, verification)).rejects.toThrow(
      "recorded delegation"
    );
    expect(executeCalls()).toHaveLength(2);
    expect(effects.size).toBe(1);
  });
  it("keeps the Agent owner's private account out of another member's Wake", async () => {
    const fixture = await seedLocalPluginFixture("read", "read");
    const privateConnection = await createConnectorConnectionName({
      organizationId: fixture.organizationA,
      service: "posthog",
      userId: fixture.ownerA,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: "INSERT INTO \"openmeld\".\"connector_connections\" (connection_name, organization_id, user_id, scope, service, status, access_policy, created_at_ms, updated_at_ms) VALUES ($1, $2, $3, 'member', 'posthog', 'active', $4, 1, 1)",
        values: [],
      },
      values: [
        privateConnection,
        fixture.organizationA,
        fixture.ownerA,
        JSON.stringify({
          center_agent: "none",
          local_agent: "read",
          remote_agent: "none",
        }),
      ],
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.newUniqueId());
    const spaceId = stub.id.toString();
    const sourceId = crypto.randomUUID();
    fixture.core.OPENMELD_SPACES = namespace;
    await runInDurableObject(stub, (_instance, state) => {
      const now = new Date().toISOString();
      upsertSpaceMetaRecord(state.storage.sql, {
        v: 1,
        spaceId,
        organizationId: fixture.organizationA,
        visibility: "private",
        accessMode: "members_only",
        createdAt: now,
        updatedAt: now,
      });
      insertSignalRecord(state.storage.sql, {
        v: 1,
        id: sourceId,
        spaceId,
        ts: Date.now(),
        type: "signal.text",
        profile: {
          kind: "human",
          profileId: fixture.requesterProfileId,
          profileName: "Requester",
        },
        data: { text: "Read using organization access" },
      });
    });
    const dispatchId = crypto.randomUUID();
    await getPostgresDatabase(env).query({
      ...{
        text: "INSERT INTO \"openmeld\".\"space_index_spaces\" (space_id, organization_id, organization_visibility, status, source_updated_at_ms, projected_at_ms, projection_event_id) VALUES ($1, $2, 'private', 'active', 1, 1, $3)",
        values: [],
      },
      values: [spaceId, fixture.organizationA, crypto.randomUUID()],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger" (idempotency_key, dispatch_id, space_id, source_event_id, source_profile_id, target_profile_id, status, first_seen_at_ms, last_attempt_at_ms, attempt_count) VALUES ($1, $2, $3, $4, $5, $6, \'accepted\', 1, 1, 1)',
        values: [],
      },
      values: [
        dispatchId,
        dispatchId,
        spaceId,
        sourceId,
        fixture.requesterProfileId,
        fixture.actor,
      ],
    });
    const request = {
      ...fixture.input,
      request: {
        dispatchId,
        action: { ...fixture.action, account: "personal" as const },
      },
    };
    await expect(rpcPluginAction(fixture.core, request)).rejects.toThrow(
      "someone else’s Wake"
    );
    expect(
      await rpcPluginAction(fixture.core, {
        ...request,
        request: { dispatchId, action: fixture.action },
      })
    ).toMatchObject({ status: "completed" });
    const audit = await getPostgresDatabase(env)
      .query({
        ...{
          text: 'SELECT represented_user_id FROM "openmeld"."center_agent_connector_action_operations" WHERE actor_profile_id = $1',
          values: [],
        },
        values: [fixture.actor],
      })
      .then((result) => result.rows[0] ?? null);
    expect(audit).toEqual({ represented_user_id: fixture.otherMemberA });
    expect(
      await rpcPluginAction(fixture.core, {
        ...fixture.input,
        request: {
          action: {
            ...fixture.action,
            account: "personal",
            operationId: "owner-personal",
          },
        },
      })
    ).toMatchObject({
      status: "completed",
      connection: { scope: "member", ownerUserId: fixture.ownerA },
    });
  });
  it("filters discovery and rejects writes on read-only connections before provider execution", async () => {
    const fixture = await seedLocalPluginFixture("write", "read");
    const listed = await rpcPluginAction(fixture.core, {
      ...fixture.input,
      request: {
        action: { operation: "actions", service: "posthog", account: "shared" },
      },
    });
    expect(listed).toMatchObject({ kind: "actions", actions: [] });
    await expect(rpcPluginAction(fixture.core, fixture.input)).rejects.toThrow(
      "read-only"
    );
    expect(
      fixture.runtime.mock.calls.filter(
        ([request]) => request.operation === "execute"
      )
    ).toHaveLength(0);
  });

  it("retains the outcome but refuses receipt disclosure and new execution after access is revoked", async () => {
    const fixture = await seedLocalPluginFixture("read", "read");
    const first = await rpcPluginAction(fixture.core, fixture.input);
    expect(first).toMatchObject({
      kind: "execution",
      status: "completed",
      replayed: false,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1, access_revision = access_revision + 1 WHERE connection_name = $2',
        values: [],
      },
      values: [
        JSON.stringify({
          center_agent: "none",
          local_agent: "none",
          remote_agent: "none",
        }),
        fixture.connection,
      ],
    });
    await expect(rpcPluginAction(fixture.core, fixture.input)).rejects.toThrow(
      "Local Agent access was revoked"
    );
    expect(
      fixture.runtime.mock.calls.filter(
        ([request]) => request.operation === "execute"
      )
    ).toHaveLength(1);
    await expect(
      rpcPluginAction(fixture.core, {
        ...fixture.input,
        request: {
          action: { ...fixture.action, operationId: "another-operation" },
        },
      })
    ).rejects.toThrow("No connection grants");
    await expect(
      rpcPluginAction(fixture.core, {
        ...fixture.input,
        request: { action: { ...fixture.action, input: { changed: true } } },
      })
    ).rejects.toThrow("different");
  });
  it("binds destructive confirmation to the exact action and current access revision", async () => {
    const fixture = await seedHumanPluginRequestFixture("destructive");
    const pending = await fixture.pending();
    await fixture.decide(pending.requestId, "approve");
    const preview = await rpcPluginAction(fixture.core, fixture.input);
    expect(preview.kind).toBe("confirmation_required");
    if (preview.kind !== "confirmation_required") {
      throw new Error("Expected confirmation");
    }
    expect(
      fixture.runtime.mock.calls.filter(
        ([request]) => request.operation === "execute"
      )
    ).toHaveLength(0);
    const confirmed = {
      ...fixture.input,
      request: {
        action: {
          ...fixture.action,
          confirmationToken: preview.confirmationToken,
        },
      },
    };
    await expect(
      rpcPluginAction(fixture.core, {
        ...confirmed,
        request: {
          action: { ...confirmed.request.action, input: { changed: true } },
        },
      })
    ).rejects.toThrow("no longer matches");
    await expect(
      rpcPluginAction(fixture.core, {
        ...confirmed,
        request: {
          action: {
            ...confirmed.request.action,
            confirmationToken: crypto.randomUUID(),
          },
        },
      })
    ).rejects.toThrow("confirmation expired");
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."connector_connections" SET access_revision = access_revision + 1 WHERE connection_name = $1',
        values: [],
      },
      values: [fixture.connection],
    });
    await expect(rpcPluginAction(fixture.core, confirmed)).rejects.toThrow(
      "no longer matches"
    );
    const nextAction = {
      ...fixture.action,
      operationId: "new-destructive-request",
    };
    fixture.input.request = {
      includeRequestAuthorization: true,
      action: nextAction,
    };
    const newPending = await fixture.pending();
    await fixture.decide(newPending.requestId, "approve");
    const next = await rpcPluginAction(fixture.core, fixture.input);
    if (next.kind !== "confirmation_required") {
      throw new Error("Expected confirmation");
    }
    expect(
      await rpcPluginAction(fixture.core, {
        ...fixture.input,
        request: {
          action: {
            ...nextAction,
            confirmationToken: next.confirmationToken,
          },
        },
      })
    ).toMatchObject({ status: "completed" });
  });
  it("denies mismatched organization, account ownership, and missing Wake provenance", async () => {
    const fixture = await seedLocalPluginFixture("read", "read");
    await expect(
      rpcPluginAction(fixture.core, {
        ...fixture.input,
        expectedOrganizationId: fixture.organizationB,
      })
    ).rejects.toThrow();
    await expect(
      rpcPluginAction(fixture.core, {
        ...fixture.input,
        context: {
          ...fixture.input.context,
          actorContext: {
            ...fixture.input.context.actorContext,
            callerPrincipalId: fixture.otherMemberA,
          },
        },
      })
    ).rejects.toThrow("owned by your signed-in");
    await expect(
      rpcPluginAction(fixture.core, {
        ...fixture.input,
        request: { ...fixture.input.request, dispatchId: "missing-dispatch" },
      })
    ).rejects.toThrow("Wake requester");
    expect(fixture.runtime).not.toHaveBeenCalled();
  });
  it("does not turn an unknown provider result into an automatic second execution", async () => {
    const fixture = await seedLocalPluginFixture("read", "read");
    fixture.runtime.mockImplementation((request) => {
      if (request.operation === "list") {
        return Promise.resolve({
          status: "catalog",
          actions: [fixture.metadata],
        });
      }
      return Promise.reject(new Error("Provider response lost"));
    });
    expect(await rpcPluginAction(fixture.core, fixture.input)).toMatchObject({
      status: "outcome_unknown",
      replayed: false,
    });
    expect(await rpcPluginAction(fixture.core, fixture.input)).toMatchObject({
      status: "outcome_unknown",
      replayed: true,
    });
    expect(
      fixture.runtime.mock.calls.filter(
        ([request]) => request.operation === "execute"
      )
    ).toHaveLength(1);
  });
});

async function seedLocalRecordedDelegation(
  fixture: Awaited<ReturnType<typeof seedLocalPluginFixture>>
) {
  const db = getPostgresDatabase(env);
  const center = `agt_${crypto.randomUUID()}`;
  const spaces = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const spaceId = spaces.newUniqueId().toString();
  fixture.core.OPENMELD_SPACES = spaces;
  const dispatchId = crypto.randomUUID();
  const clientMessageId = crypto.randomUUID();
  const sourceSignalId = crypto.randomUUID();
  const delegationId = crypto.randomUUID();
  const nowMs = Date.now();
  await runInDurableObject(
    spaces.get(spaces.idFromString(spaceId)),
    (_instance, state) => {
      const timestamp = new Date(nowMs).toISOString();
      upsertSpaceMetaRecord(state.storage.sql, {
        v: 1,
        spaceId,
        organizationId: fixture.organizationA,
        visibility: "private",
        accessMode: "members_only",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      insertSignalRecord(state.storage.sql, {
        v: 1,
        id: sourceSignalId,
        spaceId,
        ts: nowMs,
        type: "signal.text",
        profile: {
          kind: "agent",
          profileId: center,
          profileName: "Synthetic Center",
        },
        data: {
          text: "Use the isolated fixture.",
          meta: { clientMessageId },
          messageEnvelope: {
            text: "Use the isolated fixture.",
            activationTargets: [fixture.actor],
            referenceTargets: [],
          },
        },
      });
    }
  );
  const member = await db
    .query<{ id: string }>({
      text: 'SELECT id FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
      values: [fixture.organizationA, fixture.ownerA],
    })
    .then((result) => result.rows[0] ?? null);
  if (!member) {
    throw new Error("Missing original member fixture");
  }
  await db.query({
    text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source) VALUES ($1, 'Synthetic Center', $2, 'agent', $3, $4, 'cli_create')",
    values: [center, center, fixture.organizationA, fixture.ownerA],
  });
  await db.query({
    text: 'INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, operating_state, created_at) VALUES ($1, $2, \'active\', $3)',
    values: [fixture.organizationA, center, nowMs],
  });
  await db.query({
    text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1 WHERE connection_name = $2',
    values: [
      JSON.stringify({
        center_agent: "write",
        local_agent: "write",
        remote_agent: "none",
      }),
      fixture.connection,
    ],
  });
  const auth = fixture.core.OPENMELD_AUTH_WORKER;
  if (!auth?.resolveProfileById) {
    throw new Error("Missing identity fixture");
  }
  const resolveProfile = auth.resolveProfileById.bind(auth);
  auth.resolveProfileById = (input) =>
    input.openMeldProfileId === center
      ? Promise.resolve({
          ok: true,
          profile: {
            profileId: center,
            profileName: "Synthetic Center",
            profileHandle: center,
            profileKind: "agent",
            status: "active",
            ownerUserId: fixture.ownerA,
            organizationId: fixture.organizationA,
          },
        })
      : resolveProfile(input);
  const defaults = createSubmitTurnRequestV2();
  const parent = createSubmitTurnRequestV2({
    organizationId: fixture.organizationA,
    agentProfileId: center,
    agentProfileOwnerUserId: fixture.ownerA,
    spaceId,
    dispatchId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    author: {
      profileId: fixture.ownerProfileId,
      profileKind: "human",
      displayName: "Synthetic member",
    },
    turnEnvelope: {
      ...defaults.turnEnvelope,
      sender: {
        kind: "member",
        id: member.id,
        verified: true,
        profileId: fixture.ownerProfileId,
        ownerUserId: fixture.ownerA,
        displayName: "Synthetic member",
        role: "owner",
      },
      space: { ...defaults.turnEnvelope.space, id: spaceId },
      organization: {
        ...defaults.turnEnvelope.organization,
        id: fixture.organizationA,
      },
    },
  });
  await upsertRemoteAgentNativeDeliveryRecord({
    db,
    nowMs,
    attemptId: null,
    bindingId: parent.bindingId,
    dispatchId: parent.dispatchId,
    idempotencyKey: parent.idempotencyKey,
    organizationId: fixture.organizationA,
    profileId: center,
    sourceClientMessageId: parent.sourceClientMessageId ?? null,
    spaceId,
    triggerMessageId: parent.triggerMessageId,
    status: "submitted",
  });
  await persistRemoteAgentWorkerSubmitRequest({
    db,
    nowMs,
    idempotencyKey: parent.idempotencyKey,
    workerSubmitRequest: parent,
  });
  const parentSubmissionId = crypto.randomUUID();
  await markRemoteAgentNativeDeliveryAck({
    db,
    nowMs,
    idempotencyKey: parent.idempotencyKey,
    submissionId: parentSubmissionId,
    workerRequestId: crypto.randomUUID(),
    accepted: true,
  });
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db,
    idempotencyKey: parent.idempotencyKey,
  });
  if (!delivery) {
    throw new Error("Missing parent delivery");
  }
  await createAgentDelegation({
    db,
    nowMs,
    delegationId,
    idempotencyKey: delegationId,
    organizationId: fixture.organizationA,
    spaceId,
    parentTask: {
      v: 1,
      kind: "native_delivery",
      deliveryId: delivery.deliveryId,
    },
    children: [
      {
        agentProfileId: fixture.actor,
        role: "primary",
        task: {
          v: 1,
          kind: "space_wake",
          spaceId,
          sourceClientMessageId: clientMessageId,
          targetProfileId: fixture.actor,
        },
      },
    ],
    completionPolicy: { mode: "resume_parent", when: "all_terminal" },
  });
  await activateAgentDelegationChildren({ db, nowMs, delegationId });
  const attribution = {
    actorProfileId: center,
    onBehalfOf: {
      userId: fixture.ownerA,
      profileId: fixture.ownerProfileId,
      displayName: "Synthetic member",
    },
  };
  fixture.runtime.mockResolvedValue({
    status: "catalog",
    actions: [
      fixture.metadata,
      { ...fixture.metadata, id: "fixture.verify", effect: "read" },
    ],
  });
  const pluginActions = await prepareDelegatedPluginActions({
    env: fixture.core,
    db,
    organizationId: fixture.organizationA,
    actorProfileId: center,
    parentSubmissionId,
    attribution,
    targetProfileIds: [fixture.actor],
    requests: [
      {
        targetProfileId: fixture.actor,
        service: "posthog",
        connectionName: fixture.connection,
        actionId: fixture.action.actionId,
        effect: "write",
        input: { target: "isolated-A", text: "synthetic selection" },
        expiresAtMs: nowMs + 60_000,
      },
      {
        targetProfileId: fixture.actor,
        service: "posthog",
        connectionName: fixture.connection,
        actionId: "fixture.verify",
        effect: "read",
        input: { target: "isolated-A" },
        expiresAtMs: nowMs + 60_000,
      },
    ],
  });
  await prepareCenterAgentWakePublicationRecord({
    db,
    nowMs,
    command: {
      v: 1,
      clientMessageId,
      delegationId,
      organizationId: fixture.organizationA,
      spaceId,
      context: {
        ...fixture.input.context,
        actorContext: {
          ...fixture.input.context.actorContext,
          openMeldProfileId: center,
        },
        agentControllerConversationId: parentSubmissionId,
      },
      parentSubmissionId,
      profile: {
        kind: "agent",
        profileId: center,
        profileName: "Synthetic Center",
      },
      attribution,
      activationTargets: [fixture.actor],
      mentionTargets: [],
      referenceTargets: [],
      fallbackAgentProfileId: null,
      subscriptionIds: [crypto.randomUUID()],
      text: "Use the isolated fixture.",
      completionMode: "resume_parent_when_all_terminal",
      pluginActions,
    },
  });
  await db.query({
    text: 'UPDATE "openmeld"."center_agent_wake_publications" SET state = \'completed\', accepted_at_ms = $1, completed_at_ms = $2, signal_json = $3 WHERE publication_id = $4',
    values: [
      nowMs,
      nowMs,
      JSON.stringify({
        v: 1,
        id: sourceSignalId,
        type: "signal.text",
        ts: nowMs,
        spaceId,
        profile: {
          kind: "agent",
          profileId: center,
          profileName: "Synthetic Center",
        },
        data: {
          text: "Use the isolated fixture.",
          meta: { clientMessageId },
          messageEnvelope: {
            text: "Use the isolated fixture.",
            activationTargets: [fixture.actor],
            referenceTargets: [],
          },
        },
      }),
      clientMessageId,
    ],
  });
  await db.query({
    text: "INSERT INTO \"openmeld\".\"space_index_spaces\" (space_id, organization_id, organization_visibility, status, source_updated_at_ms, projected_at_ms, projection_event_id) VALUES ($1, $2, 'private', 'active', $3, $4, $5)",
    values: [spaceId, fixture.organizationA, nowMs, nowMs, crypto.randomUUID()],
  });
  await db.query({
    text: 'INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger" (idempotency_key, dispatch_id, space_id, source_event_id, source_profile_id, source_client_message_id, target_profile_id, status, first_seen_at_ms, last_attempt_at_ms, attempt_count) VALUES ($1, $2, $3, $4, $5, $6, $7, \'accepted\', $8, $9, 1)',
    values: [
      dispatchId,
      dispatchId,
      spaceId,
      sourceSignalId,
      center,
      clientMessageId,
      fixture.actor,
      nowMs,
      nowMs,
    ],
  });
  const binding = await db
    .query<{ binding_id: string }>({
      text: 'SELECT binding_id FROM "openmeld"."openMeldDaemon_agent_profile_bindings" WHERE agent_profile_id = $1',
      values: [fixture.actor],
    })
    .then((result) => result.rows[0] ?? null);
  if (!binding) {
    throw new Error("Missing Local binding fixture");
  }
  const token = await issueRuntimeCoordinatorExecutionToken({
    nowMs,
    authorityScope: {
      bindingId: binding.binding_id,
      agentControllerRef: "codex",
      openMeldServiceRuntimeId: "test-local-runtime",
    },
    executionScope: {
      dispatchId,
      runtimeCoordinatorExecutionId: crypto.randomUUID(),
      sourceClientMessageId: clientMessageId,
      spaceId,
      targetProfileId: fixture.actor,
    },
    deliveryProvenance: {
      connectionGeneration: null,
      daemonSessionId: null,
      leaseEpoch: null,
    },
  });
  const namespace =
    env.OPENMELD_RUNTIME_TRANSPORT as DurableObjectNamespace<RuntimeTransportHub>;
  const stub = namespace.get(namespace.idFromName(fixture.ownerA));
  await runInDurableObject(stub, async (_instance, state) => {
    await writeRuntimeCoordinatorTokenAuthorityToStorage(
      state.storage,
      token.authority
    );
  });
  fixture.core.OPENMELD_RUNTIME_TRANSPORT = namespace;
  return {
    delegationId,
    request: {
      dispatchId,
      executionTokenEcho: {
        executionToken: token.envelope.executionToken,
        runId: token.envelope.runId,
        runtimeCoordinatorExecutionId:
          token.envelope.executionScope.runtimeCoordinatorExecutionId,
        tokenFingerprint: token.envelope.tokenFingerprint,
      },
    },
  };
}

async function seedLocalPluginFixture(
  effect: "read" | "write" | "destructive",
  permission: "read" | "write"
) {
  const fixture = await seedConnectorFixture();
  const actor = `agt_${crypto.randomUUID()}`;
  const requesterProfileId = crypto.randomUUID();
  await getPostgresDatabase(env).query({
    ...{
      text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, 'Other requester', $2, 'human', 1, 'active', $3, $4, 'auth_bootstrap', 1, 1)",
      values: [],
    },
    values: [
      requesterProfileId,
      requesterProfileId,
      fixture.otherMemberA,
      fixture.otherMemberA,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, 'Local test Agent', $2, 'agent', 0, 'active', $3, $4, $5, 'auth_bootstrap', 1, 1)",
      values: [],
    },
    values: [
      actor,
      actor,
      fixture.organizationA,
      fixture.ownerA,
      fixture.ownerA,
    ],
  });
  const connection = await seedSharedConnectorConnection(fixture, "posthog");
  await getPostgresDatabase(env).query({
    ...{
      text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1 WHERE connection_name = $2',
      values: [],
    },
    values: [
      JSON.stringify({
        center_agent: "none",
        local_agent: permission,
        remote_agent: "none",
      }),
      connection,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: "INSERT INTO \"openmeld\".\"openMeldDaemon_agent_profile_bindings\" (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id, runtime_kind, agent_controller_ref, binding_state, created_at_ms, updated_at_ms) VALUES ($1, 'owner_account', $2, $3, 'test-local-runtime', 'openmeld_service', 'codex', 'enabled_primary', 1, 1)",
      values: [],
    },
    values: [crypto.randomUUID(), fixture.ownerA, actor],
  });
  const captured = capturedActions.data[0];
  if (!captured) {
    throw new Error("Missing captured provider action");
  }
  const metadata = {
    ...captured,
    effect,
  } as import("@openmeld/schemas/types").OpenConnectorRuntimeAction;
  const runtime = vi.fn<
    (request: PluginRuntimeRequest) => Promise<PluginRuntimeResponse>
  >(async (request) =>
    request.operation === "list"
      ? { status: "catalog", actions: [metadata] }
      : {
          status: "completed",
          data: { result: "provider-result" },
          outputSchema: {},
          providerExecutionId: "provider-execution-1",
        }
  );
  const core = {
    OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    OPENMELD_REMOTE_AGENT_WORKER: { pluginRuntime: runtime },
    OPENMELD_AUTH_WORKER: {
      resolveProfileById: (input: {
        openMeldProfileId: string;
      }): Promise<AuthRpcResolveProfileByIdResult> => {
        if (
          input.openMeldProfileId !== actor &&
          input.openMeldProfileId !== fixture.ownerProfileId &&
          input.openMeldProfileId !== requesterProfileId
        ) {
          return Promise.reject(new Error("Unknown profile"));
        }
        return Promise.resolve({
          ok: true,
          profile: {
            profileId: input.openMeldProfileId,
            profileName: "Local Agent owner",
            profileHandle: "local-owner",
            profileKind: input.openMeldProfileId === actor ? "agent" : "human",
            status: "active",
            ownerUserId:
              input.openMeldProfileId === requesterProfileId
                ? fixture.otherMemberA
                : fixture.ownerA,
            organizationId:
              input.openMeldProfileId === actor ? fixture.organizationA : null,
          },
        });
      },
      resolveOrganizationAccountIdentity: async (input: {
        account?: {
          kind: string;
          userId?: string;
        };
      }) => ({
        ok: true,
        organization: {
          id: fixture.organizationA,
          name: "Connector A",
          slug: "connector-a",
          personal: false,
          memberCount: 3,
        },
        account: {
          userId: input.account?.userId ?? fixture.ownerA,
          displayName: "Local owner",
          email: "local-owner@example.com",
          defaultHumanProfile: {
            profileId:
              input.account?.userId === fixture.otherMemberA
                ? requesterProfileId
                : fixture.ownerProfileId,
            profileName: "Local owner",
          },
          membership: { memberId: "test-owner", role: "owner" },
        },
      }),
    },
  } as unknown as CoreBindings;
  const action = {
    operation: "execute" as const,
    service: "posthog" as const,
    account: "shared" as const,
    actionId: metadata.id,
    input: {},
    operationId: "local-test-operation",
  };
  const input: PluginActionRpcInput = {
    expectedOrganizationId: fixture.organizationA,
    context: {
      activeOrganizationId: fixture.organizationA,
      actorContext: {
        callerPrincipalId: fixture.ownerA,
        ownerUserId: fixture.ownerA,
        openMeldProfileId: actor,
        profileKind: "agent",
        requestId: crypto.randomUUID(),
      },
    },
    request: { action },
  };
  return {
    ...fixture,
    actor,
    requesterProfileId,
    connection,
    core,
    runtime,
    input,
    action,
    metadata,
  };
}
const SHARED_CONNECTOR_CONNECTION_NAME_PATTERN =
  /^org_[A-Za-z0-9_-]{18}__shared__github$/u;
const OPENCONNECTOR_CONNECTION_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
describe("Core connector connection ownership", () => {
  it.each([
    ["member", "github"],
    ["shared", "github"],
    ["member", "linear"],
    ["shared", "linear"],
    ["member", "posthog"],
    ["shared", "posthog"],
  ] as const)("requires explicit Agent access for a new %s %s connection", async (scope, service) => {
    const fixture = await seedConnectorFixture();
    const core = connectorCoreEnv();
    const request = {
      context: connectorRequestContext({
        organizationId: fixture.organizationA,
        userId: fixture.ownerA,
        profileId: fixture.ownerProfileId,
      }),
      expectedOrganizationId: fixture.organizationA,
      service,
    };
    const begin = () =>
      scope === "shared"
        ? rpcBeginCurrentOrganizationSharedConnectorAuthorization(core, request)
        : rpcBeginCurrentMemberConnectorAuthorization(core, request);
    const created = await begin();
    const row = () =>
      getPostgresDatabase(env)
        .query<{
          access_policy: string | null;
          access_revision: number;
        }>({
          ...{
            text: 'SELECT access_policy, access_revision FROM "openmeld"."connector_connections" WHERE connection_name = $1',
            values: [],
          },
          values: [created.connectionName],
        })
        .then((result) => result.rows[0] ?? null);
    const none = {
      center_agent: "none",
      local_agent: "none",
      remote_agent: "none",
    } as const;
    expect(JSON.parse((await row())?.access_policy ?? "null")).toEqual(none);
    const activate = () =>
      rpcReconcileCurrentOrganizationConnectorConnections(core, {
        ...request,
        availableConnectionNames: [created.connectionName],
      });
    await activate();
    const listed = await rpcListPluginAccess(core, request);
    expect(listed.connections).toContainEqual({
      connectionName: created.connectionName,
      scope,
      canManage: true,
      revision: 0,
      policy: none,
    });
    const access = {
      db: getPostgresDatabase(env),
      organizationId: fixture.organizationA,
      connectionName: created.connectionName,
    };
    for (const consumer of [
      "center_agent",
      "remote_agent",
      "local_agent",
    ] as const) {
      for (const effect of ["read", "write"] as const) {
        await expect(
          requirePluginPermission({ ...access, consumer, effect })
        ).rejects.toThrow("permission");
      }
    }
    const policy = {
      center_agent: "read",
      remote_agent: "read",
      local_agent: "read",
    } as const;
    await rpcUpdatePluginAccess(core, {
      ...request,
      connectionName: created.connectionName,
      expectedRevision: 0,
      policy,
    });
    for (const consumer of [
      "center_agent",
      "remote_agent",
      "local_agent",
    ] as const) {
      await expect(
        requirePluginPermission({ ...access, consumer, effect: "read" })
      ).resolves.toBe("read");
      await expect(
        requirePluginPermission({ ...access, consumer, effect: "write" })
      ).rejects.toThrow("permission");
    }
    const write = { ...none, center_agent: "write" } as const;
    await rpcUpdatePluginAccess(core, {
      ...request,
      connectionName: created.connectionName,
      expectedRevision: 1,
      policy: write,
    });
    await expect(
      requirePluginPermission({
        ...access,
        consumer: "center_agent",
        effect: "write",
      })
    ).resolves.toBe("write");
    const beforeReconnect = await row();
    await begin();
    await expect(
      requirePluginPermission({
        ...access,
        consumer: "center_agent",
        effect: "write",
      })
    ).rejects.toThrow("no longer available");
    await expect(
      rpcUpdatePluginAccess(core, {
        ...request,
        connectionName: created.connectionName,
        expectedRevision: 2,
        policy,
      })
    ).rejects.toThrow();
    await activate();
    expect(JSON.parse((await row())?.access_policy ?? "null")).toEqual(write);
    expect((await row())?.access_revision).toBeGreaterThan(
      beforeReconnect?.access_revision ?? 0
    );
    await expect(
      rpcUpdatePluginAccess(core, {
        ...request,
        connectionName: created.connectionName,
        expectedRevision: 2,
        policy,
      })
    ).rejects.toThrow("changed");
    const currentRevision = (await row())?.access_revision;
    if (currentRevision === undefined) {
      throw new Error("Missing persisted access revision");
    }
    await rpcUpdatePluginAccess(core, {
      ...request,
      connectionName: created.connectionName,
      expectedRevision: currentRevision,
      policy: none,
    });
    await expect(
      requirePluginPermission({
        ...access,
        consumer: "center_agent",
        effect: "read",
      })
    ).rejects.toThrow("permission");
    const events = await getPostgresDatabase(env).query<{
      previous_policy: string;
    }>({
      ...{
        text: 'SELECT previous_policy FROM "openmeld"."connector_access_events" WHERE connection_name = $1 ORDER BY revision',
        values: [],
      },
      values: [created.connectionName],
    });
    expect(JSON.parse(events.rows[0]?.previous_policy ?? "null")).toEqual(none);
  });
  it("rejects an old permission draft when reauthorization starts between its read and atomic save", async () => {
    const fixture = await seedConnectorFixture();
    const core = connectorCoreEnv();
    const request = {
      context: connectorRequestContext({
        organizationId: fixture.organizationA,
        userId: fixture.ownerA,
        profileId: fixture.ownerProfileId,
      }),
      expectedOrganizationId: fixture.organizationA,
      service: "linear" as const,
    };
    const created = await rpcBeginCurrentMemberConnectorAuthorization(
      core,
      request
    );
    await rpcReconcileCurrentOrganizationConnectorConnections(core, {
      ...request,
      availableConnectionNames: [created.connectionName],
    });
    const db = observePostgresDatabase(
      getPostgresDatabase(env),
      () => undefined,
      async () => {
        await rpcBeginCurrentMemberConnectorAuthorization(core, request);
      }
    );
    await expect(
      updatePluginAccess({
        db,
        organizationId: fixture.organizationA,
        connectionName: created.connectionName,
        actorProfileId: fixture.ownerProfileId,
        actorUserId: fixture.ownerA,
        expectedRevision: 0,
        policy: {
          center_agent: "write",
          local_agent: "write",
          remote_agent: "write",
        },
      })
    ).rejects.toThrow("changed");
    expect(
      (
        await getPostgresDatabase(env)
          .query({
            ...{
              text: 'SELECT COUNT(*) AS n FROM "openmeld"."connector_access_events" WHERE connection_name = $1',
              values: [],
            },
            values: [created.connectionName],
          })
          .then((result) => result.rows[0] ?? null)
      )?.n
    ).toBe(0);
    const stored = await getPostgresDatabase(env)
      .query<{
        access_policy: string;
      }>({
        ...{
          text: 'SELECT access_policy FROM "openmeld"."connector_connections" WHERE connection_name = $1',
          values: [],
        },
        values: [created.connectionName],
      })
      .then((result) => result.rows[0] ?? null);
    expect(JSON.parse(stored?.access_policy ?? "null")).toEqual({
      center_agent: "none",
      local_agent: "none",
      remote_agent: "none",
    });
  });
  it("preserves legacy null grants on the same registration without lending them to a new member", async () => {
    const fixture = await seedConnectorFixture();
    const core = connectorCoreEnv();
    const old = {
      context: connectorRequestContext({
        organizationId: fixture.organizationA,
        userId: fixture.memberA,
      }),
      expectedOrganizationId: fixture.organizationA,
      service: "github" as const,
    };
    await rpcBeginCurrentMemberConnectorAuthorization(core, old);
    await rpcReconcileCurrentOrganizationConnectorConnections(core, {
      ...old,
      availableConnectionNames: [fixture.connectionA],
    });
    const policy = await rpcListPluginAccess(core, old);
    expect(policy.connections[0]?.policy.center_agent).toBe("write");
    expect(
      (
        await getPostgresDatabase(env)
          .query({
            ...{
              text: 'SELECT access_policy FROM "openmeld"."connector_connections" WHERE connection_name = $1',
              values: [],
            },
            values: [fixture.connectionA],
          })
          .then((result) => result.rows[0] ?? null)
      )?.access_policy
    ).toBeNull();
    const created = await rpcBeginCurrentMemberConnectorAuthorization(core, {
      ...old,
      context: connectorRequestContext({
        organizationId: fixture.organizationA,
        userId: fixture.otherMemberA,
      }),
    });
    expect(created.connectionName).not.toBe(fixture.connectionA);
    expect(
      JSON.parse(
        (
          await getPostgresDatabase(env)
            .query<{
              access_policy: string;
            }>({
              ...{
                text: 'SELECT access_policy FROM "openmeld"."connector_connections" WHERE connection_name = $1',
                values: [],
              },
              values: [created.connectionName],
            })
            .then((result) => result.rows[0] ?? null)
        )?.access_policy ?? "null"
      )
    ).toEqual({
      center_agent: "none",
      remote_agent: "none",
      local_agent: "none",
    });
  });
  it("requires both the personal Remote Agent owner and the represented requester for private access", async () => {
    const fixture = await seedConnectorFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1 WHERE connection_name = $2',
        values: [],
      },
      values: [
        JSON.stringify({
          center_agent: "none",
          local_agent: "none",
          remote_agent: "read",
        }),
        fixture.connectionA,
      ],
    });
    const input = {
      db: getPostgresDatabase(env),
      organizationId: fixture.organizationA,
      connectionName: fixture.connectionA,
      service: "github" as const,
      requesterUserId: fixture.memberA,
      remoteOwnerUserId: fixture.memberA,
      effect: "read" as const,
    };
    await expect(requireRemotePluginConnection(input)).resolves.toMatchObject({
      connectionName: fixture.connectionA,
    });
    await expect(
      requireRemotePluginConnection({
        ...input,
        requesterUserId: fixture.ownerA,
      })
    ).rejects.toThrow("not available");
    await expect(
      requireRemotePluginConnection({
        ...input,
        remoteOwnerUserId: fixture.ownerA,
      })
    ).rejects.toThrow("not available");
    await expect(
      requireRemotePluginConnection({ ...input, remoteOwnerUserId: null })
    ).rejects.toThrow("not available");
    await expect(
      requireRemotePluginConnection({ ...input, effect: "write" })
    ).rejects.toThrow("permission");
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."connector_connections" SET status = \'disconnected\', disconnected_at_ms = updated_at_ms WHERE connection_name = $1',
        values: [],
      },
      values: [fixture.connectionA],
    });
    await expect(
      requirePluginPermission({ ...input, consumer: "remote_agent" })
    ).rejects.toThrow("no longer available");
  });
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
      scope: "member",
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
      db: getPostgresDatabase(env),
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
    const events = await getPostgresDatabase(env).query({
      ...{
        text: 'SELECT actor_user_id, revision, previous_policy, policy FROM "openmeld"."connector_access_events" WHERE connection_name = $1',
        values: [],
      },
      values: [fixture.connectionA],
    });
    expect(events.rows).toEqual([
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
      db: getPostgresDatabase(env),
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
      sourceNativeDeliveryId: "delivery-original-request-continuation",
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: `SELECT on_behalf_of_user_id, source_native_delivery_id
         FROM "openmeld"."center_agent_audit_journal" WHERE resource_id = $1 AND action = 'execute_connector_action'`,
            values: [],
          },
          values: [`github:github.create_issue:${baseInput.operationId}`],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({
      on_behalf_of_user_id: fixture.ownerA,
      source_native_delivery_id: baseInput.sourceNativeDeliveryId,
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: `SELECT source_native_delivery_id FROM "openmeld"."center_agent_audit_journal"
         WHERE resource_id = $1 AND action = 'complete_connector_action'`,
            values: [],
          },
          values: [`github:github.create_issue:${baseInput.operationId}`],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({
      source_native_delivery_id: baseInput.sourceNativeDeliveryId,
    });
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
    const auditCount = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: `
        SELECT count(*) AS count
        FROM "openmeld"."center_agent_audit_journal"
        WHERE resource_id = $1
      `,
          values: [],
        },
        values: [
          `${baseInput.service}:${baseInput.actionId}:${baseInput.operationId}`,
        ],
      })
      .then((result) => result.rows[0] ?? null);
    expect(Number(auditCount?.count ?? 0)).toBe(2);
    const sourceSpaces = await getPostgresDatabase(env).query<{
      source_space_id: string | null;
    }>({
      ...{
        text: `
        SELECT source_space_id
        FROM "openmeld"."center_agent_audit_journal"
        WHERE resource_id = $1
        ORDER BY created_at ASC
      `,
        values: [],
      },
      values: [
        `${baseInput.service}:${baseInput.actionId}:${baseInput.operationId}`,
      ],
    });
    expect(sourceSpaces.rows).toEqual([
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
    const raceAuditRows = await getPostgresDatabase(env).query<{
      action: string;
    }>({
      ...{
        text: `
        SELECT action
        FROM "openmeld"."center_agent_audit_journal"
        WHERE resource_id = $1
        ORDER BY created_at ASC
      `,
        values: [],
      },
      values: [
        `${concurrentInput.service}:${concurrentInput.actionId}:${concurrentInput.operationId}`,
      ],
    });
    expect(raceAuditRows.rows).toHaveLength(2);
    expect(raceAuditRows.rows[0]?.action).toBe("execute_connector_action");
    expect(["complete_connector_action", "fail_connector_action"]).toContain(
      raceAuditRows.rows[1]?.action
    );
  });

  it("retains the exact Linear issue receipt for association-only replay", async () => {
    const fixture = await seedConnectorFixture();
    const receipt = {
      id: "73c7947f-5bba-4e67-a668-9392b70cd424",
      identifier: "PAY-82",
      teamId: "a86813e7-c458-4af2-8cfa-73a796d81201",
      provider: "linear" as const,
      url: "https://linear.app/acme/issue/PAY-82/fix-payment-retry",
      lastObservedAt: null,
      lastObservedState: null,
    };
    const command = {
      actionId: "linear.create_linear_issue",
      actorProfileId: fixture.ownerProfileId,
      attribution: {
        actorProfileId: fixture.ownerProfileId,
        onBehalfOf: {
          displayName: "Connector owner",
          profileId: fixture.ownerProfileId,
          userId: fixture.ownerA,
        },
      },
      connectionName: "linear-test",
      db: getPostgresDatabase(env),
      executionConnection: {
        connectionName: "linear-test",
        ownerDisplayName: fixture.memberA,
        ownerUserId: fixture.memberA,
        scope: "member" as const,
        service: "linear" as const,
      },
      operationId: `linear-issue-${crypto.randomUUID()}`,
      organizationId: fixture.organizationA,
      providerExecutionId: null,
      requester: {
        kind: "represented_member" as const,
        representedUserId: fixture.ownerA,
      },
      requestSignature: "c".repeat(64),
      service: "linear",
    };
    await recordCenterAgentConnectorActionOperation({
      ...command,
      nowMs: Date.now(),
      outcome: "attempted",
    });
    const completed = await recordCenterAgentConnectorActionOperation({
      ...command,
      linearIssueReceipt: receipt,
      nowMs: Date.now() + 1,
      outcome: "completed",
      providerExecutionId: "provider-linear-1",
    });
    expect(completed.operation.linearIssueReceipt).toEqual(receipt);
    const replay = await recordCenterAgentConnectorActionOperation({
      ...command,
      linearIssueReceipt: receipt,
      nowMs: Date.now() + 2,
      outcome: "completed",
      providerExecutionId: "provider-linear-1",
    });
    expect(replay).toMatchObject({
      operation: { linearIssueReceipt: receipt },
      replayed: true,
    });
    await expect(
      recordCenterAgentConnectorActionOperation({
        ...command,
        linearIssueReceipt: { ...receipt, identifier: "PAY-83" },
        nowMs: Date.now() + 3,
        outcome: "completed",
        providerExecutionId: "provider-linear-1",
      })
    ).rejects.toMatchObject({
      code: "center_agent.connector_action_operation_conflict",
    });
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
      db: getPostgresDatabase(env),
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT on_behalf_of_user_id, source_native_delivery_id
          FROM "openmeld"."center_agent_audit_journal"
          WHERE resource_id = $1
        `,
            values: [],
          },
          values: [`gmail:gmail.fetch_emails:${operationId}`],
        })
        .then((result) => result.rows[0] ?? null)
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
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: `
          INSERT INTO "openmeld"."openmeld_profiles" (
            profile_id, profile_name, profile_handle, profile_kind, is_default,
            status, organization_id, owner_user_id, created_by_user_id, source,
            managed_role, created_at, updated_at
          ) VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, 'auth_bootstrap', 'center_agent', $5, $6)
        `,
              values: [],
            },
            values: [
              centerAgentProfileId,
              `center-agent-${crypto.randomUUID()}`,
              fixture.organizationA,
              fixture.ownerA,
              nowMs,
              nowMs,
            ],
          },
          {
            ...{
              text: `
          INSERT INTO "openmeld"."openmeld_profiles" (
            profile_id, profile_name, profile_handle, profile_kind, is_default,
            status, organization_id, owner_user_id, created_by_user_id, source,
            created_at, updated_at
          ) VALUES ($1, 'Represented member', $2, 'human', 1, 'active', NULL, $3, $4, 'auth_bootstrap', $5, $6)
        `,
              values: [],
            },
            values: [
              representedProfileId,
              `represented-${crypto.randomUUID()}`,
              fixture.memberA,
              fixture.memberA,
              nowMs,
              nowMs,
            ],
          },
          {
            ...{
              text: `
          INSERT INTO "openmeld"."center_agent_designations" (
            organization_id, agent_profile_id, duty, designated_by, created_at
          ) VALUES ($1, $2, NULL, $3, $4)
        `,
              values: [],
            },
            values: [
              fixture.organizationA,
              centerAgentProfileId,
              fixture.ownerA,
              nowMs,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const context = {
      activeOrganizationId: fixture.organizationA,
      agentControllerConversationId: await seedConnectorTaskSource(
        fixture,
        centerAgentProfileId,
        fixture.memberA,
        representedProfileId
      ),
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
      actionId: "github.create_issue_comment",
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
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
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
        requestSignature: "d".repeat(64),
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
        getPostgresDatabase(env)
          .query({
            ...{
              text: `
            SELECT operation_id
            FROM "openmeld"."center_agent_connector_action_operations"
            WHERE operation_id = $1
          `,
              values: [],
            },
            values: [rejectedOperationId],
          })
          .then((result) => result.rows[0] ?? null)
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT operation_id
          FROM "openmeld"."center_agent_connector_action_operations"
          WHERE operation_id = $1
        `,
            values: [],
          },
          values: [unrelatedFailureOperationId],
        })
        .then((result) => result.rows[0] ?? null)
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT operation_id
          FROM "openmeld"."center_agent_connector_action_operations"
          WHERE operation_id = $1
        `,
            values: [],
          },
          values: [missingMethodOperationId],
        })
        .then((result) => result.rows[0] ?? null)
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
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: `
          UPDATE "openmeld"."connector_connections"
          SET status = 'disconnected', disconnected_at_ms = $1, updated_at_ms = $2
          WHERE connection_name = $3
        `,
              values: [],
            },
            values: [nowMs + 1, nowMs + 1, fixture.connectionA],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."members" WHERE id = $1 AND organization_id = $2',
              values: [],
            },
            values: [fixture.memberAId, fixture.organizationA],
          },
          {
            ...{
              text: 'UPDATE "openmeld"."users" SET name = $1 WHERE id = $2',
              values: [],
            },
            values: ["Changed connector owner", fixture.memberA],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT provider_execution_id, status
          FROM "openmeld"."center_agent_connector_action_operations"
          WHERE operation_id = $1
        `,
            values: [],
          },
          values: [operationId],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({
      provider_execution_id: null,
      status: "pending",
    });
  });
  it.each([
    "github",
    "posthog",
  ] as const)("reauthorizes every %s replay against its original live connection", async (service) => {
    const fixture = await seedConnectorFixture();
    const center = await seedDesignatedCenterAgent(fixture);
    const connectionName = await seedSharedConnectorConnection(
      fixture,
      service
    );
    const member = await getPostgresDatabase(env)
      .query<{
        id: string;
      }>({
        ...{
          text: 'SELECT id FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
          values: [],
        },
        values: [fixture.organizationA, fixture.ownerA],
      })
      .then((result) => result.rows[0] ?? null);
    if (!member) {
      throw new Error("Missing requester member");
    }
    const body = {
      actionId:
        service === "github"
          ? "github.create_issue_comment"
          : "posthog.create_project",
      connectionName,
      context: center.context,
      effect: "write" as const,
      operationId: `live-replay-${crypto.randomUUID()}`,
      includeExecutionPermit: true as const,
      outcome: "attempted" as const,
      providerExecutionId: null,
      requestSignature: "a".repeat(64),
      service,
      speakerMember: { memberId: member.id, userId: fixture.ownerA },
    };
    const core = connectorCoreEnv();
    const first = await rpcCenterAgentRecordConnectorActionOperation(
      core,
      body
    );
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, body)
    ).resolves.toMatchObject({
      replayed: true,
      executionConnection: first.executionConnection,
      executionAllowed: false,
    });
    for (const permission of ["read", "none"] as const) {
      await getPostgresDatabase(env).query({
        ...{
          text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1 WHERE connection_name = $2',
          values: [],
        },
        values: [
          JSON.stringify({
            center_agent: permission,
            local_agent: "none",
            remote_agent: "none",
          }),
          connectionName,
        ],
      });
      await expect(
        rpcCenterAgentRecordConnectorActionOperation(core, body)
      ).rejects.toThrow("plugin.action_forbidden");
    }
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."connector_connections" SET access_policy = NULL, status = \'disconnected\', disconnected_at_ms = updated_at_ms WHERE connection_name = $1',
        values: [],
      },
      values: [connectionName],
    });
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, body)
    ).rejects.toThrow("center_agent.connector_action_connection_invalid");
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."connector_connections" SET status = \'active\', disconnected_at_ms = NULL, user_id = $1 WHERE connection_name = $2',
        values: [],
      },
      values: [fixture.otherMemberA, connectionName],
    });
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, body)
    ).rejects.toThrow("center_agent.connector_action_connection_invalid");
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."connector_connections" SET user_id = $1 WHERE connection_name = $2',
        values: [],
      },
      values: [fixture.ownerA, connectionName],
    });
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, {
        ...body,
        connectionName: "another-account",
      })
    ).rejects.toThrow("center_agent.connector_action_connection_invalid");
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE id = $1',
        values: [],
      },
      values: [member.id],
    });
    await expect(
      rpcCenterAgentRecordConnectorActionOperation(core, body)
    ).rejects.toThrow("center_agent.member_actor_required");
    const retained = await getPostgresDatabase(env)
      .query({
        ...{
          text: 'SELECT status, connection_name, connection_owner_user_id, connection_scope FROM "openmeld"."center_agent_connector_action_operations" WHERE operation_id = $1',
          values: [],
        },
        values: [body.operationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(retained).toMatchObject({
      status: "pending",
      connection_name: connectionName,
    });
    expect(retained).toMatchObject({
      connection_owner_user_id: fixture.ownerA,
      connection_scope: "shared",
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
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          created_at, updated_at
        ) VALUES ($1, 'Represented member', $2, 'human', 1, 'active', NULL, $3, $4, 'auth_bootstrap', $5, $6)
      `,
        values: [],
      },
      values: [
        representedProfileId,
        `represented-${crypto.randomUUID()}`,
        fixture.memberA,
        fixture.memberA,
        nowMs,
        nowMs,
      ],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."connector_connections" (
          connection_name, organization_id, user_id, service, status,
          created_at_ms, updated_at_ms, disconnected_at_ms
        ) VALUES ($1, $2, $3, 'gmail', 'active', $4, $5, NULL)
      `,
        values: [],
      },
      values: [
        gmailConnection,
        fixture.organizationA,
        fixture.memberA,
        nowMs,
        nowMs,
      ],
    });
    const sourceSpaceId = `space-${crypto.randomUUID()}`;
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId: null,
      bindingId: `binding-${crypto.randomUUID()}`,
      db: getPostgresDatabase(env),
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
      db: getPostgresDatabase(env),
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
      rpcCenterAgentRecordConnectorActionAudit(connectorCoreEnv(), {
        ...input,
        connectionName: undefined,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "plugin.connection_required" }),
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."connector_connections" SET access_policy = $1 WHERE connection_name = $2',
        values: [],
      },
      values: [
        JSON.stringify({
          center_agent: "read",
          local_agent: "none",
          remote_agent: "none",
        }),
        gmailConnection,
      ],
    });
    await expect(
      rpcCenterAgentRecordConnectorActionAudit(connectorCoreEnv(), input)
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "plugin.action_forbidden" }),
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."connector_connections" SET access_policy = NULL WHERE connection_name = $1',
        values: [],
      },
      values: [gmailConnection],
    });
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT requester_attribution_key, represented_user_id, source_native_delivery_id
          FROM "openmeld"."center_agent_connector_action_operations"
          WHERE operation_id = $1
        `,
            values: [],
          },
          values: [operationId],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({
      represented_user_id: fixture.memberA,
      requester_attribution_key: `user:${fixture.memberA}`,
      source_native_delivery_id: null,
    });
    await expect(
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT source_space_id
          FROM "openmeld"."center_agent_audit_journal"
          WHERE resource_id = $1
        `,
            values: [],
          },
          values: [`gmail:gmail.fetch_emails:${operationId}`],
        })
        .then((result) => result.rows[0] ?? null)
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
    await getPostgresDatabase(env).query({
      ...{
        text: `
          INSERT INTO "openmeld"."openmeld_profiles" (
            profile_id, profile_name, profile_handle, profile_kind, is_default,
            status, organization_id, owner_user_id, created_by_user_id, source,
            created_at, updated_at
          ) VALUES ($1, 'Represented member', $2, 'human', 1, 'active', NULL, $3, $4, 'auth_bootstrap', $5, $6)
        `,
        values: [],
      },
      values: [
        representedProfileId,
        `represented-${crypto.randomUUID()}`,
        fixture.memberA,
        fixture.memberA,
        nowMs,
        nowMs,
      ],
    });
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId: null,
      bindingId: `binding-${crypto.randomUUID()}`,
      conversationKind,
      db: getPostgresDatabase(env),
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
      db: getPostgresDatabase(env),
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: 'SELECT status FROM "openmeld"."connector_connections" WHERE connection_name = $1',
            values: [],
          },
          values: [fixture.connectionA],
        })
        .then((result) => result.rows[0] ?? null)
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
      db: getPostgresDatabase(env),
      organizationId: fixture.organizationA,
      preference: "automatic",
      requesterUserId: fixture.memberA,
      service: "github",
    });
    const selectedForB = await selectActiveConnectorConnection({
      db: getPostgresDatabase(env),
      organizationId: fixture.organizationB,
      preference: "automatic",
      requesterUserId: fixture.ownerB,
      service: "github",
    });
    expect(selectedForA?.connection.organizationId).toBe(fixture.organizationA);
    expect(selectedForA?.connection.connectionName).toBe(fixture.connectionA);
    expect(selectedForB).toBeNull();
  });
  it("discovers new provider identifiers without revealing another member's private connections", async () => {
    const fixture = await seedConnectorFixture();
    const center = await seedDesignatedCenterAgent(fixture);
    await getPostgresDatabase(env).query({
      text: 'UPDATE "openmeld"."connector_connections" SET service = $1 WHERE connection_name = $2',
      values: ["new_provider", fixture.connectionA],
    });
    const coreEnv = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    } as CoreBindings;
    expect(
      await rpcCenterAgentListConnectorServices(coreEnv, {
        context: center.context,
        requesterUserId: fixture.memberA,
      })
    ).toEqual({ services: ["new_provider"] });
    expect(
      await rpcCenterAgentListConnectorServices(coreEnv, {
        context: center.context,
        requesterUserId: fixture.otherMemberA,
      })
    ).toEqual({ services: [] });
    expect(
      await rpcCenterAgentListConnectorServices(coreEnv, {
        context: center.context,
        requesterUserId: null,
      })
    ).toEqual({ services: [] });
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
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
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
    const legacy = await rpcCenterAgentResolveConnectorConnection(
      coreEnv,
      input
    );
    expect(legacy).not.toHaveProperty("permission");
    await expect(
      rpcCenterAgentResolveConnectorConnection(coreEnv, {
        ...input,
        includeAccessPolicy: true,
      })
    ).resolves.toMatchObject({ permission: "write" });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [fixture.organizationA, fixture.memberA],
    });
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
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."connector_connections" (
          connection_name, organization_id, user_id, service, status,
          created_at_ms, updated_at_ms, disconnected_at_ms
        ) VALUES ($1, $2, $3, 'github', 'pending', $4, $5, NULL)
      `,
        values: [],
      },
      values: [
        availableConnection,
        fixture.organizationA,
        fixture.otherMemberA,
        nowMs,
        nowMs,
      ],
    });
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
        db: getPostgresDatabase(env),
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
        db: getPostgresDatabase(env),
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
        db: getPostgresDatabase(env),
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
        db: getPostgresDatabase(env),
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
        db: getPostgresDatabase(env),
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
        db: getPostgresDatabase(env),
        organizationId: fixture.organizationA,
        preference: "requester",
        requesterUserId: fixture.otherMemberA,
        service: "github",
      })
    ).resolves.toBeNull();
    await getPostgresDatabase(env).query({
      ...{
        text: `
        UPDATE "openmeld"."connector_connections"
        SET status = 'disconnected',
            disconnected_at_ms = updated_at_ms + 1,
            updated_at_ms = updated_at_ms + 1
        WHERE organization_id = $1
          AND connection_name = $2
      `,
        values: [],
      },
      values: [fixture.organizationA, sharedConnection],
    });
    await expect(
      selectActiveConnectorConnection({
        db: getPostgresDatabase(env),
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
        db: getPostgresDatabase(env),
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
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [fixture.organizationA, fixture.memberA],
    });
    await expect(
      selectActiveConnectorConnection({
        db: getPostgresDatabase(env),
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT action, actor_profile_id, resource_type
          FROM "openmeld"."center_agent_audit_journal"
          WHERE organization_id = $1
            AND action = 'start_shared_app_authorization'
          LIMIT 1
        `,
            values: [],
          },
          values: [fixture.organizationA],
        })
        .then((result) => result.rows[0] ?? null)
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
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT action
          FROM "openmeld"."center_agent_audit_journal"
          WHERE organization_id = $1
            AND action = 'disconnect_shared_app'
          LIMIT 1
        `,
            values: [],
          },
          values: [fixture.organizationA],
        })
        .then((result) => result.rows[0] ?? null)
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
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."members" SET role = \'member\' WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [fixture.organizationA, fixture.ownerA],
    });
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
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
        VALUES ($1, $2, $3, 1, $4, $5)
      `,
        values: [],
      },
      values: [userId, userId, `${userId}@example.com`, nowMs, nowMs],
    });
  }
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
            values: [],
          },
          values: [
            organizationA,
            "Connector A",
            `connector-a-${suffix}`,
            nowMs,
          ],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
            values: [],
          },
          values: [
            organizationB,
            "Connector B",
            `connector-b-${suffix}`,
            nowMs,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id, profile_name, profile_handle, profile_kind, is_default,
        status, organization_id, owner_user_id, created_by_user_id, source,
        created_at, updated_at
      ) VALUES ($1, 'Connector owner', $2, 'human', 1, 'active', NULL, $3, $4, 'auth_bootstrap', $5, $6)
    `,
      values: [],
    },
    values: [
      ownerProfileId,
      `connector-owner-${suffix}`,
      ownerA,
      ownerA,
      nowMs,
      nowMs,
    ],
  });
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
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
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  const connectionA = await createConnectorConnectionName({
    organizationId: organizationA,
    service: "github",
    userId: memberA,
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."connector_connections" (
        connection_name, organization_id, user_id, service, status,
        created_at_ms, updated_at_ms, disconnected_at_ms
      ) VALUES ($1, $2, $3, 'github', 'active', $4, $5, NULL)
    `,
      values: [],
    },
    values: [connectionA, organizationA, memberA, nowMs, nowMs],
  });
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
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."connector_connections" (
        connection_name, organization_id, user_id, scope, service, status,
        created_at_ms, updated_at_ms, disconnected_at_ms
      ) VALUES ($1, $2, $3, 'shared', $4, 'active', $5, $6, NULL)
    `,
      values: [],
    },
    values: [
      connectionName,
      fixture.organizationA,
      fixture.ownerA,
      service,
      Date.now(),
      Date.now(),
    ],
  });
  return connectionName;
}
async function seedDesignatedCenterAgent(
  fixture: Awaited<ReturnType<typeof seedConnectorFixture>>
) {
  const profileId = `agt_${crypto.randomUUID()}`;
  const nowMs = Date.now();
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, 'auth_bootstrap', 'center_agent', $5, $6)
      `,
            values: [],
          },
          values: [
            profileId,
            `center-agent-${crypto.randomUUID()}`,
            fixture.organizationA,
            fixture.ownerA,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."center_agent_designations" (
          organization_id, agent_profile_id, duty, designated_by, created_at
        ) VALUES ($1, $2, NULL, $3, $4)
      `,
            values: [],
          },
          values: [fixture.organizationA, profileId, fixture.ownerA, nowMs],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return {
    context: {
      activeOrganizationId: fixture.organizationA,
      agentControllerConversationId: await seedConnectorTaskSource(
        fixture,
        profileId
      ),
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

async function seedConnectorTaskSource(
  fixture: Awaited<ReturnType<typeof seedConnectorFixture>>,
  profileId: string,
  userId = fixture.ownerA,
  humanProfileId = fixture.ownerProfileId
) {
  const idempotencyKey = crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  const nowMs = Date.now();
  await upsertRemoteAgentNativeDeliveryRecord({
    db: getPostgresDatabase(env),
    attemptId: null,
    bindingId: crypto.randomUUID(),
    dispatchId: crypto.randomUUID(),
    idempotencyKey,
    nowMs,
    organizationId: fixture.organizationA,
    profileId,
    spaceId: crypto.randomUUID(),
    triggerMessageId: crypto.randomUUID(),
    status: "submitted",
    onBehalfOfUserId: userId,
    onBehalfOfProfileId: humanProfileId,
    onBehalfOfDisplayName: "Synthetic requester",
  });
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db: getPostgresDatabase(env),
    idempotencyKey,
    nowMs,
    submissionId,
  });
  return submissionId;
}

function connectorCoreEnv(): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: {
      resolveUserDisplayName: async (input: { userId: string }) => {
        const row = await getPostgresDatabase(env)
          .query<{
            email: string;
            id: string;
            name: string | null;
          }>({
            ...{
              text: `
            SELECT id, name, email
            FROM "openmeld"."users"
            WHERE id = $1
            LIMIT 1
          `,
              values: [],
            },
            values: [input.userId],
          })
          .then((result) => result.rows[0] ?? null);
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
    OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
  } as unknown as CoreBindings;
}
function memberStatement(input: {
  id: string;
  organizationId: string;
  role: string;
  userId: string;
}): QueryConfig {
  return {
    ...{
      text: `
      INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
      values: [],
    },
    values: [
      input.id,
      input.organizationId,
      input.userId,
      input.role,
      Date.now(),
    ],
  };
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
