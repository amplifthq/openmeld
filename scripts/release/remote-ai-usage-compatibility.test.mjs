import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parseConfigFileTextToJson } from "@typescript/typescript6";
import { compareGitPathContents } from "./production-release-status.mjs";
import { compareRemoteAiUsageReceiver } from "./remote-ai-usage-compatibility.mjs";

const BASE = "b".repeat(40);
const TARGET = "a".repeat(40);
const INDEX = "services/core/src/index.ts";
const CORE_CONFIG = "services/core/wrangler.jsonc";
const REMOTE_CONFIG = "services/remote-agent/wrangler.jsonc";
const LOCKFILE = "pnpm-lock.yaml";
const SHARED_TYPESCRIPT_CONFIG = "tooling/typescript-config/base.jsonc";
const TYPESCRIPT_CONFIGS = [
  "services/core/tsconfig.json",
  "packages/db/tsconfig.json",
  "packages/schemas/tsconfig.json",
  SHARED_TYPESCRIPT_CONFIG,
];
const UNKNOWN_RECEIVER = /AI usage|AI usage receiver|Unknown AI usage/u;
const MISSING_SOURCE = /missing source/u;
const readOwner = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const original = new Map(
  [INDEX, CORE_CONFIG, REMOTE_CONFIG, LOCKFILE, ...TYPESCRIPT_CONFIGS].map(
    (path) => [path, readOwner(path)]
  )
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

test("rejects TypeScript import redirection and unknown inherited configuration", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-usage-config-"));
  try {
    const wrapper = path.join(root, "other-wrapper.ts");
    writeFileSync(
      wrapper,
      'export function withPostgresRequest() { return "redirected wrapper"; }'
    );
    const shared = parseConfigFileTextToJson(
      SHARED_TYPESCRIPT_CONFIG,
      original.get(SHARED_TYPESCRIPT_CONFIG)
    ).config;
    const redirected = {
      ...shared,
      compilerOptions: {
        ...shared.compilerOptions,
        paths: { "@openmeld/db/postgresql": [wrapper] },
      },
    };
    // Independently establish the failure: an unchanged import now invokes a
    // different wrapper through the installed Core bundler's tsconfig contract.
    const { buildSync } = createRequire(
      new URL("../../services/core/package.json", import.meta.url)
    )("esbuild");
    const bundle = buildSync({
      stdin: {
        contents:
          'import { withPostgresRequest } from "@openmeld/db/postgresql"; export const result = withPostgresRequest();',
        resolveDir: root,
      },
      tsconfigRaw: redirected,
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
    });
    const context = { module: { exports: {} } };
    runInNewContext(bundle.outputFiles[0].text, context);
    assert.equal(context.module.exports.result, "redirected wrapper");
    assert.equal(
      compare(
        new Map([[SHARED_TYPESCRIPT_CONFIG, JSON.stringify(redirected)]])
      ),
      false
    );

    for (const config of TYPESCRIPT_CONFIGS) {
      const value = parseConfigFileTextToJson(
        config,
        original.get(config)
      ).config;
      assert.equal(
        compare(
          new Map([
            [
              config,
              JSON.stringify({
                ...value,
                compilerOptions: {
                  ...value.compilerOptions,
                  moduleSuffixes: [".alternate", ""],
                },
              }),
            ],
          ])
        ),
        false,
        config
      );
      for (const extendsValue of [
        "./other-parent.json",
        ["../../tooling/typescript-config/base.jsonc", "./another-parent.json"],
      ]) {
        assert.throws(
          () =>
            compare(
              new Map([
                [config, JSON.stringify({ ...value, extends: extendsValue })],
              ])
            ),
          UNKNOWN_RECEIVER,
          config
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
