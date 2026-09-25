import { env, runInDurableObject, SELF } from "cloudflare:test";
import {
  applyOpenMeldRequestContextHeaders,
  OPENMELD_EXPECTED_FORWARDED_BY,
} from "@openmeld/gateway-contract";
import {
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  SPACE_FILE_UPLOAD_PART_BYTES,
  spaceFileUploadIdForMutation,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { organizationFileRootName } from "../src/files/file-root-identity";
import type { OrganizationFileRoot } from "../src/files/organization-file-root";

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
          await (instance as OrganizationFileRoot).list({
            root: privateRoot,
            context: contexts[1],
          });
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
        await (instance as OrganizationFileRoot).list({
          root: teamRoot,
          context: contexts[1],
        });
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

  it("writes immutable Team revisions, supports ranges, and checks access on reads", async () => {
    const { organizationId, users, contexts } = await fixture();
    const requestHeaders = () => {
      const headers = new Headers();
      applyOpenMeldRequestContextHeaders(
        headers,
        {
          requestContext: {
            ...contexts[0],
            actorContext: {
              ...contexts[0].actorContext,
              requestId: crypto.randomUUID(),
            },
          },
        },
        OPENMELD_EXPECTED_FORWARDED_BY
      );
      headers.set("content-type", "text/plain");
      return headers;
    };
    const create = await SELF.fetch(
      `http://localhost/v1/organizations/current/files/team?name=plan.txt&clientMutationId=${crypto.randomUUID()}`,
      { method: "POST", headers: requestHeaders(), body: "first plan" }
    );
    expect(create.status).toBe(201);
    const initial = (await create.json()) as {
      file: { id: string; latestRevision: { revision: number }; root: unknown };
    };
    expect(initial.file.latestRevision.revision).toBe(1);
    expect(initial.file.root).toEqual({ kind: "team", organizationId });
    const contentUrl = `http://localhost/v1/organizations/current/files/team/${initial.file.id}/content`;
    const update = await SELF.fetch(
      `${contentUrl}?baseRevision=1&clientMutationId=${crypto.randomUUID()}`,
      { method: "PUT", headers: requestHeaders(), body: "second plan" }
    );
    expect(update.status).toBe(200);
    const updated = (await update.json()) as {
      file: { latestRevision: { revision: number } };
    };
    expect(updated.file.latestRevision.revision).toBe(2);
    const stale = await SELF.fetch(
      `${contentUrl}?baseRevision=1&clientMutationId=${crypto.randomUUID()}`,
      { method: "PUT", headers: requestHeaders(), body: "stale plan" }
    );
    expect(stale.status).toBe(409);
    const first = await SELF.fetch(`${contentUrl}?revision=1`, {
      headers: requestHeaders(),
    });
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("first plan");
    const rangedHeaders = requestHeaders();
    rangedHeaders.set("range", "bytes=0-5");
    const ranged = await SELF.fetch(contentUrl, { headers: rangedHeaders });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 0-5/11");
    expect(await ranged.text()).toBe("second");
    const head = await SELF.fetch(contentUrl, {
      method: "HEAD",
      headers: requestHeaders(),
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("11");
    const privatePath = `http://localhost/v1/organizations/current/files/my/${initial.file.id}/content`;
    const wrongRoot = await SELF.fetch(privatePath, {
      headers: requestHeaders(),
    });
    expect(wrongRoot.status).toBe(404);
    await env.OPENMELD_DB.prepare(
      "DELETE FROM members WHERE organization_id = ? AND user_id = ?"
    )
      .bind(organizationId, users[0]?.id)
      .run();
    const revoked = await SELF.fetch(contentUrl, { headers: requestHeaders() });
    expect(revoked.status).toBe(403);
  });

  it("commits a multipart Team upload only after its verified parts arrive", async () => {
    const { organizationId, contexts } = await fixture();
    const headers = new Headers();
    applyOpenMeldRequestContextHeaders(
      headers,
      { requestContext: contexts[0] },
      OPENMELD_EXPECTED_FORWARDED_BY
    );
    const bytes = new Uint8Array(SPACE_FILE_RAW_UPLOAD_MAX_BYTES + 1);
    bytes.fill(65);
    bytes[bytes.length - 1] = 66;
    const parts = [
      bytes.slice(0, SPACE_FILE_UPLOAD_PART_BYTES),
      bytes.slice(SPACE_FILE_UPLOAD_PART_BYTES),
    ];
    const digests = await Promise.all(
      parts.map(async (part) => {
        const digest = await crypto.subtle.digest("SHA-256", part);
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("");
      })
    );
    const clientMutationId = crypto.randomUUID();
    const uploadId = await spaceFileUploadIdForMutation(clientMutationId);
    const url = `http://localhost/v1/organizations/current/files/team/file-uploads/${uploadId}`;
    const start = await SELF.fetch(url, {
      method: "POST",
      headers: new Headers([...headers, ["content-type", "application/json"]]),
      body: JSON.stringify({
        action: "start",
        metadata: {
          mimeType: "application/octet-stream",
          sizeBytes: bytes.length,
          partDigests: digests,
          target: {
            kind: "file",
            name: "large.bin",
            parentId: null,
            clientMutationId,
          },
        },
      }),
    });
    expect(start.status).toBe(200);
    for (const [index, part] of parts.entries()) {
      const upload = await SELF.fetch(`${url}?part=${index + 1}`, {
        method: "POST",
        headers: new Headers([
          ...headers,
          ["content-type", "application/octet-stream"],
        ]),
        body: part.buffer,
      });
      expect(upload.status).toBe(200);
    }
    const complete = await SELF.fetch(url, {
      method: "POST",
      headers: new Headers([...headers, ["content-type", "application/json"]]),
      body: JSON.stringify({ action: "complete" }),
    });
    expect(complete.status).toBe(200);
    const payload = (await complete.json()) as {
      file: {
        id: string;
        latestRevision: { sizeBytes: number };
        root: unknown;
      };
    };
    expect(payload.file.latestRevision.sizeBytes).toBe(bytes.length);
    expect(payload.file.root).toEqual({ kind: "team", organizationId });
    const contentUrl = `http://localhost/v1/organizations/current/files/team/${payload.file.id}/content`;
    const firstHeaders = new Headers(headers);
    firstHeaders.set("range", "bytes=0-0");
    const first = await SELF.fetch(contentUrl, { headers: firstHeaders });
    expect(first.status).toBe(206);
    expect(new Uint8Array(await first.arrayBuffer())[0]).toBe(65);
    const lastHeaders = new Headers(headers);
    lastHeaders.set("range", `bytes=${bytes.length - 1}-${bytes.length - 1}`);
    const last = await SELF.fetch(contentUrl, { headers: lastHeaders });
    expect(last.status).toBe(206);
    expect(new Uint8Array(await last.arrayBuffer())[0]).toBe(66);
  });
});
