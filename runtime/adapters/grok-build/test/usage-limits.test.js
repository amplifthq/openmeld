import assert from "node:assert/strict";
import test from "node:test";
import { projectGrokBuildUsageLimits } from "../dist/index.js";

const OBSERVED_AT = "2026-08-20T08:00:00.000Z";

test("projects only Grok Build's public percentage and reset evidence", () => {
  const limits = projectGrokBuildUsageLimits({
    observedAt: OBSERVED_AT,
    response: {
      config: {
        billingPeriodEnd: "private",
        creditUsagePercent: 23,
        currentPeriod: {
          end: "2026-08-24T15:45:59.058604+00:00",
          start: "private",
          type: "USAGE_PERIOD_TYPE_WEEKLY",
        },
        history: [{ private: true }],
        monthlyLimit: { private: true },
        onDemandCap: { val: 100 },
        onDemandUsed: { val: 20 },
        prepaidBalance: { val: 80 },
      },
      onDemandEnabled: true,
      subscriptionTier: "private",
    },
  });

  assert.deepEqual(limits, [
    {
      key: "grok-build:included-credits",
      label: "Weekly usage limit",
      observedAt: OBSERVED_AT,
      resetsAt: "2026-08-24T15:45:59.058Z",
      status: "available",
      usedPercent: 23,
    },
  ]);
  assert.equal(JSON.stringify(limits).includes("private"), false);
  assert.equal(JSON.stringify(limits).includes("Balance"), false);
  assert.equal(JSON.stringify(limits).includes("Tier"), false);
});

test("returns unavailable evidence for absent or invalid Grok Build usage", () => {
  for (const response of [
    {},
    { config: {} },
    { config: { creditUsagePercent: 101 } },
  ]) {
    assert.deepEqual(
      projectGrokBuildUsageLimits({ observedAt: OBSERVED_AT, response }),
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
  }
});
