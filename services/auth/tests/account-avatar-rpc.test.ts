import {
  createD1Db,
  createDrizzleAccountAvatarMutationRepository,
} from "@openmeld/auth/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
  type SqliteD1Harness,
} from "./support/sqlite-d1-harness";

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

let harness: SqliteD1Harness;

beforeEach(() => {
  harness = createSqliteD1Harness();
  applyDrizzleMigrations(harness.database);
  seedAccount();
});

afterEach(() => {
  harness.close();
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
      harness.queryFirst({
        params: [USER_ID],
        sql: "select image from users where id = ?",
      })
    ).toEqual({ image: AVATAR_URL });
  });

  it("prevents a default Human Profile identity race from winning the write", async () => {
    const repository = createDrizzleAccountAvatarMutationRepository(
      createD1Db(harness.db)
    );
    const prepared = await repository.readForActor({ actorUserId: USER_ID });
    expect(prepared?.defaultHumanProfileId).toBe(PROFILE_ID);

    harness.run({
      params: [PROFILE_ID],
      sql: "update openmeld_profiles set status = 'disabled' where profile_id = ?",
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
      harness.queryFirst({
        params: [USER_ID],
        sql: "select image from users where id = ?",
      })
    ).toEqual({ image: null });
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
      harness.queryFirst({
        params: [USER_ID],
        sql: "select image from users where id = ?",
      })
    ).toEqual({ image: AVATAR_URL });
  });

  it("returns structured failures for missing profiles and invalid input", async () => {
    harness.run({
      params: [PROFILE_ID],
      sql: "delete from openmeld_profiles where profile_id = ?",
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
    OPENMELD_DB: harness.db,
  } as unknown as CloudflareBindings);
}

function seedAccount(): void {
  const now = Date.now();
  harness.run({
    params: [USER_ID, "Owner", "owner@example.com", 1, now, now],
    sql: `
      insert into users (id, name, email, email_verified, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?)
    `,
  });
  harness.run({
    params: [
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
    sql: `
      insert into openmeld_profiles (
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
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
}
