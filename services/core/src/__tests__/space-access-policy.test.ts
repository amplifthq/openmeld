import {
  createAnonymousViewerSpaceAccessContext,
  createAuthenticatedSpaceAccessContext,
  createDispatchContinuationSpaceAccessContext,
} from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
  assertSpaceAccessMatchesSpace,
  authorizeProtectedSpaceAccess,
  authorizeSpaceJoinAccess,
  requireAuthenticatedSpaceActor,
  requireWritableSpaceActor,
  resolveViewerIdentity,
} from "../space/application/space-access-policy";
import type { SpaceMemberRecord } from "../space/infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../space/infrastructure/sql/space-meta-repo";

const requestContext = {
  actorContext: {
    openMeldProfileId: "usr_felix",
    ownerUserId: "owner-1",
    profileKind: "human" as const,
    profileName: "Felix Lu",
    requestId: "req-1",
  },
};

const nowIso = "2026-05-27T00:00:00.000Z";
const protectedMeta: SpaceMetaRecord = {
  v: 1,
  spaceId: "space-1",
  organizationId: "org-1",
  visibility: "private",
  accessMode: "protected",
  creator: {
    profileId: "usr_felix",
    kind: "human",
    ownerUserId: "owner-1",
  },
  passwordProof: {
    v: 1,
    alg: "pbkdf2-sha256",
    iter: 100_000,
    salt: "fake-salt",
    hash: "fake-hash",
  },
  createdAt: nowIso,
  updatedAt: nowIso,
};
const publicViewJoinPasswordMeta: SpaceMetaRecord = {
  ...protectedMeta,
  accessMode: "public_view_join_password",
};

