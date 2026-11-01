import { projectPluginActionRequestView } from "@openmeld/schemas";
import type { CenterAgentRecordConnectorActionOperationBody } from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expirePluginActionRecoveryInputs,
  readApprovedPluginAction,
  retryApprovedPluginActionRequests,
  rpcPluginActionRequest,
} from "../src/connectors/plugin-action-requests";
import type { CoreBindings } from "../src/lib/bindings";
import { prepareProjectIssueActionAdmission } from "../src/projects/project-issue-action-admission";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const owner = vi.hoisted(() => ({
  binding: vi.fn(),
  access: vi.fn(),
  continue: vi.fn(),
}));
vi.mock("../src/connectors/plugin-connection-continuation", () => ({
  continuePluginConnection: owner.continue,
}));
vi.mock("../src/connectors/plugin-connection-execution-binding", () => ({
  readPluginConnectionExecutionBinding: owner.binding,
}));
vi.mock(
  "../src/remote-agent/application/remote-agent-execution-access",
  () => ({
    authorizeRemoteAgentExecutionAccess: owner.access,
  })
);
vi.mock(
  "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo",
  () => ({
    readRemoteAgentNativeDeliveryByDeliveryId: async () => ({
      organizationId: "org-1",
      spaceId: "space-1",
      profileId: "agt_00000000-0000-4000-8000-000000000001",
      triggerMessageId: "walkthrough-source",
      status: "completed",
      publishedSignalId: "approval-explanation",
    }),
    readRemoteAgentNativeDeliveryBySubmissionId: async () => ({
      organizationId: "org-1",
      spaceId: "space-1",
      profileId: "agt_00000000-0000-4000-8000-000000000001",
    }),
  })
);
vi.mock("../src/projects/project-rpc", () => ({
  resolveAdmittedProjectIssueAction: async () => ({
    basis: "confirmation_required",
    destination: { provider: "linear", teamId: "team-1" },
    projectId: null,
    projectRevision: null,
  }),
}));

const profileId = "agt_00000000-0000-4000-8000-000000000001";
const context = {
  activeOrganizationId: "org-1",
  agentControllerConversationId: "resumed-submission",
  actorContext: {
    requestId: "recovery",
    profileKind: "agent" as const,
    openMeldProfileId: profileId,
  },
};
const connection = {
  connectionName: "synthetic-linear",
  service: "linear" as const,
  scope: "shared" as const,
  ownerUserId: "user-1",
  ownerDisplayName: "Synthetic member",
};
let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
let env: CoreBindings;

beforeEach(async () => {
  harness = await createPostgresHarness();
  await harness.query({
    text: "INSERT INTO openmeld.users (id,name,email,created_at,updated_at) VALUES ('user-1','Member','member@example.test',1,1)",
    values: [],
  });
  await harness.query({
    text: "INSERT INTO openmeld.organizations (id,name,slug,created_at) VALUES ('org-1','Synthetic','synthetic',1)",
    values: [],
  });
  await harness.query({
    text: "INSERT INTO openmeld.members (id,organization_id,user_id,role,created_at) VALUES ('member-1','org-1','user-1','owner',1)",
    values: [],
  });
  await harness.query({
    text: "INSERT INTO openmeld.openmeld_profiles (profile_id,profile_name,profile_handle,profile_kind,organization_id,owner_user_id,source) VALUES ($1,'Agent','synthetic-agent','agent','org-1','user-1','cli_create')",
    values: [profileId],
  });
  await harness.query({
    text: `INSERT INTO openmeld.connector_connections (connection_name,organization_id,user_id,scope,service,status,created_at_ms,updated_at_ms,access_policy,access_revision)
      VALUES ('synthetic-linear','org-1','user-1','shared','linear','active',1000,1000,'{"center_agent":"write","local_agent":"none","remote_agent":"none"}',1)`,
    values: [],
  });
  env = {
    OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
  } as CoreBindings;
  owner.access.mockResolvedValue({
    scope: {
      organizationId: "org-1",
      principal: { kind: "member", userId: "user-1" },
    },
  });
  owner.continue
    .mockReset()
    .mockResolvedValue({ signalId: "approved-continuation" });
});
afterEach(async () => {
  await harness.close();
});

