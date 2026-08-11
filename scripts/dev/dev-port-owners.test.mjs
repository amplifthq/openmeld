import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertRootDevPortsAvailable,
  parsePosixListeningTcpOwners,
  readListeningTcpPortOwners,
  readRootDevPortTargets,
} from "./dev-port-owners.mjs";

const AUTH_PACKAGE_REGEX = /@openmeld\/auth-worker/u;
const AUTH_PORT_REGEX = /19330/u;
const OWNER_PID_REGEX = /pid 55077/u;
const OWNER_WORKTREE_REGEX = /\/repo\/other-agent/u;
const NO_PROCESS_STOPPED_REGEX = /No process was stopped/u;
const BLOCKED_BEFORE_TURBO_REGEX = /before Turbo started/u;

test("reads fixed inspector ports from the root dev package scripts", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "openmeld-dev-ports-"));

  try {
    writePackageJson(repoRoot, "services/auth", {
      name: "@openmeld/auth-worker",
      scripts: {
        dev: "wrangler dev --inspector-port 19330",
      },
    });
    writePackageJson(repoRoot, "services/gateway", {
      name: "@openmeld/gateway",
      scripts: {
        dev: "wrangler dev --inspector-port=19332",
      },
    });
    writePackageJson(repoRoot, "services/remote-agent", {
      name: "@openmeld/remote-agent",
      scripts: {
        dev: "wrangler dev --inspector-port 19333",
      },
    });

    assert.deepEqual(readRootDevPortTargets({ repoRoot }), [
      {
        packageName: "@openmeld/auth-worker",
        packagePath: "services/auth",
        port: 19_330,
      },
      {
        packageName: "@openmeld/gateway",
        packagePath: "services/gateway",
        port: 19_332,
      },
      {
        packageName: "@openmeld/remote-agent",
        packagePath: "services/remote-agent",
        port: 19_333,
      },
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("parses lsof listener ownership without losing ports or pids", () => {
  assert.deepEqual(
    parsePosixListeningTcpOwners(
      [
        "p55077",
        "cworkerd",
        "f13",
        "n127.0.0.1:19330",
        "p55078",
        "cworkerd",
        "f14",
        "n[::1]:19332",
        "",
      ].join("\n")
    ),
    [
      { command: "workerd", pid: 55_077, port: 19_330 },
      { command: "workerd", pid: 55_078, port: 19_332 },
    ]
  );
});

test("reads Windows listener ownership through PowerShell", () => {
  const calls = [];
  const owners = readListeningTcpPortOwners({
    platform: "win32",
    ports: [19_330],
    repoRoot: "C:\\repo",
    spawnSyncImpl: (command) => {
      calls.push(command);
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({ LocalPort: 19_330, OwningProcess: 55_077 }),
      };
    },
  });

  assert.deepEqual(calls, ["powershell.exe"]);
  assert.deepEqual(owners, [{ command: "unknown", pid: 55_077, port: 19_330 }]);
});

test("blocks before startup and identifies the exact owning worktree", () => {
  const currentWorktree = "/repo/current";
  const owningWorktree = "/repo/other-agent";
  let startCalled = false;

  assert.throws(
    () => {
      assertRootDevPortsAvailable({
        repoRoot: currentWorktree,
        portTargets: [
          {
            packageName: "@openmeld/auth-worker",
            packagePath: "services/auth",
            port: 19_330,
          },
        ],
        listeningOwners: [{ command: "workerd", pid: 55_077, port: 19_330 }],
        processRows: [
          {
            pid: 55_077,
            command: `${owningWorktree}/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd serve`,
          },
        ],
        worktreeRoots: [currentWorktree, owningWorktree],
      });
      startCalled = true;
    },
    (error) => {
      assert.match(error.message, AUTH_PACKAGE_REGEX);
      assert.match(error.message, AUTH_PORT_REGEX);
      assert.match(error.message, OWNER_PID_REGEX);
      assert.match(error.message, OWNER_WORKTREE_REGEX);
      assert.match(error.message, NO_PROCESS_STOPPED_REGEX);
      assert.match(error.message, BLOCKED_BEFORE_TURBO_REGEX);
      return true;
    }
  );

  assert.equal(startCalled, false);
});

function writePackageJson(repoRoot, packagePath, manifest) {
  const packageDirectory = join(repoRoot, packagePath);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    join(packageDirectory, "package.json"),
    `${JSON.stringify(manifest)}\n`
  );
}
