import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type {
  AuthRpcProfileFact,
  RequestCredential,
  RiskWindowExecutionsResponse,
  TaskCredentialResolution,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { env } from "../test-support/worker-env";

// Sensitive operation sources (design-plans/member-agent-program.md §4.7,
// §6; decisions in member-agent-program-reviews/5-credentials.md). The owner
// shard's two reads are stubbed; tests/runtime-transport-runtime-coordinator-
// contract.test.ts covers them against RuntimeCoordinator state.

const feature = vi.hoisted(() => ({ enabled: true }));
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => feature.enabled,
  isRequestChainEnforced: () => feature.enabled,
}));

const shard = vi.hoisted(() => ({
  riskWindow: { executions: [], status: "ready" } as unknown,
  taskCredential: { reasonCode: "unset", status: "rejected" } as unknown,
}));
vi.mock(
  "../src/dispatch/infrastructure/runtime-transport/runtime-transport-shard",
  () => ({
    resolveRuntimeTransportOwnerShard: () => ({
      rpcReadRiskWindowExecutions: () => Promise.resolve(shard.riskWindow),
      rpcResolveTaskCredential: () => Promise.resolve(shard.taskCredential),
    }),
  })
);

const facts = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/auth/application/profile-facts-reader", () => ({
  readAuthProfileFacts: (input: { profileIds: string[] }) =>
    Promise.resolve(
      new Map(input.profileIds.map((id) => [id, facts.get(id) ?? null]))
    ),
}));

const { runGatewaySensitiveOperation } = await import(
  "../src/sensitive-operations/application/sensitive-operation-gate"
);
const { GatewayRpcEntrypoint } = await import("../src/index");
const {
  rpcAuthorizeSensitiveOperation,
  rpcDecideCredentialConfirmation,
  rpcGetCredentialConfirmation,
  rpcListMemberAgentSensitiveOperationAudit,
  rpcRecordSensitiveOperationOutcome,
} = await import("../src/sensitive-operations/sensitive-operation-rpc");

const coreEnv = env as unknown as CoreBindings;

afterEach(() => {
  feature.enabled = true;
  shard.riskWindow = { executions: [], status: "ready" };
  shard.taskCredential = { reasonCode: "unset", status: "rejected" };
  facts.clear();
});

type Person = { name: string; profileId: string; userId: string };
type Fixture = {
  agentProfileId: string;
  felix: Person;
  memberAgentId: string;
  organizationId: string;
  tali: Person;
};

const LAPTOP = "runtime-laptop";
const DESKTOP = "runtime-desktop";

