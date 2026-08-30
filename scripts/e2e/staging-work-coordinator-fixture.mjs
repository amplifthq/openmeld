#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../..");
const AUTH_PACKAGE_REQUIRE = createRequire(
  path.join(REPO_ROOT, "packages/auth/package.json")
);

export const STAGING_WORK_COORDINATOR_FIXTURE = Object.freeze({
  agentProfiles: {
    planner: {
      bindingId: "binding_961e6508-913f-4501-938d-7f41e37da8d0",
      configurationRevision: 1,
      model: "gpt-5.6-luna",
      name: "Work Coordinator Planner",
      profileId: "agt_74ecf829-a570-4044-bc74-9da5f41a68ef",
    },
    reviewer: {
      bindingId: "binding_d92264e5-28d-4c74-a861-28ec81fc5465",
      configurationRevision: 1,
      model: "gpt-5.4-mini",
      name: "Work Coordinator Reviewer",
      profileId: "agt_e90b1429-19fd-46a4-96a2-09556491437c",
    },
  },
  authUrl: "https://auth.staging.openmeld.ai",
  directMessage: {
    id: "efe0d0fb79a2fc78a080e16161851349d6900f0a920ed5ae83b460e33d9360cf",
  },
  member: {
    accountId: "6dcb0df2-5cc5-43f1-8b95-5ec37d659e12",
    humanProfileId: "6bd3ab12-a40a-4eef-a428-5d5c8f41875c",
    memberId: "01f09fd9-4d4a-4c63-87c3-bff6b3aee405",
    name: "Staging Work Coordinator Member",
    personalMemberId: "ed84fb23-ea97-4422-9ed7-3c50838973ef",
    personalOrganizationId: "e89e15a4-3095-4083-9813-30086fe95d66",
    personalOrganizationSlug: "personal-staging-work-coordinator-member",
    profileHandle: "staging-work-coordinator-member",
    userId: "fc9134de-248a-47ab-b175-41282063312e",
  },
  organization: {
    id: "b9c7f5a1-5b6d-438e-9fa7-714fab555c1d",
    name: "Work Coordinator V2 Staging",
    slug: "work-coordinator-v2-staging",
  },
  owner: {
    accountId: "85404810-920f-4026-8d31-56c006782c0a",
    humanProfileId: "467668a1-5469-48a3-b730-3bf63f3bc0c6",
    memberId: "0d2c195b-81f2-4628-a078-93ae12d4b308",
    name: "Staging Work Coordinator Owner",
    personalMemberId: "520a6849-0e3d-4328-b38a-ebfdf09635c4",
    personalOrganizationId: "c280f280-42fc-41bc-ac83-0fb6b40db4bc",
    personalOrganizationSlug: "personal-staging-work-coordinator-owner",
    profileHandle: "staging-work-coordinator-owner",
    userId: "44df20ee-0559-4755-9d0c-07d224e5a18e",
  },
  spaces: {
    fifoA: {
      id: "1b37d852c9d8462d8f98b6aa51d8d17eea0bcbc2743d26fab9b95e5c5557cc47",
      name: "Work Coordinator FIFO A",
    },
    fifoB: {
      id: "d4a9bd45a6bb356b5ebe8879ad35d88f5492037d61fb690b34b415d529865ef2",
      name: "Work Coordinator FIFO B",
    },
  },
  webUrl: "https://staging.openmeld.ai",
});

const REQUIRED_SECRET_NAMES = Object.freeze({
  memberEmail: "STAGING_WORK_COORDINATOR_MEMBER_EMAIL",
  memberPassword: "STAGING_WORK_COORDINATOR_MEMBER_PASSWORD",
  ownerEmail: "STAGING_WORK_COORDINATOR_OWNER_EMAIL",
  ownerPassword: "STAGING_WORK_COORDINATOR_OWNER_PASSWORD",
});

