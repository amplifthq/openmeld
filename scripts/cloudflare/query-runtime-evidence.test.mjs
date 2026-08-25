import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnalyticsEngineRequest,
  buildAnalyticsEngineSql,
  buildRuntimeEvidenceFilters,
  parseQueryRuntimeEvidenceArgs,
} from "./query-runtime-evidence.mjs";

const CLIENT_MESSAGE_FILTER_RE = /blob7 = 'cm_123'/u;
const TIMING_AGGREGATE_EVENT_RE =
  /blob1 = 'core\.openmeld\.dispatch\.queue_server_timing'/u;
const TIMING_AGGREGATE_GROUP_RE = /GROUP BY reasonCode/u;
const TIMING_AVG_RE = /avg\(double2\) AS avgDurationMs/u;
const TIMING_WEIGHTED_AVG_RE =
  /sum\(double2 \* _sample_interval\) \/ sum\(_sample_interval\) AS avgDurationMs/u;
const TIMING_P50_RE =
  /quantileExactWeighted\(0\.50\)\(double2, _sample_interval\) AS p50DurationMs/u;
const TIMING_P95_RE =
  /quantileExactWeighted\(0\.95\)\(double2, _sample_interval\) AS p95DurationMs/u;
const TIMING_P99_RE =
  /quantileExactWeighted\(0\.99\)\(double2, _sample_interval\) AS p99DurationMs/u;
const CONTRACT = {
  blobs: [
    "event",
    "workerName",
    "runtimeKind",
    "status",
    "reasonCode",
    "spaceId",
    "clientMessageId",
    "sourceSignalId",
    "targetProfileId",
    "dispatchId",
    "runtimeCoordinatorExecutionId",
    "latestAttemptId",
    "claimLeaseId",
    "bindingId",
    "openMeldServiceRuntimeId",
    "agentControllerRef",
    "resultRef",
    "publishedSignalId",
    "replySignalId",
    "requestId",
  ],
  blobColumns: new Map([
    ["event", "blob1"],
    ["workerName", "blob2"],
    ["runtimeKind", "blob3"],
    ["status", "blob4"],
    ["reasonCode", "blob5"],
    ["spaceId", "blob6"],
    ["clientMessageId", "blob7"],
    ["sourceSignalId", "blob8"],
    ["targetProfileId", "blob9"],
    ["dispatchId", "blob10"],
    ["runtimeCoordinatorExecutionId", "blob11"],
    ["latestAttemptId", "blob12"],
    ["claimLeaseId", "blob13"],
    ["bindingId", "blob14"],
    ["openMeldServiceRuntimeId", "blob15"],
    ["agentControllerRef", "blob16"],
    ["resultRef", "blob17"],
    ["publishedSignalId", "blob18"],
    ["replySignalId", "blob19"],
    ["requestId", "blob20"],
  ]),
  doubles: [
    "count",
    "durationMs",
    "statusCode",
    "messageCount",
    "activationTargetCount",
    "inputBytes",
    "toolCount",
  ],
  doubleColumns: new Map([
    ["count", "double1"],
    ["durationMs", "double2"],
    ["statusCode", "double3"],
    ["messageCount", "double4"],
    ["activationTargetCount", "double5"],
    ["inputBytes", "double6"],
    ["toolCount", "double7"],
  ]),
};
const DATASET_OPTION_RE = /--dataset/;
const FORMAT_JSON_EACH_ROW_RE = /FORMAT JSONEachRow/u;
const LIMIT_25_RE = /LIMIT 25/u;
const QUOTED_CLIENT_MESSAGE_FILTER_RE = /blob7 = 'cm_''quoted'/u;
const RUNTIME_EVIDENCE_TABLE_RE = /FROM openmeld_runtime_evidence/u;
const SIX_HOUR_INTERVAL_RE = /timestamp >= NOW\(\) - INTERVAL '6' HOUR/u;
const TARGET_PROFILE_FILTER_RE = /blob9 = 'agt_123'/u;
const UNKNOWN_OPTION_RE = /Unknown option/;

test("builds a historical Analytics Engine query from a client message selector", () => {
  const parsed = parseQueryRuntimeEvidenceArgs([
    "--client-message",
    "cm_123",
    "--target-profile",
    "agt_123",
    "--since",
    "6h",
    "--limit",
    "25",
  ]);

  const sql = buildAnalyticsEngineSql({ contract: CONTRACT, parsed });

  assert.match(sql, RUNTIME_EVIDENCE_TABLE_RE);
  assert.match(sql, SIX_HOUR_INTERVAL_RE);
  assert.match(sql, CLIENT_MESSAGE_FILTER_RE);
  assert.match(sql, TARGET_PROFILE_FILTER_RE);
  assert.match(sql, LIMIT_25_RE);
  assert.match(sql, FORMAT_JSON_EACH_ROW_RE);
});

test("filters final visible outcome evidence by reply signal", () => {
  const parsed = parseQueryRuntimeEvidenceArgs([
    "--reply-signal",
    "sig_reply_123",
  ]);

  assert.deepEqual(
    buildRuntimeEvidenceFilters({ contract: CONTRACT, parsed }),
    [
      {
        column: "blob19",
        field: "replySignalId",
        value: "sig_reply_123",
      },
    ]
  );
});

test("builds timing aggregate queries grouped by runtime evidence reason code", () => {
  const parsed = parseQueryRuntimeEvidenceArgs([
    "--event",
    "core.openmeld.dispatch.queue_server_timing",
    "--aggregate",
    "timing",
    "--since",
    "24h",
    "--limit",
    "20",
  ]);

  const sql = buildAnalyticsEngineSql({ contract: CONTRACT, parsed });

  assert.match(sql, TIMING_AGGREGATE_EVENT_RE);
  assert.match(sql, TIMING_AGGREGATE_GROUP_RE);
  assert.doesNotMatch(sql, TIMING_AVG_RE);
  assert.match(sql, TIMING_WEIGHTED_AVG_RE);
  assert.match(sql, TIMING_P50_RE);
  assert.match(sql, TIMING_P95_RE);
  assert.match(sql, TIMING_P99_RE);
  assert.match(sql, FORMAT_JSON_EACH_ROW_RE);
});

test("does not accept Diagnostic Report IDs as direct Analytics Engine selectors", () => {
  assert.throws(
    () => parseQueryRuntimeEvidenceArgs(["--diagnostic-report", "diag_123"]),
    UNKNOWN_OPTION_RE
  );
});

test("builds a Cloudflare SQL API request", () => {
  assert.deepEqual(
    buildAnalyticsEngineRequest({
      accountId: "account_123",
      apiToken: "token_123",
      sql: "SELECT 1",
    }),
    {
      body: "SELECT 1",
      headers: {
        Authorization: "Bearer token_123",
        "Content-Type": "text/plain",
      },
      method: "POST",
      url: "https://api.cloudflare.com/client/v4/accounts/account_123/analytics_engine/sql",
    }
  );
});

test("escapes selector values and rejects invalid table names", () => {
  const parsed = parseQueryRuntimeEvidenceArgs([
    "--dataset",
    "openmeld_runtime_evidence",
    "--client-message",
    "cm_'quoted",
  ]);

  assert.match(
    buildAnalyticsEngineSql({ contract: CONTRACT, parsed }),
    QUOTED_CLIENT_MESSAGE_FILTER_RE
  );
  assert.throws(
    () =>
      parseQueryRuntimeEvidenceArgs([
        "--dataset",
        "openmeld_runtime_evidence;DROP",
        "--client-message",
        "cm_123",
      ]),
    DATASET_OPTION_RE
  );
});
