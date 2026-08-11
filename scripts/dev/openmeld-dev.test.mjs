import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { LocalDevStackReadinessError } from "./dev-stack-readiness.mjs";
import {
  classifyOpenMeldDevCommandPreflight,
  hasActiveOpenMeldDevLockHolder,
  normalizeForwardedArgs,
  shouldPreflightOpenMeldDevCommand,
  startOpenMeldDevProcess,
  verifyOpenMeldDevLocalStackBeforeSpawn,
} from "./openmeld-dev.mjs";

const NOT_READY_MESSAGE_RE = /Local OpenMeld dev stack is not ready\./;
const REDACTED_OTT_RE = /openmeld-dev auth login --ott <redacted>/;
const SECRET_TOKEN_RE = /super-secret-token/;

test("normalizes forwarded openmeld-dev args by stripping one leading terminator", () => {
  assert.deepEqual(normalizeForwardedArgs(["--", "start"]), ["start"]);
  assert.deepEqual(normalizeForwardedArgs(["start"]), ["start"]);
});

test("skips preflight for passive openmeld-dev queries", () => {
  assert.deepEqual(classifyOpenMeldDevCommandPreflight([]), {
    kind: "skip",
    reason: "passive_query",
    commandTokens: [],
  });
  assert.equal(shouldPreflightOpenMeldDevCommand(["--help"]), false);
  assert.equal(
    shouldPreflightOpenMeldDevCommand(["auth", "login", "--help"]),
    false
  );
  assert.equal(shouldPreflightOpenMeldDevCommand(["--view", "agent"]), false);
});

test("requires preflight for repo-local commands that need auth/core/gateway", () => {
  assert.equal(shouldPreflightOpenMeldDevCommand(["start"]), true);
  assert.equal(shouldPreflightOpenMeldDevCommand(["login"]), true);
  assert.equal(shouldPreflightOpenMeldDevCommand(["setup"]), true);
  assert.equal(shouldPreflightOpenMeldDevCommand(["auth", "login"]), true);
  assert.equal(shouldPreflightOpenMeldDevCommand(["whoami"]), true);
  assert.equal(shouldPreflightOpenMeldDevCommand(["profile", "ready"]), true);
  assert.equal(shouldPreflightOpenMeldDevCommand(["profiles", "list"]), true);
  assert.equal(shouldPreflightOpenMeldDevCommand(["space", "status"]), true);
  assert.equal(shouldPreflightOpenMeldDevCommand(["spaces", "join"]), true);
  assert.equal(
    shouldPreflightOpenMeldDevCommand(["send", "--space", "space-1"]),
    true
  );
  assert.equal(
    shouldPreflightOpenMeldDevCommand(["tail", "--space", "space-1"]),
    true
  );
});

test("skips preflight for local-only openmeld-dev commands", () => {
  assert.equal(shouldPreflightOpenMeldDevCommand(["skills", "check"]), false);
  assert.equal(shouldPreflightOpenMeldDevCommand(["agents", "detect"]), false);
  assert.equal(shouldPreflightOpenMeldDevCommand(["service", "status"]), false);
  assert.equal(shouldPreflightOpenMeldDevCommand(["auth", "status"]), false);
  assert.equal(shouldPreflightOpenMeldDevCommand(["auth", "logout"]), false);
  assert.equal(shouldPreflightOpenMeldDevCommand(["logout"]), false);
  assert.equal(
    shouldPreflightOpenMeldDevCommand(["repair", "local-state"]),
    false
  );
});

test("skips preflight for unknown commands so the CLI owns unknown-command errors", () => {
  assert.deepEqual(
    classifyOpenMeldDevCommandPreflight(["mystery", "command"]),
    {
      kind: "skip",
      reason: "unknown_command",
      commandTokens: ["mystery", "command"],
    }
  );
});

test("uses the long readiness window when the dev stack is already starting", async () => {
  const timeoutValues = [];

  const result = await verifyOpenMeldDevLocalStackBeforeSpawn(["start"], {
    hasActiveDevLockHolderFn: async () => true,
    waitForLocalDevStackReadyFn: (input) => {
      timeoutValues.push(input.timeoutMs);
      return Promise.resolve({ summary: "ready" });
    },
    startupTimeoutMs: 30_000,
    shortProbeTimeoutMs: 2500,
  });

  assert.equal(result.activeDevLockHolder, true);
  assert.deepEqual(timeoutValues, [30_000]);
});