export function assertStagingFixtureTarget(
  fixture = STAGING_WORK_COORDINATOR_FIXTURE
) {
  for (const target of [fixture.authUrl, fixture.webUrl]) {
    const hostname = new URL(target).hostname;
    if (
      !hostname.endsWith(".staging.openmeld.ai") &&
      hostname !== "staging.openmeld.ai"
    ) {
      throw new Error(`Refusing non-Staging fixture target: ${hostname}`);
    }
  }
}

export function readFixtureSecrets(env = process.env) {
  const secrets = {};
  const missing = [];
  for (const [field, name] of Object.entries(REQUIRED_SECRET_NAMES)) {
    const value = String(env[name] ?? "").trim();
    if (!value) {
      missing.push(name);
      continue;
    }
    secrets[field] = value;
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing Staging smoke credentials: ${missing.join(", ")}. Run through Doppler project openmeld-staging-smoke, config stg_smoke.`
    );
  }
  return secrets;
}

export async function buildIdentitySeedSql(input) {
  const { hashPassword } = AUTH_PACKAGE_REQUIRE("better-auth/crypto");
  const now = Date.now();
  const ownerHash = await hashPassword(input.secrets.ownerPassword);
  const memberHash = await hashPassword(input.secrets.memberPassword);
  const fixture = input.fixture ?? STAGING_WORK_COORDINATOR_FIXTURE;

  return [
    "PRAGMA foreign_keys = ON;",
    upsertUserSql({
      email: input.secrets.ownerEmail,
      fixture: fixture.owner,
      now,
      organizationId: fixture.organization.id,
    }),
    upsertUserSql({
      email: input.secrets.memberEmail,
      fixture: fixture.member,
      now,
      organizationId: fixture.organization.id,
    }),
    upsertCredentialAccountSql({
      fixture: fixture.owner,
      hash: ownerHash,
      now,
    }),
    upsertCredentialAccountSql({
      fixture: fixture.member,
      hash: memberHash,
      now,
    }),
    upsertPersonalOrganizationSql({ fixture: fixture.owner, now }),
    upsertPersonalOrganizationSql({ fixture: fixture.member, now }),
    upsertMemberSql({
      memberId: fixture.owner.personalMemberId,
      organizationId: fixture.owner.personalOrganizationId,
      role: "owner",
      userId: fixture.owner.userId,
      now,
    }),
    upsertMemberSql({
      memberId: fixture.member.personalMemberId,
      organizationId: fixture.member.personalOrganizationId,
      role: "owner",
      userId: fixture.member.userId,
      now,
    }),
    `INSERT INTO organizations (id, name, slug, created_at, metadata, created_by_user_id)
VALUES (${sqlText(fixture.organization.id)}, ${sqlText(fixture.organization.name)}, ${sqlText(fixture.organization.slug)}, ${now}, '{}', ${sqlText(fixture.owner.userId)})
ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, created_by_user_id = excluded.created_by_user_id;`,
    upsertMemberSql({
      memberId: fixture.owner.memberId,
      organizationId: fixture.organization.id,
      role: "owner",
      userId: fixture.owner.userId,
      now,
    }),
    upsertMemberSql({
      memberId: fixture.member.memberId,
      organizationId: fixture.organization.id,
      role: "member",
      userId: fixture.member.userId,
      now,
    }),
    upsertHumanProfileSql({ fixture: fixture.owner, now }),
    upsertHumanProfileSql({ fixture: fixture.member, now }),
  ].join("\n\n");
}

export function buildSanitizedFixtureSummary(
  fixture = STAGING_WORK_COORDINATOR_FIXTURE
) {
  const organizationUrl = `${fixture.webUrl}/o/${fixture.organization.slug}`;
  return {
    agentProfiles: Object.values(fixture.agentProfiles),
    authUrl: fixture.authUrl,
    directMessage: {
      id: fixture.directMessage.id,
      url: `${organizationUrl}/direct-messages/${fixture.directMessage.id}?profileId=${fixture.owner.humanProfileId}`,
    },
    organizationId: fixture.organization.id,
    organizationSlug: fixture.organization.slug,
    roles: {
      member: {
        humanProfileId: fixture.member.humanProfileId,
        role: "member",
      },
      owner: {
        humanProfileId: fixture.owner.humanProfileId,
        role: "owner",
      },
    },
    spaces: Object.values(fixture.spaces).map((space) => ({
      ...space,
      url: `${organizationUrl}/spaces/${space.id}?profileId=${fixture.owner.humanProfileId}`,
    })),
    webUrl: organizationUrl,
  };
}

async function prepareIdentities() {
  assertStagingFixtureTarget();
  const secrets = readFixtureSecrets();
  const sql = await buildIdentitySeedSql({ secrets });
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "openmeld-staging-work-coordinator-")
  );
  const sqlPath = path.join(temporaryRoot, "seed.sql");
  try {
    await writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 });
    runCommand("pnpm", [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "OPENMELD_DB",
      "--config",
      "services/auth/wrangler.jsonc",
      "--env",
      "stg",
      "--remote",
      "--yes",
      "--file",
      sqlPath,
    ]);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, ...buildSanitizedFixtureSummary() }, null, 2)}\n`
  );
}

