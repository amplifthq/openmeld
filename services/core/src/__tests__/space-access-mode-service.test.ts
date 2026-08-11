import { describe, expect, it } from "vitest";
import type { CoreRpcContextInput } from "../rpc/methods";
import { handleSetSpaceAccessModeUseCase } from "../space/application/space-password-service";
import type { SpaceMetaRecord } from "../space/infrastructure/sql/space-meta-repo";

const NOW_ISO = "2026-06-26T00:00:00.000Z";
const PASSWORD_PROOF = {
  v: 1,
  alg: "pbkdf2-sha256",
  iter: 100_000,
  salt: "salt",
  hash: "hash",
} as const;

const context: CoreRpcContextInput = {
  actorContext: {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    profileKind: "human",
    requestId: "req-access-mode",
  },
};

function createMeta(input: {
  accessMode: SpaceMetaRecord["accessMode"];
  passwordProof?: SpaceMetaRecord["passwordProof"];
}): SpaceMetaRecord {
  return {
    v: 1,
    accessMode: input.accessMode,
    organizationId: "org-1",
    visibility: "private",
    ...(input.passwordProof ? { passwordProof: input.passwordProof } : {}),
    createdAt: NOW_ISO,
    creator: {
      kind: "human",
      ownerUserId: "owner-1",
      profileId: "11111111-1111-4111-8111-111111111111",
    },
    spaceId: "space-1",
    updatedAt: NOW_ISO,
  };
}

async function runUseCase(input: {
  body: unknown;
  meta: SpaceMetaRecord;
}): Promise<{
  response: Response;
  written: SpaceMetaRecord | null;
}> {
  let written: SpaceMetaRecord | null = null;
  const response = await handleSetSpaceAccessModeUseCase({
    body: input.body,
    context,
    spaceId: "space-1",
    authorizeSpacePasswordManagement: () => ({
      ok: true,
      meta: input.meta,
    }),
    invalidPayloadResponse: (requestId, message) =>
      Response.json(
        { ok: false, code: "invalid_payload", message, requestId },
        { status: 400 }
      ),
    passwordNotConfiguredResponse: (requestId) =>
      Response.json(
        {
          ok: false,
          code: "space.access_mode.password_not_configured",
          message: "Set a Space password before requiring a password to join.",
          requestId,
        },
        { status: 409 }
      ),
    passwordTooShortResponse: (requestId) =>
      Response.json(
        {
          ok: false,
          code: "space.password_too_short",
          message: "space password must be at least 6 characters",
          requestId,
        },
        { status: 400 }
      ),
    upsertSpaceMetaRecord: (record) => {
      written = record;
    },
  });
  return { response, written };
}

describe("space access mode service", () => {
  it("reuses the existing Space password when join password mode is enabled", async () => {
    const { response, written } = await runUseCase({
      body: { accessMode: "public_view_join_password" },
      meta: createMeta({
        accessMode: "protected",
        passwordProof: PASSWORD_PROOF,
      }),
    });

    await expect(response.json()).resolves.toMatchObject({
      accessMode: "public_view_join_password",
      passwordProtected: false,
      spaceId: "space-1",
    });
    expect(written).toMatchObject({
      accessMode: "public_view_join_password",
      passwordProof: PASSWORD_PROOF,
    });
  });

  it("requires the single Space password before enabling a password-gated mode", async () => {
    const { response, written } = await runUseCase({
      body: { accessMode: "public_view_join_password" },
      meta: createMeta({ accessMode: "public" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "space.access_mode.password_not_configured",
    });
    expect(written).toBeNull();
  });

  it("sets the single Space password when enabling a password-gated mode", async () => {
    const { response, written } = await runUseCase({
      body: { accessMode: "public_view_join_password", password: "abc123" },
      meta: createMeta({ accessMode: "public" }),
    });

    expect(response.status).toBe(200);
    expect(written?.accessMode).toBe("public_view_join_password");
    expect(written?.passwordProof?.alg).toBe("pbkdf2-sha256");
  });

  it("clears the Space password when the Space becomes public", async () => {
    const { response, written } = await runUseCase({
      body: { accessMode: "public" },
      meta: createMeta({
        accessMode: "public_view_join_password",
        passwordProof: PASSWORD_PROOF,
      }),
    });

    await expect(response.json()).resolves.toMatchObject({
      accessMode: "public",
      passwordProtected: false,
      spaceId: "space-1",
    });
    expect(written).toMatchObject({
      accessMode: "public",
    });
    expect(written?.passwordProof).toBeUndefined();
  });
});
