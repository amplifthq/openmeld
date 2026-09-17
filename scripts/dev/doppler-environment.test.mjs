import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDopplerComponentCommand,
  buildInjectedComponentEnvironment,
  buildInjectedEnvironment,
  buildInjectedStagingComponentEnvironment,
  buildNestedDopplerCommand,
  DEVELOPMENT_SECRET_SOURCES,
  findLocalShadowFiles,
  inspectEnvironment,
  PRODUCTION_WORKER_SECRET_SOURCES,
  resolveDevelopmentComponentSources,
  resolveStagingComponentSources,
  STAGING_WORKER_SECRET_SOURCES,
} from "./doppler-environment.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOPPLER_ENVIRONMENT_SCRIPT = fileURLToPath(
  new URL("./doppler-environment.mjs", import.meta.url)
);
const DOPPLER_INSTALL_URL = "https://docs.doppler.com/docs/install-cli";
const DOPPLER_CLI_REQUIRED_RE = /Doppler CLI is required/u;
const DOPPLER_CI_COMMAND_RE = /pnpm run verify:doppler-environment/u;
const TRUSTED_FINAL_CANDIDATE_COMMAND_RE =
  /node trusted-control\/scripts\/ci\/final-candidate\.mjs run/u;
const RAW_DOPPLER_ENOENT_RE = /spawn doppler ENOENT/u;
const SCOPED_GATEWAY_ENVIRONMENT_RE =
  /\{"auth":false,"gateway":true,"remoteAgent":false\}/u;

test("checks the opt-in staging connector source in the real child entrypoint", () => {
  const source = resolveStagingComponentSources("open-connector").find(
    (candidate) => candidate.project === "openmeld-open-connector"
  );
  const result = spawnSync(
    process.execPath,
    [DOPPLER_ENVIRONMENT_SCRIPT, "__check-source", source.project, "stg"],
    {
      encoding: "utf8",
      env: Object.fromEntries(
        source.requiredSecrets.map((name) => [name, "fixture-present"])
      ),
    }
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(
    STAGING_WORKER_SECRET_SOURCES.some(
      (candidate) => candidate.project === source.project
    ),
    false
  );
});

test("exposes one newcomer-friendly command set", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  );

  assert.equal(
    packageJson.scripts["dev:doctor"],
    "node scripts/dev/doppler-environment.mjs doctor"
  );
  assert.equal(
    packageJson.scripts["dev:worktree"],
    "node scripts/dev/doppler-environment.mjs worktree --no-sandbox"
  );
  assert.equal(
    packageJson.scripts["dev:web:worktree"],
    "node scripts/dev/doppler-environment.mjs web:worktree"
  );
  assert.equal(
    packageJson.scripts["dev:worktree:sandbox"],
    "node scripts/dev/doppler-environment.mjs worktree"
  );
  assert.equal(packageJson.scripts["env:run"], undefined);
});

test("routes the Doppler environment contract through Final Candidate", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  );

  assert.equal(
    packageJson.scripts["verify:doppler-environment"],
    "node --test scripts/dev/doppler-environment.test.mjs scripts/dev/dev-isolated.test.mjs"
  );

  assert.match(
    packageJson.scripts["verify:pre-push:checks"],
    DOPPLER_CI_COMMAND_RE
  );
  const workflowPath = new URL(
    "../../.github/workflows/final-candidate.yml",
    import.meta.url
  );
  assert.match(
    readFileSync(workflowPath, "utf8"),
    TRUSTED_FINAL_CANDIDATE_COMMAND_RE,
    workflowPath.pathname
  );
});

test("links newcomers to Doppler's official CLI installation guide", () => {
  const result = spawnSync(
    process.execPath,
    [DOPPLER_ENVIRONMENT_SCRIPT, "help"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(DOPPLER_INSTALL_URL, "u"));
  assert.equal(result.stdout.includes("Node 24"), true);
  assert.equal(result.stdout.includes("pnpm 10"), true);
  assert.equal(result.stdout.includes("corepack enable"), true);
});

test("keeps the root README on the same newcomer workflow", () => {
  const readme = readFileSync(
    new URL("../../README.md", import.meta.url),
    "utf8"
  );

  assert.equal(readme.includes("pnpm dev:doctor"), true);
  assert.equal(readme.includes("pnpm dev:worktree"), true);
  assert.equal(readme.includes("pnpm dev:web:worktree"), true);
  assert.equal(readme.includes("Default local endpoints are"), false);
});

test("turns a missing Doppler executable into one actionable next step", () => {
  const emptyPath = mkdtempSync(join(tmpdir(), "openmeld-no-doppler-"));
  const result = spawnSync(
    process.execPath,
    [DOPPLER_ENVIRONMENT_SCRIPT, "doctor"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: emptyPath },
    }
  );
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, DOPPLER_CLI_REQUIRED_RE);
  assert.match(output, new RegExp(DOPPLER_INSTALL_URL, "u"));
  assert.doesNotMatch(output, RAW_DOPPLER_ENOENT_RE);
});

