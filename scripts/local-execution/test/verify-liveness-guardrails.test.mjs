import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMANDS, REQUIRED_FILES } from "../verify-liveness-guardrails.mjs";

test("verify-liveness-guardrails keeps required runtime test files", () => {
  assert.deepEqual(REQUIRED_FILES, [
    "runtime/local-execution/test/heartbeat-watchdog.low-traffic.test.ts",
    "runtime/local-execution/test/heartbeat-watchdog.reconnect-fault-injection.test.ts",
  ]);
});

test("verify-liveness-guardrails keeps deterministic command matrix", () => {
  assert.deepEqual(COMMANDS, [
    {
      command: "pnpm",
      args: ["--filter", "@openmeld/local-execution", "test"],
      label: "local-execution test",
    },
    {
      command: "pnpm",
      args: ["--filter", "@openmeld/local-execution", "check"],
      label: "local-execution check",
    },
    {
      command: "pnpm",
      args: [
        "--filter",
        "@openmeld/local-execution",
        "run",
        "test:liveness:low-traffic",
      ],
      label: "liveness low-traffic simulation",
    },
    {
      command: "pnpm",
      args: [
        "--filter",
        "@openmeld/local-execution",
        "run",
        "test:liveness:reconnect-fault",
      ],
      label: "liveness reconnect fault-injection",
    },
    {
      command: "pnpm",
      args: ["--filter", "openmeld", "build"],
      label: "cli build for service smoke",
    },
    {
      command: "node",
      args: [
        "clients/openmeld-cli/dist/openmeld-dev.js",
        "--view",
        "human",
        "service",
        "status",
      ],
      label: "cli service status smoke (human view)",
    },
    {
      command: "node",
      args: [
        "clients/openmeld-cli/dist/openmeld-dev.js",
        "--view",
        "agent",
        "service",
        "status",
      ],
      label: "cli service status smoke (agent view)",
    },
  ]);
});