async function pending(
  operationId = "ton-walk-1315-ONB-01",
  signature?: string
) {
  const input = {
    team_id: "team-1",
    title: "Walkthrough ONB-01",
    description: "原始正文\nKeep exact punctuation, Unicode and whitespace.",
  };
  const requestSignature =
    signature ??
    (await digestCanonicalJson({
      actionId: "linear.create_linear_issue",
      connectionName: connection.connectionName,
      input,
      service: "linear",
    }));
  const operation: CenterAgentRecordConnectorActionOperationBody = {
    actionId: "linear.create_linear_issue",
    effect: "write",
    connectionName: connection.connectionName,
    operationId,
    outcome: "attempted",
    providerExecutionId: null,
    requestSignature,
    issueDestination: { provider: "linear", teamId: "team-1" },
    issueActionRecovery: { input },
    service: "linear",
    speakerMember: { memberId: "member-1", userId: "user-1" },
  };
  const failure = await prepareProjectIssueActionAdmission({
    db: harness.db,
    env,
    context,
    organizationId: "org-1",
    actorProfileId: profileId,
    userId: "user-1",
    operation,
    existingOperation: false,
    sourceRequestKey: "original-delivery",
    sourceSpaceId: "space-1",
    sourceNativeDeliveryId: "original-delivery",
    connection,
    connectionUpdatedAtMs: 1000,
    personalExecution: false,
  }).then(
    () => null,
    (error: unknown) => error
  );
  const expectedCode = signature
    ? "recovery_input_mismatch"
    : "project.issue_confirmation_required";
  if (!(failure instanceof Error && failure.message.includes(expectedCode))) {
    throw new Error(
      "The fixture did not stop at its expected admission boundary.",
      { cause: failure }
    );
  }
  const row = (
    await harness.query<{ id: string; request_json: string }>({
      text: "SELECT id, request_json FROM openmeld.plugin_action_requests WHERE operation_id=$1",
      values: [operationId],
    })
  ).rows[0];
  if (!row) {
    throw new Error("No approval persisted");
  }
  return { row, input };
}
async function approve(id: string) {
  await harness.query({
    text: "UPDATE openmeld.plugin_action_requests SET state='approved' WHERE id=$1",
    values: [id],
  });
  owner.binding.mockResolvedValue({
    approvedActionRequestId: id,
    service: "linear",
    scope: "shared",
    connectionName: connection.connectionName,
    connectionUpdatedAtMs: 1000,
    source: { signalId: "walkthrough-source" },
  });
}

