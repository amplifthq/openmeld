import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCenterAgentPerformanceSql,
  parseCenterAgentPerformanceArgs,
} from "./query-center-agent-performance.mjs";

const CONTRACT = {
  blobColumns: new Map([
    ["milestone", "blob1"],
    ["triggerSource", "blob2"],
    ["modelId", "blob3"],
    ["status", "blob4"],
    ["organizationId", "blob6"],
    ["spaceId", "blob7"],
  ]),
  doubleColumns: new Map([["elapsedFromAdmissionMs", "double2"]]),
};
const SLACK_FILTER_PATTERN = /blob2 = 'slack'/u;
const MODEL_FILTER_PATTERN = /blob3 = 'openai\/gpt-5\.4'/u;
const GROUPING_PATTERN = /GROUP BY milestone, triggerSource, modelId/u;
const WEIGHTED_P95_PATTERN =
  /quantileExactWeighted\(0\.95\)\(double2, _sample_interval\) AS p95ElapsedMs/u;
const WEIGHTED_AVERAGE_PATTERN =
  /sum\(double2 \* _sample_interval\) \/ sum\(_sample_interval\) AS avgElapsedMs/u;
const DATASET_NAME_ERROR_PATTERN = /simple Analytics Engine table name/u;

test("groups weighted Center Agent latency by milestone, channel, and model", () => {
  const parsed = parseCenterAgentPerformanceArgs([
    "--trigger-source",
    "slack",
    "--model",
    "openai/gpt-5.4",
    "--since",
    "24h",
  ]);
  const sql = buildCenterAgentPerformanceSql({ contract: CONTRACT, parsed });

  assert.match(sql, SLACK_FILTER_PATTERN);
  assert.match(sql, MODEL_FILTER_PATTERN);
  assert.match(sql, GROUPING_PATTERN);
  assert.match(sql, WEIGHTED_P95_PATTERN);
  assert.match(sql, WEIGHTED_AVERAGE_PATTERN);
});

test("rejects SQL-shaped dataset names", () => {
  assert.throws(
    () =>
      parseCenterAgentPerformanceArgs([
        "--dataset",
        "openmeld_center_agent_performance;DROP",
      ]),
    DATASET_NAME_ERROR_PATTERN
  );
});
