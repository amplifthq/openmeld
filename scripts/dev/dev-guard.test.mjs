import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertRequiredNodeMajor,
  buildTurboDevArgs,
  classifyDevEntryArgs,
  createDevGuardRunSupervisor,
  deriveDefaultTurboConcurrency,
  ensureSharedDbReady,
  hasExplicitConcurrencyArg,
  resolveDevStackRestartCommand,
  selectStaleWranglerDevPids,
  shouldVerifySharedDbPrerequisites,
  verifySharedDbPrerequisites,
} from "./dev-guard.mjs";
import { buildProcessMatcherContext } from "./process-matchers.mjs";

const NODE_MAJOR_HINT_REGEX = /pnpm dev requires Node 24\.x/;
const DEV_STOP_RETRY_HINT_REGEX = /Run `pnpm dev:stop` and retry `pnpm dev`/;
const SHARED_DB_BLOCKED_REGEX =
  /Shared OPENMELD_DB is blocked: physical contract drift/;
const INVALID_DB_CHECK_OUTPUT_REGEX =
  /shared OPENMELD_DB gate returned invalid db:check output/;
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("uses the newcomer-facing restart command for Doppler worktree development", () => {
  assert.equal(
    resolveDevStackRestartCommand(true, {
      OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
    }),
    "pnpm dev:worktree"
  );
  assert.equal(resolveDevStackRestartCommand(true, {}), "pnpm dev:isolated");
  assert.equal(resolveDevStackRestartCommand(false, {}), undefined);
});

test("keeps Sandbox enabled in Doppler worktree restart guidance", () => {
  assert.equal(
    resolveDevStackRestartCommand(true, {
      OPENMELD_DEV_ENVIRONMENT_SOURCE: "doppler",
      OPENMELD_DEV_REMOTE_AGENT_SANDBOX_ENABLED: "true",
    }),
    "pnpm dev:worktree:sandbox"
  );
});

function writePackageJson(repoRoot, packagePath, manifest) {
  const packageDirectory = join(repoRoot, packagePath);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    join(packageDirectory, "package.json"),
    `${JSON.stringify(manifest)}\n`
  );
}

test("selects stale Windows wrangler dev sessions by normalized service paths", () => {
  const matcherContext = buildProcessMatcherContext("C:\\repo");
  const rows = [
    { pid: 111, command: "node C:\\repo\\scripts\\dev\\dev-guard.mjs" },
    {
      pid: 222,
      command:
        "node C:\\repo\\node_modules\\wrangler\\bin\\wrangler.js dev --config C:\\repo\\services\\core\\wrangler.jsonc",
    },
    {
      pid: 333,
      command:
        "node C:\\repo\\node_modules\\wrangler\\bin\\wrangler.js dev --config C:\\repo\\clients\\web\\wrangler.jsonc",
    },
    {
      pid: 444,
      command:
        "node C:\\repo\\node_modules\\.pnpm\\wrangler@4.70.0\\node_modules\\wrangler\\wrangler-dist\\cli.js dev",
    },
    {
      pid: 555,
      command:
        "C:\\repo\\node_modules\\@cloudflare\\workerd-win32-64\\bin\\workerd.exe serve --socket-addr=entry=127.0.0.1:0 --external-addr=loopback=127.0.0.1:59058 --control-fd=3 -",
    },
  ];

  assert.deepEqual(
    selectStaleWranglerDevPids(rows, {
      currentPid: 111,
      matcherContext,
    }),
    [222, 444, 555]
  );
});

test("forces a non-zero exit code after readiness verification fails", () => {
  const supervisor = createDevGuardRunSupervisor();

  supervisor.markVerificationFailed();

  assert.equal(
    supervisor.resolveExitCode({
      code: 0,
      signal: null,
    }),
    1
  );
});

test("injects default concurrency when the caller does not provide one", () => {
  assert.deepEqual(buildTurboDevArgs([], { defaultConcurrency: 11 }), [
    "turbo",
    "run",
    "dev",
    "--filter=!openmeld-web",
    "--filter=!@openmeld/core",
    "--filter=!@openmeld/desktop",
    "--concurrency=11",
  ]);
});

test("delegates the isolated stack to the package-level dev:isolated task", () => {
  assert.deepEqual(
    buildTurboDevArgs([], {
      defaultConcurrency: 11,
      taskName: "dev:isolated",
    }),
    [
      "turbo",
      "run",
      "dev:isolated",
      "--filter=!openmeld-web",
      "--filter=!@openmeld/core",
      "--filter=!@openmeld/desktop",
      "--concurrency=11",
    ]
  );
});

