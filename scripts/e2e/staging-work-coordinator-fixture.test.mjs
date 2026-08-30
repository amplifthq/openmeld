import assert from "node:assert/strict";
import test from "node:test";

import {
  assertStagingFixtureTarget,
  buildIdentitySeedSql,
  buildSanitizedFixtureSummary,
  readFixtureSecrets,
  STAGING_WORK_COORDINATOR_FIXTURE,
} from "./staging-work-coordinator-fixture.mjs";

const TEST_SECRETS = {
  memberEmail: "member@example.test",
  memberPassword: "member-secret-not-real",
  ownerEmail: "owner@example.test",
  ownerPassword: "owner-secret-not-real",
};

const BEGIN_OR_COMMIT_PATTERN = /BEGIN TRANSACTION|COMMIT/u;
const CREDENTIAL_PATTERN = /'credential'/u;
const MEMBER_PATTERN = /'member'/u;
const MEMBER_EMAIL_SECRET_NAME_PATTERN =
  /STAGING_WORK_COORDINATOR_MEMBER_EMAIL/u;
const MEMBER_SECRET_PATTERN = /member-secret-not-real/u;
const ON_CONFLICT_PATTERN = /ON CONFLICT\(id\) DO UPDATE/u;
const OWNER_EMAIL_PATTERN = /owner@example\.test/u;
const OWNER_PATTERN = /'owner'/u;
const OWNER_SECRET_PATTERN = /owner-secret-not-real/u;
const STAGING_TARGET_ERROR_PATTERN = /Refusing non-Staging fixture target/u;

test("rejects any fixture target outside Staging", () => {
  assert.throws(
    () =>
      assertStagingFixtureTarget({
        ...STAGING_WORK_COORDINATOR_FIXTURE,
        webUrl: "https://openmeld.ai",
      }),
    STAGING_TARGET_ERROR_PATTERN
  );
});

test("requires every credential without including values in the error", () => {
  assert.throws(
    () =>
      readFixtureSecrets({
        STAGING_WORK_COORDINATOR_OWNER_EMAIL: "owner@example.test",
      }),
    (error) => {
      assert.match(error.message, MEMBER_EMAIL_SECRET_NAME_PATTERN);
      assert.doesNotMatch(error.message, OWNER_EMAIL_PATTERN);
      return true;
    }
  );
});

test("builds an idempotent Staging identity seed", async () => {
  const sql = await buildIdentitySeedSql({ secrets: TEST_SECRETS });
  assert.match(sql, ON_CONFLICT_PATTERN);
  assert.match(sql, CREDENTIAL_PATTERN);
  assert.match(sql, OWNER_PATTERN);
  assert.match(sql, MEMBER_PATTERN);
  assert.equal(sql.split("'{\"personal\":true}'").length - 1, 2);
  assert.match(
    sql,
    new RegExp(
      `'${STAGING_WORK_COORDINATOR_FIXTURE.owner.personalOrganizationId}'.*'${STAGING_WORK_COORDINATOR_FIXTURE.owner.userId}'.*'owner'`,
      "su"
    )
  );
  assert.match(
    sql,
    new RegExp(
      `'${STAGING_WORK_COORDINATOR_FIXTURE.member.personalOrganizationId}'.*'${STAGING_WORK_COORDINATOR_FIXTURE.member.userId}'.*'owner'`,
      "su"
    )
  );
  assert.match(
    sql,
    new RegExp(
      `'${STAGING_WORK_COORDINATOR_FIXTURE.owner.humanProfileId}'.*'human'.*NULL`,
      "su"
    )
  );
  assert.doesNotMatch(sql, BEGIN_OR_COMMIT_PATTERN);
  assert.doesNotMatch(sql, OWNER_SECRET_PATTERN);
  assert.doesNotMatch(sql, MEMBER_SECRET_PATTERN);
});

test("prints only non-secret scenario facts", () => {
  assert.deepEqual(buildSanitizedFixtureSummary(), {
    agentProfiles: [
      {
        bindingId: "binding_961e6508-913f-4501-938d-7f41e37da8d0",
        configurationRevision: 1,
        model: "gpt-5.6-luna",
        name: "Work Coordinator Planner",
        profileId: "agt_74ecf829-a570-4044-bc74-9da5f41a68ef",
      },
      {
        bindingId: "binding_d92264e5-28d-4c74-a861-28ec81fc5465",
        configurationRevision: 1,
        model: "gpt-5.4-mini",
        name: "Work Coordinator Reviewer",
        profileId: "agt_e90b1429-19fd-46a4-96a2-09556491437c",
      },
    ],
    authUrl: "https://auth.staging.openmeld.ai",
    directMessage: {
      id: "efe0d0fb79a2fc78a080e16161851349d6900f0a920ed5ae83b460e33d9360cf",
      url: "https://staging.openmeld.ai/o/work-coordinator-v2-staging/direct-messages/efe0d0fb79a2fc78a080e16161851349d6900f0a920ed5ae83b460e33d9360cf?profileId=467668a1-5469-48a3-b730-3bf63f3bc0c6",
    },
    organizationId: "b9c7f5a1-5b6d-438e-9fa7-714fab555c1d",
    organizationSlug: "work-coordinator-v2-staging",
    roles: {
      member: {
        humanProfileId: "6bd3ab12-a40a-4eef-a428-5d5c8f41875c",
        role: "member",
      },
      owner: {
        humanProfileId: "467668a1-5469-48a3-b730-3bf63f3bc0c6",
        role: "owner",
      },
    },
    spaces: [
      {
        id: "1b37d852c9d8462d8f98b6aa51d8d17eea0bcbc2743d26fab9b95e5c5557cc47",
        name: "Work Coordinator FIFO A",
        url: "https://staging.openmeld.ai/o/work-coordinator-v2-staging/spaces/1b37d852c9d8462d8f98b6aa51d8d17eea0bcbc2743d26fab9b95e5c5557cc47?profileId=467668a1-5469-48a3-b730-3bf63f3bc0c6",
      },
      {
        id: "d4a9bd45a6bb356b5ebe8879ad35d88f5492037d61fb690b34b415d529865ef2",
        name: "Work Coordinator FIFO B",
        url: "https://staging.openmeld.ai/o/work-coordinator-v2-staging/spaces/d4a9bd45a6bb356b5ebe8879ad35d88f5492037d61fb690b34b415d529865ef2?profileId=467668a1-5469-48a3-b730-3bf63f3bc0c6",
      },
    ],
    webUrl: "https://staging.openmeld.ai/o/work-coordinator-v2-staging",
  });
});
