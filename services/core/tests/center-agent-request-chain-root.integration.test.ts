import { env } from "cloudflare:test";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensurePrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecord,
} from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import type { CoreBindings } from "../src/lib/bindings";

const feature = vi.hoisted(() => ({ enforced: true }));
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => feature.enforced,
  isRequestChainEnforced: () => feature.enforced,
}));

const {
  rpcCenterAgentConnectAgentProfileToLocalAgent,
  rpcCenterAgentUpdateAgentProfileRuntimeSettings,
} = await import("../src/rpc/methods");

afterEach(() => {
  feature.enforced = true;
  vi.restoreAllMocks();
});

// Phase 3 acceptance (design-plans/member-agent-program.md §10): Tali's Center
// Agent cannot change Felix's Profile, and a permission-mode change needs the
// owner's separate confirmation bound by Core.
describe("Center Agent management checks the request chain root", () => {
  it("rejects a member named in the tool call who is not the turn's root", async () => {
    const f = await seedFixture();
    const turn = await recordTurn(f, f.tali);
    await expect(
      rpcCenterAgentUpdateAgentProfileRuntimeSettings(f.coreEnv, {
        agentControllerPermissionMode: "codex:approveForMe",
        agentProfileId: f.felixAgentProfileId,
        context: turn.context,
        onBehalfOf: { profileId: f.felix.profileId },
      })
    ).rejects.toMatchObject({
      code: "center_agent.request_chain_root_mismatch",
    });
    expect(await readPermissionMode(f)).toBeNull();
  });

  it("cannot change another member's Agent when acting for its root", async () => {
    const f = await seedFixture();
    const tali = await recordTurn(f, f.tali);
    const first = await rpcCenterAgentUpdateAgentProfileRuntimeSettings(
      f.coreEnv,
      {
        agentControllerPermissionMode: "codex:approveForMe",
        agentProfileId: f.felixAgentProfileId,
        context: tali.context,
        onBehalfOf: { profileId: f.tali.profileId },
      }
    );
    const token = first.permissionModeConfirmation?.token;
    expect(token).toBeDefined();
    const confirmation = await recordTurn(f, f.tali);
    const second = await rpcCenterAgentUpdateAgentProfileRuntimeSettings(
      f.coreEnv,
      {
        agentControllerPermissionMode: "codex:approveForMe",
        agentProfileId: f.felixAgentProfileId,
        context: confirmation.context,
        onBehalfOf: { profileId: f.tali.profileId },
        permissionModeConfirmationToken: token,
      }
    ).catch((error: unknown) => error);
    // Tali's own confirmation never reaches Felix's Binding.
    expect(JSON.stringify(second)).not.toContain('"status":"completed"');
    expect(await readPermissionMode(f)).toBeNull();
  });

  it("needs the owner's confirmation in a later turn, bound to the exact change", async () => {
    const f = await seedFixture();
    const instruction = await recordTurn(f, f.felix);
    const first = await rpcCenterAgentUpdateAgentProfileRuntimeSettings(
      f.coreEnv,
      {
        agentControllerPermissionMode: "codex:approveForMe",
        agentProfileId: f.felixAgentProfileId,
        context: instruction.context,
        onBehalfOf: { profileId: f.felix.profileId },
      }
    );
    expect(first).toMatchObject({
      permissionModeConfirmation: {
        agentControllerPermissionMode: "codex:approveForMe",
      },
      status: "blocked",
      steps: [
        expect.objectContaining({
          reasonCode: "center_agent.permission_mode_confirmation_required",
          status: "skipped",
        }),
      ],
    });
    expect(await readPermissionMode(f)).toBeNull();
    // Center Agent settings changes are audited sensitive operations (§6).
    const audit = await getPostgresDatabase(f.coreEnv).query<{
      chain_root_profile_id: string | null;
      outcome: string;
      source_kind: string;
    }>({
      text: `SELECT source_kind, outcome, chain_root_profile_id
        FROM "openmeld"."sensitive_operation_audit_events"
        WHERE agent_profile_id = $1 ORDER BY created_at_ms`,
      values: [f.felixAgentProfileId],
    });
    expect(audit.rows).toEqual([
      {
        chain_root_profile_id: f.felix.profileId,
        outcome: "confirmation_required",
        source_kind: "center_agent",
      },
    ]);
    const token = first.permissionModeConfirmation?.token as string;
    // The instruction's own turn cannot confirm it.
    await expect(
      rpcCenterAgentUpdateAgentProfileRuntimeSettings(f.coreEnv, {
        agentControllerPermissionMode: "codex:approveForMe",
        agentProfileId: f.felixAgentProfileId,
        context: instruction.context,
        onBehalfOf: { profileId: f.felix.profileId },
        permissionModeConfirmationToken: token,
      })
    ).rejects.toMatchObject({
      code: "center_agent.permission_mode_confirmation_invalid",
    });
    const confirmation = await recordTurn(f, f.felix);
    // Evidence for one mode never applies another.
    await expect(
      rpcCenterAgentUpdateAgentProfileRuntimeSettings(f.coreEnv, {
        agentControllerPermissionMode: "codex:fullAccess",
        agentProfileId: f.felixAgentProfileId,
        context: confirmation.context,
        onBehalfOf: { profileId: f.felix.profileId },
        permissionModeConfirmationToken: token,
      })
    ).rejects.toMatchObject({
      code: "center_agent.permission_mode_confirmation_invalid",
    });
    const confirmed = await rpcCenterAgentUpdateAgentProfileRuntimeSettings(
      f.coreEnv,
      {
        agentControllerPermissionMode: "codex:approveForMe",
        agentProfileId: f.felixAgentProfileId,
        context: confirmation.context,
        onBehalfOf: { profileId: f.felix.profileId },
        permissionModeConfirmationToken: token,
      }
    ).catch((error: unknown) => error);
    expect(JSON.stringify(confirmed)).not.toContain(
      "permission_mode_confirmation"
    );
    const consumed = await getPostgresDatabase(env).query<{
      consumed_native_delivery_id: string | null;
    }>({
      text: `SELECT consumed_native_delivery_id FROM "openmeld"."center_agent_permission_mode_confirmations" WHERE agent_profile_id = $1`,
      values: [f.felixAgentProfileId],
    });
    expect(consumed.rows).toEqual([
      { consumed_native_delivery_id: confirmation.deliveryId },
    ]);
  });

  it("refuses a reconnect that would change the mode without that confirmation", async () => {
    const f = await seedFixture();
    const turn = await recordTurn(f, f.felix);
    await expect(
      rpcCenterAgentConnectAgentProfileToLocalAgent(f.coreEnv, {
        agentControllerPermissionMode: "codex:fullAccess",
        agentProfileId: f.felixAgentProfileId,
        candidateId: "candidate-any",
        context: turn.context,
        onBehalfOf: { profileId: f.felix.profileId },
      })
    ).rejects.toMatchObject({
      code: "center_agent.permission_mode_confirmation_required",
    });
    expect(await readPermissionMode(f)).toBeNull();
  });

  it("keeps the current behavior before the chain is enforced", async () => {
    feature.enforced = false;
    const f = await seedFixture();
    const turn = await recordTurn(f, f.tali);
    const result = await rpcCenterAgentUpdateAgentProfileRuntimeSettings(
      f.coreEnv,
      {
        agentControllerPermissionMode: "codex:approveForMe",
        agentProfileId: f.felixAgentProfileId,
        context: turn.context,
        onBehalfOf: { profileId: f.felix.profileId },
      }
    ).catch((error: unknown) => error);
    expect(JSON.stringify(result)).not.toContain("request_chain_root_mismatch");
    expect(JSON.stringify(result)).not.toContain(
      "permission_mode_confirmation"
    );
  });
});

