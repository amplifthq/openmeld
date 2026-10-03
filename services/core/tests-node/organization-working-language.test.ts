import { describe, expect, it } from "vitest";
import { requireOrganizationWorkingLanguageManager } from "../src/organizations/center-agent-working-language-rpc";
import {
  observeOrganizationWorkingLanguage,
  readOrganizationWorkingLanguagePreference,
  readOrganizationWorkingLanguagePreferenceForSpace,
  setOrganizationWorkingLanguagePreference,
  toWorkingLanguageGuidance,
} from "../src/organizations/organization-working-language-repository";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

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
    const harness = await createWorkingLanguageHarness();
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
      await harness.close();
    }
  });
  it("resets to automatic without inventing a language", async () => {
    const harness = await createWorkingLanguageHarness();
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
      await harness.close();
    }
  });
  it("rolls back an explicit preference when its required audit write fails", async () => {
    const harness = await createWorkingLanguageHarness();
    try {
      await harness.query({
        text: "CREATE TABLE public.required_audit (id TEXT PRIMARY KEY CONSTRAINT audit_rejected CHECK (false))",
      });
      await harness.query({
        text: "GRANT INSERT ON public.required_audit TO openmeld_pg_runtime",
      });
      await expect(
        setOrganizationWorkingLanguagePreference({
          atomicStatements: [
            {
              ...{
                text: "INSERT INTO required_audit (id) VALUES ($1)",
                values: [],
              },
              values: ["audit-1"],
            },
          ],
          db: harness.db,
          languageTag: "fr",
          mode: "selected",
          nowMs: 100,
          organizationId: "org-1",
          updatedByUserId: "owner-1",
        })
      ).rejects.toThrow("audit_rejected");
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
      await harness.close();
    }
  });
  it("rolls back an automatic observation when its required audit write fails", async () => {
    const harness = await createWorkingLanguageHarness();
    try {
      await harness.query({
        text: "CREATE TABLE public.required_audit (id TEXT PRIMARY KEY CONSTRAINT audit_rejected CHECK (false))",
      });
      await harness.query({
        text: `CREATE TABLE member_research_tasks (
          id TEXT PRIMARY KEY, observed_language_tag TEXT
        )`,
      });
      await harness.query({
        text: "GRANT SELECT, UPDATE ON public.member_research_tasks TO openmeld_pg_runtime",
      });
      await harness.query({
        text: `INSERT INTO member_research_tasks (id, observed_language_tag)
          VALUES ('task-1', NULL)`,
      });
      await harness.query({
        text: "GRANT INSERT ON public.required_audit TO openmeld_pg_runtime",
      });
      await expect(
        observeOrganizationWorkingLanguage({
          beforeMutation: async (client) => {
            const result = await client.query({
              text: "UPDATE public.member_research_tasks SET observed_language_tag = $1 WHERE id = $2",
              values: ["zh-CN", "task-1"],
            });
            if (result.rowCount !== 1) {
              throw new Error("Research task no longer exists");
            }
          },
          db: harness.db,
          languageTag: "zh-CN",
          nowMs: 100,
          onChangedStatements: [
            {
              ...{
                text: "INSERT INTO required_audit (id) VALUES ($1)",
                values: [],
              },
              values: ["audit-1"],
            },
          ],
          organizationId: "org-1",
        })
      ).rejects.toThrow("audit_rejected");
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
        await harness.queryFirst({
          text: `SELECT observed_language_tag FROM member_research_tasks
            WHERE id = 'task-1'`,
        })
      ).toEqual({ observed_language_tag: null });
    } finally {
      await harness.close();
    }
  });
});
async function createWorkingLanguageHarness() {
  const harness = await createPostgresHarness();
  await harness.query({
    text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
    values: ["owner-1", "Owner", "owner@example.com"],
  });
  await harness.query({
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
    values: ["org-1", "Organization", "org-one", 1000],
  });
  await harness.query({
    text: 'INSERT INTO "openmeld"."space_index_spaces" (space_id, organization_id, organization_visibility, status, source_updated_at_ms, projected_at_ms, projection_event_id) VALUES ($1, $2, $3, $4, $5, $5, $6)',
    values: ["space-1", "org-1", "private", "active", 1000, "evt-one"],
  });
  return harness;
}
