import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildIsolatedWebStartupMessages,
  resolveIsolatedDevLaunchOptions,
  resolveIsolatedDevPresentation,
  resolveIsolatedWebDopplerCommand,
  resolveIsolatedWebScript,
} from "./dev-isolated.mjs";
import { buildInjectedEnvironment } from "./doppler-environment.mjs";

const DOPPLER_ENVIRONMENT_SCRIPT = fileURLToPath(
  new URL("./doppler-environment.mjs", import.meta.url)
);

test("uses compiled Web preview only for the explicit Desktop pilot", () => {
  assert.equal(resolveIsolatedWebScript({}), "dev:isolated");
  assert.equal(
    resolveIsolatedWebScript({ OPENMELD_DESKTOP_PILOT: "1" }),
    "desktop:pilot"
  );
  const command = resolveIsolatedWebDopplerCommand(
    { OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler", OPENMELD_DESKTOP_PILOT: "1" },
    "pnpm-test"
  );
  assert.equal(command.args.at(-1), "desktop:pilot");
});

test("presents the shared Doppler workflow with newcomer-facing commands", () => {
  assert.deepEqual(
    resolveIsolatedDevPresentation({
      OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
    }),
    {
      commandLabel: "dev:worktree",
      stackStartCommand: "pnpm dev:worktree",
      webCommandLabel: "dev:web:worktree",
      webStartCommand: "pnpm dev:web:worktree",
    }
  );
});

test("keeps the Doppler Sandbox command visible in startup and recovery guidance", () => {
  assert.deepEqual(
    resolveIsolatedDevPresentation(
      {
        OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
      },
      { remoteAgentSandboxEnabled: true }
    ),
    {
      commandLabel: "dev:worktree:sandbox",
      stackStartCommand: "pnpm dev:worktree:sandbox",
      webCommandLabel: "dev:web:worktree",
      webStartCommand: "pnpm dev:web:worktree",
    }
  );
});

test("keeps legacy command guidance for local environment files", () => {
  assert.deepEqual(resolveIsolatedDevPresentation({}), {
    commandLabel: "dev:isolated",
    stackStartCommand: "pnpm dev:isolated",
    webCommandLabel: "dev:web:isolated",
    webStartCommand: "pnpm dev:web:isolated",
  });
});

test("sets a clear expectation for the first Web page compilation", () => {
  assert.deepEqual(
    buildIsolatedWebStartupMessages({
      laneId: "wt-example",
      presentation: { webCommandLabel: "dev:web:worktree" },
      webPort: 28_320,
    }),
    [
      "[dev:web:worktree] Starting Web for worktree lane wt-example: http://wt-example.localhost:28320",
      "[dev:web:worktree] The first page load can take about one minute while Web and Cloudflare compile. Keep the page open; later loads should be fast.",
    ]
  );
});

test("enters Doppler at the Web process boundary", () => {
  const command = resolveIsolatedWebDopplerCommand(
    { OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler" },
    "pnpm-test"
  );
  assert.equal(command.executable, "doppler");
  assert.ok(command.args.includes("openmeld-web"));
  assert.deepEqual(command.args.slice(-8), [
    DOPPLER_ENVIRONMENT_SCRIPT,
    "__run-component",
    "web",
    "pnpm-test",
    "--filter",
    "openmeld-web",
    "run",
    "dev:isolated",
  ]);
  assert.equal(
    resolveIsolatedWebDopplerCommand(
      {
        OPENMELD_DEV_DOPPLER_COMPONENT: "web",
        OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
      },
      "pnpm-test"
    ),
    null
  );
  assert.equal(resolveIsolatedWebDopplerCommand({}, "pnpm-test"), null);
});

test("does not trust an ambient Web component marker after supervisor scrubbing", () => {
  const supervisorEnvironment = buildInjectedEnvironment({
    OPENMELD_DEV_DOPPLER_COMPONENT: "web",
    OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
    WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET: "ambient-web-secret",
  });

  const command = resolveIsolatedWebDopplerCommand(
    supervisorEnvironment,
    "pnpm-test"
  );
  assert.equal(command.executable, "doppler");
  assert.equal(command.env.WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET, undefined);
  assert.ok(command.args.includes("__run-component"));
});

test("uses the complete Remote Agent capability set by default", () => {
  assert.deepEqual(resolveIsolatedDevLaunchOptions([]), {
    devGuardArgs: [],
    remoteAgentSandboxEnabled: true,
    scheduledEventsEnabled: false,
  });
});

test("keeps the no-Sandbox flag out of Turbo arguments", () => {
  assert.deepEqual(
    resolveIsolatedDevLaunchOptions([
      "--no-sandbox",
      "--filter=@openmeld/remote-agent",
    ]),
    {
      devGuardArgs: ["--filter=@openmeld/remote-agent"],
      remoteAgentSandboxEnabled: false,
      scheduledEventsEnabled: false,
    }
  );
});

test("keeps the scheduled-test flag out of Turbo arguments", () => {
  assert.deepEqual(
    resolveIsolatedDevLaunchOptions([
      "--test-scheduled",
      "--filter=@openmeld/auth-worker",
    ]),
    {
      devGuardArgs: ["--filter=@openmeld/auth-worker"],
      remoteAgentSandboxEnabled: true,
      scheduledEventsEnabled: true,
    }
  );
});