test("keeps Core inside the Auth multi-worker dev process only", () => {
  const turboArgs = buildTurboDevArgs([], { defaultConcurrency: 11 });
  const dryRun = JSON.parse(
    execFileSync("corepack", ["pnpm", "exec", ...turboArgs, "--dry-run=json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
    })
  );
  const taskIds = new Set(dryRun.tasks.map((task) => task.taskId));
  const authManifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "services/auth/package.json"), "utf8")
  );

  assert.equal(taskIds.has("@openmeld/auth-worker#dev"), true);
  assert.equal(taskIds.has("@openmeld/core#dev"), false);
  assert.equal(
    authManifest.scripts.dev.includes("-c ../core/wrangler.jsonc"),
    true
  );
});

test("loads root Cloudflare credentials before Gateway dev starts", () => {
  assert.deepEqual(runGatewayDevWithRootCloudflareCredentials("dev"), {
    accountId: "test-account-id",
    apiToken: "test-api-token",
  });
});

test("loads root Cloudflare credentials before Gateway dev:prod starts", () => {
  assert.deepEqual(runGatewayDevWithRootCloudflareCredentials("dev:prod"), {
    accountId: "test-account-id",
    apiToken: "test-api-token",
  });
});

function runGatewayDevWithRootCloudflareCredentials(scriptName) {
  const tempRepoRoot = mkdtempSync(join(tmpdir(), "openmeld-gateway-dev-"));
  const gatewayDirectory = join(tempRepoRoot, "services/gateway");
  const commandDirectory = join(tempRepoRoot, "bin");
  const wranglerStubPath = join(commandDirectory, "wrangler-stub.mjs");
  const wranglerCommandPath = join(
    commandDirectory,
    process.platform === "win32" ? "wrangler.cmd" : "wrangler"
  );
  const gatewayManifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "services/gateway/package.json"), "utf8")
  );
  const childEnvironment = {
    ...process.env,
    PATH: [
      commandDirectory,
      join(REPO_ROOT, "services/gateway/node_modules/.bin"),
      process.env.PATH,
    ]
      .filter(Boolean)
      .join(delimiter),
  };
  childEnvironment.CLOUDFLARE_ACCOUNT_ID = undefined;
  childEnvironment.CLOUDFLARE_API_TOKEN = undefined;

  try {
    mkdirSync(gatewayDirectory, { recursive: true });
    mkdirSync(commandDirectory, { recursive: true });
    writeFileSync(
      join(tempRepoRoot, ".env"),
      [
        "CLOUDFLARE_ACCOUNT_ID=test-account-id",
        "CLOUDFLARE_API_TOKEN=test-api-token",
        "",
      ].join("\n")
    );
    writeFileSync(
      wranglerStubPath,
      [
        "process.stdout.write(JSON.stringify({",
        "  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? null,",
        "  apiToken: process.env.CLOUDFLARE_API_TOKEN ?? null,",
        "}));",
        "",
      ].join("\n")
    );
    if (process.platform === "win32") {
      writeFileSync(
        wranglerCommandPath,
        `@node "%~dp0\\wrangler-stub.mjs" %*\r\n`
      );
    } else {
      writeFileSync(
        wranglerCommandPath,
        `#!/bin/sh\nexec node "$(dirname "$0")/wrangler-stub.mjs" "$@"\n`
      );
      chmodSync(wranglerCommandPath, 0o755);
    }

    const output = execSync(gatewayManifest.scripts[scriptName], {
      cwd: gatewayDirectory,
      encoding: "utf8",
      env: childEnvironment,
    });

    return JSON.parse(output);
  } finally {
    rmSync(tempRepoRoot, { recursive: true, force: true });
  }
}

test("respects an explicit concurrency override from the caller", () => {
  assert.deepEqual(
    buildTurboDevArgs(
      ["--", "--filter=@openmeld/gateway", "--concurrency=21"],
      {
        defaultConcurrency: 11,
      }
    ),
    [
      "turbo",
      "run",
      "dev",
      "--filter=!openmeld-web",
      "--filter=!@openmeld/core",
      "--filter=!@openmeld/desktop",
      "--filter=@openmeld/gateway",
      "--concurrency=21",
    ]
  );
  assert.equal(
    hasExplicitConcurrencyArg([
      "--filter=@openmeld/gateway",
      "--concurrency=21",
    ]),
    true
  );
});

