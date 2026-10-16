#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { coreSecretReconciliationSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import { readCurrentCliProjectionTarget } from "./deploy-core-current-cli-projection.mjs";
import {
  assertProductionReleaseSource,
  executeWithProductionScopeLeases,
  resolveLocalReleaseOwner,
} from "./production-release.mjs";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import {
  acquireProductionScopeLease,
  releaseProductionScopeLease,
} from "./production-scope-lease.mjs";
import { probeCliBinaryStage } from "./release-cli-resume.mjs";
import { verifyStableNpmIdentity } from "./stable-npm-identity.mjs";
import { verifyWorkerDeployment } from "./worker-deployment-evidence.mjs";

const CORE_ARGS = ["--config", "services/core/wrangler.jsonc", "--env", "prod"];
const PROOF = "reconciled-secret-addition";
const KIND = "reconciled-core-secret-addition";
const REPOSITORY =
  /^(?:https:\/\/github\.com\/|git@github\.com:)amplifthq\/openmeld(?:\.git)?$/u;
const WHITESPACE = /\s+/u;
function requireEvidence(condition, reason) {
  if (!condition) {
    throw new Error(`Core secret reconciliation refused: ${reason}.`);
  }
}
function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function comparable(version) {
  const resources = version?.resources;
  requireEvidence(
    resources?.script?.etag &&
      resources.script_runtime &&
      Array.isArray(resources.bindings),
    "complete provider resources"
  );
  return {
    script: resources.script,
    runtime: resources.script_runtime,
    bindings: resources.bindings
      .filter((b) => b.type !== "secret_text")
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  };
}
function secretNames(version) {
  const names = version.resources.bindings
    .filter((b) => b.type === "secret_text")
    .map((b) => b.name)
    .sort();
  requireEvidence(new Set(names).size === names.length, "unique secret names");
  return names;
}
function semanticAnnotations(version) {
  return Object.fromEntries(
    Object.entries(version.annotations ?? {}).filter(
      ([name]) => !["workers/tag", "workers/triggered_by"].includes(name)
    )
  );
}

// Provider responses are read live. No secret value or source body is retained.
export function assessCoreSecretSuccessor(input) {
  const {
    baseline,
    deployments,
    before,
    after,
    deploymentId,
    versionId,
    addedSecret,
  } = input;
  const identity = baseline.receipt?.identity;
  requireEvidence(
    baseline.receipt?.status === "verified" &&
      identity?.kind === "worker-deployment" &&
      identity.workerName === "openmeld-core-prod" &&
      identity.sourceSha === baseline.sha &&
      identity.projectionTag,
    "verified tagged Core predecessor"
  );
  const ordered = deployments.toSorted(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
  );
  const active = ordered[0];
  requireEvidence(
    active?.id === deploymentId &&
      ordered[1]?.id === identity.deploymentId &&
      active.versions?.length === 1 &&
      active.versions[0].version_id === versionId &&
      active.versions[0].percentage === 100 &&
      ordered[1].versions?.length === 1 &&
      ordered[1].versions[0].version_id === identity.versionId &&
      ordered[1].versions[0].percentage === 100,
    "one direct fully active successor"
  );
  requireEvidence(
    active.annotations?.["workers/triggered_by"] === "secret" &&
      after.annotations?.["workers/triggered_by"] === "secret" &&
      before.id === identity.versionId &&
      after.id === versionId &&
      Date.parse(active.created_on) > Date.parse(ordered[1].created_on) &&
      Date.parse(active.created_on) > Date.parse(baseline.recordedAt),
    "provider secret operation and version correlation"
  );
  requireEvidence(
    before.annotations?.["workers/tag"] === identity.projectionTag &&
      (!after.annotations?.["workers/tag"] ||
        after.annotations["workers/tag"] === identity.projectionTag) &&
      isDeepStrictEqual(
        semanticAnnotations(before),
        semanticAnnotations(after)
      ),
    "unchanged projection and semantic annotations"
  );
  const resources = comparable(before);
  requireEvidence(
    isDeepStrictEqual(resources, comparable(after)),
    "identical code, runtime and non-secret bindings"
  );
  const oldNames = secretNames(before);
  requireEvidence(
    !oldNames.includes(addedSecret) &&
      isDeepStrictEqual(secretNames(after), [...oldNames, addedSecret].sort()),
    "only the declared secret name was added"
  );
  return coreSecretReconciliationSchema.parse({
    kind: KIND,
    controlSha: input.controlSha,
    supersededReceipt: {
      evidenceSha: baseline.evidenceSha,
      sourceSha: baseline.sha,
    },
    baselineIdentity: identity,
    addedSecret,
    deployedAt: active.created_on,
    scriptEtag: resources.script.etag,
    resourceDigest: digest(resources),
    inheritedProjectionTag: identity.projectionTag,
    tagDroppedBySecretUpdate: !after.annotations?.["workers/tag"],
    secretValuesUnobservable: true,
  });
}

