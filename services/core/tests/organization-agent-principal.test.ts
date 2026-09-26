import { env } from "cloudflare:test";
import {
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdFromDigest,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { requireCurrentDesignatedCenterAgentCaller } from "../src/center-agent/current-designated-center-agent";
import { prepareOrganizationFileRootAccess } from "../src/files/file-root-access";
import { organizationFileRootName } from "../src/files/file-root-identity";
import {
  rpcRemoteAgentListTeamFiles,
  rpcRemoteAgentReadTeamFile,
} from "../src/files/remote-agent-team-files";
import type { CoreBindings } from "../src/lib/bindings";
import { hashSpaceFileStream } from "../src/space/application/space-file-stream";

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
    const roots = bindings.OPENMELD_FILE_ROOTS;
    if (!roots) {
      throw new Error("Files root binding is required");
    }
    const teamRoot = { kind: "team" as const, organizationId };
    const teamId = roots.idFromName(organizationFileRootName(teamRoot));
    const team = roots.get(teamId);
    await expect(team.list({ context, root: teamRoot })).resolves.toMatchObject(
      {
        entries: [],
      }
    );
    const bytes = new TextEncoder().encode("Shared team note");
    const clientMutationId = crypto.randomUUID();
    const fileId = await buildSpaceFileEntryIdForMutation(clientMutationId);
    const revisionId = await buildSpaceFileRevisionIdFromDigest({
      baseRevision: null,
      contentDigest: await hashSpaceFileStream(new Blob([bytes]).stream()),
      clientMutationId,
      mimeType: "text/plain",
      name: "team-note.txt",
      parentId: null,
    });
    await team.writeContent({
      context,
      root: teamRoot,
      bytes: bytes.buffer as ArrayBuffer,
      write: {
        spaceId: teamId.toString(),
        fileId,
        revisionId,
        name: "team-note.txt",
        parentId: null,
        baseRevision: null,
        clientMutationId,
        mimeType: "text/plain",
        sizeBytes: bytes.byteLength,
      },
    });
    await expect(
      rpcRemoteAgentListTeamFiles(bindings, { context })
    ).resolves.toMatchObject({
      root: teamRoot,
      entries: [{ id: fileId, name: "team-note.txt" }],
    });
    await expect(
      rpcRemoteAgentReadTeamFile(bindings, { context, fileId, revision: 1 })
    ).resolves.toMatchObject({
      content: "Shared team note",
      file: { id: fileId, root: teamRoot },
      revision: { revision: 1 },
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
      rpcRemoteAgentReadTeamFile(bindings, { context, fileId })
    ).rejects.toMatchObject({ status: 409, code: "center_agent.paused" });
  });
});