test("treats a live repo-local dev-guard process as active even when the lock file is missing", () => {
  const isActive = hasActiveOpenMeldDevLockHolder({
    lockPath: "/tmp/missing-lock.json",
    readDevLockPayloadFn: () => null,
    readProcessRowsFn: () => [
      {
        pid: 42,
        command:
          "node /Users/felix/Desktop/felix-projects/openmeld/openmeld/scripts/dev/dev-guard.mjs -- --concurrency=21",
      },
    ],
    repoRoot: "/Users/felix/Desktop/felix-projects/openmeld/openmeld",
  });

  assert.equal(isActive, true);
});

test("uses the short readiness probe when the dev stack is not running", async () => {
  const timeoutValues = [];

  const result = await verifyOpenMeldDevLocalStackBeforeSpawn(["start"], {
    hasActiveDevLockHolderFn: async () => false,
    waitForLocalDevStackReadyFn: (input) => {
      timeoutValues.push(input.timeoutMs);
      return Promise.resolve({ summary: "ready" });
    },
    startupTimeoutMs: 30_000,
    shortProbeTimeoutMs: 2500,
  });

  assert.equal(result.activeDevLockHolder, false);
  assert.deepEqual(timeoutValues, [2500]);
});

test("probes the configured isolated Auth and Gateway URLs", async () => {
  let readinessInput = null;

  await verifyOpenMeldDevLocalStackBeforeSpawn(["login"], {
    env: {
      OPENMELD_AUTH_URL: "http://localhost:31794",
      OPENMELD_GATEWAY_URL: "http://localhost:31793",
    },
    hasActiveDevLockHolderFn: async () => false,
    waitForLocalDevStackReadyFn: (input) => {
      readinessInput = input;
      return Promise.resolve({ summary: "ready" });
    },
  });

  assert.deepEqual(readinessInput, {
    authBaseUrl: "http://localhost:31794",
    gatewayBaseUrl: "http://localhost:31793",
    timeoutMs: 2500,
  });
});

test("does not spawn the CLI child when the preflight fails", async () => {
  let spawnCalls = 0;

  await assert.rejects(
    () =>
      startOpenMeldDevProcess({
        args: ["start"],
        statFn: async () => ({ size: 1 }),
        spawnFn: () => {
          spawnCalls += 1;
          const child = new EventEmitter();
          child.kill = () => undefined;
          return child;
        },
        preflightOptions: {
          hasActiveDevLockHolderFn: async () => false,
          waitForLocalDevStackReadyFn: () =>
            Promise.reject(
              new LocalDevStackReadinessError({
                target: {
                  key: "auth",
                  summary: "auth root",
                  url: "http://localhost:8788/",
                },
                failure: "target_unreachable",
                raw: "connect ECONNREFUSED 127.0.0.1:8788",
                status: null,
              })
            ),
        },
      }),
    NOT_READY_MESSAGE_RE
  );

  assert.equal(spawnCalls, 0);
});

test("redacts sensitive values in the retry command shown by preflight failures", async () => {
  await assert.rejects(
    () =>
      verifyOpenMeldDevLocalStackBeforeSpawn(
        ["auth", "login", "--ott", "super-secret-token"],
        {
          hasActiveDevLockHolderFn: async () => false,
          waitForLocalDevStackReadyFn: () =>
            Promise.reject(
              new LocalDevStackReadinessError({
                target: {
                  key: "auth",
                  summary: "auth root",
                  url: "http://localhost:8788/",
                },
                failure: "target_unreachable",
                raw: "connect ECONNREFUSED 127.0.0.1:8788",
                status: null,
              })
            ),
        }
      ),
    (error) => {
      assert.match(error.message, REDACTED_OTT_RE);
      assert.doesNotMatch(error.message, SECRET_TOKEN_RE);
      return true;
    }
  );
});
