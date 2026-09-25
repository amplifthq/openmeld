import { env, runInDurableObject, SELF } from "cloudflare:test";
import {
  applyOpenMeldRequestContextHeaders,
  OPENMELD_EXPECTED_FORWARDED_BY,
} from "@openmeld/gateway-contract";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { organizationFileRootName } from "../src/files/file-root-identity";

const FORBIDDEN_RPC_ERROR = /HTTP 403/u;

async function fixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `file_org_${suffix}`;
  const users = [
    { id: `file_user_a_${suffix}`, name: "Alex" },
    { id: `file_user_b_${suffix}`, name: "Blair" },
  ];
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(organizationId, "Files Test", `files-${suffix}`, Date.now())
    .run();
  const contexts: OpenMeldRequestContext[] = [];
  for (const [index, user] of users.entries()) {
    const profileId = crypto.randomUUID();
    await env.OPENMELD_DB.prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
    )
      .bind(
        user.id,
        user.name,
        `files-${index}-${suffix}@example.com`,
        Date.now(),
        Date.now()
      )
      .run();
    await env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)"
    )
      .bind(
        `file_member_${index}_${suffix}`,
        organizationId,
        user.id,
        Date.now()
      )
      .run();
    await env.OPENMELD_DB.prepare(
      `INSERT INTO openmeld_profiles (
        profile_id, profile_name, profile_handle, profile_kind, is_default,
        status, owner_user_id, created_by_user_id, source, created_at, updated_at
      ) VALUES (?, ?, ?, 'human', 1, 'active', ?, ?, 'auth_bootstrap', ?, ?)`
    )
      .bind(
        profileId,
        user.name,
        `file-profile-${index}-${suffix}`,
        user.id,
        user.id,
        Date.now(),
        Date.now()
      )
      .run();
    contexts.push({
      activeOrganizationId: organizationId,
      actorContext: {
        requestId: crypto.randomUUID(),
        callerPrincipalId: user.id,
        ownerUserId: user.id,
        openMeldProfileId: profileId,
        profileKind: "human",
        profileName: user.name,
      },
    });
  }
  return {
    organizationId,
    users,
    contexts: contexts as [OpenMeldRequestContext, OpenMeldRequestContext],
  };
}

describe("Team and member Files roots", () => {
  it("shares Team folders, isolates private folders, and revokes reads with membership", async () => {
    const { organizationId, users, contexts } = await fixture();
    const teamRoot = { kind: "team" as const, organizationId };
    const privateRoot = {
      kind: "member" as const,
      organizationId,
      memberUserId: users[0]?.id ?? "",
    };
    const team = env.OPENMELD_FILE_ROOTS.get(
      env.OPENMELD_FILE_ROOTS.idFromName(organizationFileRootName(teamRoot))
    );
    const personal = env.OPENMELD_FILE_ROOTS.get(
      env.OPENMELD_FILE_ROOTS.idFromName(organizationFileRootName(privateRoot))
    );
    const teamFolder = await team.createFolder({
      root: teamRoot,
      context: contexts[0],
      body: { name: "Shared", clientMutationId: crypto.randomUUID() },
    });
    const privateFolder = await personal.createFolder({
      root: privateRoot,
      context: contexts[0],
      body: { name: "Private", clientMutationId: crypto.randomUUID() },
    });
    expect(
      (await team.list({ root: teamRoot, context: contexts[1] })).entries.map(
        (entry) => entry.id
      )
    ).toContain(teamFolder.id);
    expect(
      (
        await personal.list({ root: privateRoot, context: contexts[0] })
      ).entries.map((entry) => entry.id)
    ).toContain(privateFolder.id);
    const privateDenial = await runInDurableObject(
      personal,
      async (instance) => {
        try {
          await instance.list({ root: privateRoot, context: contexts[1] });
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }
    );
    expect(privateDenial).toMatch(FORBIDDEN_RPC_ERROR);
    await env.OPENMELD_DB.prepare(
      "DELETE FROM members WHERE organization_id = ? AND user_id = ?"
    )
      .bind(organizationId, users[1]?.id)
      .run();
    const revokedDenial = await runInDurableObject(team, async (instance) => {
      try {
        await instance.list({ root: teamRoot, context: contexts[1] });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(revokedDenial).toMatch(FORBIDDEN_RPC_ERROR);
  });

  it("serves an authorized Team listing without exposing its internal writer ID", async () => {
    const { organizationId, contexts } = await fixture();
    const headers = new Headers();
    applyOpenMeldRequestContextHeaders(
      headers,
      { requestContext: contexts[0] },
      OPENMELD_EXPECTED_FORWARDED_BY
    );
    headers.set("content-type", "application/json");
    const created = await SELF.fetch(
      "http://localhost/v1/organizations/current/files/team/folders",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Plans",
          clientMutationId: crypto.randomUUID(),
        }),
      }
    );
    expect(created.status).toBe(200);
    const createdPayload = (await created.json()) as {
      folder: { id: string; root: unknown };
    };
    expect(createdPayload.folder.root).toEqual({
      kind: "team",
      organizationId,
    });
    const response = await SELF.fetch(
      "http://localhost/v1/organizations/current/files/team",
      { headers }
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.root).toEqual({ kind: "team", organizationId });
    expect(payload.entries).toMatchObject([
      {
        id: createdPayload.folder.id,
        name: "Plans",
        root: { kind: "team", organizationId },
      },
    ]);
    expect(payload).not.toHaveProperty("spaceId");
  });
});
