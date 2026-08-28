import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "download-prior-final-candidate-evidence.sh"
);
const ONE_ARTIFACT_PATTERN = /1 trusted completed-run artifact/u;

test("downloads completed prior branch artifacts without requiring the whole run to succeed", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-prior-evidence-"));
  const bin = path.join(root, "bin");
  const destination = path.join(root, "evidence");
  mkdirSync(bin);
  const gh = path.join(bin, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = api ]; then
  if [[ "$*" == *'select(.conclusion'* ]]; then
    printf 'completed runs must not be filtered by overall conclusion\n' >&2
    exit 3
  fi
  printf '101\n100\n99\n'
  exit 0
fi
if [ "\${1:-}" = run ] && [ "\${2:-}" = download ]; then
  run_id="$3"
  shift 3
  destination=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --dir ]; then destination="$2"; shift 2; else shift; fi
  done
  if [ "$run_id" = 99 ]; then exit 1; fi
  mkdir -p "$destination"
  printf '{"run":%s}\n' "$run_id" > "$destination/final-candidate-evidence.json"
  exit 0
fi
exit 2
`,
    "utf8"
  );
  chmodSync(gh, 0o755);
  try {
    const result = spawnSync("bash", [SCRIPT, destination], {
      encoding: "utf8",
      env: {
        ...process.env,
        CANDIDATE_BRANCH: "codex/example",
        CANDIDATE_REPOSITORY: "amplifthq/openmeld",
        CANDIDATE_RUN_ID: "101",
        PATH: `${bin}:${process.env.PATH}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, ONE_ARTIFACT_PATTERN);
    assert.equal(
      existsSync(
        path.join(destination, "100", "final-candidate-evidence.json")
      ),
      true
    );
    assert.equal(existsSync(path.join(destination, "101")), false);
  } finally {
    chmodSync(destination, 0o755);
    chmodSync(path.join(destination, "100"), 0o755);
    rmSync(root, { force: true, recursive: true });
  }
});
