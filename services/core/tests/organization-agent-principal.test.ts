import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { requireCurrentDesignatedCenterAgentCaller } from "../src/center-agent/current-designated-center-agent";
import { prepareOrganizationFileRootAccess } from "../src/files/file-root-access";
import { organizationFileRootName } from "../src/files/file-root-identity";
import {
  rpcRemoteAgentListTeamFiles,
  rpcRemoteAgentReadTeamFile,
  rpcRemoteAgentSaveTeamFile,
} from "../src/files/remote-agent-team-files";
import type { CoreBindings } from "../src/lib/bindings";
import { env } from "../test-support/worker-env";

describe("Organization Center Agent principal", () => {
  it("authorizes the designated Organization identity without a creator account and rejects impersonation", async () => {
    const bindings = env as unknown as CoreBindings;
    const db = getPostgresDatabase(bindings);
    if (!db) {
      throw new Error("Identity database is required");
    }
    const organizationId = `ownership-${crypto.randomUUID()}`;
    const profileId = `agt_${crypto.randomUUID()}`;
    const userId = `user_${crypto.randomUUID()}`;
    const memberId = `member_${crypto.randomUUID()}`;
    const speakerMember = { memberId, userId };
    await db.query({
      ...{
        text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Ownership test\', $2, 1)',
        values: [],
      },
      values: [organizationId, organizationId],
    });
    await db.query({
      ...{
        text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, managed_role, source, created_at, updated_at) VALUES ($1, 'Center Agent', 'center-agent', 'agent', $2, NULL, 'center_agent', 'auth_bootstrap', 1, 1)",
        values: [],
      },
      values: [profileId, organizationId],
    });
    await db.query({
      ...{
        text: 'INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, designated_by, created_at) VALUES ($1, $2, NULL, 1)',
        values: [],
      },
      values: [organizationId, profileId],
    });
    await db.query({
      ...{
        text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, \'Member\', $2, 1, 1, 1)',
        values: [],
      },
      values: [userId, `${userId}@example.com`],
    });
    await db.query({
      ...{
        text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', 1)',
        values: [],
      },
      values: [memberId, organizationId, userId],
    });
    await db.query({
      ...{
        text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, 'Member', $2, 'human', 1, 'active', $3, $4, 'auth_bootstrap', 1, 1)",
        values: [],
      },
      values: [crypto.randomUUID(), `member-${userId}`, userId, userId],
    });
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
    const roots = bindings.OPENMELD_FILE_ROOTS;
    if (!roots) {
      throw new Error("Files root binding is required");
    }
    const teamRoot = { kind: "team" as const, organizationId };
    const team = roots.getByName(organizationFileRootName(teamRoot));
    await expect(
      prepareOrganizationFileRootAccess({
        context,
        env: bindings,
        root: teamRoot,
      })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      team.list({ context, root: teamRoot, speakerMember })
    ).resolves.toMatchObject({ entries: [] });
    const clientMutationId = crypto.randomUUID();
    const created = await rpcRemoteAgentSaveTeamFile(bindings, {
      action: "create",
      clientMutationId,
      content: "Shared team note",
      context,
      mimeType: "text/plain",
      name: "team-note.txt",
      parentId: null,
      speakerMember,
    });
    const fileId = created.file.id;
    expect(created.file).toMatchObject({
      name: "team-note.txt",
      root: teamRoot,
      latestRevision: { revision: 1 },
    });
    await expect(
      rpcRemoteAgentListTeamFiles(bindings, { context, speakerMember })
    ).resolves.toMatchObject({
      root: teamRoot,
      entries: [{ id: fileId, name: "team-note.txt" }],
    });
    await expect(
      rpcRemoteAgentReadTeamFile(bindings, {
        context,
        fileId,
        revision: 1,
        speakerMember,
      })
    ).resolves.toMatchObject({
      content: "Shared team note",
      file: { id: fileId, root: teamRoot },
      revision: { revision: 1 },
    });
    const update = {
      action: "update" as const,
      baseRevision: 1,
      clientMutationId: crypto.randomUUID(),
      content: "Updated team note",
      context,
      fileId,
      mimeType: "text/plain",
      speakerMember,
    };
    await expect(
      rpcRemoteAgentSaveTeamFile(bindings, update)
    ).resolves.toMatchObject({
      file: { id: fileId, root: teamRoot, latestRevision: { revision: 2 } },
    });
    await expect(
      rpcRemoteAgentSaveTeamFile(bindings, update)
    ).resolves.toMatchObject({
      file: { id: fileId, latestRevision: { revision: 2 } },
    });
    await expect(
      rpcRemoteAgentSaveTeamFile(bindings, {
        ...update,
        clientMutationId: crypto.randomUUID(),
        content: "Stale overwrite",
      })
    ).rejects.toThrow('"code":"file_root.conflict"');
    await expect(
      rpcRemoteAgentReadTeamFile(bindings, {
        context,
        fileId,
        revision: 1,
        speakerMember,
      })
    ).resolves.toMatchObject({ content: "Shared team note" });
    await expect(
      rpcRemoteAgentReadTeamFile(bindings, { context, fileId, speakerMember })
    ).resolves.toMatchObject({ content: "Updated team note" });
    await db.query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE id = $1',
        values: [],
      },
      values: [memberId],
    });
    await expect(
      rpcRemoteAgentReadTeamFile(bindings, { context, fileId, speakerMember })
    ).rejects.toThrow("center_agent.member_actor_required");
    await expect(
      rpcRemoteAgentListTeamFiles(bindings, { context, speakerMember })
    ).rejects.toThrow("center_agent.member_actor_required");
    await expect(
      rpcRemoteAgentSaveTeamFile(bindings, {
        ...update,
        clientMutationId: crypto.randomUUID(),
      })
    ).rejects.toThrow("center_agent.member_actor_required");
    await db.query({
      ...{
        text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', 1)',
        values: [],
      },
      values: [memberId, organizationId, userId],
    });
    const privateRoot = {
      kind: "member" as const,
      organizationId,
      memberUserId: profileId,
    };
    await expect(
      prepareOrganizationFileRootAccess({
        context,
        env: bindings,
        root: privateRoot,
      })
    ).rejects.toMatchObject({ status: 403 });
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
    await db.query({
      ...{
        text: 'UPDATE "openmeld"."center_agent_designations" SET operating_state = \'paused\', paused_at = 2 WHERE organization_id = $1',
        values: [],
      },
      values: [organizationId],
    });
    await expect(
      requireCurrentDesignatedCenterAgentCaller({ env: bindings, context })
    ).rejects.toMatchObject({ status: 409, code: "center_agent.paused" });
    await expect(
      rpcRemoteAgentReadTeamFile(bindings, { context, fileId, speakerMember })
    ).rejects.toMatchObject({ status: 409, code: "center_agent.paused" });
  });
});
