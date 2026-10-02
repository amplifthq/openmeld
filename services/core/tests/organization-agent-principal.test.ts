import { env } from "cloudflare:test";
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

describe("Organization Center Agent principal", () => {
  it("authorizes the designated Organization identity without a creator account and rejects impersonation", async () => {
    const bindings = env as unknown as CoreBindings;
    const db = bindings.OPENMELD_DB;
    if (!db) {
      throw new Error("Identity database is required");
    }
    const organizationId = `ownership-${crypto.randomUUID()}`;
    const profileId = `agt_${crypto.randomUUID()}`;
    const userId = `user_${crypto.randomUUID()}`;
    const memberId = `member_${crypto.randomUUID()}`;
    const speakerMember = { memberId, userId };
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
    await db
      .prepare(
        "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Member', ?, 1, 1, 1)"
      )
      .bind(userId, `${userId}@example.com`)
      .run();
    await db
      .prepare(
        "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', 1)"
      )
      .bind(memberId, organizationId, userId)
      .run();
    await db
      .prepare(
        "INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES (?, 'Member', ?, 'human', 1, 'active', ?, ?, 'auth_bootstrap', 1, 1)"
      )
      .bind(crypto.randomUUID(), `member-${userId}`, userId, userId)
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
    await db.prepare("DELETE FROM members WHERE id = ?").bind(memberId).run();
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
    await db
      .prepare(
        "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', 1)"
      )
      .bind(memberId, organizationId, userId)
      .run();
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
    await db
      .prepare(
        "UPDATE center_agent_designations SET operating_state = 'paused', paused_at = 2 WHERE organization_id = ?"
      )
      .bind(organizationId)
      .run();
    await expect(
      requireCurrentDesignatedCenterAgentCaller({ env: bindings, context })
    ).rejects.toMatchObject({ status: 409, code: "center_agent.paused" });
    await expect(
      rpcRemoteAgentReadTeamFile(bindings, { context, fileId, speakerMember })
    ).rejects.toMatchObject({ status: 409, code: "center_agent.paused" });
  });
});
