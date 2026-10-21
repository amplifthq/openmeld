import { MEMBER_AGENT_HARNESS_KINDS } from "../../packages/db/src/auth/member-agent.schema.ts";

// MemberAgent program, package 1b (design-plans/member-agent-program.md §8).
// Groups existing ordinary Agent Profiles into `member_agents` by the Harness
// of their enabled primary Binding, or of their most recent Binding when none
// is enabled. Profiles that never bound, or whose controller has no Harness,
// stay unassigned. The system never guesses a Harness.
//
// Idempotent: only unassigned Profiles are considered, existing MemberAgents
// are reused through the unique key, and a default Profile is set only where
// none exists. A second run changes nothing and reports zero writes.

const BUILTIN_HARNESS_KINDS = MEMBER_AGENT_HARNESS_KINDS.filter(
  (kind) => kind !== "hosted"
);

// Ordinary owned Agent Profiles. Managed Profiles (Center Agent, legacy
// assistants) are outside the MemberAgent structure. Profiles of a closing
// account or Organization are left to deletion; their owner guards reject
// any Profile update.
const ELIGIBLE_PROFILE_PREDICATE = `profile.profile_kind = 'agent'
  AND profile.status = 'active'
  AND profile.managed_role IS NULL
  AND profile.owner_user_id IS NOT NULL
  AND profile.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "openmeld"."users" AS owner
    WHERE owner.id = profile.owner_user_id AND owner.deleted_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "openmeld"."organizations" AS organization
    WHERE organization.id = profile.organization_id
      AND organization.deletion_requested_at IS NOT NULL
  )`;

// String.prototype.trim parity for ASCII whitespace; PostgreSQL btrim()
// removes spaces only.
const trimSql = (expression) =>
  `regexp_replace(${expression}, '^[[:space:]]+|[[:space:]]+$', '', 'g')`;

/**
 * SQL form of harnessKindFromAgentControllerRef (@openmeld/schemas): the
 * hosted Remote Agent maps to `hosted`, a known builtin id to itself, and
 * every other ref (custom, Center Agent, unknown, malformed) to NULL. $1 is
 * the builtin Harness list. A db test checks parity with the shared helper.
 */
export const harnessKindSql = (refExpression) => {
  const ref = trimSql(refExpression);
  const builtinId = trimSql(`substr(${ref}, 9)`);
  return `CASE
    WHEN ${ref} = 'hosted:remote-agent' THEN 'hosted'
    WHEN left(${ref}, 8) = 'builtin:' AND ${builtinId} = ANY($1::text[]) THEN ${builtinId}
  END`;
};

// One Binding per Profile: the enabled primary, else the most recent one.
// Bindings are not filtered by owner first: a selected Binding that belongs to
// another owner yields no Harness, so the Profile stays unassigned and
// invariant 1 fails closed instead of the backfill falling back to history.
const SELECTED_BINDING_CTE = `selected_binding AS (
  SELECT DISTINCT ON (binding.agent_profile_id)
    binding.agent_profile_id AS profile_id,
    ${trimSql("binding.agent_controller_ref")} AS controller_ref,
    (binding.owner_kind = 'owner_account'
      AND binding.owner_id = profile.owner_user_id) AS owner_matches,
    ${harnessKindSql("binding.agent_controller_ref")} AS ref_harness_kind
  FROM "openmeld"."openMeldDaemon_agent_profile_bindings" AS binding
  JOIN "openmeld"."openmeld_profiles" AS profile
    ON profile.profile_id = binding.agent_profile_id
  WHERE ${ELIGIBLE_PROFILE_PREDICATE}
  ORDER BY binding.agent_profile_id,
    (binding.binding_state = 'enabled_primary') DESC,
    binding.created_at_ms DESC,
    binding.updated_at_ms DESC,
    binding.binding_id DESC
),
profile_harness AS (
  SELECT selected_binding.profile_id, selected_binding.controller_ref,
    selected_binding.owner_matches,
    CASE WHEN selected_binding.owner_matches
      THEN selected_binding.ref_harness_kind
    END AS harness_kind
  FROM selected_binding
)`;

