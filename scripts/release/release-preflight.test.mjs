import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  runReleasePreflight,
  runReleaseReadyInTemporarySnapshot,
  summarizePreflight,
} from "./release-preflight.mjs";

const AHEAD_ONE_PATTERN = /ahead 1/u;
const CLEANUP_EXPLODED_PATTERN = /cleanup exploded/u;
const GATE_FAILED_PATTERN = /gate failed/u;
const SUMMARY_HEADER_PATTERN = /Release preflight summary/u;
const VERSION_DRIFT_RE = /WARNING: CLI channel version drift/u;
const NEXT_0_2_45_RE = /next 0\.2\.45/u;
const WRANGLER_AUTHENTICATION_PATTERN = /Wrangler authentication/u;
const NPM_CAPTURE = JSON.parse(
  await readFile(
    new URL("./fixtures/npm-view-openmeld-0.2.43.json", import.meta.url),
    "utf8"
  )
);

test("fails the aggregate decision when any check fails", () => {
  assert.deepEqual(
    summarizePreflight([
      { status: "PASS" },
      { status: "SKIP" },
      { status: "FAIL" },
    ]),
    { failed: 1, passed: 1, skipped: 1, status: "FAIL" }
  );
  assert.deepEqual(summarizePreflight([{ status: "SKIP" }]), {
    failed: 0,
    passed: 0,
    skipped: 1,
    status: "SKIP",
  });
});

test("continues every independent check when an injected command fails", async () => {
  const commands = [];
  let output = "";
  const result = await runReleasePreflight({
    adapters: {
      readR2CliVersion: async () => "0.2.43",
      readFile: (path) => {
        if (path.endsWith("release/local-components.json")) {
          return JSON.stringify({
            components: {
              cli: { packageVersion: "0.2.43" },
              service: { bundleVersion: "0.2.43" },
            },
          });
        }
        if (path.endsWith("clients/openmeld-cli/package.json")) {
          return JSON.stringify({ version: "0.2.43" });
        }
        if (path.endsWith(".npmrc")) {
          return "//registry.npmjs.org/:_authToken=present-for-test";
        }
        throw new Error(`Unexpected read: ${path}`);
      },
      runCommand: ({ args, command }) => {
        const key = [command, ...args].join(" ");
        commands.push(key);
        return fakeCommandResult(key);
      },
      runReleaseReady: () =>
        Promise.reject(new Error("release-ready exploded")),
    },
    cwd: "/repo",
    env: {
      CLOUDFLARE_ACCOUNT_ID: "present",
      CLOUDFLARE_API_TOKEN: "present",
      CLOUDFLARE_D1_DATABASE_ID: "present",
    },
    homeDirectory: "/home/test",
    write: (value) => {
      output += value;
    },
  });

  assert.equal(result.summary.status, "FAIL");
  assert.equal(result.checks.length, 8);
  assert.deepEqual(
    Object.fromEntries(result.checks.map((check) => [check.id, check.status])),
    {
      "branch-policy": "PASS",
      channel: "PASS",
      credentials: "PASS",
      git: "PASS",
      "local-processes": "PASS",
      migrations: "PASS",
      "release-order": "PASS",
      "release-ready": "FAIL",
    }
  );
  assert.ok(
    commands.some((command) => command.startsWith("npm view openmeld"))
  );
  assert.ok(commands.includes("ps -ax -o command="));
  assert.ok(
    commands.includes(
      "pnpm -C services/auth exec wrangler d1 migrations list OPENMELD_DB --config wrangler.jsonc --env prod --remote"
    )
  );
  assert.match(output, SUMMARY_HEADER_PATTERN);
});

test("reports npm and R2 drift with the shared next-version decision", async () => {
  const result = await runReleasePreflight({
    adapters: {
      readFile: fakeReadFile,
      readR2CliVersion: async () => "0.2.44",
      runCommand: ({ args, command }) =>
        fakeCommandResult([command, ...args].join(" ")),
      runReleaseReady: () =>
        Promise.resolve({ status: 0, stderr: "", stdout: "ready\n" }),
    },
    cwd: "/repo",
    env: {},
    homeDirectory: "/home/test",
    write: () => undefined,
  });

  const channelCheck = result.checks.find((check) => check.id === "channel");
  assert.equal(channelCheck?.status, "PASS");
  assert.match(channelCheck?.detail ?? "", VERSION_DRIFT_RE);
  assert.match(channelCheck?.detail ?? "", NEXT_0_2_45_RE);
});

