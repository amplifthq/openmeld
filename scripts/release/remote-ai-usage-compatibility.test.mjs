import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareGitPathContents } from "./production-release-status.mjs";
import { compareRemoteAiUsageReceiver } from "./remote-ai-usage-compatibility.mjs";

const BASE = "b".repeat(40);
const TARGET = "a".repeat(40);
const INDEX = "services/core/src/index.ts";
const CORE_CONFIG = "services/core/wrangler.jsonc";
const REMOTE_CONFIG = "services/remote-agent/wrangler.jsonc";
const LOCKFILE = "pnpm-lock.yaml";
const UNKNOWN_RECEIVER = /AI usage|AI usage receiver|Unknown AI usage/u;
const MISSING_SOURCE = /missing source/u;
const readOwner = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const original = new Map(
  [INDEX, CORE_CONFIG, REMOTE_CONFIG, LOCKFILE].map((path) => [
    path,
    readOwner(path),
  ])
);

function compare(overrides = new Map()) {
  return compareRemoteAiUsageReceiver({
    fromSha: BASE,
    toSha: TARGET,
    readGitFile: (sha, path) =>
      sha === TARGET && overrides.has(path)
        ? overrides.get(path)
        : original.get(path),
    compareGitPathContents: ({ paths }) =>
      ![...overrides.keys()]
        .filter((path) => path !== LOCKFILE)
        .some((changed) =>
          paths.some(
            (path) => changed === path || changed.startsWith(`${path}/`)
          )
        ),
  });
}

test("compares the actual deployed Core receiver against the privacy backlog without a SHA exception", () => {
  assert.equal(
    compareRemoteAiUsageReceiver({
      fromSha: "96cb28b5a32f3757c6fd2b78ede81044a45a5a6b",
      toSha: "89c011bf3f34c0046d7d8e837b594927371b9961",
      readGitFile: (sha, path) =>
        execFileSync("git", ["show", `${sha}:${path}`], {
          encoding: "utf8",
          maxBuffer: 5_000_000,
        }),
      compareGitPathContents,
    }),
    true
  );
});

test("rejects receiver owner changes and ambiguous entrypoint structures", () => {
  assert.equal(compare(), true);
  const index = original.get(INDEX);
  const unknown = [
    index.replace(
      "export class CenterAgentRpcEntrypoint",
      "class CenterAgentRpcEntrypoint"
    ),
    `${index}\nexport class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint {}`,
    index.replace(
      "export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint {",
      "export class CenterAgentRpcEntrypoint extends OtherEntrypoint {"
    ),
    index.replace(
      "export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint {",
      "export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint { constructor() { super(); }"
    ),
    index.replace(
      "export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint {",
      "export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint { get env() { return {}; }"
    ),
    index.replace(
      "export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint {",
      "export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint { env = {};"
    ),
    index.replace(
      "export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint {",
      "export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint { static {}"
    ),
    index.replace("  recordRemoteAiUsage(input:", "  unrelatedMethod(input:"),
    index.replace(
      "  recordRemoteAiUsage(input:",
      "  recordRemoteAiUsage() {}\n  recordRemoteAiUsage(input:"
    ),
    index.replace('from "./usage/ai-usage-rpc";', 'from "./usage/other-rpc";'),
    index.replace(
      "  withPostgresRequest,",
      "  otherWrapper as withPostgresRequest,"
    ),
    `${index}\nexport { OtherEntrypoint as CenterAgentRpcEntrypoint };`,
    "export class {",
  ];
  for (const source of unknown) {
    assert.throws(() => compare(new Map([[INDEX, source]])), UNKNOWN_RECEIVER);
  }
  for (const path of [
    INDEX,
    "packages/schemas/src/schemas/ai-usage.ts",
    "packages/schemas/src/schemas/index.ts",
    "services/core/src/usage/ai-usage-rpc.ts",
    "services/core/src/usage/ai-usage-policy.ts",
    "services/core/src/usage/ai-usage-repository.ts",
    "packages/db/src/postgresql.ts",
    "packages/db/package.json",
  ]) {
    const source =
      path === INDEX
        ? index.replace(
            "rpcRecordRemoteAiUsage(this.env, input)",
            "rpcRecordRemoteAiUsage(this.env, { ...input, phase: 'settle' })"
          )
        : "changed receiver";
    assert.equal(compare(new Map([[path, source]])), false, path);
  }
  // An unrelated RPC/import still changes the full index: no claim that it
  // necessarily passes this intentionally conservative witness.
  assert.equal(
    compare(new Map([[INDEX, `${index}\nimport './unrelated-side-effect';`]])),
    false
  );
});

test("refuses changed or ambiguous production service bindings and lockfile resolutions", () => {
  for (const [path, source] of [
    [
      REMOTE_CONFIG,
      original
        .get(REMOTE_CONFIG)
        .replaceAll('"CenterAgentRpcEntrypoint"', '"OtherEntrypoint"'),
    ],
    [
      CORE_CONFIG,
      original
        .get(CORE_CONFIG)
        .replace('"main": "src/index.ts"', '"main": "src/other.ts"'),
    ],
    [
      CORE_CONFIG,
      original
        .get(CORE_CONFIG)
        .replace(
          '"main": "src/index.ts"',
          '"main": "src/index.ts", "main": "src/other.ts"'
        ),
    ],
    [
      REMOTE_CONFIG,
      original
        .get(REMOTE_CONFIG)
        .replaceAll(
          '"service": "openmeld-core-prod"',
          '"service": "other-core-prod"'
        ),
    ],
    [LOCKFILE, "importers: {}\nimporters: {}"],
  ]) {
    assert.throws(() => compare(new Map([[path, source]])), UNKNOWN_RECEIVER);
  }
  assert.equal(
    compare(
      new Map([
        [LOCKFILE, original.get(LOCKFILE).replaceAll("pg@8.23.1", "pg@8.23.2")],
      ])
    ),
    false
  );
  assert.throws(
    () =>
      compareRemoteAiUsageReceiver({
        fromSha: BASE,
        toSha: TARGET,
        readGitFile: () => {
          throw new Error("missing source");
        },
      }),
    MISSING_SOURCE
  );
});
