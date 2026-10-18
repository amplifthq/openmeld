import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  type CenterAgentPermissionModeConfirmationScope,
  requireCenterAgentPermissionModeConfirmation,
} from "../src/center-agent/application/permission-mode-confirmation";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const CENTER = "agt_00000000-0000-4000-8000-000000000001";
const FELIX_AGENT = "agt_00000000-0000-4000-8000-000000000002";
const FELIX = "00000000-0000-4000-8000-000000000003";
const TALI = "00000000-0000-4000-8000-000000000004";

const scope: CenterAgentPermissionModeConfirmationScope = {
  actorProfileId: CENTER,
  agentControllerPermissionMode: "acceptEdits",
  agentProfileId: FELIX_AGENT,
  organizationId: "org-1",
  representedProfileId: FELIX,
  representedUserId: "user-felix",
};

async function seed(db: PostgresDatabase): Promise<void> {
  await db.transaction(async (client) => {
    await client.query({
      text: `INSERT INTO "openmeld"."users" (id, name, email) VALUES
        ('user-felix', 'Felix', 'felix@example.test'),
        ('user-tali', 'Tali', 'tali@example.test')`,
    });
    await client.query({
      text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ('org-1', 'Organization', 'org-1', 1700000000000)`,
    });
    await client.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, created_by_user_id, managed_role, source, status) VALUES
        ($1, 'Center Agent', 'center-agent', 'agent', 'org-1', NULL, 'user-felix', 'center_agent', 'auth_bootstrap', 'active'),
        ($2, 'Claude Code', 'claude-code', 'agent', 'org-1', 'user-felix', 'user-felix', NULL, 'auth_bootstrap', 'active'),
        ($3, 'Felix', 'felix', 'human', NULL, 'user-felix', NULL, NULL, 'auth_bootstrap', 'active'),
        ($4, 'Tali', 'tali', 'human', NULL, 'user-tali', NULL, NULL, 'auth_bootstrap', 'active')`,
      values: [CENTER, FELIX_AGENT, FELIX, TALI],
    });
    // Center Agent turns as Core recorded them: who spoke, and when.
    for (const [deliveryId, profileId, userId, createdAtMs] of [
      ["delivery-instruction", FELIX, "user-felix", 900],
      ["delivery-earlier", FELIX, "user-felix", 500],
      ["delivery-confirmation", FELIX, "user-felix", 1500],
      ["delivery-another-turn", FELIX, "user-felix", 1600],
      ["delivery-tali", TALI, "user-tali", 1500],
    ] as const) {
      await client.query({
        text: `INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
          delivery_id, organization_id, conversation_kind, space_id, profile_id,
          binding_id, trigger_message_id, routine_run_id, dispatch_id,
          idempotency_key, submission_id, status, on_behalf_of_profile_id,
          on_behalf_of_user_id, on_behalf_of_display_name, thread_context_json,
          created_at_ms, updated_at_ms
        ) VALUES ($1, 'org-1', 'space', 'space-1', $2, 'binding-center',
          $3, NULL, $3, $3, $3, 'accepted', $4, $5, 'Member', NULL, $6, $6)`,
        values: [
          deliveryId,
          CENTER,
          `trigger-${deliveryId}`,
          profileId,
          userId,
          createdAtMs,
        ],
      });
    }
  });
}

async function issue(db: PostgresDatabase, nowMs = 1000): Promise<string> {
  const decision = await requireCenterAgentPermissionModeConfirmation({
    db,
    nativeDeliveryId: "delivery-instruction",
    nowMs,
    scope,
  });
  if (decision.status !== "confirmation_required") {
    throw new Error("Expected confirmation evidence");
  }
  return decision.confirmation.token;
}

describe("Center Agent permission-mode confirmation", () => {
  it("never applies the instruction alone and stores only the token hash", async () => {
    const harness = await createPostgresHarness();
    await seed(harness.db);
    const token = await issue(harness.db);
    const stored = await harness.db.query<{ token_hash: string }>({
      text: `SELECT token_hash FROM "openmeld"."center_agent_permission_mode_confirmations"`,
    });
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.token_hash).not.toBe(token);
    // The turn that asked cannot also confirm.
    await expect(
      requireCenterAgentPermissionModeConfirmation({
        db: harness.db,
        nativeDeliveryId: "delivery-instruction",
        nowMs: 2000,
        scope,
        token,
      })
    ).rejects.toMatchObject({
      code: "center_agent.permission_mode_confirmation_invalid",
    });
  });

  it("accepts the same member's later turn for the exact Profile and mode, once", async () => {
    const harness = await createPostgresHarness();
    await seed(harness.db);
    const token = await issue(harness.db);
    const confirm = (nativeDeliveryId: string) =>
      requireCenterAgentPermissionModeConfirmation({
        db: harness.db,
        nativeDeliveryId,
        nowMs: 2000,
        scope,
        token,
      });
    await expect(confirm("delivery-confirmation")).resolves.toEqual({
      status: "confirmed",
    });
    // A retried tool call in the confirming turn stays idempotent.
    await expect(confirm("delivery-confirmation")).resolves.toEqual({
      status: "confirmed",
    });
    await expect(confirm("delivery-another-turn")).rejects.toMatchObject({
      code: "center_agent.permission_mode_confirmation_invalid",
    });
  });

  it("rejects a turn that started before the evidence or belongs to another member", async () => {
    const harness = await createPostgresHarness();
    await seed(harness.db);
    const token = await issue(harness.db);
    for (const nativeDeliveryId of ["delivery-earlier", "delivery-tali"]) {
      await expect(
        requireCenterAgentPermissionModeConfirmation({
          db: harness.db,
          nativeDeliveryId,
          nowMs: 2000,
          scope,
          token,
        })
      ).rejects.toMatchObject({
        code: "center_agent.permission_mode_confirmation_invalid",
      });
    }
  });

  it("rejects the evidence for another member, Profile, mode, or after expiry", async () => {
    const harness = await createPostgresHarness();
    await seed(harness.db);
    const token = await issue(harness.db);
    for (const [changed, nowMs] of [
      [{ representedProfileId: TALI, representedUserId: "user-tali" }, 2000],
      [{ agentProfileId: CENTER }, 2000],
      [{ agentControllerPermissionMode: "bypassPermissions" }, 2000],
      [{}, 1000 + 31 * 60_000],
    ] as const) {
      await expect(
        requireCenterAgentPermissionModeConfirmation({
          db: harness.db,
          nativeDeliveryId: "delivery-confirmation",
          nowMs,
          scope: { ...scope, ...changed },
          token,
        })
      ).rejects.toMatchObject({
        code: "center_agent.permission_mode_confirmation_invalid",
      });
    }
  });

  it("fails closed without the turn's Core-recorded delivery", async () => {
    const harness = await createPostgresHarness();
    await seed(harness.db);
    await expect(
      requireCenterAgentPermissionModeConfirmation({
        db: harness.db,
        nativeDeliveryId: null,
        nowMs: 1000,
        scope,
      })
    ).rejects.toMatchObject({ code: "center_agent.request_chain_unverified" });
  });
});
