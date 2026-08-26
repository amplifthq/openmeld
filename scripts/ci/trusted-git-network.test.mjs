import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildTrustedGitHubRepositoryUrl } from "./trusted-git-network.mjs";

const SCRIPT_PATH = fileURLToPath(
  new URL("./trusted-git-network.mjs", import.meta.url)
);
const CLEAN_HTTPS_SERVER_URL_PATTERN = /clean HTTPS server URL/u;

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
