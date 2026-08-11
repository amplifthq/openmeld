import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  buildFeedbackInboxEnsureSql,
  buildFeedbackInboxWranglerInvocation,
  extractFeedbackInboxResult,
  generateFeedbackInboxIdentity,
  parseFeedbackInboxArgs,
} from "./feedback-inbox.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const CONFIRM_PRODUCTION_RE = /--confirm-production/u;
const ORGANIZATION_NOT_FOUND_RE = /organization was not found/u;
const FEEDBACK_INBOX_ID_RE = /^feedback_inbox_[0-9a-f-]{36}$/u;
const FEEDBACK_INBOX_KEY_RE = /^feedback_key_[A-Za-z0-9_-]{43}$/u;

test("parses a local Feedback Inbox ensure command by default", () => {
  assert.deepEqual(
    parseFeedbackInboxArgs([
      "ensure",
      "--organization",
      "org_feedback",
      "--label",
      "OpenMeld Feedback",
    ]),
    {
      action: "ensure",
      confirmProduction: false,
      dryRun: false,
      environment: "local",
      label: "OpenMeld Feedback",
      organizationId: "org_feedback",
    }
  );
});

test("requires an explicit confirmation before targeting production", () => {
  assert.throws(
    () =>
      parseFeedbackInboxArgs([
        "ensure",
        "--organization",
        "org_feedback",
        "--label",
        "OpenMeld Feedback",
        "--env",
        "prod",
      ]),
    CONFIRM_PRODUCTION_RE
  );

  const parsed = parseFeedbackInboxArgs([
    "ensure",
    "--organization",
    "org_feedback",
    "--label",
    "OpenMeld Feedback",
    "--env",
    "prod",
    "--confirm-production",
  ]);
  assert.equal(parsed.environment, "prod");
  assert.equal(parsed.confirmProduction, true);
});

test("builds inbox-only SQL without the future direct delivery mode", () => {
  const sql = buildFeedbackInboxEnsureSql({
    createdAtMs: 1000,
    inboxId: "feedback_inbox_test",
    inboxKey: "feedback_key_test",
    label: "Felix's Feedback",
    organizationId: "org_feedback",
  });

  assert.ok(sql.includes("INSERT INTO openMeldFeedback_inboxes"));
  assert.ok(sql.includes("FROM organizations"));
  assert.ok(sql.includes("NOT EXISTS"));
  assert.ok(sql.includes("'inbox_only'"));
  assert.ok(sql.includes("'active'"));
  assert.ok(sql.includes("Felix''s Feedback"));
  assert.ok(!sql.includes("direct_to_ca"));
});

test("the generated SQL is idempotent for one organization", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE organizations (id text PRIMARY KEY NOT NULL, name text NOT NULL, slug text NOT NULL, created_at integer NOT NULL);"
    );
    db.exec(
      normalizeMigration(
        await readFile(
          path.join(
            repoRoot,
            "packages/db/drizzle/0021_curious_dark_phoenix.sql"
          ),
          "utf8"
        )
      )
    );
    db.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
    ).run("org_feedback", "Feedback Org", "feedback-org", 1);

    db.exec(
      buildFeedbackInboxEnsureSql({
        createdAtMs: 1000,
        inboxId: "feedback_inbox_first",
        inboxKey: "feedback_key_first",
        label: "OpenMeld Feedback",
        organizationId: "org_feedback",
      })
    );
    db.exec(
      buildFeedbackInboxEnsureSql({
        createdAtMs: 2000,
        inboxId: "feedback_inbox_second",
        inboxKey: "feedback_key_second",
        label: "OpenMeld Feedback Again",
        organizationId: "org_feedback",
      })
    );

    assert.deepEqual(
      db
        .prepare(
          "SELECT inbox_id AS inboxId, inbox_key AS inboxKey FROM openMeldFeedback_inboxes WHERE organization_id = ?"
        )
        .all("org_feedback")
        .map((row) => ({ ...row })),
      [
        {
          inboxId: "feedback_inbox_first",
          inboxKey: "feedback_key_first",
        },
      ]
    );
  } finally {
    db.close();
  }
});

test("builds lane-safe local and guarded remote Wrangler invocations", () => {
  const local = buildFeedbackInboxWranglerInvocation({
    environment: "local",
    sql: "SELECT 1;",
  });
  assert.equal(local.command, "pnpm");
  assert.ok(local.args.includes("--local"));
  assert.deepEqual(
    local.args.slice(
      local.args.indexOf("--persist-to"),
      local.args.indexOf("--persist-to") + 2
    ),
    ["--persist-to", "../../.wrangler-dev-state"]
  );
  assert.ok(!local.args.includes("--remote"));

  const production = buildFeedbackInboxWranglerInvocation({
    environment: "prod",
    sql: "SELECT 1;",
  });
  assert.ok(production.args.includes("--remote"));
  assert.deepEqual(
    production.args.slice(
      production.args.indexOf("--env"),
      production.args.indexOf("--env") + 3
    ),
    ["--env", "prod", "--remote"]
  );
});

test("parses the captured Wrangler D1 JSON result shape", () => {
  const capturedWranglerResult = JSON.stringify([
    {
      results: [],
      success: true,
      meta: { duration: 0 },
    },
    {
      results: [
        {
          organizationId: "org_feedback",
          inboxId: "feedback_inbox_test",
          inboxKey: "feedback_key_test",
        },
      ],
      success: true,
      meta: { duration: 0 },
    },
  ]);

  assert.deepEqual(extractFeedbackInboxResult(capturedWranglerResult), {
    inboxId: "feedback_inbox_test",
    inboxKey: "feedback_key_test",
  });
  assert.throws(
    () => extractFeedbackInboxResult('[{"results":[],"success":true}]'),
    ORGANIZATION_NOT_FOUND_RE
  );
});

test("generates opaque Feedback-prefixed inbox identity", () => {
  const identity = generateFeedbackInboxIdentity();
  assert.match(identity.inboxId, FEEDBACK_INBOX_ID_RE);
  assert.match(identity.inboxKey, FEEDBACK_INBOX_KEY_RE);
});

function normalizeMigration(sql) {
  return sql.replaceAll("--> statement-breakpoint", "");
}
