import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { productionComponentReceiptSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import { verifyHostedPostgresqlCliDatabase } from "./database-backend-admission.mjs";
import {
  workerDeploymentResponse,
  writeDeploymentOutput,
} from "./fixtures/worker-deployment-output.mjs";
import { runHostedCliRelease } from "./hosted-cli-release.mjs";
import { resolveCoreProjectionTag } from "./release-cli-resume.mjs";
import { verifyWorkerDeployment } from "./worker-deployment-evidence.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const HEALTH_FAILURE = /Core deployment verification failed/u;
const UNKNOWN_DEPLOYMENT = /does not match the exact guarded deployment/u;

test("hosted PostgreSQL publication records Core and recovers its applied release through the same entry", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "hosted-cli-pg-lifecycle-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    for (const name of [
      "release/database-backend.json",
      "release/local-components.json",
      "packages/db/postgresql",
      "tooling/postgresql/resources.json",
      "tooling/postgresql/database.mjs",
      "tooling/postgresql/remote-target.mjs",
      "tooling/postgresql/cutover.mjs",
      "services/auth/wrangler.jsonc",
      "services/core/wrangler.jsonc",
    ]) {
      mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
      cpSync(path.join(root, name), path.join(cwd, name), { recursive: true });
    }
    git("init", "--quiet");
    const commit = (name) => {
      writeFileSync(path.join(cwd, "release-label.txt"), name);
      git("add", ".");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        name
      );
      return git("rev-parse", "HEAD");
    };
    const base = commit("Deployed PostgreSQL");
    let sourceSha = commit("First CLI publication");
    const live = new Map(
      ["auth", "core"].map((scope) => [
        scope,
        {
          id: randomUUID(),
          created_on: new Date(Date.now() - 60_000).toISOString(),
          versions: [{ version_id: randomUUID(), percentage: 100 }],
        },
      ])
    );
    const receipts = new Map(
      ["db", "auth", "core"].map((scope) => [
        scope,
        {
          sha: base,
          receipt: {
            attemptId: randomUUID(),
            componentIndex: 0,
            operationKey: "a".repeat(64),
            startedAt: new Date().toISOString(),
            status: "verified",
            application: "applied",
            identity:
              scope === "db"
                ? { kind: "release-source" }
                : {
                    kind: "worker-deployment",
                    workerName: `openmeld-${scope}-prod`,
                    sourceSha: base,
                    environment: "prod",
                    deploymentId: live.get(scope).id,
                    versionId: live.get(scope).versions[0].version_id,
                    proof: "command-output",
                  },
          },
        },
      ])
    );
    let deployments = 0;
    let failHealth = false;
    const readEvidence = () => new Map(receipts);
    const runCommand = (input) => {
      if (input.label === "Verify Core deployment is visible") {
        return {
          status: failHealth ? 1 : 0,
          stderr: failHealth ? "fixture health failure" : "",
        };
      }
      const scope = input.args.some((arg) => arg.includes("auth"))
        ? "auth"
        : "core";
      return workerDeploymentResponse({ deployments: [live.get(scope)] });
    };
    const gate = (probe = {}) =>
      verifyHostedPostgresqlCliDatabase({
        root: cwd,
        sourceSha,
        readReceipts: probe.readReceipts ?? readEvidence,
        verifyDeployment: (input) =>
          verifyWorkerDeployment({ ...input, runCommand }),
        verifyHyperdrive: () => Promise.resolve(),
        verifyCrons: () => Promise.resolve(),
      });
    const run = () =>
      runHostedCliRelease({
        cwd,
        env: {
          GITHUB_REPOSITORY: "openmeld/openmeld",
          OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL: "https://github.com",
          OPENMELD_TRUSTED_GIT_GITHUB_TOKEN: "trusted-token",
          RELEASE_SHA: sourceSha,
        },
        adapters: {
          readEvidence,
          requireDatabaseCurrent: gate,
          runCommand,
          resolveWorkerTarget: ({ group }) => ({
            workerName: "openmeld-core-prod",
            environment: "prod",
            outputEnvironment: "prod",
            args: group.workerArguments,
            projectionTag: resolveCoreProjectionTag({ cwd }),
          }),
          publishEvidence: (event) => {
            for (const [scope, receipt] of Object.entries(event.receipts)) {
              productionComponentReceiptSchema.parse(receipt);
              receipts.set(scope, { sha: event.sourceSha, receipt });
            }
          },
          deployCoreWorker: (input) => {
            // The real recorded owner must have started this exact invocation.
            assert.equal(receipts.get("core").receipt.status, "started");
            assert.equal(
              input.env.OPENMELD_TRUSTED_GIT_GITHUB_TOKEN,
              undefined
            );
            const context = JSON.parse(
              input.env.OPENMELD_RELEASE_RECEIPT_CONTEXT
            );
            assert.equal(context.sourceSha, sourceSha);
            const versionId = randomUUID();
            writeDeploymentOutput(
              {
                env: input.env,
                workerDeploymentArgs: [],
                releaseScope: "core",
              },
              sourceSha,
              { event: { version_id: versionId, projection_tag: input.tag } }
            );
            live.set("core", {
              id: randomUUID(),
              created_on: new Date().toISOString(),
              versions: [{ version_id: versionId, percentage: 100 }],
            });
            deployments += 1;
          },
          runCliRelease: async (input) => {
            // An already aligned immutable publication skips its Core stage.
            if (receipts.get("core").sha !== sourceSha) {
              await input.adapters.deployCore({
                cwd,
                env: input.env,
                tag: resolveCoreProjectionTag({ cwd }),
              });
            }
          },
        },
      });

    await gate(); // The workflow's early database admission.
    await run();
    assert.equal(receipts.get("core").receipt.status, "verified");
    assert.equal(
      receipts.get("core").receipt.identity.versionId,
      live.get("core").versions[0].version_id
    );
    await gate();
    await run();
    assert.equal(deployments, 1);

    sourceSha = commit("Next CLI publication");
    failHealth = true;
    await assert.rejects(run(), HEALTH_FAILURE);
    assert.equal(receipts.get("core").receipt.status, "failed");
    assert.equal(receipts.get("core").receipt.application, "applied");
    const retainedAttempt = receipts.get("core").receipt.attemptId;
    failHealth = false;
    await gate();
    await run();
    assert.equal(receipts.get("core").receipt.status, "verified");
    assert.equal(receipts.get("core").receipt.attemptId, retainedAttempt);
    assert.equal(deployments, 2);

    live.get("core").id = randomUUID();
    await assert.rejects(gate(), UNKNOWN_DEPLOYMENT);
    await assert.rejects(run(), UNKNOWN_DEPLOYMENT);
    assert.equal(deployments, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
