import { describe, expect, it, onTestFinished } from "vitest";
import { isActiveRemoteAgentRequesterProfile } from "../src/remote-agent/application/personal-remote-agent-space-tools";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const CENTER = "agt_11111111-1111-4111-8111-111111111111";
const REPLACEMENT = "agt_22222222-2222-4222-8222-222222222222";
const HUMAN = "33333333-3333-4333-8333-333333333333";
async function fixture() {
  const harness = await createPostgresHarness();
  onTestFinished(() => harness.close());
  await harness.query({
    text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
    values: ["user-a", "Member", "member@example.com"],
  });
  await harness.query({
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
    values: ["org-a", "Organization", "org-a", 1000],
  });
  await harness.query({
    text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
    values: ["member-a", "org-a", "user-a", "member", 1000],
  });
  for (const [id, handle, kind, owner, role] of [
    [CENTER, "center", "agent", null, "center_agent"],
    [REPLACEMENT, "replacement", "agent", null, "center_agent"],
    [HUMAN, "human", "human", "user-a", null],
  ]) {
    await harness.query({
      text: 'INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, managed_role, source, status) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)',
      values: [
        id,
        handle,
        kind,
        kind === "human" ? null : "org-a",
        owner,
        role,
        "migration",
        id === REPLACEMENT ? "disabled" : "active",
      ],
    });
  }
  await harness.query({
    text: 'INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, designated_by) VALUES ($1, $2, $3)',
    values: ["org-a", CENTER, "user-a"],
  });
  const allowed = (profileId: string | null, organizationId = "org-a") =>
    isActiveRemoteAgentRequesterProfile({
      db: harness.db,
      profileId,
      organizationId,
    });
  return { harness, allowed };
}

describe("current Wake requester identity against PostgreSQL", () => {
  it("admits the active designated Center without assigning it a human owner", async () => {
    const f = await fixture();
    expect(await f.allowed(CENTER)).toBe(true);
    expect(await f.allowed(HUMAN)).toBe(true);
    expect(await f.allowed(null)).toBe(false);
    expect(await f.allowed(CENTER, "org-b")).toBe(false);
  });
  it("rejects an old designation, paused Center, disabled Profile and revoked member", async () => {
    const f = await fixture();
    await f.harness.query({
      text: 'UPDATE "openmeld"."center_agent_designations" SET agent_profile_id = $1',
      values: [REPLACEMENT],
    });
    expect(await f.allowed(CENTER)).toBe(false);
    await f.harness.query({
      text: 'UPDATE "openmeld"."center_agent_designations" SET agent_profile_id = $1, operating_state = $2, paused_at = $3',
      values: [CENTER, "paused", 2000],
    });
    expect(await f.allowed(CENTER)).toBe(false);
    await f.harness.query({
      text: 'UPDATE "openmeld"."center_agent_designations" SET operating_state = $1, paused_at = NULL',
      values: ["active"],
    });
    await f.harness.query({
      text: 'UPDATE "openmeld"."openmeld_profiles" SET status = $1 WHERE profile_id = $2',
      values: ["disabled", CENTER],
    });
    expect(await f.allowed(CENTER)).toBe(false);
    await f.harness.query({ text: 'DELETE FROM "openmeld"."members"' });
    expect(await f.allowed(HUMAN)).toBe(false);
  });
});
