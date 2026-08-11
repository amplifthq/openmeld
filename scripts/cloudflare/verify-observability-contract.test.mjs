import assert from "node:assert/strict";
import test from "node:test";

import { verifyObservabilityContract } from "./verify-observability-contract.mjs";

const EXCEEDS_CLOUDFLARE_LIMIT_RE = /exceed Cloudflare limit/u;
const MISSING_REQUIRED_OBSERVABILITY_BLOB_RE =
  /Missing required observability blob/u;
const SENSITIVE_FIELD_RE = /Sensitive field/u;

test("accepts a compact main-chain Cloudflare Analytics Engine projection", () => {
  const result = verifyObservabilityContract({
    contract: {
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
      blobColumns: new Map(
        [
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
        ].map((field, index) => [field, `blob${String(index + 1)}`])
      ),
      doubles: ["count", "durationMs"],
    },
  });

  assert.deepEqual(result, { errors: [], ok: true });
});

test("rejects sensitive and oversized Analytics Engine projections", () => {
  const fields = Array.from({ length: 21 }, (_value, index) =>
    index === 0 ? "token" : `field${String(index)}`
  );

  const result = verifyObservabilityContract({
    contract: {
      blobColumns: new Map(
        fields.map((field, index) => [field, `blob${index}`])
      ),
      blobs: fields,
      doubles: [],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), EXCEEDS_CLOUDFLARE_LIMIT_RE);
  assert.match(result.errors.join("\n"), SENSITIVE_FIELD_RE);
  assert.match(
    result.errors.join("\n"),
    MISSING_REQUIRED_OBSERVABILITY_BLOB_RE
  );
});
