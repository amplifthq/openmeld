import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildIsolatedCoreWranglerConfig,
  buildRemoteAgentNoSandboxWranglerConfig,
  resolveIsolatedWorkerDevPlan,
  resolveIsolatedWorkerDopplerCommand,
} from "./run-isolated-worker-dev.mjs";

const ISOLATED_ENV = {
  BETTER_AUTH_URL: "http://localhost:31002",
  OPENMELD_DEV_AUTH_INSPECTOR_PORT: "31010",
  OPENMELD_DEV_AUTH_PORT: "31002",
  OPENMELD_DEV_CORE_INSPECTOR_PORT: "31011",
  OPENMELD_DEV_GATEWAY_INSPECTOR_PORT: "31009",
  OPENMELD_DEV_GATEWAY_PORT: "31001",
  OPENMELD_DEV_ISOLATED: "1",
  OPENMELD_DEV_LANE_ID: "wt-example",
  OPENMELD_DEV_REMOTE_AGENT_INSPECTOR_PORT: "31012",
  OPENMELD_DEV_REMOTE_AGENT_PORT: "31003",
  OPENMELD_DEV_WRANGLER_STATE_DIR:
    "/repo/.wrangler-dev-state/isolated/wt-example",
  OPENMELD_GATEWAY_URL: "http://localhost:31001",
  WEB_APP_URL: "http://localhost:31000",
  WRANGLER_REGISTRY_PATH:
    "/repo/.wrangler-dev-state/isolated/wt-example/registry",
};
const MISSING_ISOLATED_ENV_RE = /OPENMELD_DEV_ISOLATED=1/u;
const FIXTURE_LOOPBACK_ORIGIN_RE = /loopback origin/u;
const ISOLATED_WORKER_SCRIPT = fileURLToPath(
  new URL("./run-isolated-worker-dev.mjs", import.meta.url)
);
const DOPPLER_ENVIRONMENT_SCRIPT = fileURLToPath(
  new URL("./doppler-environment.mjs", import.meta.url)
);

test("isolated Plugin fixtures override only Gateway and never use real credentials", () => {
  const env = {
    ...ISOLATED_ENV,
    OPENMELD_DEV_PLUGIN_FIXTURE_URL: "http://127.0.0.1:31999",
  };
  const plan = resolveIsolatedWorkerDevPlan({ service: "gateway", env });
  assert.ok(
    plan.args.includes("OPENMELD_CONNECTORS_BASE_URL:http://127.0.0.1:31999")
  );
  assert.ok(
    plan.args.includes(
      "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN:local-plugin-fixture"
    )
  );
  assert.throws(
    () =>
      resolveIsolatedWorkerDevPlan({
        service: "gateway",
        env: {
          ...env,
          OPENMELD_DEV_PLUGIN_FIXTURE_URL: "https://connectors.openmeld.ai",
        },
      }),
    FIXTURE_LOOPBACK_ORIGIN_RE
  );
});

test("enters Doppler at the individual Worker process boundary", () => {
  const command = resolveIsolatedWorkerDopplerCommand("gateway", {
    OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
  });
  assert.equal(command.executable, "doppler");
  assert.ok(command.args.includes("openmeld-gateway"));
  assert.deepEqual(command.args.slice(-6), [
    DOPPLER_ENVIRONMENT_SCRIPT,
    "__run-component",
    "gateway",
    process.execPath,
    ISOLATED_WORKER_SCRIPT,
    "gateway",
  ]);
  assert.equal(
    resolveIsolatedWorkerDopplerCommand("gateway", {
      OPENMELD_DEV_DOPPLER_COMPONENT: "gateway",
      OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
    }),
    null
  );
  assert.equal(resolveIsolatedWorkerDopplerCommand("gateway", {}), null);
});

test("starts Auth and Core on the isolated lane with shared persistence", () => {
  const plan = resolveIsolatedWorkerDevPlan({
    coreConfigPath: "/repo/services/core/.wrangler-isolated.json",
    env: ISOLATED_ENV,
    service: "auth",
  });

  assert.deepEqual(plan.preCommands, []);
  assert.equal(plan.command, "pnpm");
  assert.deepEqual(plan.args, [
    "exec",
    "wrangler",
    "dev",
    "-c",
    "./wrangler.jsonc",
    "-c",
    "/repo/services/core/.wrangler-isolated.json",
    "--persist-to",
    "/repo/.wrangler-dev-state/isolated/wt-example",
    "--port",
    "31002",
    "--inspector-port",
    "31010",
    "--var",
    "BETTER_AUTH_URL:http://localhost:31002",
    "--var",
    "WEB_APP_URL:http://localhost:31000",
    "--var",
    "PASSKEY_RP_ID:localhost",
  ]);
});