test("derives a default concurrency with two spare slots", () => {
  const tempRepoRoot = mkdtempSync(join(tmpdir(), "openmeld-dev-guard-"));
  try {
    writePackageJson(tempRepoRoot, "packages/included-one", {
      name: "@openmeld/included-one",
      scripts: { dev: "node ./dev.mjs" },
    });
    writePackageJson(tempRepoRoot, "services/included-two", {
      name: "@openmeld/included-two",
      scripts: { dev: "node ./dev.mjs" },
    });
    writePackageJson(tempRepoRoot, "services/remote-agent", {
      name: "@openmeld/remote-agent",
      scripts: { dev: "wrangler dev" },
    });
    writePackageJson(tempRepoRoot, "clients/web", {
      name: "openmeld-web",
      scripts: { dev: "node ./dev.mjs" },
    });
    writePackageJson(tempRepoRoot, "packages/no-dev", {
      name: "@openmeld/no-dev",
      scripts: { check: "node ./check.mjs" },
    });

    const concurrency = deriveDefaultTurboConcurrency({
      repoRoot: tempRepoRoot,
    });

    assert.equal(typeof concurrency, "number");
    assert.equal(Number.isInteger(concurrency), true);
    assert.equal(concurrency, 5);
  } finally {
    rmSync(tempRepoRoot, { recursive: true, force: true });
  }
});

test("fails early with a clear Node version error", () => {
  assert.throws(
    () => assertRequiredNodeMajor({ nodeVersion: "22.21.0" }),
    NODE_MAJOR_HINT_REGEX
  );
  assert.doesNotThrow(() => assertRequiredNodeMajor({ nodeVersion: "24.1.0" }));
});

test("checks shared DB prerequisites only for the full-stack root dev lane", () => {
  assert.equal(shouldVerifySharedDbPrerequisites([]), true);
  assert.equal(
    shouldVerifySharedDbPrerequisites(["--", "--output-logs=full"]),
    true
  );
  assert.equal(
    shouldVerifySharedDbPrerequisites(["--", "--filter=@openmeld/gateway"]),
    false
  );
});

test("classifies standard scheduling flags as the standard full-stack entry", () => {
  assert.deepEqual(classifyDevEntryArgs(["--", "--concurrency=21"]), {
    kind: "standard",
    normalizedArgs: ["--concurrency=21"],
    firstUnsupportedArg: null,
  });
  assert.deepEqual(
    classifyDevEntryArgs(["--", "--output-logs=full", "--log-order=stream"]),
    {
      kind: "standard",
      normalizedArgs: ["--output-logs=full", "--log-order=stream"],
      firstUnsupportedArg: null,
    }
  );
});

test("classifies --filter as a nonstandard dev path that should use dev:raw", () => {
  assert.deepEqual(classifyDevEntryArgs(["--", "--filter=@openmeld/gateway"]), {
    kind: "nonstandard",
    normalizedArgs: ["--filter=@openmeld/gateway"],
    firstUnsupportedArg: "--filter=@openmeld/gateway",
  });
});

test("fails fast with a clear shared DB gate error before full-stack dev starts", async () => {
  await assert.rejects(
    () =>
      verifySharedDbPrerequisites(
        [],
        buildSharedDbOptions([
          buildDbCommandResult({
            command: "db:check",
            result: "blocked",
            blockedReason: "database is locked: SQLITE_BUSY",
            status: 1,
          }),
        ])
      ),
    DEV_STOP_RETRY_HINT_REGEX
  );
});

test("auto-applies shared DB migrations when the check reports drift", async () => {
  const calls = [];

  await assert.doesNotReject(() =>
    ensureSharedDbReady(
      [],
      buildSharedDbOptions(
        [
          buildDbCommandResult({
            command: "db:check",
            result: "diff_detected",
            blockedReason: "drift detected",
            status: 1,
          }),
          buildDbCommandResult({
            command: "db:migrate:dev",
            result: "applied",
            blockedReason: null,
            status: 0,
          }),
          buildDbCommandResult({
            command: "db:check",
            result: "no_diff",
            blockedReason: null,
            status: 0,
          }),
          buildDbCommandResult({
            command: "db:verify:dev",
            result: "no_diff",
            blockedReason: null,
            status: 0,
          }),
        ],
        calls
      )
    )
  );

  assert.deepEqual(calls, [
    ["db:check"],
    ["db:migrate:dev"],
    ["db:check"],
    ["db:verify:dev"],
  ]);
});