type Fixture = Awaited<ReturnType<typeof seedFixture>>;
type Member = Fixture["felix"];

/** The saved mode of Felix's Binding; null is the harness default. */
async function readPermissionMode(f: Fixture): Promise<string | null> {
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: f.felixAgentProfileId,
    db: getPostgresDatabase(env),
    owner: { id: f.felix.userId, kind: "owner_account" },
  });
  if (!binding) {
    throw new Error("Felix's Binding disappeared");
  }
  return binding.agentControllerPermissionMode ?? null;
}

/** One Center Agent turn whose native delivery Core recorded for `member`. */
async function recordTurn(f: Fixture, member: Member) {
  const deliveryId = `delivery-${crypto.randomUUID()}`;
  const submissionId = `submission-${crypto.randomUUID()}`;
  const now = Date.now();
  await getPostgresDatabase(env).query({
    text: `
      INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
        delivery_id, organization_id, conversation_kind, space_id, profile_id,
        binding_id, trigger_message_id, routine_run_id, dispatch_id,
        idempotency_key, submission_id, status, on_behalf_of_profile_id,
        on_behalf_of_user_id, on_behalf_of_display_name, thread_context_json,
        created_at_ms, updated_at_ms
      )
      VALUES ($1, $2, 'space', $3, $4, $5, $6, NULL, $7, $8, $9, 'accepted',
        $10, $11, $12, NULL, $13, $13)
    `,
    values: [
      deliveryId,
      f.organizationId,
      `space-${f.suffix}`,
      f.centerAgentId,
      `binding-center-${f.suffix}`,
      `signal-${deliveryId}`,
      `dispatch-${deliveryId}`,
      `idempotency-${deliveryId}`,
      submissionId,
      member.profileId,
      member.userId,
      member.role,
      now,
    ],
  });
  const context: OpenMeldRequestContext = {
    activeOrganizationId: f.organizationId,
    actorContext: {
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      callerPrincipalId: f.centerAgentId,
      openMeldProfileId: f.centerAgentId,
      profileKind: "agent",
      profileName: "Center Agent",
      requestId: deliveryId,
    },
    agentControllerConversationId: submissionId,
  };
  return { context, deliveryId };
}

