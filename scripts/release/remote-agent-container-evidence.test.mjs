import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildProductionDeployStepSpecs,
  parseProductionReleaseArgs,
  resumeProductionRelease,
} from "./production-release.mjs";
import {
  describeRetainedContainer,
  readRetainedRemoteContainer,
} from "./remote-agent-container-evidence.mjs";

const NONE = /--containers-rollout=none/u;
const DRIFT = /changed|evidence|changing/u;
const AUTOMATIC = /Automatic continuation cannot/u;

// Shape captured through Wrangler 4.147.0 containers info/instances on
// 2026-10-12. IDs and registry account are anonymized; no live API is called.
const application = {
  id: "app",
  name: "openmeld-agent-computer",
  version: 124,
  scheduling_policy: "default",
  instances: 7,
  max_instances: 10,
  configuration: {
    image: `registry.cloudflare.com/account/openmeld-agent-computer@sha256:${"d".repeat(64)}`,
    vcpu: 1,
    memory: "6GiB",
    memory_mib: 6144,
    disk: { size_mb: 12_000, size: "12GB" },
    network: { assign_ipv6: "none", assign_ipv4: "none", mode: "private" },
    command: [],
    entrypoint: [],
    runtime: "firecracker",
    observability: { logs: { enabled: true } },
  },
  constraints: { tiers: [1, 2] },
  durable_objects: { namespace_id: "namespace" },
  rollout_active_grace_period: 0,
  health: {
    errors: [],
    instances: {
      active: 1,
      assigned: 0,
      healthy: 6,
      stopped: 0,
      failed: 0,
      scheduling: 0,
      starting: 0,
    },
  },
  network: { bandwidth_limit_mbps: 1000 },
};
const instances = {
  instances: [
    {
      id: "original-instance",
      state: "running",
      version: 124,
      created: "2026-10-11T17:55:52Z",
    },
    {
      id: "idle-instance",
      state: "inactive",
      version: null,
      created: "2026-10-05T07:04:33Z",
    },
  ],
  result_info: { per_page: 100, page_token: null, next_page_token: null },
};

test("retained Container checks reject configuration, rollout, original instance and pagination drift", async () => {
  const expected = describeRetainedContainer(application, instances);
  const probe = (container, page) =>
    readRetainedRemoteContainer(
      {
        runCommand: ({ args }) => ({
          status: 0,
          stdout: JSON.stringify(args.includes("info") ? container : page),
        }),
      },
      expected
    );
  assert.deepEqual(await probe(application, instances), expected);
  for (const changed of [
    { ...application, version: 125 },
    { ...application, active_rollout_id: "new-rollout" },
    {
      ...application,
      configuration: { ...application.configuration, memory_mib: 4096 },
    },
  ]) {
    await assert.rejects(probe(changed, instances), DRIFT);
  }
  await assert.rejects(
    probe(application, {
      ...instances,
      instances: [{ id: "replacement", state: "running", version: 124 }],
    }),
    DRIFT
  );
  await assert.rejects(
    probe(application, {
      ...instances,
      result_info: { ...instances.result_info, next_page_token: "next" },
    }),
    DRIFT
  );
});

test("only the explicit local Remote stage can retain Containers, and its subprocess passes Wrangler none", () => {
  for (const args of [
    ["deploy"],
    ["deploy", "--scope", "web"],
    ["deploy", "--scope", "remote-agent", "--lane", "github"],
    ["deploy", "--scope", "remote-agent", "--redeploy"],
    ["verify", "--scope", "remote-agent"],
  ]) {
    assert.throws(() =>
      parseProductionReleaseArgs([...args, "--containers-rollout=none"])
    );
  }
  const options = parseProductionReleaseArgs([
    "deploy",
    "--scope",
    "remote-agent",
    "--containers-rollout=none",
  ]);
  const [step] = buildProductionDeployStepSpecs(["remote-agent"], options);
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-worker-only-"));
  try {
    const capture = path.join(root, "command.json");
    const preload = path.join(root, "external-command.mjs");
    writeFileSync(
      preload,
      `import childProcess from 'node:child_process'; import { writeFileSync } from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; childProcess.spawnSync = (command, args) => { writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ command, args })); return { status: 0 }; }; syncBuiltinESMExports();`
    );
    assert.deepEqual(step.args, [
      "--filter",
      "@openmeld/remote-agent",
      "run",
      "deploy",
      "--containers-rollout=none",
    ]);
    const entrypoint = fileURLToPath(
      new URL(
        "../../services/remote-agent/scripts/deploy-production.mjs",
        import.meta.url
      )
    );
    const manifest = JSON.parse(
      readFileSync(
        new URL("../../services/remote-agent/package.json", import.meta.url),
        "utf8"
      )
    );
    assert.equal(
      manifest.scripts.deploy,
      "pnpm run build:workspace-dependencies && node scripts/deploy-production.mjs"
    );
    const result = spawnSync(
      process.execPath,
      ["--import", preload, entrypoint, step.args.at(-1)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENMELD_RELEASE_RECEIPT_CONTEXT: JSON.stringify({
            sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
              encoding: "utf8",
            }).trim(),
            operationKey: "a".repeat(64),
            workerName: "openmeld-remote-agent-prod",
          }),
          WRANGLER_OUTPUT_FILE_PATH: path.join(root, "receipt.jsonl"),
        },
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const command = JSON.parse(readFileSync(capture, "utf8"));
    assert.equal(command.command, "pnpm");
    assert.deepEqual(command.args.slice(0, 8), [
      "exec",
      "dotenv",
      "-e",
      "../../.env",
      "-o",
      "--",
      "sh",
      "-c",
    ]);
    assert.match(command.args.at(-1), NONE);
    assert.ok(command.args[8].endsWith('"$@"'));
    const unguarded = spawnSync(
      process.execPath,
      ["--import", preload, entrypoint, "--containers-rollout=none"],
      {
        encoding: "utf8",
        env: { ...process.env, OPENMELD_RELEASE_RECEIPT_CONTEXT: "null" },
      }
    );
    assert.equal(unguarded.status, 1);
    const ordinary = spawnSync(
      process.execPath,
      ["--import", preload, entrypoint],
      { encoding: "utf8" }
    );
    assert.equal(ordinary.status, 0, ordinary.stderr);
    const ordinaryCommand = JSON.parse(readFileSync(capture, "utf8"));
    assert.ok(
      ordinaryCommand.args[8].includes(
        "wrangler deploy --config dist/openmeld_remote_agent/wrangler.prod.json"
      )
    );
    assert.ok(!ordinaryCommand.args[8].includes("--minify"));
    assert.ok(!ordinaryCommand.args.includes("--containers-rollout=none"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatic continuation cannot promote a retained native stage", async () => {
  const sha = "a".repeat(40);
  await assert.rejects(
    resumeProductionRelease({
      sourceSha: sha,
      baseSha: "b".repeat(40),
      scopes: ["remote-agent"],
      collectStatus: () => ({
        sourceSha: sha,
        blockers: [],
        currentChange: { baseSha: "b".repeat(40), scopes: ["remote-agent"] },
        components: [
          {
            scope: "remote-agent",
            state: "unknown",
            recovery: { kind: "guarded-remote-container-continuation" },
          },
        ],
      }),
      deployScope: () => assert.fail("must not deploy native"),
    }),
    AUTOMATIC
  );
});