function createMemberRecord(input: {
  ownerUserId: string;
  profileId: string;
  status?: "active" | "removed";
}): SpaceMemberRecord {
  return {
    spaceId: "space-1",
    profileId: input.profileId,
    profileKindSnapshot: input.profileId.startsWith("agt_") ? "agent" : "human",
    profileNameSnapshot: "Member",
    ownerUserIdSnapshot: input.ownerUserId,
    ownerNameSnapshot: null,
    controllerRefSnapshot: null,
    status: input.status ?? "active",
    memberSource: "joined_directly",
    addedAt: nowIso,
    removedAt: null,
    addedByProfileId: null,
    addedByOwnerUserId: null,
    addedByDisplayNameSnapshot: null,
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: nowIso,
    lastEnteredAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

describe("space access policy", () => {
  it("resolves viewer identity for authenticated actors", () => {
    const access = createAuthenticatedSpaceAccessContext({
      requestContext,
      spaceId: "space-1",
    });

    expect(requireAuthenticatedSpaceActor(access)).toBe(requestContext);
    expect(requireWritableSpaceActor(access)).toBe(requestContext);
    expect(resolveViewerIdentity(access)).toEqual({
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "usr_felix",
    });
  });

  it("allows anonymous viewers to resolve read identity without write identity", () => {
    const access = createAnonymousViewerSpaceAccessContext({
      requestId: "anon-1",
      spaceId: "space-1",
      password: "secret-123",
    });

    expect(resolveViewerIdentity(access)).toEqual({
      viewerOwnerUserId: null,
      viewerProfileId: null,
    });
    expect(() => requireAuthenticatedSpaceActor(access)).toThrow(
      "authentication required"
    );
    expect(() => requireWritableSpaceActor(access)).toThrow(
      "anonymous viewers can only read this space"
    );
  });

  it("treats dispatch continuation as an authenticated writable actor", () => {
    const access = createDispatchContinuationSpaceAccessContext({
      dispatchId: "dispatch-1",
      requestContext,
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agt-1",
    });

    expect(requireAuthenticatedSpaceActor(access)).toBe(requestContext);
    expect(requireWritableSpaceActor(access)).toBe(requestContext);
  });

  it("fails fast when access context targets a different Space", () => {
    const access = createAuthenticatedSpaceAccessContext({
      requestContext,
      spaceId: "space-1",
    });

    expect(() =>
      assertSpaceAccessMatchesSpace({
        spaceAccess: access,
        spaceId: "space-2",
      })
    ).toThrow("space access context does not match target space");
  });

  it("authorizes a protected Space for its creator without a password", async () => {
    await expect(
      authorizeProtectedSpaceAccess({
        context: requestContext,
        meta: protectedMeta,
        readMemberByProfileId: () => null,
        hasActiveMemberForOwnerUserId: () => false,
        verifySpacePasswordProof: async () => false,
      })
    ).resolves.toEqual({ ok: true, reason: "creator_profile" });
  });

  it("uses membership proof before stale password proof for authenticated viewers", async () => {
    await expect(
      authorizeProtectedSpaceAccess({
        context: requestContext,
        meta: protectedMeta,
        readMemberByProfileId: () => null,
        hasActiveMemberForOwnerUserId: () => false,
        spacePassword: "old-or-wrong-password",
        verifySpacePasswordProof: async () => false,
      })
    ).resolves.toEqual({ ok: true, reason: "creator_profile" });
  });

  it("authorizes a protected Space for another profile under an account that already joined", async () => {
    await expect(
      authorizeProtectedSpaceAccess({
        context: {
          actorContext: {
            openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
            ownerUserId: "owner-1",
            profileKind: "agent",
            requestId: "req-agent",
          },
        },
        meta: {
          ...protectedMeta,
          creator: {
            profileId: "99999999-9999-4999-8999-999999999999",
            kind: "human",
            ownerUserId: "owner-creator",
          },
        },
        readMemberByProfileId: () => null,
        hasActiveMemberForOwnerUserId: (ownerUserId) =>
          ownerUserId === "owner-1",
        verifySpacePasswordProof: async () => false,
      })
    ).resolves.toEqual({ ok: true, reason: "same_owner_active_member" });
  });

  it("keeps protected Spaces password-gated for accounts without membership proof", async () => {
    await expect(
      authorizeProtectedSpaceAccess({
        context: {
          actorContext: {
            openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
            ownerUserId: "owner-2",
            profileKind: "agent",
            requestId: "req-other-agent",
          },
        },
        meta: protectedMeta,
        readMemberByProfileId: () => null,
        hasActiveMemberForOwnerUserId: () => false,
        verifySpacePasswordProof: async () => false,
      })
    ).resolves.toEqual({ ok: false, code: "space.password_required" });
  });

  it("allows public view with password-gated join to be read without a password", async () => {
    await expect(
      authorizeProtectedSpaceAccess({
        context: {
          actorContext: {
            openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
            ownerUserId: "owner-2",
            profileKind: "agent",
            requestId: "req-other-agent",
          },
        },
        meta: publicViewJoinPasswordMeta,
        readMemberByProfileId: () => null,
        hasActiveMemberForOwnerUserId: () => false,
        verifySpacePasswordProof: async () => false,
      })
    ).resolves.toEqual({ ok: true, reason: "unprotected_space" });
  });

  it("keeps public view with password-gated join locked for joining accounts without membership proof", async () => {
    await expect(
      authorizeSpaceJoinAccess({
        context: {
          actorContext: {
            openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
            ownerUserId: "owner-2",
            profileKind: "agent",
            requestId: "req-other-agent",
          },
        },
        meta: publicViewJoinPasswordMeta,
        readMemberByProfileId: () => null,
        hasActiveMemberForOwnerUserId: () => false,
        verifySpacePasswordProof: async () => false,
      })
    ).resolves.toEqual({ ok: false, code: "space.password_required" });
  });

  it("allows public view with password-gated join when the Space password is valid", async () => {
    await expect(
      authorizeSpaceJoinAccess({
        context: {
          actorContext: {
            openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
            ownerUserId: "owner-2",
            profileKind: "agent",
            requestId: "req-other-agent",
          },
        },
        meta: publicViewJoinPasswordMeta,
        readMemberByProfileId: () => null,
        hasActiveMemberForOwnerUserId: () => false,
        spacePassword: "correct-password",
        verifySpacePasswordProof: async (password) =>
          password === "correct-password",
      })
    ).resolves.toEqual({ ok: true, reason: "valid_password" });
  });

  it("rejects public view with password-gated join when the Space password is wrong", async () => {
    await expect(
      authorizeSpaceJoinAccess({
        context: {
          actorContext: {
            openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
            ownerUserId: "owner-2",
            profileKind: "agent",
            requestId: "req-other-agent",
          },
        },
        meta: publicViewJoinPasswordMeta,
        readMemberByProfileId: () => null,
        hasActiveMemberForOwnerUserId: () => false,
        spacePassword: "wrong-password",
        verifySpacePasswordProof: async () => false,
      })
    ).resolves.toEqual({ ok: false, code: "space.password_invalid" });
  });

  it("authorizes a protected Space for an active member profile without a password", async () => {
    await expect(
      authorizeProtectedSpaceAccess({
        context: {
          actorContext: {
            openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
            ownerUserId: "owner-3",
            profileKind: "agent",
            requestId: "req-member-agent",
          },
        },
        meta: protectedMeta,
        readMemberByProfileId: () =>
          createMemberRecord({
            ownerUserId: "owner-3",
            profileId: "agt_33333333-3333-4333-8333-333333333333",
          }),
        hasActiveMemberForOwnerUserId: () => false,
        verifySpacePasswordProof: async () => false,
      })
    ).resolves.toEqual({ ok: true, reason: "active_member_profile" });
  });
});
