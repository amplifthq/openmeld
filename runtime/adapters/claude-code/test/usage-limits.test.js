import assert from "node:assert/strict";
import test from "node:test";

const {
  projectClaudeCodeUsageLimits,
  projectClaudeCodeAccountUsageLimits,
  probeClaudeCodeUsageLimits,
} = await import("../dist/index.js");

// SDKControlGetUsageResponse in the upstream 0.3.286 sdk.d.ts: account
// utilization is a percentage, independently of the event's fraction.
const accountUsage = {
  session: {
    total_cost_usd: 0,
    total_api_duration_ms: 0,
    total_duration_ms: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    model_usage: {},
  },
  subscription_type: "pro",
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 0.9, resets_at: "2026-10-01T13:00:00Z" },
    seven_day: { utilization: null, resets_at: "2026-10-08T00:00:00Z" },
    model_scoped: [
      { display_name: "Fable", utilization: 100, resets_at: null },
    ],
    extra_usage: {
      is_enabled: true,
      monthly_limit: 100,
      used_credits: 20,
      utilization: 20,
    },
  },
  behaviors: null,
};

test("reads account percentages and dynamic model windows without projecting billing data", () => {
  const limits = projectClaudeCodeAccountUsageLimits({
    value: accountUsage,
    observedAt: "2026-10-01T08:00:00Z",
  });
  assert.equal(limits.length, 3);
  assert.equal(limits[0].usedPercent, 0.9);
  assert.equal(limits[1].reason, "not_reported");
  assert.equal(limits[1].resetsAt, "2026-10-08T00:00:00.000Z");
  assert.equal(limits[2].status, "exhausted");
  assert.equal(limits[2].key, "claude-code:seven-day-fable");
  assert.ok(!JSON.stringify(limits).includes("credits"));
  const unavailable = projectClaudeCodeAccountUsageLimits({
    value: { ...accountUsage, rate_limits_available: false, rate_limits: null },
    observedAt: "2026-10-01T08:00:00Z",
  });
  assert.equal(unavailable[0].reason, "not_applicable");
});

test("the control probe never sends a prompt or reads behaviors and refuses a different account", async () => {
  for (const email of ["owner@example.com", "other@example.com"]) {
    let prompt;
    let closed = false;
    let usageRequested = false;
    const limits = await probeClaudeCodeUsageLimits({
      expectedEmail: "owner@example.com",
      launchContract: { kind: "executable", commandPath: "/fake/claude" },
      workingDirectory: "/tmp",
      observedAt: "2026-10-01T08:00:00Z",
      queryFn: (input) => {
        prompt = input.prompt;
        assert.equal(input.options.persistSession, false);
        assert.deepEqual(input.options.allowedTools, []);
        assert.deepEqual(input.options.mcpServers, {});
        assert.equal(input.options.strictMcpConfig, true);
        assert.equal(input.options.settings.disableAllHooks, true);
        return {
          initializationResult: async () => ({
            account: { email, apiProvider: "firstParty", apiKeySource: "none" },
          }),
          usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: (
            options
          ) => {
            usageRequested = true;
            assert.deepEqual(options, { skipBehaviors: true });
            return Promise.resolve(accountUsage);
          },
          close: () => {
            closed = true;
          },
        };
      },
    });
    assert.equal(closed, true);
    assert.equal((await prompt.next()).done, true);
    assert.equal(usageRequested, email === "owner@example.com");
    assert.equal(
      limits[0].usedPercent,
      email === "owner@example.com" ? 0.9 : null
    );
  }
});

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

test("projects every primary window from Claude Code unifiedWindows events", () => {
  // This shape was captured from a live Claude.ai OAuth rate_limit_event in
  // BytePioneer-AI/codex-host@e11f02c2d210373619b7e07a68874deca5fd8e7a.
  assert.deepEqual(
    projectClaudeCodeUsageLimits({
      event: {
        rate_limit_info: {
          isUsingOverage: false,
          overageDisabledReason: "org_level_disabled",
          overageStatus: "rejected",
          rateLimitType: "five_hour",
          resetsAt: 1_787_674_200,
          status: "allowed",
          unifiedWindows: {
            five_hour: {
              resetsAt: 1_787_674_200,
              utilization: 0.28,
            },
            seven_day: {
              resetsAt: 1_787_940_000,
              utilization: 0.1,
            },
          },
        },
        session_id: "must-not-be-projected",
        type: "rate_limit_event",
        uuid: "must-not-be-projected",
      },
      observedAt: "2026-08-25T10:00:00.000Z",
    }),
    [
      {
        key: "claude-code:five-hour",
        label: "5-hour usage limit",
        observedAt: "2026-08-25T10:00:00.000Z",
        resetsAt: "2026-08-25T16:10:00.000Z",
        status: "available",
        usedPercent: 28,
      },
      {
        key: "claude-code:seven-day",
        label: "Weekly usage limit",
        observedAt: "2026-08-25T10:00:00.000Z",
        resetsAt: "2026-08-28T18:00:00.000Z",
        status: "available",
        usedPercent: 10,
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