test("accepts verified Wrangler OAuth without Cloudflare environment credentials", async () => {
  const commands = [];
  const result = await runReleasePreflight({
    adapters: {
      readFile: fakeReadFile,
      readR2CliVersion: async () => "0.2.43",
      runCommand: ({ args, command }) => {
        const key = [command, ...args].join(" ");
        commands.push(key);
        return fakeCommandResult(key);
      },
      runReleaseReady: () =>
        Promise.resolve({ status: 0, stderr: "", stdout: "ready\n" }),
    },
    cwd: "/repo",
    env: {},
    homeDirectory: "/home/test",
    write: () => undefined,
  });

  const credentialCheck = result.checks.find(
    (check) => check.id === "credentials"
  );
  const migrationCheck = result.checks.find(
    (check) => check.id === "migrations"
  );
  assert.equal(credentialCheck?.status, "PASS");
  assert.match(credentialCheck?.detail ?? "", WRANGLER_AUTHENTICATION_PATTERN);
  assert.equal(migrationCheck?.status, "PASS");
  assert.ok(commands.includes("pnpm exec wrangler whoami"));
  assert.ok(
    commands.includes(
      "pnpm -C services/auth exec wrangler d1 migrations list OPENMELD_DB --config wrangler.jsonc --env prod --remote"
    )
  );
});

test("accepts Wrangler authentication backed by explicit Cloudflare environment credentials", async () => {
  const commands = [];
  const result = await runReleasePreflight({
    adapters: {
      readR2CliVersion: async () => "0.2.43",
      readFile: fakeReadFile,
      runCommand: ({ args, command }) => {
        const key = [command, ...args].join(" ");
        commands.push(key);
        return fakeCommandResult(key);
      },
      runReleaseReady: () =>
        Promise.resolve({ status: 0, stderr: "", stdout: "ready\n" }),
    },
    cwd: "/repo",
    env: {
      CLOUDFLARE_ACCOUNT_ID: "present",
      CLOUDFLARE_API_TOKEN: "present",
    },
    homeDirectory: "/home/test",
    write: () => undefined,
  });

  const credentialCheck = result.checks.find(
    (check) => check.id === "credentials"
  );
  assert.equal(credentialCheck?.status, "PASS");
  assert.match(credentialCheck?.detail ?? "", WRANGLER_AUTHENTICATION_PATTERN);
  assert.ok(commands.includes("pnpm exec wrangler whoami"));
  assert.ok(
    commands.includes(
      "pnpm -C services/auth exec wrangler d1 migrations list OPENMELD_DB --config wrangler.jsonc --env prod --remote"
    )
  );
});

test("fails closed when Wrangler authentication and the remote migration probe fail", async () => {
  const commands = [];
  const result = await runReleasePreflight({
    adapters: {
      readR2CliVersion: async () => "0.2.43",
      readFile: fakeReadFile,
      runCommand: ({ args, command }) => {
        const key = [command, ...args].join(" ");
        commands.push(key);
        if (
          key === "pnpm exec wrangler whoami" ||
          key ===
            "pnpm -C services/auth exec wrangler d1 migrations list OPENMELD_DB --config wrangler.jsonc --env prod --remote"
        ) {
          return {
            status: 1,
            stderr: "Not authenticated",
            stdout: "",
          };
        }
        return fakeCommandResult(key);
      },
      runReleaseReady: () =>
        Promise.resolve({ status: 0, stderr: "", stdout: "ready\n" }),
    },
    cwd: "/repo",
    env: {
      CLOUDFLARE_ACCOUNT_ID: "present",
      CLOUDFLARE_API_TOKEN: "present",
    },
    homeDirectory: "/home/test",
    write: () => undefined,
  });

  const credentialCheck = result.checks.find(
    (check) => check.id === "credentials"
  );
  const migrationCheck = result.checks.find(
    (check) => check.id === "migrations"
  );
  assert.equal(credentialCheck?.status, "FAIL");
  assert.match(credentialCheck?.detail ?? "", WRANGLER_AUTHENTICATION_PATTERN);
  assert.equal(migrationCheck?.status, "FAIL");
  assert.ok(commands.includes("pnpm exec wrangler whoami"));
  assert.ok(
    commands.includes(
      "pnpm -C services/auth exec wrangler d1 migrations list OPENMELD_DB --config wrangler.jsonc --env prod --remote"
    )
  );
});

