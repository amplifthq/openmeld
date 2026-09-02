import assert from "node:assert/strict";
import test from "node:test";

test("projects OpenCode Go provider windows from its official usage response", async () => {
  const { parseOpenCodeGoUsageResponse } = await import("../dist/index.js");
  const observedAt = "2026-09-02T08:00:00.000Z";

  // Captured from the public OpenCode Go route contract in
  // packages/console/app/src/routes/zen/go/v1/usage.ts.
  const limits = parseOpenCodeGoUsageResponse({
    observedAt,
    value: {
      usage: {
        monthly: {
          percent: 41,
          resetsAt: "2026-10-01T00:00:00.000Z",
          status: "ok",
        },
        rolling: {
          percent: 100,
          resetsAt: "2026-09-02T10:00:00.000Z",
          status: "rate-limited",
        },
        weekly: {
          percent: 72.5,
          resetsAt: "2026-09-07T00:00:00.000Z",
          status: "ok",
        },
      },
    },
  });

  assert.deepEqual(limits, [
    {
      key: "opencode-go:rolling",
      label: "5-hour usage",
      observedAt,
      provider: { displayName: "OpenCode Go", id: "opencode-go" },
      resetsAt: "2026-09-02T10:00:00.000Z",
      status: "exhausted",
      usedPercent: 100,
    },
    {
      key: "opencode-go:weekly",
      label: "Weekly usage",
      observedAt,
      provider: { displayName: "OpenCode Go", id: "opencode-go" },
      resetsAt: "2026-09-07T00:00:00.000Z",
      status: "available",
      usedPercent: 72.5,
    },
    {
      key: "opencode-go:monthly",
      label: "Monthly usage",
      observedAt,
      provider: { displayName: "OpenCode Go", id: "opencode-go" },
      resetsAt: "2026-10-01T00:00:00.000Z",
      status: "available",
      usedPercent: 41,
    },
  ]);
});

test("fails closed without inventing an OpenCode Go percentage", async () => {
  const { parseOpenCodeGoUsageResponse } = await import("../dist/index.js");
  const observedAt = "2026-09-02T08:00:00.000Z";

  assert.deepEqual(
    parseOpenCodeGoUsageResponse({
      observedAt,
      value: { usage: { rolling: { percent: 10 } } },
    }),
    [
      {
        key: "opencode-go:provider",
        label: "Usage limits",
        observedAt,
        provider: { displayName: "OpenCode Go", id: "opencode-go" },
        resetsAt: null,
        status: "unavailable",
        usedPercent: null,
      },
    ]
  );
});