export async function reconcileCoreSecretEvidence(input) {
  const previous = await input.readEvidence();
  const retained = previous?.reconciliation?.kind === KIND;
  const proof = await input.verifyProvenance(previous);
  const identity = await input.verifyLive();
  requireEvidence(
    identity.proof === PROOF &&
      identity.sourceSha === previous.sha &&
      !identity.projectionTag,
    "exact successor identity without an invented provider tag"
  );
  const operationKey = digest({
    kind: KIND,
    sourceSha: previous.sha,
    proof,
    identity,
  });
  if (retained) {
    requireEvidence(
      isDeepStrictEqual(previous.reconciliation, proof) &&
        previous.receipt.operationKey === operationKey &&
        isDeepStrictEqual(previous.receipt.identity, identity),
      "unchanged retained attempt"
    );
  }
  const check = async () => {
    await input.verifyAlignment(proof);
    requireEvidence(
      isDeepStrictEqual(await input.verifyProvenance(previous), proof) &&
        isDeepStrictEqual(await input.verifyLive(), identity),
      "unchanged live evidence after verification"
    );
  };
  if (input.verifyOnly) {
    await check();
    return { mode: "verification-only", identity, proof };
  }
  const receipt = retained
    ? previous.receipt
    : {
        attemptId: randomUUID(),
        componentIndex: 0,
        operationKey,
        startedAt: new Date().toISOString(),
        status: "applied",
        application: "applied",
        identity,
      };
  const publish = (status, withProof = false) =>
    input.publishEvidence({
      sourceSha: previous.sha,
      scopes: ["core"],
      receipts: { core: { ...receipt, status } },
      ...(withProof ? { reconciliation: { core: proof } } : {}),
    });
  if (!retained) {
    await publish("applied", true);
  }
  try {
    await check();
  } catch (error) {
    if (!["failed", "verified"].includes(receipt.status)) {
      await publish("failed");
    }
    throw error;
  }
  if (receipt.status !== "verified") {
    await publish("verified");
  }
  return { mode: "reconciled", identity };
}

