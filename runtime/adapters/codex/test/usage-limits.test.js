import assert from "node:assert/strict";
import test from "node:test";
import { projectCodexUsageLimits } from "../dist/index.js";

const OBSERVED_AT = "2026-08-20T08:00:00.000Z";

test("projects Codex multi-bucket, multi-window rate limits without account metadata", () => {
  const limits = projectCodexUsageLimits({
    observedAt: OBSERVED_AT,
    response: {
      credits: { balance: "private" },
      planType: "private",
      rateLimitsByLimitId: {
        codex: {
          credits: { balance: "private" },
          limitId: "codex",
          primary: {
            resetsAt: 1_787_233_614,
            usedPercent: 82,
            windowDurationMins: 300,
          },
          secondary: {
            resetsAt: 1_787_820_414,
            usedPercent: 100,
            windowDurationMins: 10_080,
          },
        },
        codex_spark: {
          limitId: "codex_spark",
          limitName: "GPT-5.3-Codex-Spark",
          primary: {
            resetsAt: null,
            usedPercent: 15,
            windowDurationMins: 10_080,
          },
        },
      },
    },
  });

  assert.deepEqual(limits, [
    {
      key: "codex:primary",
      label: "5-hour usage",
      observedAt: OBSERVED_AT,
      resetsAt: "2026-08-20T13:46:54.000Z",
      status: "available",
      usedPercent: 82,
    },
    {
      key: "codex:secondary",
      label: "Weekly usage",
      observedAt: OBSERVED_AT,
      resetsAt: "2026-08-27T08:46:54.000Z",
      status: "exhausted",
      usedPercent: 100,
    },
    {
      key: "codex_spark:primary",
      label: "GPT-5.3-Codex-Spark weekly usage",
      observedAt: OBSERVED_AT,
      resetsAt: null,
      status: "available",
      usedPercent: 15,
    },
  ]);
  assert.equal(JSON.stringify(limits).includes("private"), false);
  assert.equal(JSON.stringify(limits).includes("credits"), false);
  assert.equal(JSON.stringify(limits).includes("planType"), false);
});

test("returns unavailable evidence when Codex reports no usable windows", () => {
  assert.deepEqual(
    projectCodexUsageLimits({
      observedAt: OBSERVED_AT,
      response: { rateLimits: {} },
    }),
    [
      {
        key: "provider",
        label: "Usage limits",
        observedAt: OBSERVED_AT,
        resetsAt: null,
        status: "unavailable",
        usedPercent: null,
      },
    ]
  );
});

test("rejects provider percentages outside the shared zero-to-100 range", () => {
  const limits = projectCodexUsageLimits({
    observedAt: OBSERVED_AT,
    response: {
      rateLimits: {
        primary: { usedPercent: 120, windowDurationMins: 300 },
        secondary: { usedPercent: -5, windowDurationMins: 10_080 },
      },
    },
  });

  assert.deepEqual(limits, [
    {
      key: "provider",
      label: "Usage limits",
      observedAt: OBSERVED_AT,
      resetsAt: null,
      status: "unavailable",
      usedPercent: null,
    },
  ]);
});
