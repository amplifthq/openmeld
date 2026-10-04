import {
  createAuthDatabase,
  createDrizzleAccountAvatarMutationRepository,
} from "@openmeld/auth/server";
import { withPostgresRequest } from "@openmeld/db/postgresql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPostgresHarness,
  type PostgresHarness,
  postgresTestBinding,
} from "../../../tooling/postgresql/test-harness";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";

const executionContext = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;
const USER_ID = "user-owner";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const AVATAR_URL = `https://gateway.openmeld.ai/v1/profile-avatars/${PROFILE_ID}/${ASSET_ID}.webp`;

let harness: PostgresHarness;

beforeEach(async () => {
  harness = await createPostgresHarness();

  await seedAccount();
});

afterEach(async () => {
  await harness.close();
  vi.restoreAllMocks();
});

describe("account avatar RPC", () => {
  it("prepares and commits the signed-in account avatar with compare-and-set", async () => {
    const rpc = createRpc();

    await expect(
      rpc.prepareAccountAvatarMutation({ actorUserId: USER_ID })
    ).resolves.toEqual({
      currentAvatar: null,
      defaultHumanProfileId: PROFILE_ID,
      ok: true,
    });
    await expect(
      rpc.commitAccountAvatarMutation({
        actorUserId: USER_ID,
        expectedAvatar: null,
        expectedDefaultHumanProfileId: PROFILE_ID,
        nextAvatar: {
          assetId: ASSET_ID,
          profileId: PROFILE_ID,
          url: AVATAR_URL,
        },
      })
    ).resolves.toEqual({
      avatar: AVATAR_URL,
      defaultHumanProfileId: PROFILE_ID,
      ok: true,
    });
    expect(
      await harness.queryFirst({
        values: [USER_ID],
        text: 'select image from "openmeld"."users" where id = $1',
      })
    ).toEqual({ image: AVATAR_URL });
  });

  it("prevents a default Human Profile identity race from winning the write", async () => {
    return await withPostgresRequest(harness.binding, async () => {
      const repository = createDrizzleAccountAvatarMutationRepository(
        createAuthDatabase()
      );
      const prepared = await repository.readForActor({ actorUserId: USER_ID });
      expect(prepared?.defaultHumanProfileId).toBe(PROFILE_ID);

      await harness.query({
        values: [PROFILE_ID],
        text: 'update "openmeld"."openmeld_profiles" set status = \'disabled\' where profile_id = $1',
      });

      await expect(
        repository.compareAndSetAvatar({
          actorUserId: USER_ID,
          expectedAvatar: null,
          expectedDefaultHumanProfileId: PROFILE_ID,
          nextAvatar: AVATAR_URL,
        })
      ).resolves.toBe(false);
      expect(
        await harness.queryFirst({
          values: [USER_ID],
          text: 'select image from "openmeld"."users" where id = $1',
        })
      ).toEqual({ image: null });
    });
  });

  it("refreshes the signed session cookie after a successful commit", async () => {
    const rpc = createRpc();
    const getSession = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          headers: {
            "set-cookie":
              "better-auth.session_data=refreshed; Path=/; HttpOnly",
          },
        })
      )
    );
    Object.defineProperty(rpc, "getAuth", {
      value: () => ({ api: { getSession } }),
    });

    await expect(
      rpc.commitAccountAvatarMutation({
        actorUserId: USER_ID,
        expectedAvatar: null,
        expectedDefaultHumanProfileId: PROFILE_ID,
        headers: {
          cookie: "better-auth.session_token=original",
        },
        nextAvatar: {
          assetId: ASSET_ID,
          profileId: PROFILE_ID,
          url: AVATAR_URL,
        },
      })
    ).resolves.toEqual({
      avatar: AVATAR_URL,
      defaultHumanProfileId: PROFILE_ID,
      ok: true,
      sessionCookies: ["better-auth.session_data=refreshed; Path=/; HttpOnly"],
    });
    expect(getSession).toHaveBeenCalledWith({
      asResponse: true,
      headers: new Headers({
        cookie: "better-auth.session_token=original",
      }),
      query: {
        disableCookieCache: true,
      },
    });
  });

  it("keeps a committed avatar when the session cookie refresh fails", async () => {
    const rpc = createRpc();
    const getSession = vi.fn(() =>
      Promise.reject(new Error("Session refresh is unavailable."))
    );
    Object.defineProperty(rpc, "getAuth", {
      value: () => ({ api: { getSession } }),
    });

    await expect(
      rpc.commitAccountAvatarMutation({
        actorUserId: USER_ID,
        expectedAvatar: null,
        expectedDefaultHumanProfileId: PROFILE_ID,
        headers: {
          cookie: "better-auth.session_token=original",
        },
        nextAvatar: {
          assetId: ASSET_ID,
          profileId: PROFILE_ID,
          url: AVATAR_URL,
        },
      })
    ).resolves.toEqual({
      avatar: AVATAR_URL,
      defaultHumanProfileId: PROFILE_ID,
      ok: true,
    });
    expect(
      await harness.queryFirst({
        values: [USER_ID],
        text: 'select image from "openmeld"."users" where id = $1',
      })
    ).toEqual({ image: AVATAR_URL });
  });

  it("returns structured failures for missing profiles and invalid input", async () => {
    await harness.query({
      values: [PROFILE_ID],
      text: 'delete from "openmeld"."openmeld_profiles" where profile_id = $1',
    });
    const rpc = createRpc();

    await expect(
      rpc.prepareAccountAvatarMutation({ actorUserId: USER_ID })
    ).resolves.toMatchObject({
      code: "account.avatar.profile_not_found",
      ok: false,
    });
    await expect(
      rpc.prepareAccountAvatarMutation({ actorUserId: "" })
    ).resolves.toMatchObject({
      code: "account.avatar.invalid_input",
      ok: false,
    });
  });
});

function createRpc(): AuthRpcEntrypoint {
  return new AuthRpcEntrypoint(executionContext, {
    AUTH_WORKER_NODE_ENV: "test",
    OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
  } as unknown as CloudflareBindings);
}

async function seedAccount(): Promise<void> {
  const now = Date.now();
  await harness.query({
    values: [USER_ID, "Owner", "owner@example.com", 1, now, now],
    text: `
      insert into "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6)
    `,
  });
  await harness.query({
    values: [
      PROFILE_ID,
      "Owner",
      "owner",
      "human",
      1,
      "active",
      USER_ID,
      "auth_bootstrap",
      now,
      now,
    ],
    text: `
      insert into "openmeld"."openmeld_profiles" (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        owner_user_id,
        source,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
  });
}
