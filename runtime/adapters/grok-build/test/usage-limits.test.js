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
          reason: "not_reported",
          resetsAt: null,
          status: "unavailable",
          usedPercent: null,
        },
      ]
    );
  }
});

test("decodes omitted proto3 zero only for a valid active unified billing period", () => {
  // Redacted live credits response documented by OpenUsage on 2026-07-06;
  // Grok's public GrokCreditsConfig descriptor defines an implicit float.
  const config = {
    currentPeriod: {
      end: "2026-07-10T04:01:09.238389+00:00",
      start: "2026-07-03T04:01:09.238389+00:00",
      type: "USAGE_PERIOD_TYPE_WEEKLY",
    },
    isUnifiedBillingUser: true,
  };
  const observedAt = "2026-07-06T08:00:00.000Z";
  const [limit] = projectGrokBuildUsageLimits({
    observedAt,
    response: { config },
  });
  assert.equal(limit.usedPercent, 0);
  assert.equal(limit.status, "available");
  assert.equal(limit.resetsAt, "2026-07-10T04:01:09.238Z");
  for (const invalidConfig of [
    { ...config, isUnifiedBillingUser: false },
    { ...config, creditUsagePercent: null },
    { ...config, creditUsagePercent: "0" },
    { ...config, currentPeriod: { ...config.currentPeriod, start: "invalid" } },
    { ...config, currentPeriod: { ...config.currentPeriod, type: "UNKNOWN" } },
  ]) {
    const [unknown] = projectGrokBuildUsageLimits({
      observedAt,
      response: { config: invalidConfig },
    });
    assert.equal(unknown.usedPercent, null);
    assert.equal(unknown.reason, "not_reported");
    assert.equal(unknown.resetsAt, limit.resetsAt);
  }
  const [expired] = projectGrokBuildUsageLimits({
    observedAt: "2026-07-10T04:01:10.000Z",
    response: { config },
  });
  assert.equal(expired.usedPercent, null);
});