test("starts the worktree supervisor without ambient managed secrets", () => {
  assert.deepEqual(
    buildInjectedEnvironment({
      BETTER_AUTH_OPENMELD_SECRET: "stale-auth-value",
      EXISTING_VALUE: "kept",
      OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN: "stale-remote-agent-value",
      OPENMELD_DEV_DOPPLER_COMPONENT: "web",
      WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET: "stale-web-value",
    }),
    {
      EXISTING_VALUE: "kept",
      OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
    }
  );
});

test("builds an explicit dev-only Doppler chain without fallback files", () => {
  const command = buildNestedDopplerCommand({
    dopplerCommand: "doppler-test",
    sources: DEVELOPMENT_SECRET_SOURCES,
    terminalArgs: ["node", "script.mjs", "__check", "dev"],
  });
  const serialized = [command.executable, ...command.args].join(" ");

  assert.equal(command.executable, "doppler-test");
  assert.equal(
    countOccurrences(serialized, "--project"),
    DEVELOPMENT_SECRET_SOURCES.length
  );
  assert.equal(
    countOccurrences(serialized, "--config dev"),
    DEVELOPMENT_SECRET_SOURCES.length
  );
  assert.equal(serialized.includes("--config prd"), false);
  assert.equal(
    countOccurrences(serialized, "--no-fallback"),
    DEVELOPMENT_SECRET_SOURCES.length
  );
  assert.equal(serialized.includes("--token"), false);

  for (const source of DEVELOPMENT_SECRET_SOURCES) {
    assert.equal(serialized.includes(source.project), true);
    for (const secretName of [
      ...source.requiredSecrets,
      ...source.optionalSecrets,
    ]) {
      assert.equal(serialized.includes(secretName), true);
    }
  }
});

test("keeps production readiness read-only and scoped to prd", () => {
  const command = buildNestedDopplerCommand({
    sources: PRODUCTION_WORKER_SECRET_SOURCES,
    terminalArgs: ["node", "script.mjs", "__check", "prd"],
  });
  const serialized = [command.executable, ...command.args].join(" ");

  assert.equal(
    countOccurrences(serialized, "--config prd"),
    PRODUCTION_WORKER_SECRET_SOURCES.length
  );
  assert.equal(serialized.includes("--config dev"), false);
  assert.equal(serialized.includes("deploy"), false);
  assert.equal(serialized.includes("sync:secrets:prod"), false);
});

test("keeps staging readiness scoped to the minimal stg secret set", () => {
  const command = buildNestedDopplerCommand({
    sources: STAGING_WORKER_SECRET_SOURCES,
    terminalArgs: ["node", "script.mjs", "__check", "stg"],
  });
  const serialized = [command.executable, ...command.args].join(" ");

  assert.equal(
    countOccurrences(serialized, "--config stg"),
    STAGING_WORKER_SECRET_SOURCES.length
  );
  assert.equal(serialized.includes("--config prd"), false);
  assert.equal(serialized.includes("--config dev"), false);
  assert.deepEqual(
    STAGING_WORKER_SECRET_SOURCES.map((source) => source.project),
    [
      "openmeld-release",
      "openmeld-web",
      "openmeld-auth",
      "openmeld-remote-agent",
      "openmeld-core",
      "openmeld-gateway",
    ]
  );
  assert.deepEqual(STAGING_WORKER_SECRET_SOURCES[0].requiredSecrets, [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN",
  ]);
});

test("gives each staging deployable only the secrets it needs", () => {
  assert.deepEqual(
    Object.fromEntries(
      ["web", "auth", "core", "gateway", "remote-agent"].map((component) => [
        component,
        resolveStagingComponentSources(component).map(
          (source) => source.project
        ),
      ])
    ),
    {
      auth: ["openmeld-release", "openmeld-auth"],
      core: ["openmeld-release", "openmeld-core"],
      gateway: ["openmeld-release", "openmeld-gateway"],
      "remote-agent": ["openmeld-release", "openmeld-remote-agent"],
      web: ["openmeld-release", "openmeld-web"],
    }
  );
  assert.deepEqual(resolveStagingComponentSources("release"), [
    STAGING_WORKER_SECRET_SOURCES[0],
  ]);
});