describe("Private approved action recovery", () => {
  it("shows original issue content only in opted-in recipient detail, without broad input or Inbox disclosure", async () => {
    const { row, input } = await pending();
    // Vendor contract: oomol-lab/open-connector @9da975b, Linear run_query
    // returns { data: GraphQL data }; team fields come from Linear's Team type.
    const runtime = vi.fn().mockResolvedValue({
      status: "completed",
      data: { data: { team: { id: "team-1", name: "Product engineering" } } },
      outputSchema: {},
      providerExecutionId: "preview-read",
    });
    env.OPENMELD_REMOTE_AGENT_WORKER = { pluginRuntime: runtime } as never;
    const read = {
      expectedOrganizationId: "org-1",
      context: {
        activeOrganizationId: "org-1",
        actorContext: {
          requestId: "preview-read",
          profileKind: "human" as const,
          openMeldProfileId: "00000000-0000-4000-8000-000000000002",
          callerPrincipalId: "user-1",
        },
      },
      command: { operation: "read" as const, requestId: row.id },
    };
    const legacy = await rpcPluginActionRequest(env, read);
    expect(legacy).not.toHaveProperty("issuePreview");
    expect(runtime).not.toHaveBeenCalled();
    const detail = await rpcPluginActionRequest(env, {
      ...read,
      includeIssuePreview: true,
    });
    expect(detail.issuePreview).toEqual({
      title: input.title,
      description: input.description,
      targets: [{ label: "Team", id: "team-1", name: "Product engineering" }],
      additionalFieldCount: 0,
    });
    expect(runtime).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionName: connection.connectionName,
        actionId: "linear.run_query",
        authorizedEffect: "read",
      })
    );
    expect(projectPluginActionRequestView(detail, true)).not.toHaveProperty(
      "issuePreview"
    );
    expect(
      projectPluginActionRequestView(detail, true, true).issuePreview
    ).toEqual(detail.issuePreview);
    const agent = await rpcPluginActionRequest(env, {
      ...read,
      includeIssuePreview: true,
      context: {
        ...read.context,
        actorContext: { ...read.context.actorContext, profileKind: "agent" },
      },
    });
    expect(agent).not.toHaveProperty("issuePreview");
    const inbox = await harness.query<{ preview: string }>({
      text: "SELECT preview FROM openmeld.inbox_items WHERE recipient_user_id='user-1'",
      values: [],
    });
    expect(JSON.stringify(inbox.rows)).not.toContain(input.title);
    expect(JSON.stringify(inbox.rows)).not.toContain(input.description);
  });

  it("withholds issue content if account access changes during the provider read", async () => {
    const { row } = await pending();
    env.OPENMELD_REMOTE_AGENT_WORKER = {
      pluginRuntime: async () => {
        await harness.query({
          text: "UPDATE openmeld.connector_connections SET access_revision=2 WHERE connection_name=$1",
          values: [connection.connectionName],
        });
        return {
          status: "completed",
          data: { data: { team: { id: "team-1", name: "Product" } } },
          outputSchema: {},
          providerExecutionId: "read",
        };
      },
    } as never;
    const detail = await rpcPluginActionRequest(env, {
      expectedOrganizationId: "org-1",
      includeIssuePreview: true,
      context: {
        activeOrganizationId: "org-1",
        actorContext: {
          requestId: "preview-revocation",
          profileKind: "human",
          callerPrincipalId: "user-1",
          openMeldProfileId: "00000000-0000-4000-8000-000000000002",
        },
      },
      command: { operation: "read", requestId: row.id },
    });
    expect(detail.state).toBe("revoked");
    expect(detail).not.toHaveProperty("issuePreview");
  });

  it("keeps recovery pending until a compatible executor is available and sends one continuation", async () => {
    const { row } = await pending();
    await approve(row.id);
    const continuation = { context, state: "pending", signalId: null };
    await harness.query({
      text: "UPDATE openmeld.plugin_action_requests SET decided_at_ms=$1, continuation_json=$2 WHERE id=$3",
      values: [Date.now(), JSON.stringify(continuation), row.id],
    });
    const state = async () =>
      JSON.parse(
        (
          await harness.query<{ continuation_json: string }>({
            text: "SELECT continuation_json FROM openmeld.plugin_action_requests WHERE id=$1",
            values: [row.id],
          })
        ).rows[0]?.continuation_json ?? "null"
      );
    await retryApprovedPluginActionRequests(env);
    expect(await state()).toEqual(continuation);
    expect(owner.continue).not.toHaveBeenCalled();
    env.OPENMELD_REMOTE_AGENT_WORKER = {
      readSubmitTurnCapabilities: async () => ({
        v: 1,
        taskId: true,
        pluginActionRecovery: true,
      }),
    };
    await retryApprovedPluginActionRequests(env);
    await retryApprovedPluginActionRequests(env);
    expect(await state()).toMatchObject({
      state: "requested",
      signalId: "approved-continuation",
    });
    expect(owner.continue).toHaveBeenCalledOnce();
  });
  it("persists the exact input before approval and returns only the operation bound to the admitted continuation", async () => {
    const first = await pending();
    expect(JSON.parse(first.row.request_json).recovery.input).toEqual(
      first.input
    );
    const other = await pending("ton-circle-list-relationship-view-1028-v2");
    await approve(other.row.id);
    await approve(first.row.id);
    const result = await readApprovedPluginAction(env, { context });
    expect(result.action).toMatchObject({
      requestId: first.row.id,
      operationId: "ton-walk-1315-ONB-01",
      recovery: { input: first.input },
    });
    expect(result.action?.requestId).not.toBe(other.row.id);
  });

  it.each([
    "requester",
    "source",
    "access-revision",
    "expired",
    "rejected",
  ] as const)("does not disclose or execute retained input after %s changes", async (change) => {
    const { row } = await pending();
    await approve(row.id);
    if (change === "requester") {
      owner.access.mockResolvedValue({
        scope: {
          organizationId: "org-1",
          principal: { kind: "member", userId: "other-user" },
        },
      });
    }
    if (change === "source") {
      owner.binding.mockResolvedValue({
        ...(await owner.binding()),
        source: { signalId: "circle-source" },
      });
    }
    if (change === "access-revision") {
      await harness.query({
        text: "UPDATE openmeld.connector_connections SET access_revision=2",
        values: [],
      });
    }
    if (change === "expired") {
      await harness.query({
        text: "UPDATE openmeld.plugin_action_requests SET expires_at_ms=1 WHERE id=$1",
        values: [row.id],
      });
    }
    if (change === "rejected") {
      await harness.query({
        text: "UPDATE openmeld.plugin_action_requests SET state='rejected' WHERE id=$1",
        values: [row.id],
      });
    }
    await expect(readApprovedPluginAction(env, { context })).rejects.toThrow(
      "recovery_unavailable"
    );
  });

  it("rejects a body that does not match the signed operation and expires private recovery bodies without deleting decision identity", async () => {
    await expect(pending("tampered", "f".repeat(64))).rejects.toThrow(
      "No approval persisted"
    );
    const { row } = await pending();
    await harness.query({
      text: "UPDATE openmeld.plugin_action_requests SET expires_at_ms=1 WHERE id=$1",
      values: [row.id],
    });
    await expirePluginActionRecoveryInputs(harness.db, Date.now());
    const saved = (
      await harness.query<{ request_json: string; operation_id: string }>({
        text: "SELECT request_json, operation_id FROM openmeld.plugin_action_requests WHERE id=$1",
        values: [row.id],
      })
    ).rows[0];
    if (!saved) {
      throw new Error("Decision identity was deleted");
    }
    expect(JSON.parse(saved.request_json)).not.toHaveProperty("recovery");
    expect(saved.operation_id).toBe("ton-walk-1315-ONB-01");
  });
});
