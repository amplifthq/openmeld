#!/usr/bin/env node
import { readRuntimeEvidenceAnalyticsContract } from "./runtime-evidence-contract.mjs";

const MAX_ANALYTICS_ENGINE_BLOBS = 20;
const MAX_ANALYTICS_ENGINE_DOUBLES = 20;
const REQUIRED_MAIN_CHAIN_BLOBS = [
  "event",
  "workerName",
  "status",
  "reasonCode",
  "spaceId",
  "clientMessageId",
  "sourceSignalId",
  "targetProfileId",
  "dispatchId",
  "runtimeCoordinatorExecutionId",
  "latestAttemptId",
  "bindingId",
  "openMeldServiceRuntimeId",
  "agentControllerRef",
  "resultRef",
  "publishedSignalId",
  "replySignalId",
  "requestId",
];
const FORBIDDEN_SENSITIVE_FIELD_PATTERNS = [
  /cookie/iu,
  /messageText/iu,
  /password/iu,
  /prompt/iu,
  /secret/iu,
  /token/iu,
];

export function verifyObservabilityContract(input = {}) {
  const contract = input.contract ?? readRuntimeEvidenceAnalyticsContract();
  const errors = [];

  if (contract.blobs.length > MAX_ANALYTICS_ENGINE_BLOBS) {
    errors.push(
      `Analytics Engine blobs exceed Cloudflare limit: ${String(
        contract.blobs.length
      )}/${String(MAX_ANALYTICS_ENGINE_BLOBS)}`
    );
  }
  if (contract.doubles.length > MAX_ANALYTICS_ENGINE_DOUBLES) {
    errors.push(
      `Analytics Engine doubles exceed Cloudflare limit: ${String(
        contract.doubles.length
      )}/${String(MAX_ANALYTICS_ENGINE_DOUBLES)}`
    );
  }

  for (const field of REQUIRED_MAIN_CHAIN_BLOBS) {
    if (!contract.blobColumns.has(field)) {
      errors.push(`Missing required observability blob: ${field}`);
    }
  }

  for (const field of [...contract.blobs, ...contract.doubles]) {
    for (const pattern of FORBIDDEN_SENSITIVE_FIELD_PATTERNS) {
      if (pattern.test(field)) {
        errors.push(`Sensitive field must not be projected: ${field}`);
      }
    }
  }

  return {
    errors,
    ok: errors.length === 0,
  };
}

if (process.argv[1]?.endsWith("verify-observability-contract.mjs")) {
  const result = verifyObservabilityContract();
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exit(1);
  }
  console.log("Observability contract verification passed.");
}
