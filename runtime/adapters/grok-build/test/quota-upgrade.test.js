import assert from "node:assert/strict";
import test from "node:test";
import {
  GrokBuildAcpTransportError,
  upgradePromptProtocolFailureWithExhaustedUsage,
} from "../dist/transport/grok-build-acp-transport.js";

function buildProtocolFailure() {
  return new GrokBuildAcpTransportError({
    code: "protocol.request_failed",
    errorType: "adapter",
    message: "protocol.request_failed: Internal error",
  });
}

test("upgrades a generic protocol failure when usage limits are exhausted", () => {
  const upgraded = upgradePromptProtocolFailureWithExhaustedUsage(
    buildProtocolFailure(),
    [
      {
        key: "grok-build:included-credits",
        label: null,
        observedAt: "2026-08-23T10:00:00.000Z",
        resetsAt: null,
        status: "exhausted",
        usedPercent: 100,
      },
    ]
  );
  assert.equal(upgraded.code, "grok-build.quota_or_entitlement");
  assert.equal(upgraded.errorType, "auth");
});

test("keeps the protocol failure when credits remain available", () => {
  const classified = buildProtocolFailure();
  const upgraded = upgradePromptProtocolFailureWithExhaustedUsage(classified, [
    {
      key: "grok-build:included-credits",
      label: null,
      observedAt: "2026-08-23T10:00:00.000Z",
      resetsAt: null,
      status: "available",
      usedPercent: 40,
    },
  ]);
  assert.equal(upgraded, classified);
});

test("keeps non-protocol failures untouched even when exhausted", () => {
  const classified = new GrokBuildAcpTransportError({
    code: "auth.failed",
    errorType: "auth",
    message: "auth.failed: unauthenticated",
  });
  const upgraded = upgradePromptProtocolFailureWithExhaustedUsage(classified, [
    {
      key: "grok-build:included-credits",
      label: null,
      observedAt: "2026-08-23T10:00:00.000Z",
      resetsAt: null,
      status: "exhausted",
      usedPercent: 100,
    },
  ]);
  assert.equal(upgraded, classified);
});
