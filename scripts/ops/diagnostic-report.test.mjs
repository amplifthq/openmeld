import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDiagnosticReportCloudflareCommands,
  buildDiagnosticReportLookupInvocation,
  buildDiagnosticReportLookupSql,
  buildDiagnosticReportTraceCommands,
  extractDiagnosticReportRowsFromWranglerJson,
  parseDiagnosticReportOpsArgs,
} from "./diagnostic-report.mjs";

const DIAGNOSTIC_REPORT_LOOKUP_SQL_RE =
  /WHERE r\.diagnostic_report_id = 'diag_123'/u;
const QUOTED_DIAGNOSTIC_REPORT_LOOKUP_SQL_RE =
  /WHERE r\.diagnostic_report_id = 'diag_''quoted'/u;

test("builds a remote D1 Diagnostic Report lookup", () => {
  const parsed = parseDiagnosticReportOpsArgs([
    "--diagnostic-report",
    "diag_123",
    "--env",
    "prod",
  ]);
  const invocation = buildDiagnosticReportLookupInvocation(parsed);

  assert.equal(invocation.command, "pnpm");
  assert.deepEqual(invocation.args.slice(2, 11), [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "OPENMELD_DB",
    "--env",
    "prod",
    "--remote",
    "--json",
  ]);
  assert.match(invocation.args.at(-1), DIAGNOSTIC_REPORT_LOOKUP_SQL_RE);
});

test("escapes Diagnostic Report ids in D1 lookup SQL", () => {
  assert.match(
    buildDiagnosticReportLookupSql("diag_'quoted"),
    QUOTED_DIAGNOSTIC_REPORT_LOOKUP_SQL_RE
  );
});

test("extracts rows from Wrangler D1 JSON output", () => {
  assert.deepEqual(
    extractDiagnosticReportRowsFromWranglerJson(
      JSON.stringify([
        { success: true, results: [{ diagnosticReportId: "diag" }] },
      ])
    ),
    [{ diagnosticReportId: "diag" }]
  );
});

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
        "--profile",
        "operator",
        "--gateway-url",
        "https://gateway.example.com",
      ],
    ]
  );
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
