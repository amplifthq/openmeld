import { runInDurableObject } from "cloudflare:test";
import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { applyOpenMeldRequestContextHeaders } from "@openmeld/gateway-contract";
import type {
  OrganizationJoinRequestRpcInput,
  SpaceInvitationRpcInput,
  SpaceInvitationRpcResult,
} from "@openmeld/schemas";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { organizationJoinRequest } from "../src/organizations/organization-join-requests";
import { spaceInvitation } from "../src/organizations/space-invitations";
import { createCoreRpcHttpError } from "../src/rpc/errors";
import { upsertSpaceCreatorMember } from "../src/space/application/space-members-service";
import {
  readSpaceMetaRecordFromSql,
  upsertSpaceMetaRecord,
} from "../src/space/infrastructure/sql/space-meta-repo";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";
import { waitForJsonMessage } from "./test-support/ws-stream";

const core = env as unknown as CoreBindings;
describe("Organization Space self-join", () => {
  it("admits a colleague to a listed members-only Space and rechecks current policy", async () => {
    const f = await fixture();
    const input = {
      spaceId: f.spaceId,
      context: {
        activeOrganizationId: f.organizationId,
        actorContext: {
          callerPrincipalId: f.recipientId,
          ownerUserId: f.recipientId,
          openMeldProfileId: f.recipientProfile,
          profileKind: "human" as const,
          profileName: "Morgan Lee",
          requestId: crypto.randomUUID(),
        },
      },
      members: [
        {
          profileId: f.recipientProfile,
          profileKind: "human" as const,
          profileName: "Morgan Lee",
          ownerUserId: f.recipientId,
          ownerName: "Morgan Lee",
          agentControllerRef: null,
        },
      ] satisfies [
        {
          profileId: string;
          profileKind: "human";
          profileName: string;
          ownerUserId: string;
          ownerName: string;
          agentControllerRef: null;
        },
      ],
    };
    const setVisibility = (visibility: "public" | "private") =>
      runInDurableObject(f.stub, (_instance, state) => {
        const meta = readSpaceMetaRecordFromSql(state.storage.sql, f.spaceId);
        if (!meta) {
          throw new Error("Missing fixture Space");
        }
        upsertSpaceMetaRecord(state.storage.sql, { ...meta, visibility });
      });
    // Consume the Workers RPC thenable inside a native promise so rejections
    // are observed by the caller (including the negative assertions below).
    const postMembers = async (
      request: Parameters<Space["rpcPostMembers"]>[0] = input
    ) => await f.stub.rpcPostMembers(request);
    await setVisibility("public");
    // A destination link or caller-supplied Organization does not grant entry.
    await expect(postMembers()).rejects.toThrow("space.membership_required");
    expect(await f.memberStatus()).toBeNull();
    await f.joinOrganization();
    await setVisibility("private");
    await expect(postMembers()).rejects.toThrow("space.membership_required");
    await setVisibility("public");
    // Self-join cannot be repurposed to add another person or an Agent.
    await expect(
      postMembers({
        ...input,
        members: [{ ...input.members[0], profileId: crypto.randomUUID() }],
      })
    ).rejects.toThrow("space.membership_required");
    await expect(
      postMembers({ ...input, members: [...input.members, ...input.members] })
    ).rejects.toThrow("space.membership_required");
    await expect(
      postMembers({
        ...input,
        context: {
          ...input.context,
          actorContext: { ...input.context.actorContext, profileKind: "agent" },
        },
      })
    ).rejects.toThrow("space.membership_required");
    await expect(
      postMembers({
        ...input,
        context: {
          ...input.context,
          actorContext: {
            ...input.context.actorContext,
            callerPrincipalId: f.ownerId,
          },
        },
      })
    ).rejects.toThrow("space.membership_required");
    expect(await f.memberStatus()).toBeNull();
    const joined = await f.stub.rpcPostMembers(input);
    expect(joined.addedMemberIds).toEqual([f.recipientProfile]);
    expect(await f.memberStatus()).toBe("active");
    expect((await f.stub.rpcPostMembers(input)).alreadyMemberIds).toEqual([
      f.recipientProfile,
    ]);
    const headers = new Headers({ Upgrade: "websocket" });
    applyOpenMeldRequestContextHeaders(headers, {
      requestContext: input.context,
    });
    const response = await f.stub.fetch(
      new Request(`https://openmeld-core.internal/stream?space=${f.spaceId}`, {
        headers,
      })
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (!socket) {
      throw new Error("Missing accepted WebSocket");
    }
    socket.accept();
    const hello = waitForJsonMessage(
      socket,
      (message) => message.type === "system.hello.ack"
    );
    socket.send(
      JSON.stringify({
        type: "hello",
        profile: {
          kind: "human",
          profileId: f.recipientProfile,
          profileName: "Morgan Lee",
        },
      })
    );
    await hello;
    const passiveResponse = await f.stub.fetch(
      new Request(`https://openmeld-core.internal/stream?space=${f.spaceId}`, {
        headers,
      })
    );
    const passiveSocket = passiveResponse.webSocket;
    if (!passiveSocket) {
      throw new Error("Missing passive WebSocket");
    }
    passiveSocket.accept();
    const passiveHello = waitForJsonMessage(
      passiveSocket,
      (message) => message.type === "system.hello.ack"
    );
    passiveSocket.send(
      JSON.stringify({
        type: "hello",
        profile: {
          kind: "human",
          profileId: f.recipientProfile,
          profileName: "Morgan Lee",
        },
      })
    );
    await passiveHello;
    // Membership revalidation may close either stream during the awaited RPCs.
    // Observe both close events before revoking the member's authorization.
    const closed = new Promise<CloseEvent>((resolve) =>
      socket.addEventListener("close", resolve, { once: true })
    );
    const passiveClosed = new Promise<CloseEvent>((resolve) =>
      passiveSocket.addEventListener("close", resolve, { once: true })
    );
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [f.organizationId, f.recipientId],
    });
    await expect(
      (async () =>
        await f.stub.rpcGetStatus({
          spaceId: f.spaceId,
          context: input.context,
        }))()
    ).rejects.toThrow("space.membership_required");
    await expect(postMembers()).rejects.toThrow("space.membership_required");
    socket.send(
      JSON.stringify({
        type: "signal.text",
        data: { text: "A departed member must not publish this" },
      })
    );
    expect((await closed).code).toBe(1008);
    await f.stub.rpcPatchMeta({
      spaceId: f.spaceId,
      context: {
        ...input.context,
        actorContext: {
          ...input.context.actorContext,
          callerPrincipalId: f.ownerId,
          ownerUserId: f.ownerId,
          openMeldProfileId: f.ownerProfile,
        },
      },
      name: "Internal project renamed after departure",
    });
    expect((await passiveClosed).code).toBe(1008);
  });
  it("keeps other live sessions open when one access check cannot reach PostgreSQL", async () => {
    const f = await fixture();
    await f.joinOrganization();
    const context = (userId: string, profileId: string) => ({
      activeOrganizationId: f.organizationId,
      actorContext: {
        callerPrincipalId: userId,
        ownerUserId: userId,
        openMeldProfileId: profileId,
        profileKind: "human" as const,
        profileName: "Morgan Lee",
        requestId: crypto.randomUUID(),
      },
    });
    const ownerContext = context(f.ownerId, f.ownerProfile);
    const recipientContext = context(f.recipientId, f.recipientProfile);
    await runInDurableObject(f.stub, (_instance, state) => {
      const meta = readSpaceMetaRecordFromSql(state.storage.sql, f.spaceId);
      if (!meta) {
        throw new Error("Missing fixture Space");
      }
      upsertSpaceMetaRecord(state.storage.sql, {
        ...meta,
        visibility: "public",
      });
    });
    await f.stub.rpcPostMembers({
      spaceId: f.spaceId,
      context: recipientContext,
      members: [
        {
          profileId: f.recipientProfile,
          profileKind: "human",
          profileName: "Morgan Lee",
          ownerUserId: f.recipientId,
          ownerName: "Morgan Lee",
          agentControllerRef: null,
        },
      ],
    });
    const openLiveSocket = async (
      requestContext: typeof ownerContext,
      profileId: string
    ) => {
      const headers = new Headers({ Upgrade: "websocket" });
      applyOpenMeldRequestContextHeaders(headers, { requestContext });
      const response = await f.stub.fetch(
        new Request(
          `https://openmeld-core.internal/stream?space=${f.spaceId}`,
          { headers }
        )
      );
      const socket = response.webSocket;
      if (!socket) {
        throw new Error("Missing accepted WebSocket");
      }
      socket.accept();
      const hello = waitForJsonMessage(
        socket,
        (message) => message.type === "system.hello.ack"
      );
      socket.send(
        JSON.stringify({
          type: "hello",
          profile: { kind: "human", profileId, profileName: "Morgan Lee" },
        })
      );
      await hello;
      return socket;
    };
    const ownerSocket = await openLiveSocket(ownerContext, f.ownerProfile);
    const recipientSocket = await openLiveSocket(
      recipientContext,
      f.recipientProfile
    );
    const ownerClosed = new Promise<CloseEvent>((resolve) =>
      ownerSocket.addEventListener("close", resolve, { once: true })
    );
    const recipientClosed = new Promise<CloseEvent>((resolve) =>
      recipientSocket.addEventListener("close", resolve, { once: true })
    );
    // The recipient's Organization membership lookup now fails the way a
    // PostgreSQL connect timeout does; nobody's access was revoked.
    await runInDurableObject(f.stub, (instance) => {
      const space = instance as unknown as {
        authorizeSpacePasswordAccess: (input: {
          context?: { actorContext: { ownerUserId?: string } };
        }) => Promise<unknown>;
      };
      const authorize = space.authorizeSpacePasswordAccess.bind(space);
      space.authorizeSpacePasswordAccess = (input) =>
        input.context?.actorContext.ownerUserId === f.recipientId
          ? Promise.reject(
              createCoreRpcHttpError({
                status: 503,
                code: "organization.context_unavailable",
                // A failing lookup can echo request text into its message.
                reason:
                  "Organization context could not be verified. x-openmeld-space-password: hunter2",
              })
            )
          : authorize(input);
    });
    const loggedErrors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    onTestFinished(() => loggedErrors.mockRestore());
    const ownerInvalidation = waitForJsonMessage(
      ownerSocket,
      (message) => message.type === "space.meta.changed",
      5000
    );
    const ownerSeesRecipientQuit = waitForJsonMessage(
      ownerSocket,
      (message) =>
        message.type === "presence.quit" &&
        (message.profile as { profileId?: string } | undefined)?.profileId ===
          f.recipientProfile,
      5000
    );
    await f.stub.rpcPatchMeta({
      spaceId: f.spaceId,
      context: ownerContext,
      name: "Launch planning, week two",
    });
    // Fail closed only for the unverified session, with a retryable close.
    expect(await recipientClosed).toMatchObject({
      code: 1013,
      reason: "space_access_unverified",
    });
    await expect(ownerInvalidation).resolves.toMatchObject({
      type: "space.meta.changed",
      reason: "space.name.updated",
    });
    // The closed session is announced to the sessions that stay open.
    await expect(ownerSeesRecipientQuit).resolves.toMatchObject({
      type: "presence.quit",
    });
    const ownerOutcome = await Promise.race([
      ownerClosed.then(() => "closed"),
      new Promise((resolve) => setTimeout(() => resolve("open"), 50)),
    ]);
    expect(ownerOutcome).toBe("open");
    const accessCheckLogs = loggedErrors.mock.calls.filter(
      ([event]) => event === "[core.space.live_access_check_failed]"
    );
    expect(accessCheckLogs).not.toHaveLength(0);
    expect(JSON.stringify(accessCheckLogs)).not.toContain("hunter2");
    ownerSocket.close(1000, "test_complete");
  });
});
// First-party Auth directory contract; membership decisions use PostgreSQL.
describe("Space ownership handoff", () => {
  it("retains one owner during concurrent demotions and preserves creator attribution", async () => {
    const f = await fixture();
    const context = (userId: string, profileId: string) => ({
      activeOrganizationId: f.organizationId,
      actorContext: {
        requestId: crypto.randomUUID(),
        callerPrincipalId: userId,
        ownerUserId: userId,
        openMeldProfileId: profileId,
        profileKind: "human" as const,
      },
    });
    const ownerContext = context(f.ownerId, f.ownerProfile);
    const recipientContext = context(f.recipientId, f.recipientProfile);
    const patch = async (
      actor: typeof ownerContext,
      userId: string,
      role: "owner" | "member"
    ) =>
      await f.stub.rpcPatchMeta({
        spaceId: f.spaceId,
        context: actor,
        ownership: { userId, role },
      });
    await expect(patch(ownerContext, f.ownerId, "member")).rejects.toThrow(
      "space.last_owner"
    );
    await expect(patch(ownerContext, f.recipientId, "owner")).rejects.toThrow(
      "space.owner_membership_required"
    );
    await f.joinOrganization();
    const invitation = invitationId(await f.create());
    await f.recipient({ action: "claim", invitationId: invitation });
    await f.recipient({ action: "complete", invitationId: invitation });
    await expect(
      patch(recipientContext, f.recipientId, "owner")
    ).rejects.toThrow("space.forbidden");
    expect(
      (await patch(ownerContext, f.recipientId, "owner")).ownerUserIds
    ).toEqual(expect.arrayContaining([f.ownerId, f.recipientId]));
    await expect(
      getPostgresDatabase(env).query({
        ...{
          text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
          values: [],
        },
        values: [f.organizationId, f.recipientId],
      })
    ).rejects.toThrow();
    expect(
      await f.stub.rpcCheckSpaceOwnerDeparture({
        spaceId: f.spaceId,
        organizationId: f.organizationId,
        userId: f.recipientId,
      })
    ).toEqual({ spaceId: f.spaceId, name: "Launch planning" });
    const demotions = await Promise.allSettled([
      patch(ownerContext, f.ownerId, "member"),
      patch(recipientContext, f.recipientId, "member"),
    ]);
    expect(
      demotions.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const meta = await runInDurableObject(f.stub, (_, state) =>
      readSpaceMetaRecordFromSql(state.storage.sql, f.spaceId)
    );
    expect(meta?.ownerUserIds).toHaveLength(1);
    expect(meta?.creator?.profileId).toBe(f.ownerProfile);
  });
});
describe("targeted guest invitations", () => {
  it("requires explicit owner approval and grants only Space membership", async () => {
    const f = await fixture();
    const context = (userId: string, profileId: string) => ({
      activeOrganizationId: f.organizationId,
      actorContext: {
        requestId: crypto.randomUUID(),
        callerPrincipalId: userId,
        ownerUserId: userId,
        openMeldProfileId: profileId,
        profileKind: "human" as const,
      },
    });
    const owner = context(f.ownerId, f.ownerProfile);
    const guest = context(f.recipientId, f.recipientProfile);
    const create = () =>
      f.owner({
        action: "create",
        organizationId: f.organizationId,
        spaceId: f.spaceId,
        email: `${f.recipientId}@example.com`,
        audience: "guest",
      });
    expect((await create()).result.ok).toBe(false);
    await f.stub.rpcPatchMeta({
      spaceId: f.spaceId,
      context: owner,
      allowGuests: true,
    });
    const invitation = invitationId(await create());
    expect(
      (await f.recipient({ action: "claim", invitationId: invitation })).result
        .ok
    ).toBe(true);
    expect(
      (await f.recipient({ action: "complete", invitationId: invitation }))
        .result.ok
    ).toBe(true);
    expect(await f.memberStatus()).toBe("active");
    expect(
      await getPostgresDatabase(env)
        .query({
          ...{
            text: 'SELECT id FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
            values: [],
          },
          values: [f.organizationId, f.recipientId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toBeNull();
    expect(
      await f.stub.rpcHasSpaceGuestAccess({
        spaceId: f.spaceId,
        context: guest,
      })
    ).toBe(true);
    expect(
      await f.stub.rpcGetStatus({ spaceId: f.spaceId, context: guest })
    ).toMatchObject({ spaceId: f.spaceId });
    await expect(
      (async () =>
        await f.stub.rpcPatchMeta({
          spaceId: f.spaceId,
          context: guest,
          allowGuests: true,
        }))()
    ).rejects.toThrow("space.forbidden");
    await expect(
      (async () =>
        await f.stub.rpcPatchMeta({
          spaceId: f.spaceId,
          context: owner,
          ownership: { userId: f.recipientId, role: "owner" },
        }))()
    ).rejects.toThrow("space.owner_membership_required");
    await f.stub.rpcPatchMeta({
      spaceId: f.spaceId,
      context: owner,
      allowGuests: false,
    });
    expect(
      await f.stub.rpcHasSpaceGuestAccess({
        spaceId: f.spaceId,
        context: guest,
      })
    ).toBe(false);
    await expect(
      (async () =>
        await f.stub.rpcGetStatus({ spaceId: f.spaceId, context: guest }))()
    ).rejects.toThrow("space.membership_required");
  });
});
const requestCore: CoreBindings = {
  ...core,
  OPENMELD_AUTH_WORKER: {
    resolveOrganizationAccountIdentity: async ({ organizationId, account }) => {
      if (account?.kind !== "email") {
        throw new Error("This fixture resolves invitation recipients by email");
      }
      const row = await getPostgresDatabase(env)
        .query<{
          id: string;
          email: string;
          member_id: string | null;
        }>({
          ...{
            text: 'SELECT u.id, u.email, m.id AS member_id FROM "openmeld"."users" u LEFT JOIN "openmeld"."members" m ON m.user_id = u.id AND m.organization_id = $1 WHERE lower(u.email) = lower($2)',
            values: [],
          },
          values: [organizationId, account.email],
        })
        .then((result) => result.rows[0] ?? null);
      return {
        ok: true,
        organization: {
          id: organizationId,
          name: "Harbor Design",
          slug: organizationId,
          personal: false,
          memberCount: 1,
        },
        account: row
          ? {
              userId: row.id,
              email: row.email,
              displayName: "Morgan Lee",
              defaultHumanProfile: null,
              membership: row.member_id
                ? { memberId: row.member_id, role: "member" }
                : null,
            }
          : null,
      };
    },
    resolveOrganizationDirectoryMembers: async ({ organizationId }) => {
      const rows = await getPostgresDatabase(env).query<{
        id: string;
        user_id: string;
        role: string;
        email: string;
        name: string;
      }>({
        ...{
          text: 'SELECT m.id, m.user_id, m.role, u.email, u.name FROM "openmeld"."members" m JOIN "openmeld"."users" u ON u.id = m.user_id WHERE m.organization_id = $1',
          values: [],
        },
        values: [organizationId],
      });
      return {
        ok: true,
        organizationId,
        members: rows.rows.map((row) => ({
          memberId: row.id,
          organizationId,
          userId: row.user_id,
          role: row.role,
          joinedAt: new Date().toISOString(),
          humanProfile: null,
          user: {
            id: row.user_id,
            email: row.email,
            name: row.name,
            image: null,
          },
        })),
      };
    },
  },
};
describe("invitation approval boundary", () => {
  it("lists old pending requests before completed records across pages and keeps member history private", async () => {
    const f = await fixture();
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of Array.from({ length: 104 }, (_, index) => ({
          ...{
            text: 'INSERT INTO "openmeld"."organization_join_requests" (id, organization_id, requested_by_user_id, email, status, created_at, reviewed_by_user_id, reviewed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            values: [],
          },
          values: [
            `${f.organizationId}-${index}`,
            f.organizationId,
            f.ownerId,
            `request-${index}@example.com`,
            index < 2 ? "pending" : "approved",
            index < 2 ? 1 : 1000 + index,
            index < 2 ? null : f.ownerId,
            index < 2 ? null : 2000 + index,
          ],
        }))) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const call = (
      userId: string,
      request: OrganizationJoinRequestRpcInput["request"]
    ) =>
      organizationJoinRequest(requestCore, {
        responseVersion: "3",
        userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        request,
      });
    const first = await call(f.ownerId, {
      action: "list",
      organizationId: f.organizationId,
    });
    if (!first.ok) {
      throw new Error(first.message);
    }
    expect(first.requests).toHaveLength(100);
    expect(first.requests.slice(0, 2).map((request) => request.status)).toEqual(
      ["pending", "pending"]
    );
    expect(
      first.requests.slice(2).every((request) => request.status === "approved")
    ).toBe(true);
    const last = first.requests.at(-1);
    if (!last) {
      throw new Error("Expected a cursor row");
    }
    const next = await call(f.ownerId, {
      action: "list",
      organizationId: f.organizationId,
      before: {
        createdAt: last.createdAt,
        id: last.id,
        pending: last.status === "pending",
      },
    });
    if (!next.ok) {
      throw new Error(next.message);
    }
    expect(next.requests).toHaveLength(4);
    expect(
      new Set(
        [...first.requests, ...next.requests].map((request) => request.id)
      ).size
    ).toBe(104);
    // A page ending inside the pending group must include remaining pending
    // rows before crossing into completed records, even at an equal timestamp.
    const pendingCursor = first.requests[0];
    if (!pendingCursor) {
      throw new Error("Expected a pending cursor row");
    }
    const afterPending = await call(f.ownerId, {
      action: "list",
      organizationId: f.organizationId,
      before: {
        createdAt: pendingCursor.createdAt,
        id: pendingCursor.id,
        pending: true,
      },
    });
    expect(afterPending).toMatchObject({
      ok: true,
      requests: [
        first.requests[1],
        ...first.requests.slice(2),
        next.requests[0],
      ],
    });
    await f.joinOrganization();
    expect(
      await call(f.recipientId, {
        action: "list",
        organizationId: f.organizationId,
      })
    ).toMatchObject({ ok: true, requests: [] });
  });
  it("does not complete a Space invitation just because the recipient belongs to the organization", async () => {
    const f = await fixture();
    await f.joinOrganization();
    const call = (request: OrganizationJoinRequestRpcInput["request"]) =>
      organizationJoinRequest(requestCore, {
        responseVersion: "2",
        userId: f.ownerId,
        email: `${f.ownerId}@example.com`,
        emailVerified: true,
        request,
      });
    const created = await call({
      action: "create",
      organizationId: f.organizationId,
      spaceId: f.spaceId,
      email: `${f.recipientId}@example.com`,
    });
    if (!(created.ok && created.requests[0])) {
      throw new Error("Request was not created");
    }
    expect(
      await call({ action: "approve", requestId: created.requests[0].id })
    ).toMatchObject({
      ok: true,
      requests: [{ joinedAt: null, invitationSentAt: null }],
    });
    expect(
      await call({ action: "summary", organizationId: f.organizationId })
    ).toMatchObject({ actionRequiredCount: 1 });
    expect(await f.memberStatus()).toBeNull();
  });
  it.each([
    false,
    true,
  ])("completes an email request for an existing member on approval or retry (retry=%s)", async (retry) => {
    const f = await fixture();
    const call = (request: OrganizationJoinRequestRpcInput["request"]) =>
      organizationJoinRequest(requestCore, {
        responseVersion: "2",
        userId: f.ownerId,
        email: `${f.ownerId}@example.com`,
        emailVerified: true,
        request,
      });
    const created = await call({
      action: "create",
      organizationId: f.organizationId,
      email: `${f.recipientId}@example.com`,
    });
    if (!(created.ok && created.requests[0])) {
      throw new Error("Request was not created");
    }
    const requestId = created.requests[0].id;
    if (retry) {
      expect(await call({ action: "approve", requestId })).toMatchObject({
        requests: [{ joinedAt: null, invitationSentAt: null }],
      });
      expect(
        await call({ action: "summary", organizationId: f.organizationId })
      ).toMatchObject({ actionRequiredCount: 1 });
    }
    await f.joinOrganization();
    const completed = await call({ action: "approve", requestId });
    expect(completed).toMatchObject({
      ok: true,
      requests: [
        {
          status: "approved",
          joinedAt: expect.any(Number),
          invitationSentAt: null,
          applicantUserId: null,
        },
      ],
    });
    expect(await call({ action: "approve", requestId })).toEqual(completed);
    expect(
      await call({ action: "summary", organizationId: f.organizationId })
    ).toMatchObject({ actionRequiredCount: 0 });
    expect(
      await getPostgresDatabase(env)
        .query({
          ...{
            text: 'SELECT count(*) AS total FROM "openmeld"."inbox_items" WHERE organization_id = $1 AND resolution_status = \'open\'',
            values: [],
          },
          values: [f.organizationId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toEqual({ total: 0 });
    expect(await f.memberStatus()).toBeNull();
  });
  it("notifies every administrator without marking routine reviews urgent and lets any one complete a recipient's joining request", async () => {
    const f = await fixture();
    const adminId = crypto.randomUUID();
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, \'Admin\', $2, 1, $3, $4)',
              values: [],
            },
            values: [adminId, `${adminId}@example.com`, Date.now(), Date.now()],
          },
          {
            ...{
              text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'admin\', $4)',
              values: [],
            },
            values: [
              crypto.randomUUID(),
              f.organizationId,
              adminId,
              Date.now(),
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const call = (
      userId: string,
      request: OrganizationJoinRequestRpcInput["request"],
      responseVersion: "2" | "3" = "2"
    ) =>
      organizationJoinRequest(requestCore, {
        responseVersion,
        userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        request,
      });
    const submitted = await call(f.recipientId, {
      action: "create_from_link",
      organizationId: f.organizationId,
      sponsorUserId: f.ownerId,
    });
    if (!(submitted.ok && submitted.requests[0])) {
      throw new Error("Request was not created");
    }
    const requestId = submitted.requests[0].id;
    expect(submitted.requests[0]).toMatchObject({
      applicantUserId: f.recipientId,
      joinedAt: null,
      status: "pending",
    });
    expect(
      await call(f.recipientId, {
        action: "create_from_link",
        organizationId: f.organizationId,
        sponsorUserId: f.ownerId,
      })
    ).toMatchObject({ requests: [{ id: requestId }] });
    const items = await getPostgresDatabase(env).query({
      ...{
        text: 'SELECT recipient_user_id, importance, attention FROM "openmeld"."inbox_items" WHERE organization_id = $1',
        values: [],
      },
      values: [f.organizationId],
    });
    expect(items.rows).toEqual(
      expect.arrayContaining(
        [f.ownerId, adminId].map((recipient_user_id) => ({
          recipient_user_id,
          importance: "normal",
          attention: "action_required",
        }))
      )
    );
    expect(items.rows).toHaveLength(2);
    expect(
      await getPostgresDatabase(env)
        .query({
          ...{
            text: 'SELECT count(*) AS total FROM "openmeld"."inbox_email_deliveries" WHERE inbox_item_id IN (SELECT id FROM "openmeld"."inbox_items" WHERE organization_id = $1)',
            values: [],
          },
          values: [f.organizationId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toEqual({ total: 2 });
    const decisions = await Promise.all([
      call(f.ownerId, { action: "approve", requestId }, "3"),
      call(adminId, { action: "approve", requestId }, "3"),
    ]);
    expect(decisions.filter((decision) => decision.ok)).toHaveLength(1);
    expect(decisions.find((decision) => !decision.ok)).toMatchObject({
      ok: false,
      code: "organization.join_request.already_reviewed",
    });
    const approved = decisions.find((decision) => decision.ok);
    if (!approved?.ok) {
      throw new Error("No approval succeeded");
    }
    const retried = await call(adminId, { action: "retry", requestId }, "3");
    expect(retried).toEqual(approved);
    expect(
      await call(adminId, { action: "join_complete", requestId })
    ).toMatchObject({ ok: false });
    await f.joinOrganization(); // Auth's membership write must precede Core completion.
    const completed = await call(adminId, {
      action: "join_complete",
      requestId,
    });
    expect(completed).toMatchObject({
      ok: true,
      requests: [{ joinedAt: expect.any(Number), invitationSentAt: null }],
    });
    expect(
      await call(f.ownerId, { action: "join_complete", requestId })
    ).toEqual(completed);
    expect(
      await call(f.ownerId, {
        action: "summary",
        organizationId: f.organizationId,
      })
    ).toMatchObject({ actionRequiredCount: 0 });
    const unresolved = await getPostgresDatabase(env)
      .query({
        ...{
          text: 'SELECT count(*) AS total FROM "openmeld"."inbox_items" WHERE organization_id = $1 AND resolution_status = \'open\'',
          values: [],
        },
        values: [f.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(unresolved).toEqual({ total: 0 });
  });
  it("keeps requests separate from membership, blocks member approval, and queues one review email", async () => {
    const f = await fixture();
    await f.joinOrganization();
    const call = (
      userId: string,
      request: OrganizationJoinRequestRpcInput["request"]
    ) =>
      organizationJoinRequest(requestCore, {
        userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        request,
      });
    const create = () =>
      call(f.recipientId, {
        action: "create",
        organizationId: f.organizationId,
        email: "new-person@example.com",
      });
    const result = await create();
    if (!(result.ok && result.requests[0])) {
      throw new Error(JSON.stringify(result));
    }
    const requestId = result.requests[0].id;
    expect(result.requests[0].status).toBe("pending");
    const summary = (userId: string) =>
      call(userId, { action: "summary", organizationId: f.organizationId });
    expect(await summary(f.ownerId)).toMatchObject({
      ok: true,
      actionRequiredCount: 1,
    });
    expect(await summary(f.recipientId)).toMatchObject({
      ok: true,
      actionRequiredCount: 0,
    });
    expect(await create()).toMatchObject({
      ok: true,
      requests: [{ id: requestId }],
    });
    expect(
      await call(f.recipientId, { action: "approve", requestId })
    ).toMatchObject({ ok: false, code: "organization.join_request.forbidden" });
    const counts = await getPostgresDatabase(env)
      .query({
        ...{
          text: 'SELECT (SELECT count(*) FROM "openmeld"."inbox_items" WHERE organization_id = $1) AS inbox, (SELECT count(*) FROM "openmeld"."inbox_email_deliveries" WHERE inbox_item_id IN (SELECT id FROM "openmeld"."inbox_items" WHERE organization_id = $2)) AS emails, (SELECT count(*) FROM "openmeld"."invitations" WHERE organization_id = $3) AS invitations',
          values: [],
        },
        values: [f.organizationId, f.organizationId, f.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(counts).toEqual({ inbox: 1, emails: 1, invitations: 0 });
    expect(
      await getPostgresDatabase(env)
        .query({
          ...{
            text: 'SELECT importance, attention FROM "openmeld"."inbox_items" WHERE organization_id = $1 AND source_key = $2',
            values: [],
          },
          values: [f.organizationId, `invitation:${requestId}`],
        })
        .then((result) => result.rows[0] ?? null)
    ).toEqual({ importance: "normal", attention: "action_required" });
    expect(
      await call(f.ownerId, { action: "approve", requestId })
    ).toMatchObject({
      ok: true,
      requests: [{ status: "approved", invitationSentAt: null }],
    });
    const reviewState = () =>
      getPostgresDatabase(env)
        .query({
          ...{
            text: 'SELECT resolution_status FROM "openmeld"."inbox_items" WHERE organization_id = $1 AND source_key = $2',
            values: [],
          },
          values: [f.organizationId, `invitation:${requestId}`],
        })
        .then((result) => result.rows[0] ?? null);
    // Approval is not delivery: keep the actionable item until Auth confirms sending.
    expect(await reviewState()).toEqual({ resolution_status: "open" });
    expect(await summary(f.ownerId)).toMatchObject({
      ok: true,
      actionRequiredCount: 1,
    });
    expect(
      await call(f.recipientId, { action: "delivery_complete", requestId })
    ).toMatchObject({ ok: false, code: "organization.join_request.forbidden" });
    expect(
      await call(f.ownerId, { action: "delivery_complete", requestId })
    ).toMatchObject({
      ok: true,
      requests: [{ invitationSentAt: expect.any(Number) }],
    });
    expect(await reviewState()).toEqual({ resolution_status: "resolved" });
    expect(await summary(f.ownerId)).toMatchObject({
      ok: true,
      actionRequiredCount: 0,
    });
    expect(
      await call(f.ownerId, { action: "reject", requestId })
    ).toMatchObject({
      ok: false,
      code: "organization.join_request.already_reviewed",
    });
    expect(
      await getPostgresDatabase(env)
        .query({
          ...{
            text: 'SELECT count(*) AS count FROM "openmeld"."members" WHERE organization_id = $1',
            values: [],
          },
          values: [f.organizationId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toEqual({ count: 2 });
  });
  it("does not let an unverified applicant or a non-Space sponsor create a request", async () => {
    const f = await fixture();
    await f.joinOrganization();
    const input = {
      userId: f.recipientId,
      email: f.email,
      emailVerified: true,
      request: {
        action: "create" as const,
        organizationId: f.organizationId,
        spaceId: f.spaceId,
        email: "another@example.com",
      },
    };
    expect(await organizationJoinRequest(requestCore, input)).toMatchObject({
      ok: false,
      code: "space.invitation.forbidden",
    });
    expect(
      await organizationJoinRequest(requestCore, {
        ...input,
        emailVerified: false,
      })
    ).toMatchObject({
      ok: false,
      code: "organization.join_request.email_verification_required",
    });
  });
});
async function fixture() {
  const organizationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const recipientId = crypto.randomUUID();
  const ownerProfile = crypto.randomUUID();
  const recipientProfile = crypto.randomUUID();
  const email = `${recipientId}@example.com`;
  const now = Date.now();
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Harbor Design\', $2, $3)',
      values: [],
    },
    values: [organizationId, organizationId, now],
  });
  for (const [userId, profileId, address] of [
    [ownerId, ownerProfile, `${ownerId}@example.com`],
    [recipientId, recipientProfile, email],
  ]) {
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, \'Morgan Lee\', $2, 1, $3, $4)',
              values: [],
            },
            values: [userId, address, now, now],
          },
          {
            ...{
              text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, 'Morgan Lee', $2, 'human', 1, 'active', $3, $4, 'auth_bootstrap', $5, $6)",
              values: [],
            },
            values: [profileId, profileId, userId, userId, now, now],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
  }
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'owner\', $4)',
      values: [],
    },
    values: [crypto.randomUUID(), organizationId, ownerId, now],
  });
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const objectId = namespace.newUniqueId();
  const spaceId = objectId.toString();
  const stub = namespace.get(objectId);
  await runInDurableObject(stub, (_instance, state) => {
    const creator = {
      profileId: ownerProfile,
      kind: "human" as const,
      ownerUserId: ownerId,
      profileName: "Morgan Lee",
    };
    upsertSpaceMetaRecord(state.storage.sql, {
      v: 1,
      spaceId,
      name: "Launch planning",
      organizationId,
      creator,
      visibility: "private",
      accessMode: "members_only",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
    upsertSpaceCreatorMember({ sql: state.storage.sql, spaceId, creator });
  });
  const owner = (request: SpaceInvitationRpcInput["request"]) =>
    spaceInvitation(core, {
      userId: ownerId,
      email: `${ownerId}@example.com`,
      emailVerified: true,
      request,
    });
  const recipient = (request: SpaceInvitationRpcInput["request"]) =>
    spaceInvitation(core, {
      userId: recipientId,
      email,
      emailVerified: true,
      request,
    });
  const joinOrganization = () =>
    getPostgresDatabase(env).query({
      ...{
        text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', $4)',
        values: [],
      },
      values: [crypto.randomUUID(), organizationId, recipientId, now],
    });
  const create = () =>
    owner({ action: "create", organizationId, spaceId, email });
  const memberStatus = () =>
    runInDurableObject(
      stub,
      (_instance, state) =>
        [
          ...state.storage.sql.exec<{
            status: string;
          }>(
            "SELECT status FROM space_members WHERE profile_id = ?",
            recipientProfile
          ),
        ][0]?.status ?? null
    );
  return {
    owner,
    ownerProfile,
    recipient,
    create,
    joinOrganization,
    memberStatus,
    stub,
    organizationId,
    ownerId,
    recipientId,
    recipientProfile,
    email,
    spaceId,
  };
}
function invitationId(result: SpaceInvitationRpcResult): string {
  if (!(result.result.ok && result.result.invitations[0])) {
    throw new Error(JSON.stringify(result));
  }
  return result.result.invitations[0].id;
}
describe("Space invitation admission", () => {
  it("rejects expired admission until an authorized sender resends", async () => {
    const f = await fixture();
    const id = invitationId(await f.create());
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."space_invitations" SET expires_at = $1 WHERE id = $2',
        values: [],
      },
      values: [Date.now() - 1, id],
    });
    expect(
      await f.recipient({ action: "claim", invitationId: id })
    ).toMatchObject({
      result: { ok: false, code: "space.invitation.inactive" },
    });
    expect(await f.memberStatus()).toBeNull();
    expect(await f.owner({ action: "resend", invitationId: id })).toMatchObject(
      {
        result: { ok: true, invitations: [{ id, status: "pending" }] },
      }
    );
    expect(
      await f.recipient({ action: "claim", invitationId: id })
    ).toMatchObject({
      result: { ok: true, invitations: [{ id, status: "accepting" }] },
    });
  });
  it("requires current sender permission, the intended verified recipient, and Organization membership", async () => {
    const f = await fixture();
    const id = invitationId(await f.create());
    expect(await f.owner({ action: "claim", invitationId: id })).toMatchObject({
      result: { ok: false, code: "space.invitation.account_mismatch" },
    });
    expect(
      await spaceInvitation(core, {
        userId: f.recipientId,
        email: f.email,
        emailVerified: false,
        request: { action: "claim", invitationId: id },
      })
    ).toMatchObject({
      result: {
        ok: false,
        code: "space.invitation.email_verification_required",
      },
    });
    expect(
      await f.recipient({ action: "claim", invitationId: id })
    ).toMatchObject({ result: { ok: true }, organizationMember: false });
    expect(
      await f.recipient({ action: "complete", invitationId: id })
    ).toMatchObject({
      result: {
        ok: false,
        code: "space.invitation.organization_membership_required",
      },
    });
    expect(await f.memberStatus()).toBeNull();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."members" SET role = \'member\' WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [f.organizationId, f.ownerId],
    });
    expect(await f.create()).toMatchObject({
      result: { ok: false, code: "space.invitation.forbidden" },
    });
  });
  it("deduplicates concurrent sends and never re-adds a removed member when acceptance is retried", async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([f.create(), f.create()]);
    const id = invitationId(first);
    expect(invitationId(second)).toBe(id);
    await f.recipient({ action: "claim", invitationId: id });
    await f.joinOrganization();
    expect(
      await f.recipient({ action: "complete", invitationId: id })
    ).toMatchObject({
      result: { ok: true, invitations: [{ status: "accepted" }] },
    });
    expect(await f.memberStatus()).toBe("active");
    await runInDurableObject(f.stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE space_members SET status = 'removed' WHERE profile_id = ?",
        f.recipientProfile
      );
    });
    // Model a lost D1 completion acknowledgement after the Space transaction.
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."space_invitations" SET status = \'accepting\' WHERE id = $1',
        values: [],
      },
      values: [id],
    });
    expect(
      await f.recipient({ action: "complete", invitationId: id })
    ).toMatchObject({ result: { ok: true } });
    expect(await f.memberStatus()).toBe("removed");
  });
  it("arbitrates revoke and grant in the same Space transaction", async () => {
    const f = await fixture();
    const id = invitationId(await f.create());
    await f.recipient({ action: "claim", invitationId: id });
    await f.joinOrganization();
    await Promise.all([
      f.owner({ action: "revoke", invitationId: id }),
      f.recipient({ action: "complete", invitationId: id }),
    ]);
    const result = await f.recipient({ action: "preview", invitationId: id });
    if (!result.result.ok) {
      throw new Error(JSON.stringify(result));
    }
    const status = result.result.invitations[0]?.status;
    expect(["accepted", "revoked"]).toContain(status);
    expect(await f.memberStatus()).toBe(
      status === "accepted" ? "active" : null
    );
  });
});