function upsertUserSql(input) {
  return `INSERT INTO users (id, name, email, email_verified, created_at, updated_at, normalized_email, last_selected_organization_id)
VALUES (${sqlText(input.fixture.userId)}, ${sqlText(input.fixture.name)}, ${sqlText(input.email)}, 1, ${input.now}, ${input.now}, ${sqlText(input.email.toLowerCase())}, ${sqlText(input.organizationId)})
ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, email_verified = 1, updated_at = excluded.updated_at, normalized_email = excluded.normalized_email, last_selected_organization_id = excluded.last_selected_organization_id;`;
}

function upsertCredentialAccountSql(input) {
  return `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
VALUES (${sqlText(input.fixture.accountId)}, ${sqlText(input.fixture.userId)}, 'credential', ${sqlText(input.fixture.userId)}, ${sqlText(input.hash)}, ${input.now}, ${input.now})
ON CONFLICT(id) DO UPDATE SET password = excluded.password, updated_at = excluded.updated_at;`;
}

function upsertMemberSql(input) {
  return `INSERT INTO members (id, organization_id, user_id, role, created_at)
VALUES (${sqlText(input.memberId)}, ${sqlText(input.organizationId)}, ${sqlText(input.userId)}, ${sqlText(input.role)}, ${input.now})
ON CONFLICT(id) DO UPDATE SET organization_id = excluded.organization_id, user_id = excluded.user_id, role = excluded.role;`;
}

function upsertPersonalOrganizationSql(input) {
  return `INSERT INTO organizations (id, name, slug, created_at, metadata, created_by_user_id)
VALUES (${sqlText(input.fixture.personalOrganizationId)}, ${sqlText(input.fixture.name)}, ${sqlText(input.fixture.personalOrganizationSlug)}, ${input.now}, '{"personal":true}', ${sqlText(input.fixture.userId)})
ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, metadata = excluded.metadata, created_by_user_id = excluded.created_by_user_id;`;
}

function upsertHumanProfileSql(input) {
  return `INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, created_at, updated_at)
VALUES (${sqlText(input.fixture.humanProfileId)}, ${sqlText(input.fixture.name)}, ${sqlText(input.fixture.profileHandle)}, 'human', 1, 'active', NULL, ${sqlText(input.fixture.userId)}, ${sqlText(input.fixture.userId)}, 'auth_bootstrap', ${input.now}, ${input.now})
ON CONFLICT(profile_id) DO UPDATE SET profile_name = excluded.profile_name, profile_handle = excluded.profile_handle, status = 'active', organization_id = NULL, owner_user_id = excluded.owner_user_id, updated_at = excluded.updated_at;`;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "unknown"}): ${String(result.stderr || result.stdout).trim()}`
    );
  }
}

async function main() {
  const command = process.argv[2] ?? "summary";
  if (command === "summary") {
    assertStagingFixtureTarget();
    process.stdout.write(
      `${JSON.stringify(buildSanitizedFixtureSummary(), null, 2)}\n`
    );
    return;
  }
  if (command === "prepare-identities") {
    await prepareIdentities();
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
