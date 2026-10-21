import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { harnessKindFromAgentControllerRef } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  connect,
  migrate,
  migrationDirectory,
  quoteIdentifier,
} from "../../../tooling/postgresql/database.mjs";
import {
  backfillMemberAgents,
  checkMemberAgentInvariants,
  harnessKindSql,
} from "../../../tooling/postgresql/member-agent-backfill.mjs";
import {
  createPostgresHarness,
  type PostgresHarness,
} from "../../../tooling/postgresql/test-harness";
import { MEMBER_AGENT_HARNESS_KINDS } from "../src/auth/member-agent.schema.ts";

type Query = (config: {
  text: string;
  values?: unknown[];
}) => Promise<{ rows: Record<string, unknown>[] }>;

const profileId = (suffix: number) =>
  `agt_00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const HOSTED_REMOTE_AGENT_IDENTITY = JSON.stringify({
  kind: "hosted_remote_agent",
  authority: "core_logical_runtime",
  agentControllerRef: "hosted:remote-agent",
  logicalRuntimeId: "hosted:remote-agent",
  platform: "cloudflare_think",
});
const HOSTED_CENTER_AGENT_IDENTITY = JSON.stringify({
  kind: "hosted_center_agent",
  authority: "core_logical_runtime",
  agentControllerRef: "hosted:center-agent",
  logicalRuntimeId: "hosted:center-agent",
  platform: "cloudflare_think",
});
const HOSTED_RUNTIME_BY_REF: Record<
  string,
  { runtimeKind: string; identity: string } | undefined
> = {
  "hosted:remote-agent": {
    runtimeKind: "hosted_remote_agent",
    identity: HOSTED_REMOTE_AGENT_IDENTITY,
  },
  "hosted:center-agent": {
    runtimeKind: "hosted_center_agent",
    identity: HOSTED_CENTER_AGENT_IDENTITY,
  },
};

async function seedIdentities(query: Query) {
  for (const id of ["alice", "bob"]) {
    await query({
      text: 'INSERT INTO "openmeld"."users"(id,name,email) VALUES($1,$2,$3)',
      values: [id, id, `${id}@example.com`],
    });
  }
  for (const org of ["one", "two"]) {
    await query({
      text: 'INSERT INTO "openmeld"."organizations"(id,name,slug,created_at) VALUES($1,$2,$3,0)',
      values: [org, org, org],
    });
  }
}

async function insertProfile(
  query: Query,
  input: {
    id: number;
    organizationId?: string;
    ownerUserId?: string | null;
    managedRole?: string | null;
    status?: "active" | "disabled";
    lastUsedAt?: number | null;
    createdAt?: number;
  }
) {
  await query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (
      profile_id, profile_name, profile_handle, profile_kind, status, organization_id,
      owner_user_id, source, managed_role, last_used_at, created_at, updated_at
    ) VALUES ($1, $1, $1, 'agent', $2, $3, $4, 'web_create', $5, $6, $7, $7)`,
    values: [
      profileId(input.id),
      input.status ?? "active",
      input.organizationId ?? "one",
      input.ownerUserId === undefined ? "alice" : input.ownerUserId,
      input.managedRole ?? null,
      input.lastUsedAt ?? null,
      input.createdAt ?? 1000,
    ],
  });
}

