import type {
  OpenMeldRequestContext,
  SpaceAccessMode,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { SpacePasswordProof } from "../lib/space-password-proof";
import { authorizeSpacePublicationModeChange } from "../space/application/space-publication-mode-authorization";
import type { SpaceMetaRecord } from "../space/infrastructure/sql/space-meta-repo";

const NOW_ISO = "2026-05-28T00:00:00.000Z";
const PASSWORD_PROOF = {
  v: 1,
  alg: "pbkdf2-sha256",
  iter: 100_000,
  salt: "salt",
  hash: "hash",
} as const satisfies SpacePasswordProof;

function createContext(input: {
  ownerUserId?: string;
  profileId: string;
  profileKind: "agent" | "human";
}): OpenMeldRequestContext {
  return {
    actorContext: {
      openMeldProfileId: input.profileId,
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      profileKind: input.profileKind,
      requestId: "req-publication-mode",
    },
  };
}

function createMeta(input: {
  accessMode?: SpaceAccessMode;
  creatorKind?: "agent" | "human";
  creatorOwnerUserId?: string;
  creatorProfileId?: string;
  passwordProof?: SpacePasswordProof;
}): SpaceMetaRecord {
  return {
    v: 1,
    createdAt: NOW_ISO,
    organizationId: "org-1",
    visibility: "private",
    creator: {
      kind: input.creatorKind ?? "human",
      profileId: input.creatorProfileId ?? "hum-owner",
      ...(input.creatorOwnerUserId
        ? { ownerUserId: input.creatorOwnerUserId }
        : {}),
    },
    accessMode:
      input.accessMode ?? (input.passwordProof ? "protected" : "public"),
    ...(input.passwordProof ? { passwordProof: input.passwordProof } : {}),
    spaceId: "space-1",
    updatedAt: NOW_ISO,
  };
}

describe("space publication mode authorization", () => {
  it("allows the human Space creator with explicit valid password proof", async () => {
    const verifySpacePasswordProof = vi.fn(async () => true);

    const result = await authorizeSpacePublicationModeChange({
      context: createContext({
        profileId: "hum-owner",
        profileKind: "human",
      }),
      meta: createMeta({ passwordProof: PASSWORD_PROOF }),
      spacePassword: "correct-password",
      verifySpacePasswordProof,
    });

    expect(result).toEqual({ ok: true });
    expect(verifySpacePasswordProof).toHaveBeenCalledWith(
      "correct-password",
      PASSWORD_PROOF
    );
  });

  it("requires the owner human for an agent-created Space", async () => {
    const result = await authorizeSpacePublicationModeChange({
      context: createContext({
        ownerUserId: "owner-1",
        profileId: "agt-creator",
        profileKind: "agent",
      }),
      meta: createMeta({
        creatorKind: "agent",
        creatorOwnerUserId: "owner-1",
        creatorProfileId: "agt-creator",
        passwordProof: PASSWORD_PROOF,
      }),
      spacePassword: "correct-password",
      verifySpacePasswordProof: vi.fn(async () => true),
    });

    expect(result).toMatchObject({
      code: "space.publication_mode.owner_required",
      ok: false,
      status: 403,
    });
  });

  it("allows the owner human for an agent-created Space with explicit valid password proof", async () => {
    const verifySpacePasswordProof = vi.fn(async () => true);

    const result = await authorizeSpacePublicationModeChange({
      context: createContext({
        ownerUserId: "owner-1",
        profileId: "hum-owner",
        profileKind: "human",
      }),
      meta: createMeta({
        creatorKind: "agent",
        creatorOwnerUserId: "owner-1",
        creatorProfileId: "agt-creator",
        passwordProof: PASSWORD_PROOF,
      }),
      spacePassword: "correct-password",
      verifySpacePasswordProof,
    });

    expect(result).toEqual({ ok: true });
    expect(verifySpacePasswordProof).toHaveBeenCalledWith(
      "correct-password",
      PASSWORD_PROOF
    );
  });

  it("rejects non-owner profiles before checking the password", async () => {
    const verifySpacePasswordProof = vi.fn(async () => true);

    const result = await authorizeSpacePublicationModeChange({
      context: createContext({
        profileId: "hum-other",
        profileKind: "human",
      }),
      meta: createMeta({ passwordProof: PASSWORD_PROOF }),
      spacePassword: "correct-password",
      verifySpacePasswordProof,
    });

    expect(result).toMatchObject({
      code: "space.publication_mode.owner_required",
      ok: false,
      status: 403,
    });
    expect(verifySpacePasswordProof).not.toHaveBeenCalled();
  });

  it("requires an explicit password even when the actor is the owner", async () => {
    const result = await authorizeSpacePublicationModeChange({
      context: createContext({
        profileId: "hum-owner",
        profileKind: "human",
      }),
      meta: createMeta({ passwordProof: PASSWORD_PROOF }),
      verifySpacePasswordProof: vi.fn(async () => true),
    });

    expect(result).toMatchObject({
      code: "space.password_required",
      ok: false,
      status: 401,
    });
  });

  it("requires a configured Space password before publication mode can change", async () => {
    const result = await authorizeSpacePublicationModeChange({
      context: createContext({
        profileId: "hum-owner",
        profileKind: "human",
      }),
      meta: createMeta({}),
      spacePassword: "unused-password",
      verifySpacePasswordProof: vi.fn(async () => true),
    });

    expect(result).toMatchObject({
      code: "space.publication_mode.password_not_configured",
      ok: false,
      status: 409,
    });
  });
});