test("fails Git readiness when HEAD is ahead of origin/main", async () => {
  const result = await runReleasePreflight({
    adapters: {
      readR2CliVersion: async () => "0.2.43",
      readFile: fakeReadFile,
      runCommand: ({ args, command }) => {
        const key = [command, ...args].join(" ");
        if (key === "git rev-list --left-right --count origin/main...HEAD") {
          return { status: 0, stderr: "", stdout: "0\t1\n" };
        }
        return fakeCommandResult(key);
      },
      runReleaseReady: () =>
        Promise.resolve({ status: 0, stderr: "", stdout: "ready\n" }),
    },
    cwd: "/repo",
    env: {},
    homeDirectory: "/home/test",
    write: () => undefined,
  });

  const gitCheck = result.checks.find((check) => check.id === "git");
  assert.equal(gitCheck?.status, "FAIL");
  assert.match(gitCheck?.detail ?? "", AHEAD_ONE_PATTERN);
  assert.equal(result.summary.status, "FAIL");
});

test("runs release readiness only in a cleaned temporary snapshot", async () => {
  const commands = [];
  let temporaryRoot = "";
  const result = await runReleaseReadyInTemporarySnapshot(
    { cwd: "/repo", env: {} },
    {
      createTemporaryDirectory: async (prefix) => {
        temporaryRoot = await mkdtemp(prefix);
        return temporaryRoot;
      },
      runCommand: (input) => {
        commands.push(input);
        return { status: 1, stderr: "gate failed", stdout: "gate output" };
      },
      runRequiredCommand: (input) => {
        commands.push(input);
        return {
          status: 0,
          stderr: "",
          stdout: input.args.join(" ") === "rev-parse HEAD" ? "abc123\n" : "",
        };
      },
    }
  );

  const snapshotRoot = join(temporaryRoot, "repo");
  const verifyCommand = commands.find(
    ({ args, command }) =>
      command === "pnpm" && args.join(" ") === "run verify:release-ready"
  );
  assert.equal(result.status, 1);
  assert.equal(verifyCommand?.cwd, snapshotRoot);
  assert.notEqual(verifyCommand?.cwd, "/repo");
  await assert.rejects(access(temporaryRoot), { code: "ENOENT" });
});

test("preserves the gate result when temporary cleanup also fails", async () => {
  const result = await runReleaseReadyInTemporarySnapshot(
    { cwd: "/repo", env: {} },
    {
      createTemporaryDirectory: async () => "/tmp/preflight-cleanup-test",
      removeTemporaryDirectory: () => {
        throw new Error("cleanup exploded");
      },
      runCommand: () => ({
        status: 1,
        stderr: "gate failed",
        stdout: "gate output",
      }),
      runRequiredCommand: (input) => ({
        status: 0,
        stderr: "",
        stdout: input.args.join(" ") === "rev-parse HEAD" ? "abc123\n" : "",
      }),
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, GATE_FAILED_PATTERN);
  assert.match(result.stderr, CLEANUP_EXPLODED_PATTERN);
});

function fakeReadFile(path) {
  if (path.endsWith("release/local-components.json")) {
    return JSON.stringify({
      components: {
        cli: { packageVersion: "0.2.43" },
        service: { bundleVersion: "0.2.43" },
      },
    });
  }
  if (path.endsWith("clients/openmeld-cli/package.json")) {
    return JSON.stringify({ version: "0.2.43" });
  }
  if (path.endsWith(".npmrc")) {
    return "//registry.npmjs.org/:_authToken=present-for-test";
  }
  throw new Error(`Unexpected read: ${path}`);
}

function fakeCommandResult(key) {
  const outputByCommand = new Map([
    ["git rev-parse --is-inside-work-tree", "true\n"],
    ["git status --porcelain=v1", ""],
    ["git rev-parse --abbrev-ref HEAD", "codex/retro-landing\n"],
    ["git rev-parse HEAD", "aaaaaaaa\n"],
    ["git rev-parse origin/main", "aaaaaaaa\n"],
    ["git rev-parse --verify v0.2.43^{commit}", "aaaaaaaa\n"],
    ["git rev-list --left-right --count origin/main...HEAD", "0\t0\n"],
    ["git diff --name-only v0.2.43 --", ""],
    ["git ls-files --others --exclude-standard", ""],
    [
      "npm view openmeld dist-tags versions --json",
      JSON.stringify(NPM_CAPTURE.distTagsAndVersions),
    ],
    [
      "npm view openmeld@0.2.43 version gitHead dist.integrity --json",
      JSON.stringify(NPM_CAPTURE.publishedVersion),
    ],
    ["ps -ax -o command=", "wrangler dev\ncodex exec resume run-id\n"],
    [
      "pnpm -C services/auth exec wrangler d1 migrations list OPENMELD_DB --config wrangler.jsonc --env prod --remote",
      "No migrations to apply.\n",
    ],
    ["pnpm exec wrangler whoami", "You are logged in with an OAuth Token.\n"],
  ]);
  if (!outputByCommand.has(key)) {
    throw new Error(`Unexpected command: ${key}`);
  }
  return { status: 0, stderr: "", stdout: outputByCommand.get(key) };
}