const CREATE_MEMBER_AGENTS_SQL = `WITH ${SELECTED_BINDING_CTE}
INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source)
SELECT gen_random_uuid()::text, grouped.organization_id, grouped.owner_user_id, grouped.harness_kind, 'migrated'
FROM (
  SELECT DISTINCT profile.organization_id, profile.owner_user_id, profile_harness.harness_kind
  FROM "openmeld"."openmeld_profiles" AS profile
  JOIN profile_harness ON profile_harness.profile_id = profile.profile_id
  WHERE ${ELIGIBLE_PROFILE_PREDICATE}
    AND profile.member_agent_id IS NULL
    AND profile_harness.harness_kind IS NOT NULL
) AS grouped
ON CONFLICT (organization_id, owner_user_id, harness_kind) DO NOTHING`;

const ASSIGN_PROFILES_SQL = `WITH ${SELECTED_BINDING_CTE}
UPDATE "openmeld"."openmeld_profiles" AS profile
SET member_agent_id = member_agent.id,
  updated_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
FROM profile_harness, "openmeld"."member_agents" AS member_agent
WHERE profile_harness.profile_id = profile.profile_id
  AND ${ELIGIBLE_PROFILE_PREDICATE}
  AND profile.member_agent_id IS NULL
  AND member_agent.organization_id = profile.organization_id
  AND member_agent.owner_user_id = profile.owner_user_id
  AND member_agent.harness_kind = profile_harness.harness_kind`;

// Most recently used Profile; never-used Profiles fall back to creation time.
const SET_DEFAULT_PROFILES_SQL = `UPDATE "openmeld"."member_agents" AS member_agent
SET default_profile_id = chosen.profile_id,
  updated_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
FROM (
  SELECT DISTINCT ON (profile.member_agent_id)
    profile.member_agent_id, profile.profile_id
  FROM "openmeld"."openmeld_profiles" AS profile
  WHERE profile.member_agent_id IS NOT NULL AND profile.status = 'active'
  ORDER BY profile.member_agent_id,
    profile.last_used_at DESC NULLS LAST,
    profile.created_at DESC,
    profile.profile_id
) AS chosen
WHERE member_agent.id = chosen.member_agent_id
  AND member_agent.default_profile_id IS NULL`;

const UNASSIGNED_PROFILES_SQL = `WITH ${SELECTED_BINDING_CTE}
SELECT
  count(*) FILTER (WHERE profile_harness.profile_id IS NULL)::int AS never_bound,
  count(*) FILTER (
    WHERE NOT profile_harness.owner_matches
  )::int AS binding_owner_mismatch,
  count(*) FILTER (
    WHERE profile_harness.owner_matches
      AND left(profile_harness.controller_ref, 7) = 'custom:'
  )::int AS custom_controller,
  count(*) FILTER (
    WHERE profile_harness.owner_matches
      AND profile_harness.harness_kind IS NULL
      AND left(profile_harness.controller_ref, 7) <> 'custom:'
  )::int AS unknown_controller,
  count(*) FILTER (WHERE profile_harness.harness_kind IS NOT NULL)::int AS harness_without_member_agent
FROM "openmeld"."openmeld_profiles" AS profile
LEFT JOIN profile_harness ON profile_harness.profile_id = profile.profile_id
WHERE ${ELIGIBLE_PROFILE_PREDICATE}
  AND profile.member_agent_id IS NULL`;

/**
 * Executable invariants 1–3 of design-plans/member-agent-program.md §9. Each
 * query returns the number of violating rows; zero means the invariant holds.
 */