test("verifies the applied local D1 migrations when committed migration files are clean", async () => {
  const calls = [];

  await assert.doesNotReject(() =>
    ensureSharedDbReady(
      [],
      buildSharedDbOptions(
        [
          buildDbCommandResult({
            command: "db:check",
            result: "no_diff",
            blockedReason: null,
            status: 0,
          }),
          buildDbCommandResult({
            command: "db:verify:dev",
            result: "no_diff",
            blockedReason: null,
            status: 0,
          }),
        ],
        calls
      )
    )
  );

  assert.deepEqual(calls, [["db:check"], ["db:verify:dev"]]);
});

test("applies pending local migrations when the physical D1 schema is behind", async () => {
  const calls = [];

  await assert.doesNotReject(() =>
    ensureSharedDbReady(
      [],
      buildSharedDbOptions(
        [
          buildDbCommandResult({
            command: "db:check",
            result: "no_diff",
            blockedReason: null,
            status: 0,
          }),
          buildDbCommandResult({
            command: "db:verify:dev",
            result: "diff_detected",
            blockedReason:
              "auth local OPENMELD_DB: missing migration 0041_smooth_bromley.sql",
            status: 1,
          }),
          buildDbCommandResult({
            command: "db:migrate:dev",
            result: "applied",
            blockedReason: null,
            status: 0,
          }),
          buildDbCommandResult({
            command: "db:verify:dev",
            result: "no_diff",
            blockedReason: null,
            status: 0,
          }),
        ],
        calls
      )
    )
  );

  assert.deepEqual(calls, [
    ["db:check"],
    ["db:verify:dev"],
    ["db:migrate:dev"],
    ["db:verify:dev"],
  ]);
});

test("accepts shared DB JSON emitted with a Turbo task prefix", async () => {
  const calls = [];

  await assert.doesNotReject(() =>
    ensureSharedDbReady(
      [],
      buildSharedDbOptions(
        [
          buildDbCommandResult({
            command: "db:check",
            result: "no_diff",
            blockedReason: null,
            status: 0,
            stdoutPrefix: "@openmeld/db:db:check: ",
          }),
          buildDbCommandResult({
            command: "db:verify:dev",
            result: "no_diff",
            blockedReason: null,
            status: 0,
            stdoutPrefix: "@openmeld/db:db:verify:dev: ",
          }),
        ],
        calls
      )
    )
  );

  assert.deepEqual(calls, [["db:check"], ["db:verify:dev"]]);
});

test("fails fast when shared DB drift remains blocked after auto-migrate", async () => {
  await assert.rejects(
    () =>
      ensureSharedDbReady(
        [],
        buildSharedDbOptions([
          buildDbCommandResult({
            command: "db:check",
            result: "diff_detected",
            blockedReason: "drift detected",
            status: 1,
          }),
          buildDbCommandResult({
            command: "db:migrate:dev",
            result: "applied",
            blockedReason: null,
            status: 0,
          }),
          buildDbCommandResult({
            command: "db:check",
            result: "blocked",
            blockedReason: "physical contract drift",
            status: 1,
          }),
        ])
      ),
    SHARED_DB_BLOCKED_REGEX
  );
});

test("fails fast when shared DB tooling does not return structured JSON", async () => {
  await assert.rejects(
    () =>
      ensureSharedDbReady([], {
        runCommandWithStatusFn: async () => ({
          stdout: "not-json",
          stderr: "",
          status: 1,
          signal: null,
        }),
        timeoutMs: 10,
      }),
    INVALID_DB_CHECK_OUTPUT_REGEX
  );
});

function buildSharedDbOptions(sequence, calls = []) {
  const queue = [...sequence];

  return {
    runCommandWithStatusFn: (args) => {
      calls.push([...args]);
      const next = queue.shift();
      if (!next) {
        throw new Error(`unexpected shared DB command: ${args.join(" ")}`);
      }
      return next;
    },
    timeoutMs: 10,
  };
}

function buildDbCommandResult(input) {
  return {
    stdout: `${input.stdoutPrefix ?? ""}${JSON.stringify({
      contractVersion: 3,
      command: input.command,
      cwd: "/repo",
      phase: "migration_phase",
      subject: "shared",
      result: input.result,
      blockedReason: input.blockedReason,
      snapshot: {
        subject: "shared",
        mode: "tooling",
        bindingName: "OPENMELD_DB",
        schemaSources: [],
        migrationSources: [],
        target: {
          targetKind: "worker_binding",
          bindingName: "OPENMELD_DB",
          databaseId: null,
          databaseName: null,
          localPath: null,
          resolvedFrom: null,
        },
        d1LocalDbPath: null,
        notes: [],
      },
    })}\n`,
    stderr: "",
    status: input.status,
    signal: null,
  };
}
