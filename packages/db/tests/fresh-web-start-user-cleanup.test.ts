import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FreshWebStartLocalDbTarget,
  normalizeFreshWebStartCleanupEmail,
  runFreshWebStartUserCleanup,
} from "../src/tooling/fresh-web-start-user-cleanup.ts";
import {
  type BetterSqliteDatabase,
  createCanonicalSharedInMemoryDatabase,
  createCanonicalSharedLocalFixture,
  DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS,
} from "./helpers/shared-sqlite-fixture.ts";

const cleanupFns: Array<() => void> = [];

afterEach(() => {
  while (cleanupFns.length > 0) {
    cleanupFns.pop()?.();
  }
});

describe("fresh Web Start user cleanup", () => {
  it(
    "deletes OpenMeld product state for one account and preserves auth identity",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "fresh-web-start-cleanup"
      );
      cleanupFns.push(fixture.cleanup);
      const database = new Database(fixture.sqlitePath);

      try {
        seedAuthUser(database, {
          email: "fresh@example.com",
          userId: "user-fresh",
        });
        seedAuthUser(database, {
          email: "other@example.com",
          userId: "user-other",
        });
        seedOpenMeldProductState(database, "user-fresh");
        seedOpenMeldProductState(database, "user-other");

        const localDbTargets: FreshWebStartLocalDbTarget[] = [
          {
            localDbPath: fixture.sqlitePath,
            services: ["auth", "core"],
          },
        ];
        const result = runFreshWebStartUserCleanup({
          databasesByPath: new Map([[fixture.sqlitePath, database]]),
          email: " Fresh@Example.com ",
          localDbTargets,
        });

        expect(result).toMatchObject({
          clearAuthSessions: false,
          email: "fresh@example.com",
          localDbTargets,
          userId: "user-fresh",
        });
        expect(result.counts).toMatchObject({
          openMeldProfiles: 2,
          openMeldProfileSpaceHistory: 2,
          openMeldSpaceDeletionTombstones: 1,
          openMeldDaemonOwnedDevices: 1,
          openMeldDaemonCurrentDeviceTargets: 1,
          authOneTimeTokenVerifications: 0,
          authSessions: 0,
        });

        expect(readCount(database, "users", "id = 'user-fresh'")).toBe(1);
        expect(readCount(database, "accounts", "user_id = 'user-fresh'")).toBe(
          1
        );
        expect(readCount(database, "sessions", "user_id = 'user-fresh'")).toBe(
          1
        );

        expect(
          readCount(
            database,
            "openmeld_profiles",
            "owner_user_id = 'user-fresh'"
          )
        ).toBe(0);
        expect(readCount(database, "openmeld_profile_space_history")).toBe(2);
        expect(
          readCount(
            database,
            "openmeld_space_deletion_tombstones",
            "deleted_by_owner_user_id = 'user-fresh'"
          )
        ).toBe(0);
        expect(
          readCount(
            database,
            "openMeldDaemon_owned_devices",
            "owner_user_id = 'user-fresh'"
          )
        ).toBe(0);
        expect(
          readCount(
            database,
            "openMeldDaemon_current_device_targets",
            "owner_user_id = 'user-fresh'"
          )
        ).toBe(0);

        expect(
          readCount(
            database,
            "openmeld_profiles",
            "owner_user_id = 'user-other'"
          )
        ).toBe(2);
        expect(
          readCount(
            database,
            "openMeldDaemon_owned_devices",
            "owner_user_id = 'user-other'"
          )
        ).toBe(1);
      } finally {
        database.close();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it("optionally clears auth sessions for the user", () => {
    const database = createCanonicalSharedInMemoryDatabase();
    const localDbPath = ":memory:";

    try {
      seedAuthUser(database, {
        email: "fresh@example.com",
        userId: "user-fresh",
      });
      seedOneTimeTokenVerification(database, "fresh-token");
      seedOneTimeTokenVerification(database, "other-token");
      seedEmailVerification(database);
      seedOpenMeldProductState(database, "user-fresh");

      const result = runFreshWebStartUserCleanup({
        clearAuthSessions: true,
        databasesByPath: new Map([[localDbPath, database]]),
        email: "fresh@example.com",
        localDbTargets: [
          {
            localDbPath,
            services: ["auth", "core"],
          },
        ],
      });

      expect(result.counts.authOneTimeTokenVerifications).toBe(2);
      expect(result.counts.authSessions).toBe(1);
      expect(readCount(database, "sessions", "user_id = 'user-fresh'")).toBe(0);
      expect(
        readCount(
          database,
          "verifications",
          "identifier LIKE 'one-time-token:%'"
        )
      ).toBe(0);
      expect(
        readCount(database, "verifications", "identifier = 'email:test'")
      ).toBe(1);
      expect(readCount(database, "users", "id = 'user-fresh'")).toBe(1);
    } finally {
      database.close();
    }
  });

  it(
    "fails fast when the test account does not exist",
    () => {
      const fixture = createCanonicalSharedLocalFixture(
        "fresh-web-start-missing-user"
      );
      cleanupFns.push(fixture.cleanup);
      const database = new Database(fixture.sqlitePath);

      try {
        expect(() =>
          runFreshWebStartUserCleanup({
            databasesByPath: new Map([[fixture.sqlitePath, database]]),
            email: "missing@example.com",
            localDbTargets: [
              {
                localDbPath: fixture.sqlitePath,
                services: ["auth", "core"],
              },
            ],
          })
        ).toThrow(
          "fresh Web Start cleanup could not find a local auth user for missing@example.com"
        );
      } finally {
        database.close();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );

  it("normalizes and validates the email input", () => {
    expect(normalizeFreshWebStartCleanupEmail(" Demo@Example.com ")).toBe(
      "demo@example.com"
    );
    expect(() => normalizeFreshWebStartCleanupEmail("")).toThrow(
      "fresh Web Start cleanup requires a valid --email value"
    );
  });

  it(
    "clears split auth/core local worker targets instead of only one sqlite file",
    () => {
      const authFixture = createCanonicalSharedLocalFixture(
        "fresh-web-start-split-auth",
        "openmeld-auth-local"
      );
      const coreFixture = createCanonicalSharedLocalFixture(
        "fresh-web-start-split-core",
        "openmeld-core-local"
      );
      cleanupFns.push(authFixture.cleanup, coreFixture.cleanup);
      const authDatabase = new Database(authFixture.sqlitePath);
      const coreDatabase = new Database(coreFixture.sqlitePath);

      try {
        seedAuthUser(authDatabase, {
          email: "fresh@example.com",
          userId: "user-fresh",
        });
        seedAuthUser(authDatabase, {
          email: "other@example.com",
          userId: "user-other",
        });
        seedAuthSideOpenMeldProductState(authDatabase, "user-fresh");
        seedAuthSideOpenMeldProductState(authDatabase, "user-other");
        seedCoreSideOpenMeldProductState(coreDatabase, "user-fresh");
        seedCoreSideOpenMeldProductState(coreDatabase, "user-other");

        const localDbTargets: FreshWebStartLocalDbTarget[] = [
          {
            localDbPath: authFixture.sqlitePath,
            services: ["auth"],
          },
          {
            localDbPath: coreFixture.sqlitePath,
            services: ["core"],
          },
        ];
        const result = runFreshWebStartUserCleanup({
          databasesByPath: new Map([
            [authFixture.sqlitePath, authDatabase],
            [coreFixture.sqlitePath, coreDatabase],
          ]),
          email: "fresh@example.com",
          localDbTargets,
        });

        expect(result.localDbTargets).toEqual(localDbTargets);
        expect(result.counts).toMatchObject({
          openMeldProfiles: 2,
          openMeldProfileSpaceHistory: 2,
          openMeldSpaceDeletionTombstones: 1,
          openMeldDaemonOwnedDevices: 1,
          openMeldDaemonCurrentDeviceTargets: 1,
          authOneTimeTokenVerifications: 0,
          authSessions: 0,
        });

        expect(readCount(authDatabase, "users", "id = 'user-fresh'")).toBe(1);
        expect(
          readCount(authDatabase, "sessions", "user_id = 'user-fresh'")
        ).toBe(1);
        expect(
          readCount(
            authDatabase,
            "openmeld_profiles",
            "owner_user_id = 'user-fresh'"
          )
        ).toBe(0);
        expect(
          readCount(
            coreDatabase,
            "openMeldDaemon_current_device_targets",
            "owner_user_id = 'user-fresh'"
          )
        ).toBe(0);
        expect(
          readCount(
            coreDatabase,
            "openMeldDaemon_owned_devices",
            "owner_user_id = 'user-fresh'"
          )
        ).toBe(0);

        expect(
          readCount(
            authDatabase,
            "openmeld_profiles",
            "owner_user_id = 'user-other'"
          )
        ).toBe(2);
        expect(
          readCount(
            coreDatabase,
            "openMeldDaemon_current_device_targets",
            "owner_user_id = 'user-other'"
          )
        ).toBe(1);
      } finally {
        authDatabase.close();
        coreDatabase.close();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );
});

function seedAuthUser(
  database: BetterSqliteDatabase,
  input: { email: string; userId: string }
): void {
  const now = 1_700_000_000_000;
  database
    .prepare(
      `INSERT INTO users (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at,
        normalized_email
      ) VALUES (?, ?, ?, 1, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.email,
      input.email,
      now,
      now,
      input.email.toLowerCase()
    );
  database
    .prepare(
      `INSERT INTO accounts (
        id,
        account_id,
        provider_id,
        user_id,
        password,
        created_at,
        updated_at
      ) VALUES (?, ?, 'credential', ?, 'hashed-password', ?, ?)`
    )
    .run(`account-${input.userId}`, input.email, input.userId, now, now);
  database
    .prepare(
      `INSERT INTO sessions (
        id,
        expires_at,
        token,
        created_at,
        updated_at,
        user_id
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      `session-${input.userId}`,
      now + 60_000,
      `token-${input.userId}`,
      now,
      now,
      input.userId
    );
}

function seedOneTimeTokenVerification(
  database: BetterSqliteDatabase,
  tokenId: string
): void {
  const now = 1_700_000_000_000;
  database
    .prepare(
      `INSERT INTO verifications (
        id,
        identifier,
        value,
        expires_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      `verification-${tokenId}`,
      `one-time-token:${tokenId}`,
      `session-token-${tokenId}`,
      now + 60_000,
      now,
      now
    );
}

function seedEmailVerification(database: BetterSqliteDatabase): void {
  const now = 1_700_000_000_000;
  database
    .prepare(
      `INSERT INTO verifications (
        id,
        identifier,
        value,
        expires_at,
        created_at,
        updated_at
      ) VALUES ('verification-email', 'email:test', 'code', ?, ?, ?)`
    )
    .run(now + 60_000, now, now);
}

function seedOpenMeldProductState(
  database: BetterSqliteDatabase,
  ownerUserId: string
): void {
  seedAuthSideOpenMeldProductState(database, ownerUserId);
  seedCoreSideOpenMeldProductState(database, ownerUserId);
}

function seedAuthSideOpenMeldProductState(
  database: BetterSqliteDatabase,
  ownerUserId: string
): void {
  const now = 1_700_000_100_000;
  const humanProfileId =
    ownerUserId === "user-fresh"
      ? "11111111-1111-1111-1111-111111111111"
      : "22222222-2222-2222-2222-222222222222";
  const agentProfileId =
    ownerUserId === "user-fresh"
      ? "agt_33333333-3333-3333-3333-333333333333"
      : "agt_44444444-4444-4444-4444-444444444444";
  const organizationId =
    ownerUserId === "user-fresh" ? "org-fresh" : "org-other";
  const organizationSlug =
    ownerUserId === "user-fresh" ? "fresh-org" : "other-org";

  database
    .prepare(
      `INSERT INTO organizations (
        id,
        name,
        slug,
        created_at
      ) VALUES (?, ?, ?, ?)`
    )
    .run(
      organizationId,
      `Organization for ${ownerUserId}`,
      organizationSlug,
      now
    );

  database
    .prepare(
      `INSERT INTO members (
        id,
        organization_id,
        user_id,
        role,
        created_at
      ) VALUES (?, ?, ?, 'member', ?)`
    )
    .run(`member-${ownerUserId}`, organizationId, ownerUserId, now);

  database
    .prepare(
      `INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        created_by_user_id,
        source,
        created_at,
        updated_at
      ) VALUES
        (?, 'Fresh Human', 'fresh-human', 'human', 1, 'active', NULL, ?, ?, 'cli_create', ?, ?),
        (?, 'Fresh Agent', 'fresh-agent', 'agent', 0, 'active', ?, ?, ?, 'cli_create', ?, ?)`
    )
    .run(
      humanProfileId,
      ownerUserId,
      ownerUserId,
      now,
      now,
      agentProfileId,
      organizationId,
      ownerUserId,
      ownerUserId,
      now,
      now
    );

  database
    .prepare(
      `INSERT INTO openmeld_profile_space_history (
        profile_id,
        gateway_host,
        space_id,
        last_joined_at,
        status,
        created_at,
        updated_at
      ) VALUES
        (?, 'localhost:8080', 'space-1', ?, 'active', ?, ?),
        (?, 'localhost:8080', 'space-2', ?, 'active', ?, ?)`
    )
    .run(humanProfileId, now, now, now, agentProfileId, now, now, now);

  database
    .prepare(
      `INSERT INTO openmeld_space_deletion_tombstones (
        gateway_host,
        space_id,
        deleted_by_owner_user_id,
        deleted_at,
        created_at,
        updated_at
      ) VALUES ('localhost:8080', ?, ?, ?, ?, ?)`
    )
    .run(`deleted-${ownerUserId}`, ownerUserId, now, now, now);
}

function seedCoreSideOpenMeldProductState(
  database: BetterSqliteDatabase,
  ownerUserId: string
): void {
  const now = 1_700_000_100_000;

  database
    .prepare(
      `INSERT INTO openMeldDaemon_owned_devices (
        owner_user_id,
        device_id,
        observed_display_name,
        user_display_name,
        platform_family,
        os_version,
        device_type,
        first_seen_at_ms,
        last_observed_at_ms,
        updated_at_ms
      ) VALUES (?, ?, 'Observed Computer', 'Pinned Computer', 'macOS', '15.0', 'laptop', ?, ?, ?)`
    )
    .run(ownerUserId, `device-${ownerUserId}`, now, now, now);

  database
    .prepare(
      `INSERT INTO openMeldDaemon_current_device_targets (
        owner_user_id,
        device_id,
        updated_at_ms
      ) VALUES (?, ?, ?)`
    )
    .run(ownerUserId, `device-${ownerUserId}`, now);
}

function readCount(
  database: BetterSqliteDatabase,
  tableName: string,
  whereClause = "1 = 1"
): number {
  const row = database
    .prepare<[], { count: number }>(
      `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${whereClause}`
    )
    .get();
  return Number(row?.count ?? 0);
}
