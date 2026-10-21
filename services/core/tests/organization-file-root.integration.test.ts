import { runInDurableObject, SELF } from "cloudflare:test";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
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
import { describe, expect, it, vi } from "vitest";
import { ensurePersonalComputer } from "../src/computer/personal-computer";
import { organizationFileRootName } from "../src/files/file-root-identity";
import { OrganizationFileRoot } from "../src/files/organization-file-root";
import type { CoreBindings } from "../src/lib/bindings";
import { cleanupDeletedAccount } from "../src/organizations/account-deletion";
import {
  rpcAddSpaceMembers,
  rpcListSignals,
  rpcMutateSpaceMessage,
  rpcPostSignal,
  rpcReadSpaceFileContent,
  rpcWriteSpaceFileContent,
} from "../src/rpc/methods";
import { hashSpaceFileStream } from "../src/space/application/space-file-stream";
import { env } from "../test-support/worker-env";

const FORBIDDEN_RPC_ERROR = /HTTP 403/u;
async function fixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `file_org_${suffix}`;
  const users = [
    { id: `file_user_a_${suffix}`, name: "Alex" },
    { id: `file_user_b_${suffix}`, name: "Blair" },
  ];
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
      values: [],
    },
    values: [organizationId, "Files Test", `files-${suffix}`, Date.now()],
  });
  const contexts: OpenMeldRequestContext[] = [];
  for (const [index, user] of users.entries()) {
    const profileId = crypto.randomUUID();
    await getPostgresDatabase(env).query({
      ...{
        text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $5)',
        values: [],
      },
      values: [
        user.id,
        user.name,
        `files-${index}-${suffix}@example.com`,
        Date.now(),
        Date.now(),
      ],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', $4)',
        values: [],
      },
      values: [
        `file_member_${index}_${suffix}`,
        organizationId,
        user.id,
        Date.now(),
      ],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: `INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id, profile_name, profile_handle, profile_kind, is_default,
        status, owner_user_id, created_by_user_id, source, created_at, updated_at
      ) VALUES ($1, $2, $3, 'human', 1, 'active', $4, $5, 'auth_bootstrap', $6, $7)`,
        values: [],
      },
      values: [
        profileId,
        user.name,
        `file-profile-${index}-${suffix}`,
        user.id,
        user.id,
        Date.now(),
        Date.now(),
      ],
    });
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
  it("waits for an admitted R2 write before reporting private-root erasure complete", async () => {
    const { organizationId, users, contexts } = await fixture();
    const userId = users[0]?.id;
    if (!userId) {
      throw new Error("Missing user");
    }
    const root = {
      kind: "member" as const,
      organizationId,
      memberUserId: userId,
    };
    const stub = env.OPENMELD_FILE_ROOTS.get(
      env.OPENMELD_FILE_ROOTS.idFromName(organizationFileRootName(root))
    );
    await runInDurableObject(stub, async (_instance, state) => {
      const started = Promise.withResolvers<void>();
      const released = Promise.withResolvers<void>();
      const bucket = new Proxy(env.OPENMELD_SPACE_ATTACHMENTS, {
        get(target, key) {
          if (key === "put") {
            return async (...args: Parameters<R2Bucket["put"]>) => {
              started.resolve();
              await released.promise;
              return target.put(...args);
            };
          }
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const owner = new OrganizationFileRoot(state, {
        ...env,
        OPENMELD_SPACE_ATTACHMENTS: bucket,
      } as CoreBindings);
      const bytes = new TextEncoder().encode("private in-flight content");
      const mutation = crypto.randomUUID();
      const fileId = await buildSpaceFileEntryIdForMutation(mutation);
      const revisionId = await buildSpaceFileRevisionIdFromDigest({
        baseRevision: null,
        clientMutationId: mutation,
        mimeType: "text/plain",
        name: "private.txt",
        parentId: null,
        contentDigest: await hashSpaceFileStream(new Blob([bytes]).stream()),
      });
      const writing = owner
        .writeContent({
          root,
          context: contexts[0],
          bytes: bytes.slice().buffer,
          write: {
            spaceId: state.id.toString(),
            fileId,
            revisionId,
            clientMutationId: mutation,
            name: "private.txt",
            parentId: null,
            baseRevision: null,
            mimeType: "text/plain",
            sizeBytes: bytes.byteLength,
          },
        })
        .then(
          () => "accepted",
          (error) => String(error)
        );
      await started.promise;
      await getPostgresDatabase(env).query({
        text: 'UPDATE "openmeld"."users" SET deleted_at = $2 WHERE id = $1',
        values: [userId, Date.now()],
      });
      expect(await owner.purgeDeletedAccountRoot({ root, userId })).toBe(false);
      released.resolve();
      expect(await writing).not.toBe("accepted");
      expect(await owner.purgeDeletedAccountRoot({ root, userId })).toBe(true);
      expect(
        (
          await bucket.list({
            prefix: `org/${organizationId}/file-roots/member/${userId}/`,
          })
        ).objects
      ).toEqual([]);
    });
  });
  it("finishes account cleanup after another tenant has disappeared and preserves the surviving team's files and Slack connection", async () => {
    const { organizationId, users } = await fixture();
    const userId = users[0]?.id;
    const teammateId = users[1]?.id;
    if (!(userId && teammateId)) {
      throw new Error("Missing account fixture");
    }
    const db = getPostgresDatabase(env);
    const closed = `closed-${crypto.randomUUID()}`;
    const personalComputer = await ensurePersonalComputer(db, userId);
    const teammateComputer = await ensurePersonalComputer(db, teammateId);
    const eraseAccountComputer = vi
      .fn<
        NonNullable<
          NonNullable<
            CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]
          >["eraseAccountComputer"]
        >
      >()
      .mockRejectedValueOnce(new Error("Computer temporarily unavailable"))
      .mockResolvedValue(undefined);
    const cleanupEnv = {
      ...env,
      OPENMELD_REMOTE_AGENT_WORKER: { eraseAccountComputer },
    } as CoreBindings;
    const gone = `gone-${crypto.randomUUID()}`;
    await db.query({
      text: 'INSERT INTO "openmeld"."organizations" (id,name,slug,created_at,deletion_requested_at) VALUES ($1,$1,$1,$2,$2)',
      values: [closed, Date.now()],
    });
    for (const id of [closed, organizationId]) {
      await db.query({
        text: 'INSERT INTO "openmeld"."slack_workspace_tokens" (slack_team_id,encrypted_bot_token,bot_user_id,installed_by_user_id,organization_id,created_at_ms,updated_at_ms) VALUES ($1,$2,$3,$4,$1,1,1)',
        values: [id, "encrypted-fixture", "bot", userId],
      });
      await db.query({
        text: 'INSERT INTO "openmeld"."openMeldRemoteAgent_slack_workspace_bindings" (slack_team_id,organization_id,created_at_ms,updated_at_ms) VALUES ($1,$1,1,1)',
        values: [id],
      });
    }
    const privateKey = `org/${gone}/file-roots/member/${userId}/files/private/revisions/old`;
    const closedKey = `org/${closed}/file-roots/team/files/shared/revisions/one`;
    const retainedKey = `org/${organizationId}/file-roots/team/files/shared/revisions/one`;
    for (const key of [privateKey, closedKey, retainedKey]) {
      await env.OPENMELD_SPACE_ATTACHMENTS.put(key, "work");
    }
    await db.query({
      text: 'UPDATE "openmeld"."users" SET deleted_at = $2 WHERE id = $1',
      values: [userId, Date.now()],
    });
    const humanCleanupId = crypto.randomUUID();
    await db.query({
      text: 'INSERT INTO "openmeld"."openmeld_profile_deletion_outbox" (profile_id,owner_user_id,profile_kind) VALUES ($1,$2,\'human\')',
      values: [humanCleanupId, userId],
    });
    const plan = {
      deleteOrganizationIds: [closed],
      privateOrganizationIds: [gone, organizationId, closed],
      profileIds: [humanCleanupId],
    };
    await db.query({
      text: 'INSERT INTO "openmeld"."account_deletion_requests" (user_id,plan_json,created_at_ms,next_attempt_at_ms) VALUES ($1,$2,1,1)',
      values: [userId, JSON.stringify(plan)],
    });
    await expect(
      cleanupDeletedAccount(cleanupEnv, { userId, privateRootIndex: 0 })
    ).rejects.toThrow("Computer temporarily unavailable");
    expect(
      (
        await db.query({
          text: 'SELECT id FROM "openmeld"."cloud_computers" WHERE owner_user_id = $1',
          values: [userId],
        })
      ).rows
    ).toEqual([{ id: personalComputer.id }]);
    expect(
      await cleanupDeletedAccount(cleanupEnv, {
        userId,
        privateRootIndex: 0,
      })
    ).toEqual({ complete: false, privateRootIndex: 3 });
    expect(eraseAccountComputer).toHaveBeenLastCalledWith({
      computerId: personalComputer.id,
    });
    expect(
      (
        await db.query({
          text: 'SELECT id FROM "openmeld"."cloud_computers" WHERE owner_user_id = ANY($1::text[])',
          values: [[userId, teammateId]],
        })
      ).rows
    ).toEqual([{ id: teammateComputer.id }]);
    await db.query({
      text: 'DELETE FROM "openmeld"."openmeld_profile_deletion_outbox" WHERE profile_id = $1',
      values: [humanCleanupId],
    });
    expect(
      await cleanupDeletedAccount(cleanupEnv, { userId, privateRootIndex: 0 })
    ).toEqual({ complete: true, privateRootIndex: 3 });
    expect(await env.OPENMELD_SPACE_ATTACHMENTS.get(privateKey)).toBeNull();
    expect(await env.OPENMELD_SPACE_ATTACHMENTS.get(closedKey)).toBeNull();
    expect(
      await (await env.OPENMELD_SPACE_ATTACHMENTS.get(retainedKey))?.text()
    ).toBe("work");
    for (const table of [
      "slack_workspace_tokens",
      "openMeldRemoteAgent_slack_workspace_bindings",
    ]) {
      expect(
        (
          await db.query({
            text: `SELECT 1 FROM "openmeld"."${table}" WHERE organization_id = $1`,
            values: [closed],
          })
        ).rows
      ).toEqual([]);
      expect(
        (
          await db.query({
            text: `SELECT 1 FROM "openmeld"."${table}" WHERE organization_id = $1`,
            values: [organizationId],
          })
        ).rows
      ).toHaveLength(1);
    }
  });
  it("erases a deleted account's private root and orphan revisions without deleting team files", async () => {
    const { organizationId, users, contexts } = await fixture();
    const userId = users[0]?.id;
    if (!userId) {
      throw new Error("Missing account fixture");
    }
    const root = {
      kind: "member" as const,
      organizationId,
      memberUserId: userId,
    };
    const personal = env.OPENMELD_FILE_ROOTS.get(
      env.OPENMELD_FILE_ROOTS.idFromName(organizationFileRootName(root))
    );
    await personal.createFolder({
      root,
      context: contexts[0],
      body: { name: "Private", clientMutationId: crypto.randomUUID() },
    });
    const privateKey = `org/${organizationId}/file-roots/member/${userId}/files/private/revisions/old`;
    const teamKey = `org/${organizationId}/file-roots/team/files/shared/revisions/one`;
    await env.OPENMELD_SPACE_ATTACHMENTS.put(privateKey, "private revision");
    await env.OPENMELD_SPACE_ATTACHMENTS.put(teamKey, "shared revision");
    await expect(
      (async () => await personal.purgeDeletedAccountRoot({ root, userId }))()
    ).rejects.toThrow("not authorized");
    await getPostgresDatabase(env).query({
      text: 'UPDATE "openmeld"."users" SET deleted_at = $2 WHERE id = $1',
      values: [userId, Date.now()],
    });
    expect(await personal.purgeDeletedAccountRoot({ root, userId })).toBe(true);
    expect(await personal.purgeDeletedAccountRoot({ root, userId })).toBe(true);
    expect(await env.OPENMELD_SPACE_ATTACHMENTS.get(privateKey)).toBeNull();
    expect(
      await (await env.OPENMELD_SPACE_ATTACHMENTS.get(teamKey))?.text()
    ).toBe("shared revision");
    await expect(
      (async () => await personal.list({ root, context: contexts[0] }))()
    ).rejects.toThrow("being deleted");
    const team = { kind: "team" as const, organizationId };
    const shared = env.OPENMELD_FILE_ROOTS.get(
      env.OPENMELD_FILE_ROOTS.idFromName(organizationFileRootName(team))
    );
    await expect(
      (async () =>
        await shared.purgeDeletedAccountRoot({ root: team, userId }))()
    ).rejects.toThrow("not authorized");
  });
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
    const recipient = contexts[1].actorContext;
    await rpcAddSpaceMembers(env as CoreBindings, {
      context,
      spaceId: targetSpace,
      members: [
        {
          profileId: recipient.openMeldProfileId,
          profileKind: "human",
          profileName: "Blair",
          ownerName: "Blair",
          ownerUserId: recipient.ownerUserId ?? null,
          agentControllerRef: null,
        },
      ],
    });
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
      audienceProfileIds: [profileId, recipient.openMeldProfileId],
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
          audienceProfileIds: [profileId],
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
    const recipientRead = await rpcReadSpaceFileContent(env as CoreBindings, {
      context: contexts[1],
      spaceId: targetSpace,
      content: { spaceId: targetSpace, fileId: file.id, revision: 1 },
    });
    expect(new TextDecoder().decode(recipientRead.bytes)).toBe(
      "Shared 🌱 text."
    );
    await expect(
      rpcListSignals(env as CoreBindings, {
        context: contexts[1],
        spaceId: sourceSpace,
        aroundSignalId: signal.id,
        beforeCount: 0,
        afterCount: 0,
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
    const { spaceId } = (await space.json()) as {
      spaceId: string;
    };
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
      file: {
        id: string;
      };
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
      file: {
        id: string;
        name: string;
      };
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
    const { spaceId } = (await created.json()) as {
      spaceId: string;
    };
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
      file: {
        id: string;
        root: unknown;
      };
      source: {
        root: unknown;
        revisionId: string;
      };
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
      file: {
        id: string;
      };
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
      file: {
        id: string;
        root: unknown;
      };
      source: {
        revision: number;
      };
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
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [organizationId, users[1]?.id],
    });
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
      folder: {
        id: string;
        root: unknown;
      };
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
      file: {
        id: string;
        latestRevision: {
          revision: number;
        };
        root: unknown;
      };
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
      file: {
        latestRevision: {
          revision: number;
        };
      };
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
    expect(first.headers.get("cache-control")).toContain("no-transform");
    expect(await first.text()).toBe("first plan");
    const rangedHeaders = requestHeaders();
    rangedHeaders.set("range", "bytes=0-5");
    const ranged = await SELF.fetch(contentUrl, { headers: rangedHeaders });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("cache-control")).toContain("no-transform");
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
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [organizationId, users[0]?.id],
    });
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
        latestRevision: {
          sizeBytes: number;
        };
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