test("scopes isolated passkeys to the Web hostname instead of shared localhost", () => {
  const plan = resolveIsolatedWorkerDevPlan({
    coreConfigPath: "/repo/services/core/.wrangler-isolated.json",
    env: {
      ...ISOLATED_ENV,
      BETTER_AUTH_URL: "http://wt-example.localhost:31002",
      WEB_APP_URL: "http://wt-example.localhost:31000",
      PASSKEY_RP_ID: "localhost",
    },
    service: "auth",
  });
  assert.ok(plan.args.includes("PASSKEY_RP_ID:wt-example.localhost"));
  assert.ok(
    plan.args.includes("BETTER_AUTH_URL:http://wt-example.localhost:31002")
  );
  assert.ok(
    plan.args.includes("WEB_APP_URL:http://wt-example.localhost:31000")
  );
});

test("starts Gateway and Remote Agent on their isolated public and inspector ports", () => {
  const gateway = resolveIsolatedWorkerDevPlan({
    env: ISOLATED_ENV,
    service: "gateway",
  });
  const remoteAgent = resolveIsolatedWorkerDevPlan({
    env: ISOLATED_ENV,
    service: "remote-agent",
  });

  assert.deepEqual(gateway.args, [
    "exec",
    "wrangler",
    "dev",
    "--persist-to",
    "/repo/.wrangler-dev-state/isolated/wt-example",
    "--port",
    "31001",
    "--inspector-port",
    "31009",
    "--var",
    "OPENMELD_GATEWAY_URL:http://localhost:31001",
    "--var",
    "WEB_APP_URL:http://localhost:31000",
  ]);
  assert.deepEqual(remoteAgent.preCommands, [
    { args: ["run", "build"], command: "pnpm" },
  ]);
  assert.deepEqual(remoteAgent.args, [
    "exec",
    "wrangler",
    "dev",
    "--config",
    "dist/openmeld_remote_agent/wrangler.json",
    "--persist-to",
    "/repo/.wrangler-dev-state/isolated/wt-example",
    "--port",
    "31003",
    "--inspector-port",
    "31012",
    "--var",
    "OPENMELD_FEEDBACK_SUBMIT_BASE_URL:http://localhost:31001",
  ]);
});

test("lets Slack smoke override the ephemeral local OAuth callback", () => {
  const gateway = resolveIsolatedWorkerDevPlan({
    env: {
      ...ISOLATED_ENV,
      OPENMELD_SLACK_OAUTH_REDIRECT_URL:
        "https://openmeld-smoke.loca.lt/slack/oauth/callback",
    },
    service: "gateway",
  });

  assert.deepEqual(gateway.args.slice(-2), [
    "--var",
    "OPENMELD_SLACK_OAUTH_REDIRECT_URL:https://openmeld-smoke.loca.lt/slack/oauth/callback",
  ]);
});

test("uses an explicit public Core callback origin without changing local routing", () => {
  const turboConfig = JSON.parse(
    readFileSync(new URL("../../turbo.json", import.meta.url), "utf8")
  );
  assert.ok(
    turboConfig.tasks["dev:isolated"].passThroughEnv.includes(
      "OPENMELD_DEV_PUBLIC_GATEWAY_ORIGIN"
    )
  );
  const sourceConfig = {
    vars: { OPENMELD_GATEWAY_URL: "http://localhost:8080" },
  };
  const config = buildIsolatedCoreWranglerConfig({
    env: {
      ...ISOLATED_ENV,
      OPENMELD_DEV_PUBLIC_GATEWAY_ORIGIN: "https://callback.example.com",
    },
    sourceConfig,
  });
  assert.equal(
    config.vars.OPENMELD_GATEWAY_URL,
    "https://callback.example.com"
  );
  assert.equal(config.vars.CORS_ORIGINS, ISOLATED_ENV.OPENMELD_GATEWAY_URL);
  assert.equal(sourceConfig.vars.OPENMELD_GATEWAY_URL, "http://localhost:8080");
  const authPlan = resolveIsolatedWorkerDevPlan({
    coreConfigPath: "/repo/services/core/.wrangler-isolated.json",
    env: {
      ...ISOLATED_ENV,
      OPENMELD_DEV_PUBLIC_GATEWAY_ORIGIN: "https://callback.example.com",
    },
    service: "auth",
  });
  assert.equal(
    authPlan.env.OPENMELD_GATEWAY_URL,
    "https://callback.example.com"
  );
  assert.equal(authPlan.env.WEB_APP_URL, ISOLATED_ENV.WEB_APP_URL);
  assert.equal(
    buildIsolatedCoreWranglerConfig({ env: ISOLATED_ENV, sourceConfig }).vars
      .OPENMELD_GATEWAY_URL,
    "http://localhost:8080"
  );
});