test("reports required and optional availability without exposing values", () => {
  const sources = [
    {
      config: "dev",
      optionalSecrets: ["OPTIONAL_TOKEN"],
      project: "example",
      requiredSecrets: ["REQUIRED_TOKEN", "EMPTY_TOKEN"],
    },
  ];
  const inspection = inspectEnvironment(sources, {
    EMPTY_TOKEN: "  ",
    OPTIONAL_TOKEN: "optional-secret-value",
    REQUIRED_TOKEN: "required-secret-value",
  });

  assert.deepEqual(inspection, {
    availableOptionalSecrets: ["OPTIONAL_TOKEN"],
    missingOptionalSecrets: [],
    missingRequiredSecrets: ["EMPTY_TOKEN"],
    requiredSecretCount: 2,
  });
  assert.equal(JSON.stringify(inspection).includes("secret-value"), false);
});

test("detects only local files that can shadow Doppler", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "openmeld-doppler-env-"));
  const shadowFile = join(fixtureRoot, "services/core/.dev.vars");
  const localEnvironmentFile = join(fixtureRoot, "clients/web/.env.local");
  const productionFile = join(fixtureRoot, "services/core/.dev.vars.prod");
  mkdirSync(dirname(shadowFile), { recursive: true });
  mkdirSync(dirname(localEnvironmentFile), { recursive: true });
  writeFileSync(shadowFile, "SECRET=not-read\n");
  writeFileSync(localEnvironmentFile, "SECRET=not-read\n");
  writeFileSync(productionFile, "SECRET=not-read\n");

  assert.deepEqual(findLocalShadowFiles(fixtureRoot), [
    localEnvironmentFile,
    shadowFile,
  ]);
});

test("assigns each injected secret to exactly one Doppler project", () => {
  const names = DEVELOPMENT_SECRET_SOURCES.flatMap((source) => [
    ...source.requiredSecrets,
    ...source.optionalSecrets,
  ]);

  assert.equal(new Set(names).size, names.length);
});

test("maps each local runtime to only the Doppler projects it owns", () => {
  assert.deepEqual(
    Object.fromEntries(
      ["web", "auth", "gateway", "remote-agent"].map((component) => [
        component,
        resolveDevelopmentComponentSources(component).map(
          (source) => source.project
        ),
      ])
    ),
    {
      auth: ["openmeld-auth", "openmeld-core"],
      gateway: ["openmeld-gateway"],
      "remote-agent": ["openmeld-remote-agent"],
      web: ["openmeld-web"],
    }
  );
});

test("passes only one component's managed secrets into its runtime", () => {
  assert.deepEqual(
    buildInjectedComponentEnvironment("gateway", {
      BETTER_AUTH_OPENMELD_SECRET: "must-not-reach-gateway",
      EXISTING_VALUE: "kept",
      OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN: "gateway-optional",
      CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "must-not-reach-gateway-either",
      SLACK_OPENMELD_OAUTH_CLIENT_ID: "gateway-client-id",
      SLACK_OPENMELD_OAUTH_CLIENT_SECRET: "gateway-client-secret",
      SLACK_OPENMELD_SIGNING_SECRET: "gateway-signing-secret",
    }),
    {
      EXISTING_VALUE: "kept",
      OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN: "gateway-optional",
      OPENMELD_DEV_DOPPLER_COMPONENT: "gateway",
      OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
      SLACK_OPENMELD_OAUTH_CLIENT_ID: "gateway-client-id",
      SLACK_OPENMELD_OAUTH_CLIENT_SECRET: "gateway-client-secret",
      SLACK_OPENMELD_SIGNING_SECRET: "gateway-signing-secret",
    }
  );
});

test("maps the stable OpenMeld release token name only at the staging command boundary", () => {
  assert.deepEqual(
    buildInjectedStagingComponentEnvironment("core", {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "stale-native-token",
      CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "must-not-reach-core",
      CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN: "staging-release-token",
      EXISTING_VALUE: "kept",
    }),
    {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "staging-release-token",
      EXISTING_VALUE: "kept",
    }
  );
});

test("routes a component runtime through the scoped Doppler entrypoint", () => {
  const command = buildDopplerComponentCommand(
    "remote-agent",
    ["pnpm", "run", "dev:isolated:runtime"],
    {
      BETTER_AUTH_OPENMELD_SECRET: "must-not-reach-remote-agent",
      PATH: "/fixture",
    }
  );
  assert.equal(command.executable, "doppler");
  assert.ok(command.args.includes("--forward-signals=true"));
  assert.ok(command.args.includes("openmeld-remote-agent"));
  assert.deepEqual(command.args.slice(-7), [
    process.execPath,
    DOPPLER_ENVIRONMENT_SCRIPT,
    "__run-component",
    "remote-agent",
    "pnpm",
    "run",
    "dev:isolated:runtime",
  ]);
  assert.equal(command.env.BETTER_AUTH_OPENMELD_SECRET, undefined);
  assert.equal(command.env.PATH, "/fixture");
});

