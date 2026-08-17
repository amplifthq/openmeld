import { describe, expect, it } from "vitest";
import { requireOrganizationWorkingLanguageManager } from "../src/organizations/center-agent-working-language-rpc";
import {
  observeOrganizationWorkingLanguage,
  prepareRequirePreviousStatementChangedOneRow,
  readOrganizationWorkingLanguagePreference,
  readOrganizationWorkingLanguagePreferenceForSpace,
  setOrganizationWorkingLanguagePreference,
  toWorkingLanguageGuidance,
} from "../src/organizations/organization-working-language-repository";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("Organization working language", () => {
  it("allows only Organization owners and admins to select the preference", () => {
    expect(() =>
      requireOrganizationWorkingLanguageManager("owner")
    ).not.toThrow();
    expect(() =>
      requireOrganizationWorkingLanguageManager("admin")
    ).not.toThrow();
    expect(() => requireOrganizationWorkingLanguageManager("member")).toThrow(
      "Only an Organization owner or admin"
    );
  });

  it("keeps trusted observations automatic and never overwrites an explicit selection", async () => {
    const harness = createWorkingLanguageHarness();
    try {
      expect(
        await readOrganizationWorkingLanguagePreference({
          db: harness.db,
          organizationId: "org-1",
        })
      ).toMatchObject({ languageTag: null, mode: "automatic", revision: 0 });

      const observed = await observeOrganizationWorkingLanguage({
        db: harness.db,
        languageTag: "zh-hans",
        nowMs: 100,
        organizationId: "org-1",
      });
      expect(observed).toMatchObject({
        changed: true,
        preference: {
          languageTag: "zh-Hans",
          mode: "automatic",
          revision: 1,
          updatedByUserId: null,
        },
      });

      const selected = await setOrganizationWorkingLanguagePreference({
        db: harness.db,
        languageTag: "fr-ca",
        mode: "selected",
        nowMs: 200,
        organizationId: "org-1",
        updatedByUserId: "owner-1",
      });
      expect(selected).toMatchObject({
        languageTag: "fr-CA",
        mode: "selected",
        revision: 2,
        updatedByUserId: "owner-1",
      });

      const ignored = await observeOrganizationWorkingLanguage({
        db: harness.db,
        languageTag: "ja",
        nowMs: 300,
        organizationId: "org-1",
      });
      expect(ignored.changed).toBe(false);
      expect(ignored.preference).toEqual(selected);
      expect(toWorkingLanguageGuidance(ignored.preference)).toEqual({
        languageTag: "fr-CA",
        mode: "selected",
      });
      expect(
        await readOrganizationWorkingLanguagePreferenceForSpace({
          db: harness.db,
          spaceId: "space-1",
        })
      ).toEqual(selected);
    } finally {
      harness.close();
    }
  });

  it("resets to automatic without inventing a language", async () => {
    const harness = createWorkingLanguageHarness();
    try {
      await setOrganizationWorkingLanguagePreference({
        db: harness.db,
        languageTag: "de",
        mode: "selected",
        nowMs: 100,
        organizationId: "org-1",
        updatedByUserId: "owner-1",
      });
      const reset = await setOrganizationWorkingLanguagePreference({
        db: harness.db,
        mode: "automatic",
        nowMs: 200,
        organizationId: "org-1",
        updatedByUserId: "owner-1",
      });

      expect(reset).toMatchObject({
        languageTag: null,
        mode: "automatic",
        revision: 0,
        updatedAtMs: null,
        updatedByUserId: null,
      });
      expect(toWorkingLanguageGuidance(reset)).toBeNull();
    } finally {
      harness.close();
    }
  });

  it("rolls back an explicit preference when its required audit write fails", async () => {
    const harness = createWorkingLanguageHarness();
    try {
      harness.run({
        sql: "CREATE TABLE required_audit (id TEXT PRIMARY KEY)",
      });
      harness.run({
        sql: `CREATE TRIGGER reject_required_audit
          BEFORE INSERT ON required_audit
          BEGIN
            SELECT RAISE(ABORT, 'audit rejected');
          END`,
      });

      await expect(
        setOrganizationWorkingLanguagePreference({
          atomicStatements: [
            harness.db
              .prepare("INSERT INTO required_audit (id) VALUES (?)")
              .bind("audit-1"),
          ],
          db: harness.db,
          languageTag: "fr",
          mode: "selected",
          nowMs: 100,
          organizationId: "org-1",
          updatedByUserId: "owner-1",
        })
      ).rejects.toThrow("audit rejected");
      await expect(
        readOrganizationWorkingLanguagePreference({
          db: harness.db,
          organizationId: "org-1",
        })
      ).resolves.toMatchObject({
        languageTag: null,
        mode: "automatic",
        revision: 0,
      });
    } finally {
      harness.close();
    }
  });

  it("rolls back an automatic observation when its required audit write fails", async () => {
    const harness = createWorkingLanguageHarness();
    try {
      harness.run({
        sql: "CREATE TABLE required_audit (id TEXT PRIMARY KEY)",
      });
      harness.run({
        sql: `CREATE TABLE member_research_tasks (
          id TEXT PRIMARY KEY, observed_language_tag TEXT
        )`,
      });
      harness.run({
        sql: `INSERT INTO member_research_tasks (id, observed_language_tag)
          VALUES ('task-1', NULL)`,
      });
      harness.run({
        sql: `CREATE TRIGGER reject_required_audit
          BEFORE INSERT ON required_audit
          BEGIN
            SELECT RAISE(ABORT, 'audit rejected');
          END`,
      });

      await expect(
        observeOrganizationWorkingLanguage({
          beforeStatements: [
            harness.db
              .prepare(
                `UPDATE member_research_tasks
                  SET observed_language_tag = ? WHERE id = ?`
              )
              .bind("zh-CN", "task-1"),
            prepareRequirePreviousStatementChangedOneRow(harness.db),
          ],
          db: harness.db,
          languageTag: "zh-CN",
          nowMs: 100,
          onChangedStatements: [
            harness.db
              .prepare("INSERT INTO required_audit (id) VALUES (?)")
              .bind("audit-1"),
          ],
          organizationId: "org-1",
        })
      ).rejects.toThrow("audit rejected");
      await expect(
        readOrganizationWorkingLanguagePreference({
          db: harness.db,
          organizationId: "org-1",
        })
      ).resolves.toMatchObject({
        languageTag: null,
        mode: "automatic",
        revision: 0,
      });
      expect(
        harness.queryFirst({
          sql: `SELECT observed_language_tag FROM member_research_tasks
            WHERE id = 'task-1'`,
        })
      ).toEqual({ observed_language_tag: null });
    } finally {
      harness.close();
    }
  });
});

function createWorkingLanguageHarness() {
  const harness = createSqliteD1Harness();
  for (const sql of [
    `CREATE TABLE organization_working_language_preferences (
      organization_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      language_tag TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_by_user_id TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE space_index_spaces (
      space_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL
    )`,
    `INSERT INTO space_index_spaces (space_id, organization_id)
      VALUES ('space-1', 'org-1')`,
  ]) {
    harness.run({ sql });
  }
  return harness;
}
