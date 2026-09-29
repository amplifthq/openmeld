import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { isActiveRemoteAgentRequesterProfile } from "../src/remote-agent/application/personal-remote-agent-space-tools";

const databases: DatabaseSync[] = [];
function fixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(`
    CREATE TABLE openmeld_profiles (profile_id TEXT PRIMARY KEY, organization_id TEXT, owner_user_id TEXT, status TEXT, profile_kind TEXT, managed_role TEXT);
    CREATE TABLE members (organization_id TEXT, user_id TEXT);
    CREATE TABLE center_agent_designations (organization_id TEXT PRIMARY KEY, agent_profile_id TEXT, duty TEXT, designated_by TEXT, operating_state TEXT, paused_at INTEGER, paused_by_user_id TEXT, created_at INTEGER);
    INSERT INTO openmeld_profiles VALUES ('center', 'org-a', NULL, 'active', 'agent', 'center_agent');
    INSERT INTO openmeld_profiles VALUES ('human', 'org-a', 'user-a', 'active', 'human', NULL);
    INSERT INTO members VALUES ('org-a', 'user-a');
    INSERT INTO center_agent_designations VALUES ('org-a', 'center', NULL, 'user-a', 'active', NULL, NULL, 1);
  `);
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: SQLInputValue[]) => ({
        first: () =>
          Promise.resolve(database.prepare(sql).get(...values) ?? null),
      }),
    }),
  } as unknown as D1Database;
  const allowed = (profileId: string | null, organizationId = "org-a") =>
    isActiveRemoteAgentRequesterProfile({ db, profileId, organizationId });
  return { database, allowed };
}
afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

describe("current Wake requester identity against real SQL", () => {
  it("admits the active designated Center without assigning it a human owner", async () => {
    const f = fixture();
    expect(await f.allowed("center")).toBe(true);
    expect(await f.allowed("human")).toBe(true);
    expect(await f.allowed(null)).toBe(false);
    expect(await f.allowed("center", "org-b")).toBe(false);
  });
  it("rejects an old designation, paused Center, disabled Profile and revoked member", async () => {
    const f = fixture();
    f.database.exec(
      "UPDATE center_agent_designations SET agent_profile_id = 'replacement'"
    );
    expect(await f.allowed("center")).toBe(false);
    f.database.exec(
      "UPDATE center_agent_designations SET agent_profile_id = 'center', operating_state = 'paused'"
    );
    expect(await f.allowed("center")).toBe(false);
    f.database.exec(
      "UPDATE center_agent_designations SET operating_state = 'active'; UPDATE openmeld_profiles SET status = 'disabled' WHERE profile_id = 'center'"
    );
    expect(await f.allowed("center")).toBe(false);
    f.database.exec("DELETE FROM members");
    expect(await f.allowed("human")).toBe(false);
  });
});
