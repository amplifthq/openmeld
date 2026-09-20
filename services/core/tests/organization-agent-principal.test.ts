import { env } from "cloudflare:test";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { requireCurrentDesignatedCenterAgentCaller } from "../src/center-agent/current-designated-center-agent";
import type { CoreBindings } from "../src/lib/bindings";

describe("Organization Center Agent principal", () => {
  it("authorizes the designated Organization identity without a creator account and rejects impersonation", async () => {
    const bindings = env as unknown as CoreBindings;
    const db = bindings.OPENMELD_DB;
    if (!db) {
      throw new Error("Identity database is required");
    }
    const organizationId = `ownership-${crypto.randomUUID()}`;
    const profileId = `agt_${crypto.randomUUID()}`;
    await db
      .prepare(
        "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Ownership test', ?, 1)"
      )
      .bind(organizationId, organizationId)
      .run();
    await db
      .prepare(
        "INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, managed_role, source, created_at, updated_at) VALUES (?, 'Center Agent', 'center-agent', 'agent', ?, NULL, 'center_agent', 'auth_bootstrap', 1, 1)"
      )
      .bind(profileId, organizationId)
      .run();
    await db
      .prepare(
        "INSERT INTO center_agent_designations (organization_id, agent_profile_id, designated_by, created_at) VALUES (?, ?, NULL, 1)"
      )
      .bind(organizationId, profileId)
      .run();
    const context = {
      activeOrganizationId: organizationId,
      actorContext: {
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        callerPrincipalId: profileId,
        openMeldProfileId: profileId,
        profileKind: "agent" as const,
        requestId: "ownership-test",
      },
    };
    await expect(
      requireCurrentDesignatedCenterAgentCaller({ env: bindings, context })
    ).resolves.toMatchObject({
      actorProfile: { profileId, ownerUserId: null, organizationId },
    });
    await expect(
      requireCurrentDesignatedCenterAgentCaller({
        env: bindings,
        context: {
          ...context,
          actorContext: {
            ...context.actorContext,
            ownerUserId: "former-creator",
            callerPrincipalId: "former-creator",
          },
        },
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "center_agent.not_designated",
    });
    await expect(
      requireCurrentDesignatedCenterAgentCaller({
        env: bindings,
        context: {
          ...context,
          actorContext: {
            ...context.actorContext,
            openMeldProfileId: `agt_${crypto.randomUUID()}`,
          },
        },
      })
    ).rejects.toMatchObject({ status: 403 });
    await db
      .prepare(
        "UPDATE center_agent_designations SET operating_state = 'paused', paused_at = 2 WHERE organization_id = ?"
      )
      .bind(organizationId)
      .run();
    await expect(
      requireCurrentDesignatedCenterAgentCaller({ env: bindings, context })
    ).rejects.toMatchObject({ status: 409, code: "center_agent.paused" });
  });
});