async function seedFixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `org_request_chain_${suffix}`;
  const db = getPostgresDatabase(env);
  const [felix, tali] = (["owner", "member"] as const).map((role) => ({
    role,
    userId: `user_${role}_${suffix}`,
    memberId: `member_${role}_${suffix}`,
    profileId: crypto.randomUUID(),
  }));
  if (!(felix && tali)) {
    throw new Error("Missing fixture members.");
  }
  const centerAgentId = `agt_${crypto.randomUUID()}`;
  const felixAgentProfileId = `agt_${crypto.randomUUID()}`;
  const now = Date.now();
  await db.transaction(async (client) => {
    await client.query({
      text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, 'Request chain', $2, $3)`,
      values: [organizationId, `request-chain-${suffix}`, now],
    });
    for (const member of [felix, tali]) {
      await client.query({
        text: `INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $4)`,
        values: [
          member.userId,
          member.role,
          `${member.userId}@example.com`,
          now,
        ],
      });
      await client.query({
        text: `INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)`,
        values: [
          member.memberId,
          organizationId,
          member.userId,
          member.role,
          now,
        ],
      });
      await client.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, $2, $3, 'human', 1, 'active', $4, $4, 'auth_bootstrap', $5, $5)`,
        values: [
          member.profileId,
          member.role,
          `${member.role}-${suffix}`,
          member.userId,
          now,
        ],
      });
    }
    await client.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, managed_role, created_at, updated_at) VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, 'cli_create', 'center_agent', $5, $5)`,
      values: [
        centerAgentId,
        `center-agent-${suffix}`,
        organizationId,
        felix.userId,
        now,
      ],
    });
    await client.query({
      text: `INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, duty, designated_by, created_at) VALUES ($1, $2, NULL, $3, $4)`,
      values: [organizationId, centerAgentId, felix.userId, now],
    });
    await client.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, 'Felix Codex', $1, 'agent', 0, 'active', $2, $3, $3, 'cli_create', $4, $4)`,
      values: [felixAgentProfileId, organizationId, felix.userId, now],
    });
  });
  await ensurePrimaryAgentProfileBindingRecord({
    db,
    record: {
      agentProfileId: felixAgentProfileId,
      bindingId: `binding-${suffix}`,
      agentControllerRef: "builtin:codex",
      createdAtMs: now,
      updatedAtMs: now,
      owner: { id: felix.userId, kind: "owner_account" },
      openMeldServiceRuntimeId: `runtime-${suffix}`,
    },
  });
  return {
    centerAgentId,
    coreEnv: {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    } as CoreBindings,
    felix,
    felixAgentProfileId,
    organizationId,
    suffix,
    tali,
  };
}