async function seed(): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const organizationId = `org_credentials_${suffix}`;
  const person = (name: string): Person => ({
    name,
    profileId: crypto.randomUUID(),
    userId: `user_${name.toLowerCase()}_${suffix}`,
  });
  const felix = person("Felix");
  const tali = person("Tali");
  const agentProfileId = `agt_${crypto.randomUUID()}`;
  const memberAgentId = `ma_${suffix}`;
  const now = Date.now();
  await getPostgresDatabase(env).transaction(async (client) => {
    await client.query({
      text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, 'Credentials', $2, $3)`,
      values: [organizationId, `credentials-${suffix}`, now],
    });
    for (const member of [felix, tali]) {
      await client.query({
        text: `INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $4)`,
        values: [
          member.userId,
          member.name,
          `${member.userId}@example.com`,
          now,
        ],
      });
      await client.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, $2, $3, 'human', 1, 'active', $4, $4, 'auth_bootstrap', $5, $5)`,
        values: [
          member.profileId,
          member.name,
          `${member.name.toLowerCase()}-${suffix}`,
          member.userId,
          now,
        ],
      });
      await client.query({
        text: `INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', $4)`,
        values: [`member_${member.userId}`, organizationId, member.userId, now],
      });
    }
    await client.query({
      text: `INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source, created_at, updated_at) VALUES ($1, $2, $3, 'claude-code', 'detected', $4, $4)`,
      values: [memberAgentId, organizationId, felix.userId, now],
    });
    await client.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, member_agent_id, created_at, updated_at) VALUES ($1, 'PR Reviewer', $1, 'agent', 0, 'active', $2, $3, $3, 'cli_create', $4, $5, $5)`,
      values: [
        agentProfileId,
        organizationId,
        felix.userId,
        memberAgentId,
        now,
      ],
    });
  });
  const fact = (
    profileId: string,
    profileKind: "agent" | "human",
    ownerUserId: string
  ): AuthRpcProfileFact => ({
    organizationId,
    ownerUserId,
    profileHandle: profileId,
    profileId,
    profileKind,
    profileName: profileId,
    status: "active",
  });
  facts.set(felix.profileId, fact(felix.profileId, "human", felix.userId));
  facts.set(tali.profileId, fact(tali.profileId, "human", tali.userId));
  facts.set(agentProfileId, fact(agentProfileId, "agent", felix.userId));
  return { agentProfileId, felix, memberAgentId, organizationId, tali };
}

function contextFor(f: Fixture, person: Person): OpenMeldRequestContext {
  return {
    activeOrganizationId: f.organizationId,
    actorContext: {
      callerPrincipalId: person.userId,
      openMeldProfileId: person.profileId,
      ownerUserId: person.userId,
      profileKind: "human",
      profileName: person.name,
      requestId: crypto.randomUUID(),
    },
  };
}

const TASK_CREDENTIAL = {
  executionToken: `rcet_v1_${"a".repeat(64)}`,
  runId: "run-1",
  runtimeCoordinatorExecutionId: "rcx-task",
  tokenFingerprint: `etfp_v1_${"c".repeat(32)}`,
};

/** A running task on the owner's computer, for the risk window. */
function runningTask(input: {
  rootProfileId: string | null;
  runtimeId: string;
  targetProfileId: string;
}): RiskWindowExecutionsResponse {
  return {
    executions: [
      {
        openMeldServiceRuntimeId: input.runtimeId,
        rootProfileId: input.rootProfileId,
        targetProfileId: input.targetProfileId,
      },
    ],
    status: "ready",
  };
}

/** The permission-mode write, standing in for every §6 operation. */
async function setPermissionMode(
  f: Fixture,
  credential: RequestCredential,
  change: () => Promise<string>,
  mode = "full_access"
) {
  return await runGatewaySensitiveOperation(
    coreEnv,
    {
      agentControllerPermissionMode: mode,
      agentProfileId: f.agentProfileId,
      context: contextFor(f, f.felix),
      requestCredential: credential,
    },
    {
      agentProfileId: f.agentProfileId,
      operation: "binding_permission_mode",
    },
    async (operationInput) => {
      // The credential never travels past the gate.
      if ("requestCredential" in operationInput) {
        throw new Error("The task credential leaked past the gate.");
      }
      return await change();
    }
  );
}

async function readAudit(f: Fixture) {
  return (
    await getPostgresDatabase(env).query<{
      chain_root_profile_id: string | null;
      confirmation_id: string | null;
      outcome: string;
      reason_code: string | null;
      source_kind: string;
      task_execution_id: string | null;
    }>({
      text: `SELECT source_kind, outcome, chain_root_profile_id, task_execution_id, confirmation_id, reason_code
        FROM "openmeld"."sensitive_operation_audit_events"
        WHERE organization_id = $1 ORDER BY created_at_ms, id`,
      values: [f.organizationId],
    })
  ).rows;
}

async function readConfirmationInboxItems(f: Fixture) {
  return (
    await getPostgresDatabase(env).query<{
      importance: string;
      kind: string;
      preview: string;
      recipient_user_id: string;
      resolution_status: string;
    }>({
      text: `SELECT kind, importance, recipient_user_id, resolution_status, preview
        FROM "openmeld"."inbox_items"
        WHERE organization_id = $1 AND source_kind = 'credential_confirmation'`,
      values: [f.organizationId],
    })
  ).rows;
}

function interactive(): RequestCredential {
  return { kind: "interactive_session" };
}

function cli(confirmationId?: string): RequestCredential {
  return {
    kind: "cli_credential",
    ...(confirmationId ? { confirmationId } : {}),
  };
}

describe("sensitive operation credentials", () => {
  it("turns a colleague-rooted task's CLI call into a confirmation card, not a change", async () => {
    const f = await seed();
    shard.riskWindow = runningTask({
      rootProfileId: f.tali.profileId,
      runtimeId: LAPTOP,
      targetProfileId: f.agentProfileId,
    });
    const change = vi.fn(async () => "changed");
    const handle = crypto.randomUUID().replaceAll("-", "");

    await expect(setPermissionMode(f, cli(handle), change)).rejects.toThrow(
      "credential_confirmation.required"
    );
    // Asking again does not open a second card.
    await expect(setPermissionMode(f, cli(handle), change)).rejects.toThrow(
      "credential_confirmation.required"
    );
    expect(change).not.toHaveBeenCalled();
    expect(await readConfirmationInboxItems(f)).toEqual([
      expect.objectContaining({
        importance: "urgent",
        kind: "credential_confirmation",
        recipient_user_id: f.felix.userId,
        resolution_status: "open",
      }),
    ]);
    const [item] = await readConfirmationInboxItems(f);
    expect(item?.preview).not.toContain("full_access");

    // The waiting CLI polls the same handle.
    const pending = await rpcGetCredentialConfirmation(coreEnv, {
      confirmationId: handle,
      context: contextFor(f, f.felix),
    });
    expect(pending.confirmation).toMatchObject({
      agentProfileId: f.agentProfileId,
      operation: "binding_permission_mode",
      status: "pending",
    });

    // Neither the CLI credential nor a task can answer it.
    for (const requestCredential of [
      cli(),
      { kind: "cli_credential", taskCredential: TASK_CREDENTIAL } as const,
    ]) {
      await expect(
        rpcDecideCredentialConfirmation(coreEnv, {
          body: { decision: "approve" },
          confirmationId: handle,
          context: contextFor(f, f.felix),
          requestCredential,
        })
      ).rejects.toThrow("credential_confirmation.interactive_session_required");
    }
    // Nor a colleague, even signed in on the web.
    await expect(
      rpcDecideCredentialConfirmation(coreEnv, {
        body: { decision: "approve" },
        confirmationId: handle,
        context: contextFor(f, f.tali),
        requestCredential: interactive(),
      })
    ).rejects.toThrow("credential_confirmation.not_found");

    await rpcDecideCredentialConfirmation(coreEnv, {
      body: { decision: "approve" },
      confirmationId: handle,
      context: contextFor(f, f.felix),
      requestCredential: interactive(),
    });
    expect(await readConfirmationInboxItems(f)).toEqual([
      expect.objectContaining({ resolution_status: "resolved" }),
    ]);
    // A different change is not covered by this approval.
    await expect(
      setPermissionMode(f, cli(), change, "ask_first")
    ).rejects.toThrow("credential_confirmation.required");
    expect(change).not.toHaveBeenCalled();

    // The same request now runs once; the approval is used up.
    await expect(setPermissionMode(f, cli(handle), change)).resolves.toBe(
      "changed"
    );
    expect(change).toHaveBeenCalledTimes(1);
    await expect(setPermissionMode(f, cli(handle), change)).rejects.toThrow(
      "credential_confirmation.required"
    );
    expect(change).toHaveBeenCalledTimes(1);

    expect(
      (await readAudit(f)).map((row) => [row.source_kind, row.outcome])
    ).toEqual([
      ["cli_credential", "confirmation_required"],
      ["cli_credential", "confirmation_required"],
      ["cli_credential", "confirmation_required"],
      ["cli_credential", "succeeded"],
      ["cli_credential", "confirmation_required"],
    ]);
  });

  it("refuses the change when the owner declines", async () => {
    const f = await seed();
    shard.riskWindow = runningTask({
      rootProfileId: f.tali.profileId,
      runtimeId: LAPTOP,
      targetProfileId: f.agentProfileId,
    });
    const change = vi.fn(async () => "changed");
    const handle = crypto.randomUUID().replaceAll("-", "");
    await expect(setPermissionMode(f, cli(handle), change)).rejects.toThrow(
      "credential_confirmation.required"
    );
    await rpcDecideCredentialConfirmation(coreEnv, {
      body: { decision: "decline" },
      confirmationId: handle,
      context: contextFor(f, f.felix),
      requestCredential: interactive(),
    });
    await expect(setPermissionMode(f, cli(handle), change)).rejects.toThrow(
      "credential_confirmation.declined"
    );
    expect(change).not.toHaveBeenCalled();
    expect((await readAudit(f)).at(-1)).toMatchObject({
      outcome: "declined",
      source_kind: "cli_credential",
    });
  });

  it("never interrupts the owner's terminal when no task with another root is running", async () => {
    const f = await seed();
    const change = vi.fn(async () => "changed");
    await expect(setPermissionMode(f, cli(), change)).resolves.toBe("changed");
    // The owner's own task running is not a risk.
    shard.riskWindow = runningTask({
      rootProfileId: f.felix.profileId,
      runtimeId: LAPTOP,
      targetProfileId: f.agentProfileId,
    });
    await expect(setPermissionMode(f, cli(), change)).resolves.toBe("changed");
    // Nor is a colleague's task for a Profile in another Organization.
    shard.riskWindow = runningTask({
      rootProfileId: f.tali.profileId,
      runtimeId: LAPTOP,
      targetProfileId: "agt_elsewhere",
    });
    facts.set("agt_elsewhere", {
      ...(facts.get(f.agentProfileId) as AuthRpcProfileFact),
      organizationId: "org_elsewhere",
      profileId: "agt_elsewhere",
    });
    await expect(setPermissionMode(f, cli(), change)).resolves.toBe("changed");
    expect(change).toHaveBeenCalledTimes(3);
    expect(await readConfirmationInboxItems(f)).toEqual([]);
    expect(await readAudit(f)).toEqual([
      expect.objectContaining({
        chain_root_profile_id: f.felix.profileId,
        outcome: "succeeded",
        source_kind: "cli_credential",
      }),
      expect.objectContaining({ outcome: "succeeded" }),
      expect.objectContaining({ outcome: "succeeded" }),
    ]);
  });

  it("treats an unverifiable or rootless running task as the risk window", async () => {
    const f = await seed();
    const change = vi.fn(async () => "changed");
    shard.riskWindow = {
      reasonCode: "runtime_coordinator.execution_state_rebuilding",
      status: "unavailable",
    };
    await expect(setPermissionMode(f, cli(), change)).rejects.toThrow(
      "credential_confirmation.required"
    );
    shard.riskWindow = runningTask({
      rootProfileId: null,
      runtimeId: LAPTOP,
      targetProfileId: f.agentProfileId,
    });
    await expect(
      setPermissionMode(f, cli(), change, "ask_first")
    ).rejects.toThrow("credential_confirmation.required");
    expect(change).not.toHaveBeenCalled();
  });

  it("accepts the owner's own Web or App session without reading the window", async () => {
    const f = await seed();
    shard.riskWindow = runningTask({
      rootProfileId: f.tali.profileId,
      runtimeId: LAPTOP,
      targetProfileId: f.agentProfileId,
    });
    const change = vi.fn(async () => "changed");
    await expect(setPermissionMode(f, interactive(), change)).resolves.toBe(
      "changed"
    );
    expect(await readAudit(f)).toEqual([
      expect.objectContaining({
        chain_root_profile_id: f.felix.profileId,
        outcome: "succeeded",
        source_kind: "web_session",
      }),
    ]);
  });

  it("accepts a task credential rooted at the owner and rejects expired or colleague-rooted ones", async () => {
    const f = await seed();
    const change = vi.fn(async () => "changed");
    const task = (credential: Partial<TaskCredentialResolution> = {}) => {
      shard.taskCredential = {
        openMeldServiceRuntimeId: LAPTOP,
        rootProfileId: f.felix.profileId,
        runtimeCoordinatorExecutionId:
          TASK_CREDENTIAL.runtimeCoordinatorExecutionId,
        status: "valid",
        targetProfileId: f.agentProfileId,
        ...credential,
      };
    };
    const withTask: RequestCredential = {
      kind: "cli_credential",
      taskCredential: TASK_CREDENTIAL,
    };

    task();
    await expect(setPermissionMode(f, withTask, change)).resolves.toBe(
      "changed"
    );

    // An ended (expired) task's credential.
    shard.taskCredential = {
      reasonCode: "execution_token_terminal_late",
      status: "rejected",
    };
    await expect(setPermissionMode(f, withTask, change)).rejects.toThrow(
      "task_credential.rejected"
    );
    // A colleague-rooted task's credential: the chain root is not the owner.
    task({ rootProfileId: f.tali.profileId });
    await expect(setPermissionMode(f, withTask, change)).rejects.toThrow(
      "sensitive_operation.root_not_owner"
    );
    // A task without a recorded root.
    task({ rootProfileId: null });
    await expect(setPermissionMode(f, withTask, change)).rejects.toThrow(
      "task_credential.rejected"
    );
    expect(change).toHaveBeenCalledTimes(1);
    expect(await readAudit(f)).toEqual([
      expect.objectContaining({
        chain_root_profile_id: f.felix.profileId,
        outcome: "succeeded",
        source_kind: "task_credential",
        task_execution_id: TASK_CREDENTIAL.runtimeCoordinatorExecutionId,
      }),
      expect.objectContaining({
        outcome: "rejected",
        reason_code: "execution_token_terminal_late",
        source_kind: "task_credential",
      }),
      expect.objectContaining({
        chain_root_profile_id: f.tali.profileId,
        outcome: "rejected",
        reason_code: "sensitive_operation.root_not_owner",
        source_kind: "task_credential",
      }),
      expect.objectContaining({
        outcome: "rejected",
        reason_code: "task_credential.chain_missing",
        source_kind: "task_credential",
      }),
    ]);
  });

  it("asks the owner when a colleague's task runs next to an owner-rooted task", async () => {
    const f = await seed();
    const change = vi.fn(async () => "changed");
    shard.taskCredential = {
      openMeldServiceRuntimeId: LAPTOP,
      rootProfileId: f.felix.profileId,
      runtimeCoordinatorExecutionId:
        TASK_CREDENTIAL.runtimeCoordinatorExecutionId,
      status: "valid",
      targetProfileId: f.agentProfileId,
    };
    const withTask: RequestCredential = {
      kind: "cli_credential",
      taskCredential: TASK_CREDENTIAL,
    };
    // Another Service lane on the same computer has its own runtime, and its
    // tasks run as the same OS user: any running colleague task counts.
    for (const [runtimeId, mode] of [
      [DESKTOP, "ask_first"],
      [LAPTOP, "full_access"],
    ] as const) {
      shard.riskWindow = runningTask({
        rootProfileId: f.tali.profileId,
        runtimeId,
        targetProfileId: f.agentProfileId,
      });
      await expect(
        setPermissionMode(f, withTask, change, mode)
      ).rejects.toThrow("credential_confirmation.required");
    }
    expect(change).not.toHaveBeenCalled();
    expect((await readAudit(f)).at(-1)).toMatchObject({
      outcome: "confirmation_required",
      source_kind: "task_credential",
    });
  });

  it("rejects a sensitive operation that carries no credential facts", async () => {
    const f = await seed();
    const change = vi.fn(async () => "changed");
    await expect(
      runGatewaySensitiveOperation(
        coreEnv,
        { agentProfileId: f.agentProfileId, context: contextFor(f, f.felix) },
        { agentProfileId: f.agentProfileId, operation: "binding_disable" },
        change
      )
    ).rejects.toThrow("sensitive_operation.source_required");
    expect(change).not.toHaveBeenCalled();
    // Without proof the request counts as the CLI credential, and is audited.
    expect(await readAudit(f)).toEqual([
      expect.objectContaining({
        outcome: "rejected",
        reason_code: "sensitive_operation.source_required",
        source_kind: "cli_credential",
      }),
    ]);
  });

  it("changes nothing while the MemberAgent program is off", async () => {
    const f = await seed();
    feature.enabled = false;
    shard.riskWindow = runningTask({
      rootProfileId: f.tali.profileId,
      runtimeId: LAPTOP,
      targetProfileId: f.agentProfileId,
    });
    const change = vi.fn(async () => "changed");
    await expect(setPermissionMode(f, cli(), change)).resolves.toBe("changed");
    expect(await readAudit(f)).toEqual([]);
  });

  it("shows the audit to the MemberAgent owner only", async () => {
    const f = await seed();
    const change = vi.fn(async () => "changed");
    await setPermissionMode(f, interactive(), change);
    const audit = await rpcListMemberAgentSensitiveOperationAudit(coreEnv, {
      context: contextFor(f, f.felix),
      memberAgentId: f.memberAgentId,
    });
    expect(audit.events).toEqual([
      expect.objectContaining({
        actorUserId: f.felix.userId,
        agentProfileId: f.agentProfileId,
        operation: "binding_permission_mode",
        outcome: "succeeded",
        sourceKind: "web_session",
      }),
    ]);
    await expect(
      rpcListMemberAgentSensitiveOperationAudit(coreEnv, {
        context: contextFor(f, f.tali),
        memberAgentId: f.memberAgentId,
      })
    ).rejects.toThrow("member_agent.not_found");
  });

  it("gates every sensitive Gateway method before it runs", async () => {
    const f = await seed();
    shard.riskWindow = runningTask({
      rootProfileId: f.tali.profileId,
      runtimeId: LAPTOP,
      targetProfileId: f.agentProfileId,
    });
    const entrypoint = Object.create(
      GatewayRpcEntrypoint.prototype
    ) as InstanceType<typeof GatewayRpcEntrypoint>;
    Reflect.set(entrypoint, "env", env);
    const base = {
      agentProfileId: f.agentProfileId,
      context: contextFor(f, f.felix),
      requestCredential: cli(),
    };
    const calls: [string, Record<string, unknown>][] = [
      ["ensureAgentProfilePrimaryBinding", {}],
      ["updateAgentProfilePrimaryBindingModelSelection", {}],
      ["updateAgentProfilePrimaryBindingAgentControllerCollaborationMode", {}],
      ["updateAgentProfilePrimaryBindingAgentControllerPermissionMode", {}],
      ["updateAgentProfilePrimaryBindingOpenCodePermission", {}],
      ["disableAgentProfilePrimaryBinding", {}],
      ["setAgentProfileCreationDefaults", { organizationId: f.organizationId }],
      ["updateAgentProfileDefaultProject", { defaultProjectId: null }],
      [
        "updateBoundAgentProfileDefaultProject",
        { defaultProjectId: null, expectedBindingTarget: { bindingId: "b" } },
      ],
      ["setCurrentAgentProfileWorkspace", { folder: "a" }],
      ["setPeopleComputerAgentProfileWorkspace", { folder: "b" }],
      ["setBoundPeopleComputerAgentProfileWorkspace", { folder: "c" }],
      [
        "manageAgentProfileFolders",
        { operation: { operation: "add_openmeld_managed" } },
      ],
      ["executeAgentProfileWorkRecovery", { body: { action: "skip" } }],
      ["agentProfileExecutionMode", { body: { mode: "serial" } }],
      ["respondToSpaceAgentInteraction", { spaceId: "space-1" }],
      ["deleteSpace", { spaceId: "space-1" }],
      ["decideAgentAccessRequest", { requestId: "request-1" }],
      ["revokeAgentProfileAccessGrant", { grantId: "grant-1" }],
      [
        "updateAgentDirectMessageSession",
        { spaceId: "space-1", update: { operation: "archive" } },
      ],
      ["deleteAgentDirectMessageSession", { spaceId: "space-2" }],
      [
        "addSpaceMembers",
        {
          members: [
            {
              ownerUserId: f.felix.userId,
              profileId: f.agentProfileId,
              profileKind: "agent",
              profileName: "PR Reviewer",
            },
          ],
          spaceId: "space-1",
        },
      ],
    ];
    for (const [method, input] of calls) {
      const call = Reflect.get(entrypoint, method) as (
        value: unknown
      ) => Promise<unknown>;
      await expect(
        call.call(entrypoint, { ...base, ...input }),
        method
      ).rejects.toThrow("credential_confirmation.required");
    }
    // Each distinct request opens its own card.
    expect(await readConfirmationInboxItems(f)).toHaveLength(calls.length);
  });

  it("gates an owner's folder changes as working-folder writes", async () => {
    const f = await seed();
    const entrypoint = Object.create(
      GatewayRpcEntrypoint.prototype
    ) as InstanceType<typeof GatewayRpcEntrypoint>;
    Reflect.set(entrypoint, "env", env);
    // The folder change itself needs the Agent's Computer; the gate runs first.
    const change = vi
      .spyOn(
        Object.getPrototypeOf(GatewayRpcEntrypoint.prototype),
        "manageAgentProfileFolders"
      )
      .mockImplementation((input: unknown) => {
        if (
          input &&
          typeof input === "object" &&
          "requestCredential" in input
        ) {
          throw new Error("The credential leaked past the gate.");
        }
        return Promise.resolve("changed");
      });
    const manage = (requestCredential: RequestCredential) =>
      entrypoint.manageAgentProfileFolders({
        agentProfileId: f.agentProfileId,
        context: contextFor(f, f.felix),
        expectedBindingTarget: {
          agentControllerConversationId: null,
          agentControllerRef: "builtin:codex",
          bindingId: "binding-1",
          openMeldServiceRuntimeId: LAPTOP,
        },
        operation: {
          folderId: "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11",
          operation: "remove",
        },
        requestCredential,
      });
    try {
      // The owner's Web session passes.
      await expect(manage(interactive())).resolves.toBe("changed");
      // A colleague-rooted task's credential is refused.
      shard.taskCredential = {
        openMeldServiceRuntimeId: LAPTOP,
        rootProfileId: f.tali.profileId,
        runtimeCoordinatorExecutionId:
          TASK_CREDENTIAL.runtimeCoordinatorExecutionId,
        status: "valid",
        targetProfileId: f.agentProfileId,
      };
      await expect(
        manage({ kind: "cli_credential", taskCredential: TASK_CREDENTIAL })
      ).rejects.toThrow("sensitive_operation.root_not_owner");
      // The CLI credential while a colleague's task runs waits for the owner.
      shard.riskWindow = runningTask({
        rootProfileId: f.tali.profileId,
        runtimeId: LAPTOP,
        targetProfileId: f.agentProfileId,
      });
      await expect(manage(cli())).rejects.toThrow(
        "credential_confirmation.required"
      );
      expect(change).toHaveBeenCalledTimes(1);
      expect(await readAudit(f)).toEqual([
        expect.objectContaining({
          outcome: "succeeded",
          source_kind: "web_session",
        }),
        expect.objectContaining({
          outcome: "rejected",
          reason_code: "sensitive_operation.root_not_owner",
          source_kind: "task_credential",
        }),
        expect.objectContaining({
          outcome: "confirmation_required",
          source_kind: "cli_credential",
        }),
      ]);
      const operations = await getPostgresDatabase(env).query<{
        operation: string;
      }>({
        text: `SELECT DISTINCT operation FROM "openmeld"."sensitive_operation_audit_events"
          WHERE organization_id = $1`,
        values: [f.organizationId],
      });
      expect(operations.rows).toEqual([{ operation: "working_folder_write" }]);
    } finally {
      change.mockRestore();
    }
  });

  it("decides Auth's Agent Profile deletion through the same gate and audits its outcome", async () => {
    const f = await seed();
    const actor = {
      humanProfileId: null,
      organizationId: f.organizationId,
      userId: f.felix.userId,
    };
    const ask = (credential: RequestCredential) =>
      rpcAuthorizeSensitiveOperation(coreEnv, {
        actor,
        agentProfileId: f.agentProfileId,
        credential,
        digestInput: { profileId: f.agentProfileId },
        operation: "profile_delete",
      });
    shard.riskWindow = runningTask({
      rootProfileId: f.tali.profileId,
      runtimeId: LAPTOP,
      targetProfileId: f.agentProfileId,
    });
    await expect(ask(cli())).resolves.toMatchObject({
      code: "credential_confirmation.required",
      httpStatus: 409,
      status: "refused",
    });
    const allowed = await ask(interactive());
    expect(allowed).toMatchObject({
      decision: { sourceKind: "web_session" },
      status: "allowed",
    });
    if (allowed.status !== "allowed") {
      throw new Error("Expected an allowed deletion.");
    }
    await rpcRecordSensitiveOperationOutcome(coreEnv, {
      actor,
      agentProfileId: f.agentProfileId,
      decision: allowed.decision,
      operation: "profile_delete",
      outcome: "succeeded",
      reasonCode: null,
    });
    expect(
      (await readAudit(f)).map((row) => [row.source_kind, row.outcome])
    ).toEqual([
      ["cli_credential", "confirmation_required"],
      ["web_session", "succeeded"],
    ]);
    feature.enabled = false;
    await expect(ask(cli())).resolves.toEqual({ status: "not_enforced" });
  });
});
