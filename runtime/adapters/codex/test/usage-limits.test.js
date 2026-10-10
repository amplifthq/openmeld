import assert from "node:assert/strict";
import test from "node:test";
import {
  projectCodexUsageObservation,
  readCodexAccountUsageObservation,
} from "../dist/index.js";

const OBSERVED_AT = "2026-08-20T08:00:00.000Z";

test("projects Codex multi-bucket, multi-window rate limits without account metadata", () => {
  const { usageLimits: limits } = projectCodexUsageObservation({
    source: "account_read",
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
    projectCodexUsageObservation({
      source: "account_read",
      observedAt: OBSERVED_AT,
      response: { rateLimits: {} },
    }).usageLimits,
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

test("separates included-window usage from backend account capacity without exposing credit details", () => {
  // Captured from the same Service executable's native account/rateLimits/read
  // on 2026-10-09. Private account and monetary values are anonymized.
  const captured = {
    ordinaryUsageAllowed: false,
    rateLimits: {
      limitId: "codex",
      primary: {
        usedPercent: 100,
        windowDurationMins: 10_080,
        resetsAt: 1_792_045_608,
      },
      secondary: null,
      credits: { hasCredits: true, unlimited: false, balance: "10" },
      spendControlReached: false,
      rateLimitReachedType: "rate_limit_reached",
    },
  };
  for (const [name, response, expectedBlock] of [
    ["remaining credits", captured, false],
    [
      "unlimited credits",
      {
        ...captured,
        rateLimits: {
          ...captured.rateLimits,
          credits: { hasCredits: false, unlimited: true, balance: null },
        },
      },
      false,
    ],
    [
      "no remaining capacity",
      {
        ...captured,
        rateLimits: {
          ...captured.rateLimits,
          credits: { hasCredits: false, unlimited: false, balance: "0" },
        },
      },
      true,
    ],
    [
      "spend control",
      {
        ...captured,
        rateLimits: { ...captured.rateLimits, spendControlReached: true },
      },
      true,
    ],
    [
      "unknown included permission",
      { ...captured, ordinaryUsageAllowed: null },
      null,
    ],
    [
      "unknown spend control",
      {
        ...captured,
        rateLimits: { ...captured.rateLimits, spendControlReached: null },
      },
      null,
    ],
    [
      "unknown credits",
      { ...captured, rateLimits: { ...captured.rateLimits, credits: null } },
      null,
    ],
    [
      "contradictory zero credits",
      {
        ...captured,
        rateLimits: {
          ...captured.rateLimits,
          credits: { hasCredits: true, unlimited: false, balance: "0" },
        },
      },
      null,
    ],
    [
      "contradictory positive credits",
      {
        ...captured,
        rateLimits: {
          ...captured.rateLimits,
          credits: { hasCredits: false, unlimited: false, balance: "10" },
        },
      },
      null,
    ],
    [
      "malformed credits",
      {
        ...captured,
        rateLimits: {
          ...captured.rateLimits,
          credits: { hasCredits: true, unlimited: false, balance: "unknown" },
        },
      },
      null,
    ],
    [
      "unrelated exhausted bucket",
      {
        ...captured,
        ordinaryUsageAllowed: true,
        rateLimitsByLimitId: {
          codex: captured.rateLimits,
          other: { limitId: "other", primary: { usedPercent: 100 } },
        },
      },
      false,
    ],
  ]) {
    const observation = projectCodexUsageObservation({
      observedAt: OBSERVED_AT,
      response,
      source: "account_read",
    });
    const limits = observation.usageLimits;
    assert.equal(limits[0].status, "exhausted", name);
    assert.equal(limits[0].usedPercent, 100, name);
    assert.deepEqual(
      observation.usageAdmission,
      { blocksNewWork: expectedBlock, observedAt: OBSERVED_AT },
      name
    );
    for (const limit of limits) {
      assert.equal("blocksNewWork" in limit, false, name);
    }
    assert.equal(JSON.stringify(observation).includes("balance"), false, name);
    assert.equal(JSON.stringify(observation).includes("credits"), false, name);
  }
  const noWindows = projectCodexUsageObservation({
    source: "account_read",
    observedAt: OBSERVED_AT,
    response: {
      ...captured,
      ordinaryUsageAllowed: true,
      rateLimits: { ...captured.rateLimits, primary: null },
    },
  });
  assert.equal(noWindows.usageLimits[0].status, "unavailable");
  assert.deepEqual(noWindows.usageAdmission, {
    blocksNewWork: false,
    observedAt: OBSERVED_AT,
  });
  const sparseUpdate = projectCodexUsageObservation({
    observedAt: OBSERVED_AT,
    response: { rateLimits: captured.rateLimits },
    source: "rolling_update",
  });
  assert.equal(sparseUpdate.usageAdmission, undefined);
});

test("rejects provider percentages outside the shared zero-to-100 range", () => {
  const { usageLimits: limits } = projectCodexUsageObservation({
    source: "account_read",
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

test("binds capacity to one native account observation across delayed reads and workspace changes", async () => {
  // Native account/read has no account id. Bracket it with native quota ids
  // and the session's account-change epoch; never infer workspace from email.
  for (const [name, beforeId, afterId, email, changedEpoch, known] of [
    [
      "same account",
      "workspace-a",
      "workspace-a",
      "same@example.com",
      false,
      true,
    ],
    [
      "late account A quota with B login",
      "workspace-a",
      "workspace-b",
      "other@example.com",
      false,
      false,
    ],
    [
      "same email with another workspace",
      "workspace-a",
      "workspace-b",
      "same@example.com",
      false,
      false,
    ],
    [
      "missing quota account id",
      undefined,
      undefined,
      "same@example.com",
      false,
      false,
    ],
    [
      "account changed and changed back",
      "workspace-a",
      "workspace-a",
      "same@example.com",
      true,
      false,
    ],
  ]) {
    let epoch = 0;
    let quotaReads = 0;
    const observation = await readCodexAccountUsageObservation({
      readAccountEpoch: () => epoch,
      request: (method) => {
        if (method === "account/read") {
          if (changedEpoch) {
            epoch += 1;
          }
          return Promise.resolve({
            account: { type: "chatgpt", email, planType: "team" },
            requiresOpenaiAuth: true,
          });
        }
        quotaReads += 1;
        return Promise.resolve({
          accountId: quotaReads === 1 ? beforeId : afterId,
          ordinaryUsageAllowed: false,
          rateLimits: {
            limitId: "codex",
            primary: { usedPercent: 100, windowDurationMins: 10_080 },
            credits: { hasCredits: true, unlimited: false, balance: "10" },
            spendControlReached: false,
          },
        });
      },
    });
    assert.equal(Boolean(observation.accountKey), known, name);
    assert.equal(
      observation.usageObservation.usageAdmission?.blocksNewWork,
      known ? false : null,
      name
    );
    assert.equal(
      observation.usageObservation.usageLimits[0].status,
      known ? "exhausted" : "unavailable",
      name
    );
    assert.equal(quotaReads, 2, name);
  }
});
