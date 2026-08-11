import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRuntimeEvidenceAnalyticsContract,
  readRuntimeEvidenceAnalyticsContract,
} from "./runtime-evidence-contract.mjs";

test("reads the canonical Analytics Engine runtime evidence columns", () => {
  const contract = readRuntimeEvidenceAnalyticsContract();

  assert.equal(contract.blobs.length, 20);
  assert.equal(contract.doubles.length, 7);
  assert.equal(contract.blobColumns.get("clientMessageId"), "blob7");
  assert.equal(
    contract.blobColumns.get("runtimeCoordinatorExecutionId"),
    "blob11"
  );
  assert.equal(contract.blobColumns.get("bindingId"), "blob14");
  assert.equal(contract.blobColumns.get("openMeldServiceRuntimeId"), "blob15");
  assert.equal(contract.doubleColumns.get("inputBytes"), "double6");
  assert.equal(contract.doubleColumns.get("toolCount"), "double7");
});

test("parses canonical string arrays from schema source text", () => {
  const contract = parseRuntimeEvidenceAnalyticsContract(`
    export const OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS = [
      "event",
      "workerName",
    ] as const;
    export const OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES = [
      "count",
    ] as const;
  `);

  assert.deepEqual(contract.blobs, ["event", "workerName"]);
  assert.deepEqual(contract.doubles, ["count"]);
  assert.equal(contract.blobColumns.get("workerName"), "blob2");
});
