import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCanaryServiceStatusPayload,
  buildLocalCanaryVerificationTarget,
  parseAgentJsonLines,
  parseCliOptions,
  runCanaryServiceVerification,
} from "./verify-openmeld-canary-service.mjs";

const LOCAL_TARGET = buildLocalCanaryVerificationTarget();
const MISSING_ENVIRONMENT_TARGET_RE = /missing environmentTarget/;
const SERVICE_ANOMALIES_RE = /Service anomalies/;
const MISSING_REMOTE_ENV_RE =
  /requires OPENMELD_GATEWAY_URL and OPENMELD_AUTH_URL/;
const CLEANUP_REMOTE_RE = /cannot be combined/;
const MISMATCH_NON_ZERO_RE = /non-zero exit/;

test("parseAgentJsonLines returns JSONL entries and ignores plain text", () => {
  assert.deepEqual(
    parseAgentJsonLines(
      [
        "human text",
        JSON.stringify({ code: "daemon.status.result", payload: { ok: true } }),
        "",
      ].join("\n")
    ),
    [{ code: "daemon.status.result", payload: { ok: true } }]
  );
});

test("assertCanaryServiceStatusPayload accepts healthy local launchd status", () => {
  assert.doesNotThrow(() =>
    assertCanaryServiceStatusPayload({
      payload: {
        environmentTarget: LOCAL_TARGET,
        runtime: {
          managedBySystemService: true,
          serviceController: "launchd",
        },
        inventory: {
          anomalies: [],
        },
      },
      expectedTarget: LOCAL_TARGET,
      platform: "darwin",
    })
  );
});

test("assertCanaryServiceStatusPayload rejects missing environment target", () => {
  assert.throws(
    () =>
      assertCanaryServiceStatusPayload({
        payload: {
          runtime: {
            managedBySystemService: true,
            serviceController: "launchd",
          },
          inventory: {
            anomalies: [],
          },
        },
        expectedTarget: LOCAL_TARGET,
        platform: "darwin",
      }),
    MISSING_ENVIRONMENT_TARGET_RE
  );
});

test("assertCanaryServiceStatusPayload rejects service anomalies", () => {
  assert.throws(
    () =>
      assertCanaryServiceStatusPayload({
        payload: {
          environmentTarget: LOCAL_TARGET,
          runtime: {
            managedBySystemService: true,
            serviceController: "launchd",
          },
          inventory: {
            anomalies: [{ code: "bundle_content_drift" }],
          },
        },
        expectedTarget: LOCAL_TARGET,
        platform: "darwin",
      }),
    SERVICE_ANOMALIES_RE
  );
});

test("parseCliOptions requires matching remote Gateway and Auth URLs", () => {
  assert.throws(
    () =>
      parseCliOptions(["--remote"], {
        OPENMELD_GATEWAY_URL: "https://gateway.openmeld.invalid",
      }),
    MISSING_REMOTE_ENV_RE
  );
  assert.deepEqual(
    parseCliOptions(["--remote"], {
      OPENMELD_GATEWAY_URL: "https://gateway.openmeld.invalid",
      OPENMELD_AUTH_URL: "https://auth.openmeld.invalid",
    }).mode,
    "remote"
  );
});

test("parseCliOptions uses the openmeld-canary wrapper default environment", () => {
  assert.deepEqual(parseCliOptions([]), {
    mode: "local",
    gatewayUrl: LOCAL_TARGET.gatewayUrl,
    authBaseUrl: LOCAL_TARGET.authBaseUrl,
  });
});

test("parseCliOptions supports explicit cleanup mode only for the local lane", () => {
  assert.equal(parseCliOptions(["--cleanup"]).mode, "cleanup");
  assert.throws(
    () => parseCliOptions(["--cleanup", "--remote"]),
    CLEANUP_REMOTE_RE
  );
});

test("runCanaryServiceVerification cleanup only touches the canary lane", async () => {
  const calls = [];
  const commandRunner = (command, args, options = {}) => {
    calls.push({ args, command, env: options.env });
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await runCanaryServiceVerification({
    commandRunner,
    options: parseCliOptions(["--cleanup"]),
  });

  assert.deepEqual(
    calls.map((call) => `${call.command} ${call.args.join(" ")}`),
    [
      "openmeld-canary service stop --view agent",
      "openmeld-canary service status --view human",
    ]
  );
  assert.equal(
    calls.every((call) => call.env?.OPENMELD_ENV_PRESET === "canary"),
    true
  );
});

test("runCanaryServiceVerification stops the canary service after validation failure", async () => {
  const calls = [];
  const commandRunner = (command, args, options = {}) => {
    calls.push({ command, args, env: options.env });
    if (
      command === "openmeld-canary" &&
      args.join(" ") === "service status --view agent"
    ) {
      return {
        stdout: `${JSON.stringify({
          code: "daemon.status.result",
          payload: {
            runtime: {
              managedBySystemService: true,
              serviceController: "launchd",
            },
            inventory: {
              anomalies: [],
            },
          },
        })}\n`,
        stderr: "",
        exitCode: 0,
      };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  await assert.rejects(
    () =>
      runCanaryServiceVerification({
        options: parseCliOptions([]),
        commandRunner,
      }),
    MISSING_ENVIRONMENT_TARGET_RE
  );

  assert.ok(
    calls.some(
      (call) =>
        call.command === "openmeld-canary" &&
        call.args.join(" ") === "service stop --view agent"
    ),
    "expected failed verification to stop the managed canary service"
  );
});

test("runCanaryServiceVerification requires explicit mismatch checks to fail non-zero", async () => {
  const commandRunner = (command, args) => {
    const joined = `${command} ${args.join(" ")}`;
    if (joined === "openmeld-canary service status --view agent") {
      return {
        stdout: `${JSON.stringify({
          code: "daemon.status.result",
          payload: {
            environmentTarget: LOCAL_TARGET,
            runtime: {
              managedBySystemService: true,
              serviceController: "launchd",
            },
            inventory: {
              anomalies: [],
            },
          },
        })}\n`,
        stderr: "",
        exitCode: 0,
      };
    }
    if (joined === "openmeld-canary auth status --view human") {
      return {
        stdout: "Wrong OpenMeld Environment",
        stderr: "",
        exitCode: 0,
      };
    }
    if (joined === "openmeld-canary auth status --view agent") {
      return {
        stdout: `${JSON.stringify({
          code: "auth.status.result",
          payload: {
            guidanceReason: "mismatch",
            state: "mismatch",
          },
        })}\n`,
        stderr: "",
        exitCode: 0,
      };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };

  await assert.rejects(
    () =>
      runCanaryServiceVerification({
        options: parseCliOptions([]),
        commandRunner,
      }),
    MISMATCH_NON_ZERO_RE
  );
});