test("injects one component without leaking ambient secrets from another", () => {
  const fakeBin = createFakeDopplerBin();
  const result = spawnSync(
    process.execPath,
    [
      DOPPLER_ENVIRONMENT_SCRIPT,
      "component",
      "gateway",
      "--",
      process.execPath,
      "-e",
      "console.log(JSON.stringify({auth:Boolean(process.env.BETTER_AUTH_OPENMELD_SECRET),gateway:Boolean(process.env.SLACK_OPENMELD_OAUTH_CLIENT_SECRET),remoteAgent:Boolean(process.env.CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN)}))",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        BETTER_AUTH_OPENMELD_SECRET: "stale-auth-value",
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "stale-remote-agent-value",
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, SCOPED_GATEWAY_ENVIRONMENT_RE);
});

test("preserves a component package working directory through Doppler", () => {
  const fakeBin = createFakeDopplerBin();
  const gatewayDirectory = join(REPO_ROOT, "services/gateway");
  const result = spawnSync(
    process.execPath,
    [
      DOPPLER_ENVIRONMENT_SCRIPT,
      "component",
      "gateway",
      "--",
      process.execPath,
      "-e",
      "console.log(process.cwd())",
    ],
    {
      cwd: gatewayDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), gatewayDirectory);
});

test("checks every Doppler project without combining their values", () => {
  const fakeBin = createFakeDopplerBin();
  const logDirectory = mkdtempSync(join(tmpdir(), "openmeld-doppler-log-"));
  const logPath = join(logDirectory, "calls.log");
  const result = spawnSync(
    process.execPath,
    [DOPPLER_ENVIRONMENT_SCRIPT, "doctor"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_DOPPLER_LOG: logPath,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(logPath, "utf8").trim().split("\n").sort(), [
    "openmeld-auth:target",
    "openmeld-core:target",
    "openmeld-gateway:target",
    "openmeld-remote-agent:target",
    "openmeld-web:target",
  ]);
});

test("keeps managed secrets out of Turbo supervisor tasks", () => {
  const turboConfig = JSON.parse(
    readFileSync(new URL("../../turbo.json", import.meta.url), "utf8")
  );
  const managedNames = DEVELOPMENT_SECRET_SOURCES.flatMap((source) => [
    ...source.requiredSecrets,
    ...source.optionalSecrets,
  ]).sort();

  for (const taskName of ["dev", "dev:isolated"]) {
    const passedNames = (turboConfig.tasks[taskName].passThroughEnv ?? [])
      .filter((name) => managedNames.includes(name))
      .sort();
    assert.deepEqual(passedNames, [], taskName);
  }
});

test("passes the Doppler source marker through Turbo to component boundaries", () => {
  const turboConfig = JSON.parse(
    readFileSync(new URL("../../turbo.json", import.meta.url), "utf8")
  );

  assert.equal(
    turboConfig.tasks["dev:isolated"].passThroughEnv.includes(
      "OPENMELD_DEV_ENVIRONMENT_SOURCE"
    ),
    true
  );
});

function countOccurrences(value, search) {
  return value.split(search).length - 1;
}

function createFakeDopplerBin() {
  const directory = mkdtempSync(join(tmpdir(), "openmeld-fake-doppler-"));
  const executable = join(directory, "doppler");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const project = args[args.indexOf("--project") + 1];
const separator = args.indexOf("--");
const env = { ...process.env };
if (process.env.FAKE_DOPPLER_LOG) {
  const nextExecutable = args[separator + 1] === "doppler" ? "doppler" : "target";
  appendFileSync(process.env.FAKE_DOPPLER_LOG, project + ":" + nextExecutable + "\\n");
}
if (project === "openmeld-web") {
  env.WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET = "fake-web-secret";
}
if (project === "openmeld-auth") {
  env.BETTER_AUTH_OPENMELD_SECRET = "fake-auth-secret";
  env.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET = "fake-github-secret";
  env.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET = "fake-google-secret";
}
if (project === "openmeld-core") {
  env.SLACK_OPENMELD_BOT_TOKEN = "fake-slack-bot-token";
  env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY = "fake-slack-crypto-key";
  env.LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY = "fake-lark-key";
  env.ZEP_OPENMELD_API_KEY = "fake-zep-key";
}
if (project === "openmeld-gateway") {
  env.SLACK_OPENMELD_OAUTH_CLIENT_ID = "fake-client-id";
  env.SLACK_OPENMELD_OAUTH_CLIENT_SECRET = "fake-client-secret";
  env.SLACK_OPENMELD_SIGNING_SECRET = "fake-signing-secret";
}
if (project === "openmeld-remote-agent") {
  env.CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN = "fake-ai-gateway-token";
  env.OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN = "fake-openconnector-token";
}
const child = spawnSync(args[separator + 1], args.slice(separator + 2), {
  env,
  stdio: "inherit",
});
process.exit(child.status ?? 1);
`
  );
  chmodSync(executable, 0o755);
  return directory;
}