async function insertBinding(
  query: Query,
  input: {
    id: string;
    profile: number;
    ref: string;
    enabled: boolean;
    createdAt: number;
    ownerUserId?: string;
    organizationOwnerId?: string;
  }
) {
  const hosted = HOSTED_RUNTIME_BY_REF[input.ref];
  const runtimeKind = hosted?.runtimeKind ?? "openmeld_service";
  const identity = hosted?.identity ?? null;
  await query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
      binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id,
      runtime_kind, hosted_runtime_identity_json, agent_controller_ref, binding_state,
      created_at_ms, updated_at_ms, disabled_at_ms
    ) VALUES ($1, $2, $3, $4, 'runtime-1', $5, $6, $7, $8, $9, $9, $10)`,
    values: [
      input.id,
      input.organizationOwnerId ? "organization" : "owner_account",
      input.organizationOwnerId ?? input.ownerUserId ?? "alice",
      profileId(input.profile),
      runtimeKind,
      identity,
      input.ref,
      input.enabled ? "enabled_primary" : "disabled_historical",
      input.createdAt,
      input.enabled ? null : input.createdAt + 1,
    ],
  });
}

/**
 * Every grouping case in one fixture. Expected outcome:
 * - alice/one claude-code: 1 (latest lastUsedAt, default), 2
 * - alice/one codex: 3 (latest Binding disabled), 12 (default: newest, never used)
 * - alice/one hosted: 7 (Remote Agent)
 * - alice/one cursor: 13 (enabled Binding wins over a newer disabled one)
 * - alice/two claude-code: 8
 * - bob/one claude-code: 9, reusing an existing detected MemberAgent
 * - unassigned: 4 never bound, 5 custom controller, 6 unknown builtin
 * - skipped: 10 Center Agent, 11 disabled Profile, 14 legacy assistant
 */
async function seedProfiles(query: Query) {
  await insertProfile(query, { id: 1, lastUsedAt: 3000 });
  await insertBinding(query, {
    id: "b1",
    profile: 1,
    ref: "builtin:claude-code",
    enabled: true,
    createdAt: 100,
  });
  await insertProfile(query, { id: 2, lastUsedAt: 1000, createdAt: 2000 });
  await insertBinding(query, {
    id: "b2",
    profile: 2,
    ref: "builtin:claude-code",
    enabled: true,
    createdAt: 100,
  });
  await insertProfile(query, { id: 3, createdAt: 1000 });
  await insertBinding(query, {
    id: "b3-old",
    profile: 3,
    ref: "builtin:claude-code",
    enabled: false,
    createdAt: 100,
  });
  await insertBinding(query, {
    id: "b3-new",
    profile: 3,
    ref: "builtin:codex",
    enabled: false,
    createdAt: 200,
  });
  await insertProfile(query, { id: 12, createdAt: 1500 });
  await insertBinding(query, {
    id: "b12",
    profile: 12,
    ref: "builtin:codex",
    enabled: true,
    createdAt: 100,
  });
  await insertProfile(query, { id: 4 });
  await insertProfile(query, { id: 5 });
  await insertBinding(query, {
    id: "b5",
    profile: 5,
    ref: "custom:ops-bot",
    enabled: true,
    createdAt: 100,
  });
  await insertProfile(query, { id: 6 });
  await insertBinding(query, {
    id: "b6",
    profile: 6,
    ref: "builtin:unknown-harness",
    enabled: true,
    createdAt: 100,
  });
  await insertProfile(query, { id: 7 });
  await insertBinding(query, {
    id: "b7",
    profile: 7,
    ref: "hosted:remote-agent",
    enabled: true,
    createdAt: 100,
  });
  await insertProfile(query, { id: 13 });
  await insertBinding(query, {
    id: "b13-enabled",
    profile: 13,
    ref: "builtin:cursor",
    enabled: true,
    createdAt: 100,
  });
  await insertBinding(query, {
    id: "b13-newer-disabled",
    profile: 13,
    ref: "builtin:codex",
    enabled: false,
    createdAt: 200,
  });
  await insertProfile(query, { id: 8, organizationId: "two" });
  await insertBinding(query, {
    id: "b8",
    profile: 8,
    ref: "builtin:claude-code",
    enabled: true,
    createdAt: 100,
  });
  await insertProfile(query, { id: 9, ownerUserId: "bob" });
  await insertBinding(query, {
    id: "b9",
    profile: 9,
    ref: "builtin:claude-code",
    enabled: true,
    createdAt: 100,
    ownerUserId: "bob",
  });
  await insertProfile(query, {
    id: 10,
    ownerUserId: null,
    managedRole: "center_agent",
  });
  await insertBinding(query, {
    id: "b10",
    profile: 10,
    ref: "hosted:center-agent",
    enabled: true,
    createdAt: 100,
    organizationOwnerId: "one",
  });
  await insertProfile(query, { id: 11, status: "disabled" });
  await insertBinding(query, {
    id: "b11",
    profile: 11,
    ref: "builtin:claude-code",
    enabled: true,
    createdAt: 100,
  });
  await insertProfile(query, { id: 14, managedRole: "openmeld_assistant" });
  await insertBinding(query, {
    id: "b14",
    profile: 14,
    ref: "builtin:claude-code",
    enabled: true,
    createdAt: 100,
  });
}

async function readGrouping(query: Query) {
  const agents = (
    await query({
      text: `SELECT member_agent.organization_id, member_agent.owner_user_id, member_agent.harness_kind,
          member_agent.source, member_agent.default_profile_id,
          array_agg(profile.profile_id ORDER BY profile.profile_id) AS profile_ids
        FROM "openmeld"."member_agents" AS member_agent
        LEFT JOIN "openmeld"."openmeld_profiles" AS profile ON profile.member_agent_id = member_agent.id
        GROUP BY member_agent.id
        ORDER BY member_agent.organization_id, member_agent.owner_user_id, member_agent.harness_kind`,
    })
  ).rows;
  const unassigned = (
    await query({
      text: `SELECT profile_id FROM "openmeld"."openmeld_profiles"
        WHERE member_agent_id IS NULL ORDER BY profile_id`,
    })
  ).rows.map((row) => row.profile_id);
  return { agents, unassigned };
}

async function snapshot(query: Query) {
  return {
    agents: (
      await query({
        text: `SELECT * FROM "openmeld"."member_agents" ORDER BY id`,
      })
    ).rows,
    profiles: (
      await query({
        text: `SELECT profile_id, member_agent_id, updated_at FROM "openmeld"."openmeld_profiles" ORDER BY profile_id`,
      })
    ).rows,
  };
}

const EXPECTED_GROUPING = {
  agents: [
    {
      organization_id: "one",
      owner_user_id: "alice",
      harness_kind: "claude-code",
      source: "migrated",
      default_profile_id: profileId(1),
      profile_ids: [profileId(1), profileId(2)],
    },
    {
      organization_id: "one",
      owner_user_id: "alice",
      harness_kind: "codex",
      source: "migrated",
      default_profile_id: profileId(12),
      profile_ids: [profileId(3), profileId(12)],
    },
    {
      organization_id: "one",
      owner_user_id: "alice",
      harness_kind: "cursor",
      source: "migrated",
      default_profile_id: profileId(13),
      profile_ids: [profileId(13)],
    },
    {
      organization_id: "one",
      owner_user_id: "alice",
      harness_kind: "hosted",
      source: "migrated",
      default_profile_id: profileId(7),
      profile_ids: [profileId(7)],
    },
    {
      organization_id: "one",
      owner_user_id: "bob",
      harness_kind: "claude-code",
      source: "detected",
      default_profile_id: profileId(9),
      profile_ids: [profileId(9)],
    },
    {
      organization_id: "two",
      owner_user_id: "alice",
      harness_kind: "claude-code",
      source: "migrated",
      default_profile_id: profileId(8),
      profile_ids: [profileId(8)],
    },
  ],
  unassigned: [4, 5, 6, 10, 11, 14].map(profileId),
};

const ZERO_VIOLATIONS = {
  enabled_profile_has_matching_member_agent: 0,
  one_member_agent_per_owner_harness: 0,
  default_profile_belongs_to_member_agent: 0,
};

describe("MemberAgent backfill", () => {
  let harness: PostgresHarness;
  let query: Query;

  beforeEach(async () => {
    harness = await createPostgresHarness();
    query = harness.query as unknown as Query;
    await seedIdentities(query);
    await seedProfiles(query);
    // A MemberAgent created by catalog sync before the backfill runs.
    await query({
      text: `INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source)
        VALUES ('bob-detected', 'one', 'bob', 'claude-code', 'detected')`,
    });
  });

  afterEach(async () => await harness.close());

  it("groups Profiles by Harness, picks defaults and reports unassigned reasons", async () => {
    const counts = await backfillMemberAgents(harness);

    expect(counts).toEqual({
      memberAgentsCreated: 5,
      profilesAssigned: 8,
      defaultProfilesSet: 6,
      profilesUnassigned: {
        never_bound: 1,
        binding_owner_mismatch: 0,
        custom_controller: 1,
        unknown_controller: 1,
      },
      profilesWithHarnessUnassigned: 0,
      invariantViolations: ZERO_VIOLATIONS,
    });
    expect(await readGrouping(query)).toEqual(EXPECTED_GROUPING);
    const reused = await query({
      text: `SELECT id FROM "openmeld"."member_agents" WHERE owner_user_id = 'bob'`,
    });
    expect(reused.rows).toEqual([{ id: "bob-detected" }]);
  });

  it("changes nothing when it runs a second time", async () => {
    await backfillMemberAgents(harness);
    const before = await snapshot(query);

    const counts = await backfillMemberAgents(harness);

    expect(counts).toEqual({
      memberAgentsCreated: 0,
      profilesAssigned: 0,
      defaultProfilesSet: 0,
      profilesUnassigned: {
        never_bound: 1,
        binding_owner_mismatch: 0,
        custom_controller: 1,
        unknown_controller: 1,
      },
      profilesWithHarnessUnassigned: 0,
      invariantViolations: ZERO_VIOLATIONS,
    });
    expect(await snapshot(query)).toEqual(before);
  });

  it("reports the real run's counts on a dry run and writes nothing", async () => {
    const before = await snapshot(query);

    const preview = await backfillMemberAgents(harness, { dryRun: true });

    expect(await snapshot(query)).toEqual(before);
    const { dryRun, ...previewCounts } = preview;
    expect(dryRun).toBe(true);
    expect(previewCounts).toEqual(await backfillMemberAgents(harness));
    expect(await readGrouping(query)).toEqual(EXPECTED_GROUPING);
  });

  it("leaves Profiles of a closing Organization to deletion instead of failing", async () => {
    await query({
      text: `INSERT INTO "openmeld"."organizations"(id,name,slug,created_at) VALUES('closing','closing','closing',0)`,
    });
    await insertProfile(query, { id: 20, organizationId: "closing" });
    await insertBinding(query, {
      id: "b20",
      profile: 20,
      ref: "builtin:claude-code",
      enabled: true,
      createdAt: 100,
    });
    await query({
      text: `UPDATE "openmeld"."organizations" SET deletion_requested_at = 1 WHERE id = 'closing'`,
    });

    const counts = await backfillMemberAgents(harness);

    expect(counts.memberAgentsCreated).toBe(5);
    expect(counts.invariantViolations).toEqual(ZERO_VIOLATIONS);
    expect(
      (
        await query({
          text: `SELECT member_agent_id FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1`,
          values: [profileId(20)],
        })
      ).rows
    ).toEqual([{ member_agent_id: null }]);
  });

  it("fails closed when an enabled Binding belongs to another owner", async () => {
    // Profile 1's enabled Claude Code Binding stays under alice after the
    // Profile owner changes; its history must not decide the Harness.
    await query({
      text: `UPDATE "openmeld"."openmeld_profiles" SET owner_user_id = 'bob' WHERE profile_id = $1`,
      values: [profileId(1)],
    });
    const before = await snapshot(query);

    await expect(backfillMemberAgents(harness)).rejects.toMatchObject({
      counts: {
        profilesUnassigned: { binding_owner_mismatch: 1 },
        invariantViolations: {
          ...ZERO_VIOLATIONS,
          enabled_profile_has_matching_member_agent: 1,
        },
      },
    });
    expect(await snapshot(query)).toEqual(before);
  });

  it("rolls back every write when an existing assignment breaks an invariant", async () => {
    await query({
      text: `INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source)
        VALUES ('alice-codex', 'one', 'alice', 'codex', 'detected')`,
    });
    // Profile 1 runs Claude Code but was attached to the Codex MemberAgent.
    await query({
      text: `UPDATE "openmeld"."openmeld_profiles" SET member_agent_id = 'alice-codex' WHERE profile_id = $1`,
      values: [profileId(1)],
    });
    const before = await snapshot(query);

    await expect(backfillMemberAgents(harness)).rejects.toMatchObject({
      counts: {
        invariantViolations: {
          ...ZERO_VIOLATIONS,
          enabled_profile_has_matching_member_agent: 1,
        },
      },
    });
    expect(await snapshot(query)).toEqual(before);
  });
});

describe("harnessKindSql", () => {
  let harness: PostgresHarness;
  beforeEach(async () => {
    harness = await createPostgresHarness();
  });
  afterEach(async () => await harness.close());

  it("classifies controller refs exactly like harnessKindFromAgentControllerRef", async () => {
    const builtinKinds = MEMBER_AGENT_HARNESS_KINDS.filter(
      (kind) => kind !== "hosted"
    );
    const refs = [
      "builtin:claude-code",
      " builtin:codex ",
      "builtin:\tcodex",
      "\thosted:remote-agent\n",
      "builtin: grok-build",
      "builtin:grok-bot",
      "hosted:remote-agent",
      "hosted:center-agent",
      "custom:ops-bot",
      "builtin:unknown",
      "builtin:hosted",
      "builtin:",
      "builtin:codex:extra",
      "codex",
      "BUILTIN:codex",
      "",
    ];
    for (const ref of refs) {
      const result = await harness.query({
        text: `SELECT ${harnessKindSql("$2::text")} AS harness_kind`,
        values: [builtinKinds, ref],
      });
      expect({ ref, harnessKind: result.rows[0]?.harness_kind }).toEqual({
        ref,
        harnessKind: harnessKindFromAgentControllerRef(ref),
      });
    }
  });
});

describe("MemberAgent invariants", () => {
  let harness: PostgresHarness;
  let query: Query;

  beforeEach(async () => {
    harness = await createPostgresHarness();
    query = harness.query as unknown as Query;
    await seedIdentities(query);
    await seedProfiles(query);
    await backfillMemberAgents(harness);
  });

  afterEach(async () => await harness.close());

  it("hold after the backfill", async () => {
    expect(await checkMemberAgentInvariants(harness)).toEqual(ZERO_VIOLATIONS);
  });

  it("1: detects an enabled Profile with a Harness but no MemberAgent", async () => {
    await query({
      text: `UPDATE "openmeld"."openmeld_profiles" SET member_agent_id = NULL WHERE profile_id = $1`,
      values: [profileId(2)],
    });
    expect(await checkMemberAgentInvariants(harness)).toEqual({
      ...ZERO_VIOLATIONS,
      enabled_profile_has_matching_member_agent: 1,
    });
  });

  it("2: detects two MemberAgents for one organization, owner and Harness", async () => {
    // The unique index prevents this; drop it only in this test database to
    // prove the assertion itself detects the violation.
    await query({
      text: `DROP INDEX "openmeld"."member_agents_owner_harness_uq_idx"`,
    });
    await query({
      text: `INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source)
        VALUES ('duplicate', 'one', 'alice', 'claude-code', 'manual')`,
    });
    expect(await checkMemberAgentInvariants(harness)).toEqual({
      ...ZERO_VIOLATIONS,
      one_member_agent_per_owner_harness: 1,
    });
  });

  it("3: detects a default Profile that belongs to another MemberAgent", async () => {
    // member_agents_default_profile_fk prevents this; drop it only in this
    // test database to prove the assertion itself detects the violation.
    await query({
      text: `ALTER TABLE "openmeld"."member_agents" DROP CONSTRAINT "member_agents_default_profile_fk"`,
    });
    await query({
      text: `UPDATE "openmeld"."member_agents" SET default_profile_id = $1
        WHERE owner_user_id = 'alice' AND organization_id = 'one' AND harness_kind = 'claude-code'`,
      values: [profileId(3)],
    });
    expect(await checkMemberAgentInvariants(harness)).toEqual({
      ...ZERO_VIOLATIONS,
      default_profile_belongs_to_member_agent: 1,
    });
  });
});

describe("member_agents migration on a database with existing Profiles", () => {
  const ownerUrl = () =>
    new URL(process.env.POSTGRESQL_OPENMELD_MIGRATION_URL ?? "");
  let databaseName: string;
  let previousJournalDirectory: string;

  beforeEach(async () => {
    databaseName = `openmeld_pg_member_agents_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = await connect(ownerUrl().toString(), true);
    try {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    } finally {
      await admin.end();
    }
    // The journal as it was before 0038: same files, truncated history.
    previousJournalDirectory = await mkdtemp(
      path.join(os.tmpdir(), "openmeld-pre-member-agents-")
    );
    await cp(migrationDirectory, previousJournalDirectory, { recursive: true });
    const journalPath = path.join(
      previousJournalDirectory,
      "meta/_journal.json"
    );
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    const memberAgentsIndex = journal.entries.findIndex(
      (entry: { tag: string }) => entry.tag === "0038_member_agents"
    );
    if (memberAgentsIndex < 1) {
      throw new Error("0038_member_agents is missing from the journal");
    }
    journal.entries = journal.entries.slice(0, memberAgentsIndex);
    await writeFile(journalPath, JSON.stringify(journal));
  });

  afterEach(async () => {
    await rm(previousJournalDirectory, { force: true, recursive: true });
    const admin = await connect(ownerUrl().toString(), true);
    try {
      await admin.query(
        `DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`
      );
    } finally {
      await admin.end();
    }
  });

  it("adds the table and column, then backfills the existing Profiles", async () => {
    const url = ownerUrl();
    url.pathname = `/${databaseName}`;
    const client = await connect(url.toString(), true);
    try {
      await migrate(client, previousJournalDirectory);
      const clientQuery = client.query.bind(client) as unknown as Query;
      await seedIdentities(clientQuery);
      await seedProfiles(clientQuery);

      const upgrade = await migrate(client);
      expect(upgrade.applied).toContain("0038_member_agents.sql");
      expect(
        (
          await client.query(
            `SELECT count(*)::int AS assigned FROM "openmeld"."openmeld_profiles" WHERE member_agent_id IS NOT NULL`
          )
        ).rows
      ).toEqual([{ assigned: 0 }]);

      const counts = await backfillMemberAgents(client);
      expect(counts).toMatchObject({
        memberAgentsCreated: 6,
        profilesAssigned: 8,
        defaultProfilesSet: 6,
        invariantViolations: ZERO_VIOLATIONS,
      });
      console.info(
        `MemberAgent backfill counts (existing-Profile upgrade): ${JSON.stringify(counts)}`
      );
      const grouping = await readGrouping(clientQuery);
      expect(grouping.unassigned).toEqual(EXPECTED_GROUPING.unassigned);
      expect(
        grouping.agents.map((agent) => ({ ...agent, source: "migrated" }))
      ).toEqual(
        EXPECTED_GROUPING.agents.map((agent) => ({
          ...agent,
          source: "migrated",
        }))
      );
    } finally {
      await client.end();
    }
  });
});