export const MEMBER_AGENT_INVARIANTS = [
  {
    id: 1,
    name: "enabled_profile_has_matching_member_agent",
    // An active ordinary Profile whose enabled primary Binding has a Harness
    // belongs to exactly one MemberAgent, and that MemberAgent has the same
    // Harness. Center Agent and other managed Profiles are excluded.
    // The enabled Binding is matched regardless of its owner, so a Binding
    // left under another owner is a violation rather than silently skipped.
    sql: `SELECT count(*)::int AS violations
FROM "openmeld"."openmeld_profiles" AS profile
JOIN "openmeld"."openMeldDaemon_agent_profile_bindings" AS binding
  ON binding.agent_profile_id = profile.profile_id
  AND binding.binding_state = 'enabled_primary'
LEFT JOIN "openmeld"."member_agents" AS member_agent
  ON member_agent.id = profile.member_agent_id
WHERE ${ELIGIBLE_PROFILE_PREDICATE}
  AND ${harnessKindSql("binding.agent_controller_ref")} IS NOT NULL
  AND member_agent.harness_kind IS DISTINCT FROM ${harnessKindSql("binding.agent_controller_ref")}`,
    usesBuiltinHarnessKinds: true,
  },
  {
    id: 2,
    name: "one_member_agent_per_owner_harness",
    sql: `SELECT count(*)::int AS violations FROM (
  SELECT 1 FROM "openmeld"."member_agents"
  GROUP BY organization_id, owner_user_id, harness_kind
  HAVING count(*) > 1
) AS duplicate`,
    usesBuiltinHarnessKinds: false,
  },
  {
    id: 3,
    name: "default_profile_belongs_to_member_agent",
    sql: `SELECT count(*)::int AS violations
FROM "openmeld"."member_agents" AS member_agent
LEFT JOIN "openmeld"."openmeld_profiles" AS profile
  ON profile.profile_id = member_agent.default_profile_id
WHERE member_agent.default_profile_id IS NOT NULL
  AND profile.member_agent_id IS DISTINCT FROM member_agent.id`,
    usesBuiltinHarnessKinds: false,
  },
];

/** Count violations of invariants 1–3 without changing data. */
export async function checkMemberAgentInvariants(client) {
  const violations = {};
  for (const invariant of MEMBER_AGENT_INVARIANTS) {
    const result = await client.query({
      text: invariant.sql,
      values: invariant.usesBuiltinHarnessKinds ? [BUILTIN_HARNESS_KINDS] : [],
    });
    violations[invariant.name] = result.rows[0].violations;
  }
  return violations;
}

/**
 * Run the backfill in one transaction and return its counts. The transaction
 * rolls back, and the call throws, when any invariant fails afterwards.
 * `dryRun` runs the same writes and checks, then always rolls back, so the
 * counts are exactly what a real run would commit.
 */
export async function backfillMemberAgents(client, { dryRun = false } = {}) {
  await client.query("BEGIN");
  try {
    // No table lock: account deletion takes owner locks before it touches
    // member_agents, and a table lock here would invert that order. Each
    // write is conditional (ON CONFLICT, IS NULL), so concurrent writers are
    // safe. Fail fast instead of queueing behind a live writer.
    await client.query(
      "SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s'"
    );
    const values = [BUILTIN_HARNESS_KINDS];
    const created = await client.query({
      text: CREATE_MEMBER_AGENTS_SQL,
      values,
    });
    const assigned = await client.query({ text: ASSIGN_PROFILES_SQL, values });
    const defaults = await client.query(SET_DEFAULT_PROFILES_SQL);
    const unassigned = (
      await client.query({ text: UNASSIGNED_PROFILES_SQL, values })
    ).rows[0];
    const invariantViolations = await checkMemberAgentInvariants(client);
    const counts = {
      memberAgentsCreated: created.rowCount ?? 0,
      profilesAssigned: assigned.rowCount ?? 0,
      defaultProfilesSet: defaults.rowCount ?? 0,
      profilesUnassigned: {
        never_bound: unassigned.never_bound,
        binding_owner_mismatch: unassigned.binding_owner_mismatch,
        custom_controller: unassigned.custom_controller,
        unknown_controller: unassigned.unknown_controller,
      },
      // Always zero after a successful run: every Profile with a Harness is assigned.
      profilesWithHarnessUnassigned: unassigned.harness_without_member_agent,
      invariantViolations,
    };
    if (
      counts.profilesWithHarnessUnassigned > 0 ||
      Object.values(invariantViolations).some((count) => count > 0)
    ) {
      await client.query("ROLLBACK");
      const error = new Error(
        `MemberAgent invariants failed; backfill rolled back: ${JSON.stringify({ invariantViolations, profilesWithHarnessUnassigned: counts.profilesWithHarnessUnassigned })}`
      );
      error.counts = counts;
      throw error;
    }
    if (dryRun) {
      await client.query("ROLLBACK");
      return { ...counts, dryRun: true };
    }
    await client.query("COMMIT");
    return counts;
  } catch (error) {
    if (!error.counts) {
      await client.query("ROLLBACK");
    }
    throw error;
  }
}