function command(cwd, binary, args) {
  return execFileSync(binary, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}
export function runCoreSecretReconciliation(input) {
  const cwd = path.resolve(input.cwd);
  const controlRoot = fileURLToPath(new URL("../../", import.meta.url));
  const sourceSha = command(cwd, "git", ["rev-parse", "HEAD"]).trim();
  const controlSha = command(controlRoot, "git", ["rev-parse", "HEAD"]).trim();
  const sourceCheck = () => {
    requireEvidence(
      command(cwd, "git", ["rev-parse", "HEAD"]).trim() === sourceSha &&
        command(cwd, "git", ["status", "--porcelain"]).trim() === "",
      "clean fixed product source"
    );
    requireEvidence(
      REPOSITORY.test(
        command(cwd, "git", ["remote", "get-url", "origin"]).trim()
      ),
      "production repository"
    );
    assertProductionReleaseSource({ cwd, sourceSha });
    if (!input.verifyOnly) {
      requireEvidence(
        command(controlRoot, "git", ["rev-parse", "HEAD"]).trim() ===
          controlSha &&
          command(controlRoot, "git", ["status", "--porcelain"]).trim() ===
            "" &&
          command(controlRoot, "git", [
            "ls-remote",
            "origin",
            "refs/heads/main",
          ])
            .trim()
            .split(WHITESPACE)[0] === controlSha,
        "clean current-main control"
      );
    }
  };
  sourceCheck();
  const readJson = (args) =>
    JSON.parse(
      command(cwd, "pnpm", [
        "exec",
        "wrangler",
        ...args,
        ...CORE_ARGS,
        "--json",
      ])
    );
  const readBaseline = (previous) => {
    if (previous?.reconciliation?.kind !== KIND) {
      return previous;
    }
    const proof = previous.reconciliation;
    const raw = JSON.parse(
      command(cwd, "git", [
        "show",
        "-s",
        "--format=%B",
        proof.supersededReceipt.evidenceSha,
      ])
    );
    return {
      receipt: raw.receipt,
      sha: raw.sourceSha,
      recordedAt: raw.recordedAt,
      evidenceSha: proof.supersededReceipt.evidenceSha,
    };
  };
  const execute = () =>
    reconcileCoreSecretEvidence({
      verifyOnly: input.verifyOnly,
      readEvidence: () => {
        const previous = readGuardedLocalReleaseSources({ cwd }).get("core");
        requireEvidence(
          previous?.sha === sourceSha,
          "same-source canonical receipt"
        );
        return previous;
      },
      verifyProvenance: (previous) => {
        sourceCheck();
        const baseline = readBaseline(previous);
        return assessCoreSecretSuccessor({
          baseline,
          controlSha:
            previous?.reconciliation?.kind === KIND
              ? previous.reconciliation.controlSha
              : controlSha,
          deployments: readJson(["deployments", "list"]),
          before: readJson([
            "versions",
            "view",
            baseline.receipt.identity.versionId,
          ]),
          after: readJson(["versions", "view", input.versionId]),
          ...input,
        });
      },
      verifyLive: () =>
        verifyWorkerDeployment({
          cwd,
          sourceSha,
          target: { workerName: "openmeld-core-prod", args: CORE_ARGS },
          expected: {
            deploymentId: input.deploymentId,
            versionId: input.versionId,
            proof: PROOF,
          },
          runCommand: (spec) =>
            spawnSync(spec.command, spec.args, {
              cwd: spec.cwd,
              env: spec.env,
              encoding: "utf8",
            }),
        }),
      verifyAlignment: async (proof) => {
        const projection = await readCurrentCliProjectionTarget({ cwd });
        requireEvidence(
          projection.expectedCoreTag === proof.inheritedProjectionTag,
          "inherited compiled projection still matches the immutable stable CLI"
        );
        await verifyStableNpmIdentity({
          version: projection.channelVersion,
          sourceSha: projection.tagCommitSha,
        });
        const binary = await probeCliBinaryStage({
          cwd,
          env: process.env,
          adapters: { fetch },
          target: {
            version: projection.channelVersion,
            serviceVersion:
              projection.releaseManifest.components.service.bundleVersion,
            minRequiredCliVersion: projection.minRequiredCliVersion,
            headSha: projection.tagCommitSha,
            tagName: projection.tagName,
          },
        });
        requireEvidence(binary.action === "SKIP", "published binary identity");
      },
      publishEvidence: (event) => {
        sourceCheck();
        return publishGuardedLocalReleaseEvidence({ cwd, ...event });
      },
    });
  return input.verifyOnly
    ? execute()
    : executeWithProductionScopeLeases({
        sourceSha,
        scopes: ["core", "cli"],
        owner: resolveLocalReleaseOwner(),
        execute,
        adapters: {
          acquireProductionScopeLease: (options) =>
            acquireProductionScopeLease({ cwd, ...options }),
          releaseProductionScopeLease: (options) =>
            releaseProductionScopeLease({ cwd, ...options }),
        },
      });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const options = {};
  const names = {
    "--release-source": "cwd",
    "--deployment": "deploymentId",
    "--version": "versionId",
    "--added-secret": "addedSecret",
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verify-only") {
      options.verifyOnly = true;
      continue;
    }
    const name = names[args[i]];
    if (!name || options[name] || !args[i + 1]) {
      throw new Error(
        "Use --release-source <path> --deployment <id> --version <id> --added-secret <name> [--verify-only]."
      );
    }
    options[name] = args[++i];
  }
  if (Object.values(names).some((name) => !options[name])) {
    throw new Error("Missing required reconciliation argument.");
  }
  try {
    console.log(JSON.stringify(await runCoreSecretReconciliation(options)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