test("keeps the no-Sandbox Remote Agent on shared isolated persistence", () => {
  const remoteAgent = resolveIsolatedWorkerDevPlan({
    env: {
      ...ISOLATED_ENV,
      OPENMELD_DEV_REMOTE_AGENT_SANDBOX_ENABLED: "false",
    },
    service: "remote-agent",
  });

  assert.deepEqual(remoteAgent.args, [
    "exec",
    "wrangler",
    "dev",
    "--config",
    "dist/openmeld_remote_agent/wrangler.no-sandbox.json",
    "--enable-containers=false",
    "--persist-to",
    "/repo/.wrangler-dev-state/isolated/wt-example",
    "--port",
    "31003",
    "--inspector-port",
    "31012",
    "--var",
    "OPENMELD_FEEDBACK_SUBMIT_BASE_URL:http://localhost:31001",
  ]);
});

test("removes the Sandbox registration from the no-Sandbox Wrangler config", () => {
  const sourceConfig = {
    containers: [
      { class_name: "Sandbox", name: "openmeld-remote-agent-sandbox" },
    ],
    dev: {
      enable_containers: true,
      port: 8790,
    },
    durable_objects: {
      bindings: [
        { class_name: "Sandbox", name: "SANDBOX" },
        { class_name: "FlueRegistry", name: "FLUE_REGISTRY" },
      ],
    },
    migrations: [
      { new_sqlite_classes: ["FlueRegistry"], tag: "v1" },
      { new_sqlite_classes: ["Sandbox"], tag: "v2_sandbox" },
      { deleted_classes: ["Sandbox"], tag: "v3_retire_sandbox" },
    ],
    vars: {
      OPENMELD_WORKER_ENVIRONMENT: "local",
    },
  };

  const lightweightConfig =
    buildRemoteAgentNoSandboxWranglerConfig(sourceConfig);

  assert.deepEqual(lightweightConfig.containers, []);
  assert.deepEqual(lightweightConfig.durable_objects.bindings, [
    { class_name: "FlueRegistry", name: "FLUE_REGISTRY" },
  ]);
  assert.deepEqual(lightweightConfig.migrations, [
    { new_sqlite_classes: ["FlueRegistry"], tag: "v1" },
  ]);
  assert.deepEqual(lightweightConfig.dev, {
    enable_containers: false,
    port: 8790,
  });
  assert.deepEqual(lightweightConfig.vars, {
    OPENMELD_WORKER_ENVIRONMENT: "local",
  });
  assert.deepEqual(sourceConfig.containers, [
    { class_name: "Sandbox", name: "openmeld-remote-agent-sandbox" },
  ]);
  assert.deepEqual(sourceConfig.migrations, [
    { new_sqlite_classes: ["FlueRegistry"], tag: "v1" },
    { new_sqlite_classes: ["Sandbox"], tag: "v2_sandbox" },
    { deleted_classes: ["Sandbox"], tag: "v3_retire_sandbox" },
  ]);
});

test("overrides only Core local dev addresses while preserving its bindings", () => {
  const sourceConfig = {
    name: "openmeld-core",
    main: "src/index.ts",
    dev: {
      ip: "localhost",
      port: 8787,
      inspector_port: 9229,
    },
    vars: {
      OPENMELD_WORKER_ENVIRONMENT: "local",
      WEB_APP_URL: "http://localhost:3000",
      CORS_ORIGINS: "http://localhost:8080",
    },
    services: [{ binding: "OPENMELD_AUTH_WORKER", service: "openmeld-auth" }],
  };

  const isolatedConfig = buildIsolatedCoreWranglerConfig({
    env: ISOLATED_ENV,
    sourceConfig,
  });

  assert.equal(isolatedConfig.name, "openmeld-core");
  assert.equal(isolatedConfig.main, "src/index.ts");
  assert.equal(isolatedConfig.dev.port, 8787);
  assert.equal(isolatedConfig.dev.inspector_port, 31_011);
  assert.equal(isolatedConfig.vars.WEB_APP_URL, "http://localhost:31000");
  assert.equal(isolatedConfig.vars.CORS_ORIGINS, "http://localhost:31001");
  assert.deepEqual(isolatedConfig.services, sourceConfig.services);
});

test("fails fast when a worker script is run outside the isolated launcher", () => {
  assert.throws(
    () =>
      resolveIsolatedWorkerDevPlan({
        env: {},
        service: "gateway",
      }),
    MISSING_ISOLATED_ENV_RE
  );
});
