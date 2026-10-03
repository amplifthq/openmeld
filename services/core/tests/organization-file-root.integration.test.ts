import { env, runInDurableObject, SELF } from "cloudflare:test";
import {
  applyOpenMeldRequestContextHeaders,
  OPENMELD_EXPECTED_FORWARDED_BY,
} from "@openmeld/gateway-contract";
import { buildSpaceMessageEvidence } from "@openmeld/protocol";
import {
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdFromDigest,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  SPACE_FILE_UPLOAD_PART_BYTES,
  spaceFileUploadIdForMutation,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import { organizationFileRootName } from "../src/files/file-root-identity";
import type { OrganizationFileRoot } from "../src/files/organization-file-root";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcListSignals,
  rpcMutateSpaceMessage,
  rpcPostSignal,
  rpcReadSpaceFileContent,
  rpcWriteSpaceFileContent,
} from "../src/rpc/methods";
import { hashSpaceFileStream } from "../src/space/application/space-file-stream";

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
  it("copies only the author's selected version and preserves the lawful Files copy after recall", async () => {
    const { contexts } = await fixture();
    const context = contexts[0];
    const headers = new Headers({ "content-type": "application/json" });
    applyOpenMeldRequestContextHeaders(
      headers,
      { requestContext: context },
      OPENMELD_EXPECTED_FORWARDED_BY
    );
    const create = async (accessMode = "members_only") => {
      const response = await SELF.fetch("http://localhost/v1/spaces", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Synthetic excerpt fixture",
          visibility: "private",
          accessMode,
        }),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { spaceId: string }).spaceId;
    };
    const sourceSpace = await create();
    const targetSpace = await create();
    const profileId = context.actorContext.openMeldProfileId;
    const signal = await rpcPostSignal(env as CoreBindings, {
      context,
      spaceId: sourceSpace,
      profile: { profileId, kind: "human", profileName: "Alex" },
      text: "Hidden prefix. Shared 🌱 text. Hidden suffix.",
      authoringPolicy: "user_authored",
    });
    if (signal.type !== "signal.text") {
      throw new Error("Expected text fixture");
    }
    const current = (
      await rpcListSignals(env as CoreBindings, {
        context,
        spaceId: sourceSpace,
        aroundSignalId: signal.id,
        beforeCount: 0,
        afterCount: 0,
        signalTypes: ["signal.text"],
      })
    ).signals[0];
    if (current?.type !== "signal.text") {
      throw new Error("Expected current source evidence");
    }
    const evidence = await buildSpaceMessageEvidence({
      signal: current,
      spaceId: sourceSpace,
    });
    const body = {
      source: {
        spaceId: sourceSpace,
        sourceSignalId: signal.id,
        authorProfileId: profileId,
        version: evidence.message.sourceRef.version,
        start: 15,
        end: 29,
      },
      audienceProfileIds: [profileId],
      name: "selected.txt",
      parentId: null,
      clientMutationId: crypto.randomUUID(),
    };
    const copy = (
      request = body,
      destination = targetSpace,
      requestHeaders = headers
    ) =>
      SELF.fetch(`http://localhost/v1/spaces/${destination}/files/excerpts`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(request),
      });
    expect(
      (
        await copy({
          ...body,
          source: {
            ...body.source,
            authorProfileId: contexts[1].actorContext.openMeldProfileId,
          },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await copy({
          ...body,
          source: { ...body.source, version: `sha256:${"0".repeat(64)}` },
        })
      ).status
    ).toBe(409);
    expect(
      (await copy({ ...body, source: { ...body.source, end: 1000 } })).status
    ).toBe(400);
    expect(
      (
        await copy({
          ...body,
          audienceProfileIds: [
            profileId,
            contexts[1].actorContext.openMeldProfileId,
          ],
        })
      ).status
    ).toBe(409);
    expect((await copy(body, await create("public"))).status).toBe(409);
    const response = await copy();
    expect(response.status).toBe(201);
    const { file } = (await response.json()) as { file: { id: string } };
    const content = () =>
      rpcReadSpaceFileContent(env as CoreBindings, {
        context,
        spaceId: targetSpace,
        content: { spaceId: targetSpace, fileId: file.id, revision: 1 },
      });
    expect(new TextDecoder().decode((await content()).bytes)).toBe(
      "Shared 🌱 text."
    );
    const retry = await copy();
    expect(retry.status).toBe(201);
    expect(((await retry.json()) as { file: { id: string } }).file.id).toBe(
      file.id
    );
    expect(
      (await copy({ ...body, source: { ...body.source, start: 16 } })).status
    ).toBe(409);
    await rpcMutateSpaceMessage(env as CoreBindings, {
      context,
      spaceId: sourceSpace,
      signalId: signal.id,
      spaceAccess: createAuthenticatedSpaceAccessContext({
        spaceId: sourceSpace,
        requestContext: context,
      }),
      body: { action: "recall", expectedRevision: 0 },
    });
    expect(
      (await copy({ ...body, clientMutationId: crypto.randomUUID() })).status
    ).toBe(409);
    expect(new TextDecoder().decode((await content()).bytes)).toBe(
      "Shared 🌱 text."
    );
    await expect(
      rpcReadSpaceFileContent(env as CoreBindings, {
        context: contexts[1],
        spaceId: targetSpace,
        content: { spaceId: targetSpace, fileId: file.id, revision: 1 },
      })
    ).rejects.toThrow();
  });

  it("copies a private exact revision into one Space with source-bound retries", async () => {
    const { contexts } = await fixture();
    const headersFor = (context: OpenMeldRequestContext) => {
      const headers = new Headers({ "content-type": "application/json" });
      applyOpenMeldRequestContextHeaders(
        headers,
        { requestContext: context },
        OPENMELD_EXPECTED_FORWARDED_BY
      );
      return headers;
    };
    const space = await SELF.fetch("http://localhost/v1/spaces", {
      method: "POST",
      headers: headersFor(contexts[0]),
      body: JSON.stringify({
        name: "Destination Space",
        visibility: "private",
        accessMode: "public",
      }),
    });
    expect(space.status).toBe(200);
    const { spaceId } = (await space.json()) as { spaceId: string };
    const sourceWrite = await SELF.fetch(
      `http://localhost/v1/organizations/current/files/my?name=private-source.txt&clientMutationId=${crypto.randomUUID()}`,
      {
        method: "POST",
        headers: new Headers({
          ...Object.fromEntries(headersFor(contexts[0])),
          "content-type": "text/plain",
        }),
        body: "Private source version one",
      }
    );
    expect(sourceWrite.status).toBe(201);
    const { file: sourceFile } = (await sourceWrite.json()) as {
      file: { id: string };
    };
    const body = {
      sourceLocation: "my",
      sourceFileId: sourceFile.id,
      sourceRevision: 1,
      name: "space-copy.txt",
      parentId: null,
      clientMutationId: crypto.randomUUID(),
    };
    const copy = (context: OpenMeldRequestContext, request = body) =>
      SELF.fetch(`http://localhost/v1/spaces/${spaceId}/files/copies`, {
        method: "POST",
        headers: headersFor(context),
        body: JSON.stringify(request),
      });
    const otherOrganization = await fixture();
    expect([403, 404]).toContain(
      (await copy(otherOrganization.contexts[0])).status
    );
    expect([403, 404]).toContain((await copy(contexts[1])).status);
    const first = await copy(contexts[0]);
    expect(first.status).toBe(201);
    const result = (await first.json()) as {
      file: { id: string; name: string };
    };
    expect(result.file.name).toBe("space-copy.txt");
    const replay = await copy(contexts[0]);
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as typeof result).file.id).toBe(
      result.file.id
    );
    expect(
      (await copy(contexts[0], { ...body, name: "different-copy.txt" })).status
    ).toBe(409);
    const read = await rpcReadSpaceFileContent(env as CoreBindings, {
      context: contexts[0],
      spaceId,
      content: { spaceId, fileId: result.file.id },
    });
    expect(new TextDecoder().decode(read.bytes)).toBe(
      "Private source version one"
    );
  });

  it("copies an authorized Space revision into Team Files without granting other members access to its source", async () => {
    const { organizationId, contexts } = await fixture();
    const headersFor = (context: OpenMeldRequestContext) => {
      const headers = new Headers({ "content-type": "application/json" });
      applyOpenMeldRequestContextHeaders(
        headers,
        { requestContext: context },
        OPENMELD_EXPECTED_FORWARDED_BY
      );
      return headers;
    };
    const created = await SELF.fetch("http://localhost/v1/spaces", {
      method: "POST",
      headers: headersFor(contexts[0]),
      body: JSON.stringify({
        name: "Source Space",
        visibility: "private",
        accessMode: "public",
      }),
    });
    expect(created.status).toBe(200);
    const { spaceId } = (await created.json()) as { spaceId: string };
    const bytes = new TextEncoder().encode("Space source revision");
    const clientMutationId = crypto.randomUUID();
    const fileId = await buildSpaceFileEntryIdForMutation(clientMutationId);
    const digest = await hashSpaceFileStream(new Blob([bytes]).stream());
    const revisionId = await buildSpaceFileRevisionIdFromDigest({
      baseRevision: null,
      contentDigest: digest,
      clientMutationId,
      mimeType: "text/plain",
      name: "space-notes.txt",
      parentId: null,
    });
    await rpcWriteSpaceFileContent(env as CoreBindings, {
      context: contexts[0],
      spaceId,
      bytes: bytes.buffer as ArrayBuffer,
      write: {
        spaceId,
        fileId,
        revisionId,
        name: "space-notes.txt",
        parentId: null,
        baseRevision: null,
        clientMutationId,
        mimeType: "text/plain",
        sizeBytes: bytes.byteLength,
      },
    });
    const copyBody = {
      sourceLocation: "space",
      sourceSpaceId: spaceId,
      sourceFileId: fileId,
      sourceRevision: 1,
      name: "copied-space-notes.txt",
      parentId: null,
      clientMutationId: crypto.randomUUID(),
    };
    const copy = (context: OpenMeldRequestContext) =>
      SELF.fetch(
        "http://localhost/v1/organizations/current/files/team/copies",
        {
          method: "POST",
          headers: headersFor(context),
          body: JSON.stringify(copyBody),
        }
      );
    const otherOrganization = await fixture();
    expect([403, 404]).toContain(
      (await copy(otherOrganization.contexts[0])).status
    );
    const first = await copy(contexts[0]);
    expect(first.status).toBe(201);
    const result = (await first.json()) as {
      file: { id: string; root: unknown };
      source: { root: unknown; revisionId: string };
    };
    expect(result.source).toMatchObject({
      root: { kind: "space", organizationId, spaceId },
      revisionId,
    });
    expect(result.file.root).toEqual({ kind: "team", organizationId });
    const retry = await copy(contexts[0]);
    expect(retry.status).toBe(201);
    expect(((await retry.json()) as typeof result).file.id).toBe(
      result.file.id
    );
    const sharedRead = await SELF.fetch(
      `http://localhost/v1/organizations/current/files/team/${result.file.id}/content`,
      { headers: headersFor(contexts[1]) }
    );
    expect(sharedRead.status).toBe(200);
    expect(await sharedRead.text()).toBe("Space source revision");
  });

  it("copies an exact private revision to Team Files without changing its source or retry target", async () => {
    const { organizationId, contexts } = await fixture();
    const headersFor = (context: OpenMeldRequestContext) => {
      const headers = new Headers({ "content-type": "application/json" });
      applyOpenMeldRequestContextHeaders(
        headers,
        { requestContext: context },
        OPENMELD_EXPECTED_FORWARDED_BY
      );
      return headers;
    };
    const original = await SELF.fetch(
      `http://localhost/v1/organizations/current/files/my?name=notes.txt&clientMutationId=${crypto.randomUUID()}`,
      {
        method: "POST",
        headers: new Headers({
          ...Object.fromEntries(headersFor(contexts[0])),
          "content-type": "text/plain",
        }),
        body: "first version",
      }
    );
    expect(original.status).toBe(201);
    const { file: privateFile } = (await original.json()) as {
      file: { id: string };
    };
    const updated = await SELF.fetch(
      `http://localhost/v1/organizations/current/files/my/${privateFile.id}/content?baseRevision=1&clientMutationId=${crypto.randomUUID()}`,
      {
        method: "PUT",
        headers: new Headers({
          ...Object.fromEntries(headersFor(contexts[0])),
          "content-type": "text/plain",
        }),
        body: "second version",
      }
    );
    expect(updated.status).toBe(200);
    const mutationId = crypto.randomUUID();
    const copyBody = {
      sourceLocation: "my",
      sourceFileId: privateFile.id,
      sourceRevision: 1,
      name: "shared-notes.txt",
      parentId: null,
      clientMutationId: mutationId,
    };
    const copy = (body: typeof copyBody, context = contexts[0]) =>
      SELF.fetch(
        "http://localhost/v1/organizations/current/files/team/copies",
        {
          method: "POST",
          headers: headersFor(context),
          body: JSON.stringify(body),
        }
      );
    expect((await copy(copyBody, contexts[1])).status).toBe(404);
    const first = await copy(copyBody);
    expect(first.status).toBe(201);
    const result = (await first.json()) as {
      file: { id: string; root: unknown };
      source: { revision: number };
    };
    expect(result.file.root).toEqual({ kind: "team", organizationId });
    expect(result.source.revision).toBe(1);
    const replay = await copy(copyBody);
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as typeof result).file.id).toBe(
      result.file.id
    );
    expect((await copy({ ...copyBody, sourceRevision: 2 })).status).toBe(409);
    const teamRead = await SELF.fetch(
      `http://localhost/v1/organizations/current/files/team/${result.file.id}/content`,
      { headers: headersFor(contexts[1]) }
    );
    expect(teamRead.status).toBe(200);
    expect(await teamRead.text()).toBe("first version");
  });

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
