import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  connect,
  grantRuntime,
  migrate,
} from "../../tooling/postgresql/database.mjs";

import {
  buildDiagnosticReportCloudflareCommands,
  buildDiagnosticReportLookupQuery,
  buildDiagnosticReportTraceCommands,
  lookupDiagnosticReportRows,
  parseDiagnosticReportOpsArgs,
  verifyDiagnosticReportDatabaseTarget,
} from "./diagnostic-report.mjs";

test("binds report IDs as PostgreSQL parameters", () => {
  const query = buildDiagnosticReportLookupQuery("diag_'quoted");
  assert.deepEqual(query.values, ["diag_'quoted"]);
  assert.ok(query.text.includes("r.diagnostic_report_id = $1"));
  assert.ok(
    query.text.includes('openmeld."openMeldDaemon_space_diagnostic_reports"')
  );
  assert.ok(!query.text.includes("diag_'quoted"));
});

test("rejects mismatched remote roles/branches and non-isolated local targets", async () => {
  const inventory = JSON.parse(
    await readFile(
      new URL("../../tooling/postgresql/resources.json", import.meta.url),
      "utf8"
    )
  );
  const entry = inventory.environments.production;
  const parsed = parseDiagnosticReportOpsArgs([
    "--diagnostic-report",
    "diag_123",
  ]);
  const url = `postgresql://${entry.runtimeRole}.${entry.branchId}:synthetic@${entry.host}:5432/postgres`;
  assert.doesNotThrow(() =>
    verifyDiagnosticReportDatabaseTarget(parsed, url, inventory)
  );
  assert.throws(() =>
    verifyDiagnosticReportDatabaseTarget(
      { ...parsed, env: "stg" },
      url,
      inventory
    )
  );
  assert.throws(() =>
    verifyDiagnosticReportDatabaseTarget(
      parsed,
      url.replace(entry.runtimeRole, entry.migrationRole),
      inventory
    )
  );
  assert.throws(() =>
    verifyDiagnosticReportDatabaseTarget(
      { ...parsed, remote: false },
      "postgresql://fixture:synthetic@127.0.0.1:5432/openmeld_pg_local",
      inventory,
      {}
    )
  );
  assert.throws(() =>
    verifyDiagnosticReportDatabaseTarget(
      { ...parsed, remote: false },
      url,
      inventory,
      { OPENMELD_PG_ISOLATED: "1" }
    )
  );
});

test(
  "resolves the current migrated PostgreSQL report and its Wake pointers",
  { skip: process.env.OPENMELD_PG_ISOLATED !== "1" },
  async () => {
    const owner = await connect(
      process.env.POSTGRESQL_OPENMELD_MIGRATION_URL,
      true
    );
    try {
      await migrate(owner);
      await grantRuntime(owner, "openmeld_pg_runtime");
      await owner.query(
        `INSERT INTO openmeld."openMeldDaemon_space_diagnostic_reports" (diagnostic_report_id,space_id,reported_signal_id,problem_type,reporter_profile_id,wake_pointer_derivation_status,reason_codes_json,created_at_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          "diag_pg",
          "space_pg",
          "signal_pg",
          "no_reply",
          "profile_pg",
          "exact",
          "[]",
          Date.now(),
        ]
      );
      await owner.query(
        `INSERT INTO openmeld."openMeldDaemon_space_diagnostic_report_wake_pointers" (diagnostic_report_id,space_id,client_message_id,source_signal_id,target_profile_id,created_at_ms) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          "diag_pg",
          "space_pg",
          "client_pg",
          "signal_pg",
          "agent_pg",
          Date.now(),
        ]
      );
      const client = await connect(
        process.env.POSTGRESQL_OPENMELD_RUNTIME_URL,
        true
      );
      try {
        const rows = await lookupDiagnosticReportRows({
          client,
          diagnosticReportId: "diag_pg",
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].clientMessageId, "client_pg");
        assert.equal(rows[0].targetProfileId, "agent_pg");
        assert.equal(rows[0].diagnosticReportId, "diag_pg");
        assert.deepEqual(
          await lookupDiagnosticReportRows({
            client,
            diagnosticReportId: "diag_pg' OR '1'='1",
          }),
          []
        );
        assert.equal(
          (
            await lookupDiagnosticReportRows({
              client,
              diagnosticReportId: "diag_pg",
            })
          ).length,
          1
        );
      } finally {
        await client.end();
      }
    } finally {
      await owner.end();
    }
  }
);

test("builds trace commands from derived wake pointers", () => {
  const parsed = parseDiagnosticReportOpsArgs([
    "--diagnostic-report",
    "diag_123",
    "--cli",
    "openmeld",
    "--profile",
    "operator",
    "--gateway-url",
    "https://gateway.example.com",
  ]);

  assert.deepEqual(
    buildDiagnosticReportTraceCommands({
      parsed,
      rows: [
        {
          clientMessageId: "cm_123",
          spaceId: "sp_123",
          targetProfileId: "agt_123",
        },
      ],
    }),
    [
      [
        "pnpm",
        "ops:trace",
        "--cli",
        "openmeld",
        "--space",
        "sp_123",
        "--client-message",
        "cm_123",
        "--target-profile",
        "agt_123",
        "--no-cf-hints",
        "--view",
        "agent",
        "--profile",
        "operator",
        "--gateway-url",
        "https://gateway.example.com",
      ],
    ]
  );
});

test("never copies a provided Space password into generated commands", () => {
  const parsed = parseDiagnosticReportOpsArgs([
    "--diagnostic-report",
    "diag_123",
    "--password",
    "private-space-password",
  ]);
  const commands = buildDiagnosticReportTraceCommands({
    parsed,
    rows: [
      { spaceId: "space", clientMessageId: "client", targetProfileId: "agent" },
    ],
  });
  assert.ok(!JSON.stringify(commands).includes("private-space-password"));
  assert.ok(commands[0].includes("<space-password>"));
});

test("builds Cloudflare query commands from derived Wake pointers", () => {
  assert.deepEqual(
    buildDiagnosticReportCloudflareCommands({
      rows: [
        {
          clientMessageId: "cm_123",
          spaceId: "sp_123",
          sourceSignalId: "sig_123",
          targetProfileId: "agt_123",
        },
        {
          clientMessageId: "cm_123",
          spaceId: "sp_123",
          sourceSignalId: "sig_123",
          targetProfileId: "agt_123",
        },
        {
          clientMessageId: null,
          spaceId: "sp_123",
          sourceSignalId: "sig_456",
          targetProfileId: "agt_456",
        },
      ],
    }),
    [
      [
        "pnpm",
        "ops:cf:query",
        "--space",
        "sp_123",
        "--client-message",
        "cm_123",
        "--target-profile",
        "agt_123",
      ],
      [
        "pnpm",
        "ops:cf:query",
        "--space",
        "sp_123",
        "--source-signal",
        "sig_456",
        "--target-profile",
        "agt_456",
      ],
    ]
  );
});
