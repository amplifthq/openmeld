#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";
import {
  buildDopplerComponentCommand,
  DEVELOPMENT_ENVIRONMENT_SOURCE_VARIABLE,
  DOPPLER_DEVELOPMENT_COMPONENT_VARIABLE,
  DOPPLER_DEVELOPMENT_ENVIRONMENT_SOURCE,
} from "./doppler-environment.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const coreConfigSourcePath = resolve(repoRoot, "services/core/wrangler.jsonc");
const coreIsolatedConfigPath = resolve(
  repoRoot,
  "services/core/.wrangler-isolated.json"
);
const remoteAgentConfigDirectory = resolve(
  repoRoot,
  "services/remote-agent/dist/openmeld_remote_agent"
);
const remoteAgentConfigPath = resolve(
  remoteAgentConfigDirectory,
  "wrangler.json"
);
const remoteAgentNoSandboxConfigPath = resolve(
  remoteAgentConfigDirectory,
  "wrangler.no-sandbox.json"
);
const REMOTE_AGENT_SANDBOX_CLASS_NAME = "Sandbox";

if (isDirectExecution()) {
  runIsolatedWorker(process.argv[2])
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[isolated-worker-dev] ${toErrorMessage(error)}`);
      process.exit(1);
    });
}

export function resolveIsolatedWorkerDevPlan(input) {
  const env = input.env ?? process.env;
  assertIsolatedEnvironment(env);
  const persistTo = requireEnvironmentValue(
    env,
    "OPENMELD_DEV_WRANGLER_STATE_DIR"
  );
  const commonArgs = ["--persist-to", persistTo];

  switch (input.service) {
    case "auth":
      return {
        ...(env.OPENMELD_DEV_PUBLIC_GATEWAY_ORIGIN
          ? {
              env: {
                ...env,
                OPENMELD_GATEWAY_URL: env.OPENMELD_DEV_PUBLIC_GATEWAY_ORIGIN,
              },
            }
          : {}),
        args: [
          "exec",
          "wrangler",
          "dev",
          "-c",
          "./wrangler.jsonc",
          "-c",
          requireText(input.coreConfigPath, "coreConfigPath"),
          ...commonArgs,
          "--port",
          requirePort(env, "OPENMELD_DEV_AUTH_PORT"),
          "--inspector-port",
          requirePort(env, "OPENMELD_DEV_AUTH_INSPECTOR_PORT"),
          "--var",
          `BETTER_AUTH_URL:${requireEnvironmentValue(env, "BETTER_AUTH_URL")}`,
          "--var",
          `WEB_APP_URL:${requireEnvironmentValue(env, "WEB_APP_URL")}`,
          ...(env.AUTH_DESKTOP_DEVELOPMENT_TARGET
            ? [
                "--var",
                `AUTH_DESKTOP_DEVELOPMENT_TARGET:${env.AUTH_DESKTOP_DEVELOPMENT_TARGET}`,
              ]
            : []),
          "--var",
          `PASSKEY_RP_ID:${new URL(requireEnvironmentValue(env, "WEB_APP_URL")).hostname}`,
        ],
        command: "pnpm",
        preCommands: [],
      };
    case "gateway":
      return {
        args: [
          "exec",
          "wrangler",
          "dev",
          ...commonArgs,
          "--port",
          requirePort(env, "OPENMELD_DEV_GATEWAY_PORT"),
          "--inspector-port",
          requirePort(env, "OPENMELD_DEV_GATEWAY_INSPECTOR_PORT"),
          "--var",
          `OPENMELD_GATEWAY_URL:${requireEnvironmentValue(env, "OPENMELD_GATEWAY_URL")}`,
          "--var",
          `WEB_APP_URL:${requireEnvironmentValue(env, "WEB_APP_URL")}`,
          ...localPluginFixtureArgs(env.OPENMELD_DEV_PLUGIN_FIXTURE_URL),
          ...(env.OPENMELD_SLACK_OAUTH_REDIRECT_URL
            ? [
                "--var",
                `OPENMELD_SLACK_OAUTH_REDIRECT_URL:${env.OPENMELD_SLACK_OAUTH_REDIRECT_URL}`,
              ]
            : []),
        ],
        command: "pnpm",
        preCommands: [],
      };
    case "remote-agent": {
      const sandboxEnabled =
        env.OPENMELD_DEV_REMOTE_AGENT_SANDBOX_ENABLED !== "false";
      return {
        args: [
          "exec",
          "wrangler",
          "dev",
          "--config",
          sandboxEnabled
            ? "dist/openmeld_remote_agent/wrangler.json"
            : "dist/openmeld_remote_agent/wrangler.no-sandbox.json",
          ...(sandboxEnabled ? [] : ["--enable-containers=false"]),
          "--persist-to",
          persistTo,
          "--port",
          requirePort(env, "OPENMELD_DEV_REMOTE_AGENT_PORT"),
          "--inspector-port",
          requirePort(env, "OPENMELD_DEV_REMOTE_AGENT_INSPECTOR_PORT"),
          "--var",
          `OPENMELD_FEEDBACK_SUBMIT_BASE_URL:${requireEnvironmentValue(env, "OPENMELD_GATEWAY_URL")}`,
        ],
        command: "pnpm",
        preCommands: [{ args: ["run", "build"], command: "pnpm" }],
      };
    }
    default:
      throw new Error(`Unsupported isolated Worker service: ${input.service}`);
  }
}

function localPluginFixtureArgs(value) {
  if (!value) {
    return [];
  }
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Plugin fixtures must use an http://127.0.0.1 loopback origin."
    );
  }
  return [
    "--var",
    `OPENMELD_CONNECTORS_BASE_URL:${url.origin}`,
    "--var",
    "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN:local-plugin-fixture",
  ];
}

export function resolveIsolatedWorkerDopplerCommand(
  service,
  env = process.env
) {
  if (
    env[DEVELOPMENT_ENVIRONMENT_SOURCE_VARIABLE] !==
      DOPPLER_DEVELOPMENT_ENVIRONMENT_SOURCE ||
    env[DOPPLER_DEVELOPMENT_COMPONENT_VARIABLE] === service
  ) {
    return null;
  }
  return buildDopplerComponentCommand(
    service,
    [process.execPath, scriptPath, service],
    env
  );
}

export function buildRemoteAgentNoSandboxWranglerConfig(sourceConfig) {
  return {
    ...sourceConfig,
    containers: [],
    dev: {
      ...(sourceConfig.dev ?? {}),
      enable_containers: false,
    },
    durable_objects: {
      ...(sourceConfig.durable_objects ?? {}),
      bindings: (sourceConfig.durable_objects?.bindings ?? []).filter(
        (binding) =>
          binding.class_name !== REMOTE_AGENT_SANDBOX_CLASS_NAME &&
          binding.name !== "SANDBOX"
      ),
    },
    migrations: (sourceConfig.migrations ?? [])
      .map(removeRemoteAgentSandboxFromMigration)
      .filter((migration) => migration !== null),
  };
}

export function buildIsolatedCoreWranglerConfig(input) {
  const env = input.env ?? process.env;
  assertIsolatedEnvironment(env);
  const sourceConfig = input.sourceConfig;

  return {
    ...sourceConfig,
    dev: {
      ...(sourceConfig.dev ?? {}),
      inspector_port: Number(
        requirePort(env, "OPENMELD_DEV_CORE_INSPECTOR_PORT")
      ),
    },
    vars: {
      ...(sourceConfig.vars ?? {}),
      CORS_ORIGINS: requireEnvironmentValue(env, "OPENMELD_GATEWAY_URL"),
      ...(env.OPENMELD_DEV_PUBLIC_GATEWAY_ORIGIN
        ? { OPENMELD_GATEWAY_URL: env.OPENMELD_DEV_PUBLIC_GATEWAY_ORIGIN }
        : {}),
      WEB_APP_URL: requireEnvironmentValue(env, "WEB_APP_URL"),
    },
  };
}

export async function runIsolatedWorker(service) {
  if (!service) {
    throw new Error(
      "Usage: node scripts/dev/run-isolated-worker-dev.mjs <auth|gateway|remote-agent>"
    );
  }

  const dopplerCommand = resolveIsolatedWorkerDopplerCommand(service);
  if (dopplerCommand) {
    const exitCode = await runCommand(
      dopplerCommand.executable,
      dopplerCommand.args,
      { forwardSignals: true, env: dopplerCommand.env }
    );
    return exitCode;
  }

  if (service === "auth") {
    writeIsolatedCoreConfig(process.env);
  }
  const plan = resolveIsolatedWorkerDevPlan({
    coreConfigPath: coreIsolatedConfigPath,
    env: process.env,
    service,
  });

  for (const preCommand of plan.preCommands) {
    const exitCode = await runCommand(preCommand.command, preCommand.args, {
      forwardSignals: true,
    });
    if (exitCode !== 0) {
      return exitCode;
    }
  }
  if (
    service === "remote-agent" &&
    process.env.OPENMELD_DEV_REMOTE_AGENT_SANDBOX_ENABLED === "false"
  ) {
    writeRemoteAgentNoSandboxConfig();
  }

  // Use Wrangler's public bin entry; pnpm exec need not stay resident for it.
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("wrangler/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bin = resolve(
    manifestPath,
    "..",
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin.wrangler
  );
  const exitCode = await runCommand(
    process.execPath,
    [bin, ...plan.args.slice(2)],
    {
      env: plan.env,
      forwardSignals: true,
    }
  );
  return exitCode;
}

function writeIsolatedCoreConfig(env) {
  const sourceConfig = parseJsoncObject(
    readFileSync(coreConfigSourcePath, "utf8")
  );
  const isolatedConfig = buildIsolatedCoreWranglerConfig({
    env,
    sourceConfig,
  });
  writeFileSync(
    coreIsolatedConfigPath,
    `${JSON.stringify(isolatedConfig, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

function writeRemoteAgentNoSandboxConfig() {
  const sourceConfig = JSON.parse(readFileSync(remoteAgentConfigPath, "utf8"));
  const lightweightConfig =
    buildRemoteAgentNoSandboxWranglerConfig(sourceConfig);
  writeFileSync(
    remoteAgentNoSandboxConfigPath,
    `${JSON.stringify(lightweightConfig, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

function removeRemoteAgentSandboxFromMigration(migration) {
  const nextMigration = { ...migration };
  for (const key of ["new_classes", "new_sqlite_classes", "deleted_classes"]) {
    if (Array.isArray(nextMigration[key])) {
      nextMigration[key] = nextMigration[key].filter(
        (className) => className !== REMOTE_AGENT_SANDBOX_CLASS_NAME
      );
    }
  }

  const hasOperation = Object.entries(nextMigration).some(
    ([key, value]) =>
      key !== "tag" && (!Array.isArray(value) || value.length > 0)
  );
  return hasOperation ? nextMigration : null;
}

function runCommand(command, args, options = {}) {
  const executable =
    process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    const forwardSigint = () => child.kill("SIGINT");
    const forwardSigterm = () => child.kill("SIGTERM");
    const cleanupSignalHandlers = () => {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
    };
    if (options.forwardSignals) {
      process.once("SIGINT", forwardSigint);
      process.once("SIGTERM", forwardSigterm);
    }
    child.once("error", (error) => {
      cleanupSignalHandlers();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanupSignalHandlers();
      resolvePromise(signal ? 1 : (code ?? 1));
    });
  });
}

function assertIsolatedEnvironment(env) {
  if (String(env.OPENMELD_DEV_ISOLATED ?? "").trim() !== "1") {
    throw new Error(
      "Isolated Worker dev requires OPENMELD_DEV_ISOLATED=1 from a root isolated development launcher."
    );
  }
  requireEnvironmentValue(env, "WRANGLER_REGISTRY_PATH");
}

function requirePort(env, name) {
  const raw = requireEnvironmentValue(env, name);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return String(port);
}

function requireEnvironmentValue(env, name) {
  return requireText(env[name], name);
}

function requireText(value, name) {
  const normalized = String(value ?? "").trim();
  if (normalized.length === 0) {
    throw new Error(`Missing required isolated dev value: ${name}`);
  }
  return normalized;
}

function isDirectExecution() {
  return process.argv[1] && resolve(process.argv[1]) === scriptPath;
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
