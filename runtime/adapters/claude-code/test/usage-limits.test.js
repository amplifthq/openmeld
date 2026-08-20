import assert from "node:assert/strict";
import test from "node:test";

const { projectClaudeCodeUsageLimits } = await import("../dist/index.js");

test("projects a native Claude SDK rate-limit event into 0-100 semantics", () => {
  assert.deepEqual(
    projectClaudeCodeUsageLimits({
      event: {
        rate_limit_info: {
          hasChargeableSavedPaymentMethod: true,
          isUsingOverage: true,
          rateLimitType: "five_hour",
          resetsAt: 1_787_191_200,
          status: "allowed_warning",
          utilization: 0.875,
        },
        session_id: "must-not-be-projected",
        type: "rate_limit_event",
      },
      observedAt: "2026-08-20T10:00:00.000Z",
    }),
    [
      {
        key: "claude-code:five-hour",
        label: "5-hour usage limit",
        observedAt: "2026-08-20T10:00:00.000Z",
        resetsAt: "2026-08-20T02:00:00.000Z",
        status: "available",
        usedPercent: 87.5,
      },
    ]
  );
});

test("supports provider-reported shared and model weekly windows", () => {
  const cases = [
    ["seven_day", "claude-code:seven-day", "Weekly usage limit"],
    ["seven_day_opus", "claude-code:seven-day-opus", "Opus weekly usage limit"],
    [
      "seven_day_sonnet",
      "claude-code:seven-day-sonnet",
      "Sonnet weekly usage limit",
    ],
  ];
  for (const [rateLimitType, key, label] of cases) {
    const [limit] = projectClaudeCodeUsageLimits({
      event: {
        rate_limit_info: {
          rateLimitType,
          status: "allowed_warning",
          utilization: 0.4,
        },
        type: "rate_limit_event",
      },
      observedAt: "2026-08-20T10:00:00.000Z",
    });
    assert.equal(limit?.key, key);
    assert.equal(limit?.label, label);
    assert.equal(limit?.usedPercent, 40);
  }
});

test("keeps missing utilization unknown even when Claude rejects the request", () => {
  assert.deepEqual(
    projectClaudeCodeUsageLimits({
      event: {
        rate_limit_info: {
          rateLimitType: "five_hour",
          resetsAt: 1_787_191_200,
          status: "allowed",
        },
        type: "rate_limit_event",
      },
      observedAt: "2026-08-20T10:00:00.000Z",
    }),
    []
  );

  assert.deepEqual(
    projectClaudeCodeUsageLimits({
      event: {
        rate_limit_info: {
          errorCode: "credits_required",
          rateLimitType: "seven_day",
          resetsAt: 1_787_191_200,
          status: "rejected",
        },
        type: "rate_limit_event",
      },
      observedAt: "2026-08-20T10:00:00.000Z",
    }),
    []
  );

  assert.deepEqual(
    projectClaudeCodeUsageLimits({
      event: {
        rate_limit_info: {
          rateLimitType: "seven_day",
          resetsAt: 1_787_191_200,
          status: "rejected",
          utilization: 1,
        },
        type: "rate_limit_event",
      },
      observedAt: "2026-08-20T10:00:00.000Z",
    }),
    [
      {
        key: "claude-code:seven-day",
        label: "Weekly usage limit",
        observedAt: "2026-08-20T10:00:00.000Z",
        resetsAt: "2026-08-20T02:00:00.000Z",
        status: "exhausted",
        usedPercent: 100,
      },
    ]
  );
});

test("rejects malformed percentages and payment-related limit types", () => {
  for (const utilization of [
    -0.01,
    1.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.deepEqual(
      projectClaudeCodeUsageLimits({
        event: {
          rate_limit_info: {
            rateLimitType: "five_hour",
            status: "allowed_warning",
            utilization,
          },
          type: "rate_limit_event",
        },
        observedAt: "2026-08-20T10:00:00.000Z",
      }),
      []
    );
  }
  assert.deepEqual(
    projectClaudeCodeUsageLimits({
      event: {
        rate_limit_info: {
          rateLimitType: "overage",
          status: "rejected",
          utilization: 1,
        },
        type: "rate_limit_event",
      },
      observedAt: "2026-08-20T10:00:00.000Z",
    }),
    []
  );
});
