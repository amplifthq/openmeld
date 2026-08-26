import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildTrustedGitHubRepositoryUrl,
  createTrustedGitEnvironment,
} from "./trusted-git-network.mjs";

const SCRIPT_PATH = fileURLToPath(
  new URL("./trusted-git-network.mjs", import.meta.url)
);
const CLEAN_HTTPS_SERVER_URL_PATTERN = /clean HTTPS server URL/u;
const TRUSTED_MAIN_REFRESH_ERROR_PATTERN =
  /Trusted Git could not refresh current main/u;
const AUTHORIZATION_HEADER_PATTERN = /authorization\s*:/iu;

test("rejects credentials embedded in a trusted GitHub server URL", () => {
  assert.throws(
    () =>
      buildTrustedGitHubRepositoryUrl({
        repository: "amplifthq/openmeld",
        serverUrl: "https://user:secret@github.com",
      }),
    CLEAN_HTTPS_SERVER_URL_PATTERN
  );
});

test("private GitHub fetches use explicit HTTPS auth without exposing or persisting the token", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-trusted-git-"));
  const repository = path.join(root, "release-source");
  const bin = path.join(root, "bin");
  const log = path.join(root, "git.log");
  const token = "fixture-read-token-not-real";
  try {
    mkdirSync(path.join(repository, ".git"), { recursive: true });
    mkdirSync(bin);
    const fakeGit = path.join(bin, "git");
    writeFileSync(
      fakeGit,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `printf '%s|%s|%s|%s|%s|%s|%s\\n' "$PWD" "$*" "${"$"}{GIT_CONFIG_KEY_0:-}" "${"$"}{GIT_CONFIG_VALUE_0:-}" "${"$"}{GIT_CONFIG_KEY_3:-}" "${"$"}{GIT_CONFIG_VALUE_3:-}" "${"$"}{OPENMELD_TRUSTED_GIT_GITHUB_TOKEN:-absent}" >> "$TRUSTED_GIT_LOG"`,
        "",
      ].join("\n")
    );
    chmodSync(fakeGit, 0o755);
    const environment = {
      ...process.env,
      OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL: "https://github.com",
      OPENMELD_TRUSTED_GIT_GITHUB_TOKEN: token,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      TRUSTED_GIT_LOG: log,
    };
    for (const operation of ["fetch-main", "fetch-tags"]) {
      const result = spawnSync(
        process.execPath,
        [
          SCRIPT_PATH,
          operation,
          "--cwd",
          repository,
          "--repository",
          "amplifthq/openmeld",
        ],
        { encoding: "utf8", env: environment }
      );
      assert.equal(result.status, 0, result.stderr);
    }

    const records = readFileSync(log, "utf8").trim().split("\n");
    assert.equal(records.length, 2);
    for (const record of records) {
      const [cwd, command, hooksKey, hooksValue, authKey, authValue, rawToken] =
        record.split("|");
      assert.equal(cwd, realpathSync(repository));
      assert.ok(command.includes("https://github.com/amplifthq/openmeld.git"));
      assert.ok(!command.includes(token));
      assert.ok(!command.includes(" origin "));
      assert.equal(hooksKey, "core.hooksPath");
      assert.equal(hooksValue, "/dev/null");
      assert.equal(authKey, "http.https://github.com/.extraheader");
      assert.equal(
        authValue,
        `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`
      );
      assert.equal(rawToken, "absent");
    }
    assert.equal(existsSync(path.join(repository, ".git", "config")), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("hostile parent Git tracing cannot print a trusted HTTPS credential", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-trusted-git-trace-"));
  const repository = path.join(root, "release-source");
  const certificate = path.join(root, "certificate.pem");
  const privateKey = path.join(root, "private-key.pem");
  const token = "fixture-trace-token-not-real";
  const encodedToken = Buffer.from(`x-access-token:${token}`).toString(
    "base64"
  );
  let server;
  try {
    mkdirSync(repository);
    execFileSync("git", ["init", "--quiet"], {
      cwd: repository,
      stdio: "ignore",
    });
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        privateKey,
        "-out",
        certificate,
        "-subj",
        "/CN=127.0.0.1",
        "-days",
        "1",
      ],
      { stdio: "ignore" }
    );
    server = createServer(
      {
        cert: readFileSync(certificate),
        key: readFileSync(privateKey),
      },
      (_request, response) => {
        response.writeHead(401, { "content-type": "text/plain" });
        response.end("fixture authentication rejected\n");
      }
    );
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const result = await runChild(
      process.execPath,
      [
        SCRIPT_PATH,
        "fetch-main",
        "--cwd",
        repository,
        "--repository",
        "amplifthq/openmeld",
      ],
      {
        ...process.env,
        GIT_CURL_VERBOSE: "1",
        GIT_SSL_NO_VERIFY: "1",
        GIT_TRACE: "1",
        GIT_TRACE_CURL: "1",
        GIT_TRACE_CURL_NO_DATA: "0",
        GIT_TRACE_PACKET: "1",
        GIT_TRACE_PERFORMANCE: "1",
        GIT_TRACE_REDACT: "0",
        GIT_TRACE_SETUP: "1",
        GIT_TRACE_SHALLOW: "1",
        OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL: `https://127.0.0.1:${String(address.port)}`,
        OPENMELD_TRUSTED_GIT_GITHUB_TOKEN: token,
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, TRUSTED_MAIN_REFRESH_ERROR_PATTERN);
    for (const output of [result.stdout, result.stderr]) {
      assert.ok(!output.includes(token));
      assert.ok(!output.includes(encodedToken));
      assert.doesNotMatch(output, AUTHORIZATION_HEADER_PATTERN);
    }
  } finally {
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    rmSync(root, { force: true, recursive: true });
  }
});

test("trusted Git ignores inherited config injection and external behavior hooks", () => {
  const sanitized = createTrustedGitEnvironment({
    ...process.env,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: "/tmp/attacker-objects",
    GIT_CONFIG_PARAMETERS: "'http.extraheader=Authorization: stolen'",
    GIT_EXEC_PATH: "/tmp/attacker-git-exec",
    GIT_EXTERNAL_DIFF: "/tmp/attacker-diff",
    GIT_PROXY_COMMAND: "/tmp/attacker-proxy",
    GIT_SSH: "/tmp/attacker-ssh",
  });

  for (const variableName of [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_PARAMETERS",
    "GIT_EXEC_PATH",
    "GIT_EXTERNAL_DIFF",
    "GIT_PROXY_COMMAND",
    "GIT_SSH",
  ]) {
    assert.equal(sanitized[variableName], undefined);
  }
  assert.equal(sanitized.GIT_TRACE_REDACT, "1");
});

function runChild(command, args, environment) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      resolve({ status: 1, stderr: `${stderr}${error.message}`, stdout });
    });
    child.once("exit", (status) => {
      resolve({ status: status ?? 1, stderr, stdout });
    });
  });
}
