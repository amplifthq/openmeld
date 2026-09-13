import { describe, expect, it } from "vitest";
import {
  listOnlineOrganizationMembers,
  recordOrganizationMemberPresence,
} from "../src/organizations/organization-member-presence-repository";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Organization member presence", () => {
  it("aggregates independent sessions, rejects old reports and expires idle or disconnected pages", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationsForTables(harness, [
      "users",
      "organizations",
      "members",
      "organization_member_presence_sessions",
    ]);
    harness.run({
      sql: "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'Person', 'person@example.com', true, 1, 1)",
    });
    for (const org of ["a", "b"]) {
      harness.run({
        sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, 1)",
        params: [org, org, org],
      });
    }
    const base = {
      db: harness.db,
      organizationId: "a",
      userId: "u",
      humanProfileId: "human",
    };
    const write = (
      sessionId: string,
      sequence: number,
      nowMs: number,
      foreground = true,
      interaction = true
    ) =>
      recordOrganizationMemberPresence({
        ...base,
        nowMs,
        report: { sessionId, sequence, foreground, interaction },
      });
    const online = (nowMs: number, organizationId = "a") =>
      listOnlineOrganizationMembers({ db: harness.db, organizationId, nowMs });
    try {
      await write("phone", 1, 1_000_000);
      await write("laptop", 1, 1_000_000);
      await write("laptop", 3, 1_010_000, false, false);
      await write("laptop", 2, 1_020_000);
      expect(await online(1_020_000)).toEqual([
        { user_id: "u", human_profile_id: "human" },
      ]);
      expect(await online(1_020_000, "b")).toEqual([]);
      await write("phone", 2, 1_025_000, false, false);
      expect(await online(1_025_000)).toEqual([]);
      await write("phone", 3, 1_030_000);
      expect(await online(1_119_999)).toHaveLength(1);
      expect(await online(1_120_000)).toEqual([]);
      // A connected page with no new interaction must still become idle.
      for (let n = 1; n <= 10; n++) {
        await write("phone", n + 3, 1_030_000 + n * 30_000, true, false);
      }
      expect(await online(1_330_000)).toEqual([]);
      // A heartbeat alone cannot establish presence for a new session.
      await write("background", 1, 1_340_000, true, false);
      expect(await online(1_340_000)).toEqual([]);
      await write("phone", 14, 1_350_000);
      expect(await online(1_350_000)).toHaveLength(1);
    } finally {
      harness.close();
    }
  });
});
