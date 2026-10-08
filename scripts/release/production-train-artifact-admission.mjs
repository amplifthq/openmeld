#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { verifyPublishedNpmCliArtifact } from "./npm-cli-artifact.mjs";
import { checkProductionArtifact } from "./production-artifact-check.mjs";
import {
  buildProductionReleasePlan,
  expandRequestedReleaseScopes,
} from "./production-release.mjs";
import {
  admissionIdentity,
  admissionSha256,
  isCoordinatedRelease,
  PARENT_ADMISSION_ENV,
  parseAdmissionEvidence,
  restoreParentRendererArtifact,
  verifyParentAdmission,
} from "./production-train-admission-evidence.mjs";
import { admitCliNpmArtifact } from "./release-cli-resume.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ARTIFACT_ID_PATTERN = /^[1-9][0-9]*$/u;
export const PRODUCTION_TRAIN_SCOPES_ENV = "OPENMELD_PRODUCTION_TRAIN_SCOPES";

export function resolveProductionTrain(input, dependencies = {}) {
  const sourceSha = String(input.sourceSha ?? "").trim();
  if (!EXACT_SHA_PATTERN.test(sourceSha)) {
    throw new Error("Production train requires an exact source SHA.");
  }
  const declaredScopes = String(
    input.env?.[PRODUCTION_TRAIN_SCOPES_ENV] ?? ""
  ).trim();
  if (!declaredScopes) {
    throw new Error(
      `Production train scopes must be declared in ${PRODUCTION_TRAIN_SCOPES_ENV}.`
    );
  }
  const declaredTokens = declaredScopes
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const desktopSelected = declaredTokens.includes("desktop");
  const productionDeclaration = declaredTokens
    .filter((scope) => scope !== "desktop")
    .join(",");
  const buildPlan = dependencies.buildPlan ?? buildProductionReleasePlan;
  const plan = productionDeclaration
    ? buildPlan({
        affectedPackages: [],
        changedPaths: [],
        scope: productionDeclaration,
        sourceSha,
      })
    : { scopes: [], sourceSha };
  if (plan.sourceSha !== sourceSha) {
    throw new Error("Production train plan changed the exact source SHA.");
  }
  if (!Array.isArray(plan.scopes)) {
    throw new Error("Production train plan resolved no release scopes.");
  }
  const expandScopes =
    dependencies.expandScopes ?? expandRequestedReleaseScopes;
  const selectedTokens = String(input.selectedScopes ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const selectedDesktop = selectedTokens.includes("desktop");
  const selectedProductionDeclaration = selectedTokens
    .filter((scope) => scope !== "desktop")
    .join(",");
  const selectedProductionScopes = selectedProductionDeclaration
    ? expandScopes(selectedProductionDeclaration)
    : [];
  if (!Array.isArray(selectedProductionScopes)) {
    throw new Error(
      "Production train admission requires explicit selected scopes."
    );
  }
  const selectedScopes = [
    ...selectedProductionScopes,
    ...(selectedDesktop ? ["desktop"] : []),
  ];
  if (!Array.isArray(selectedScopes) || selectedScopes.length === 0) {
    throw new Error(
      "Production train admission requires explicit selected scopes."
    );
  }
  const scopes = [...plan.scopes, ...(desktopSelected ? ["desktop"] : [])];
  const outsideTrain = selectedScopes.filter(
    (scope) => !scopes.includes(scope)
  );
  if (outsideTrain.length > 0) {
    throw new Error(
      `Selected production scopes are outside the declared train: ${outsideTrain.join(", ")}.`
    );
  }
  return {
    artifactScopes: ["cli", "desktop", "web", "website", "docs"].filter(
      (scope) => selectedScopes.includes(scope)
    ),
    productionScopes: [...plan.scopes],
    selectedScopes: [...selectedScopes],
    scopes,
    sourceSha: plan.sourceSha,
  };
}

async function admitTrainCliArtifact(input, dependencies) {
  let publishedIntegrity;
  const result = await (dependencies.checkNpmArtifact ?? admitCliNpmArtifact)({
    cwd: input.root,
    env: input.env,
    sourceSha: input.sourceSha,
    ...(input.issueParentEvidence
      ? {
          adapters: {
            verifyNpmArtifact: async (request) => {
              await verifyPublishedNpmCliArtifact(request);
              publishedIntegrity = request.metadata.dist.integrity;
            },
          },
        }
      : {}),
  });
  return input.issueParentEvidence
    ? {
        scope: "cli",
        integrity: result.artifact?.integrity ?? publishedIntegrity,
      }
    : undefined;
}

async function admitTrainRendererArtifact(input, scope, dependencies) {
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    return await (dependencies.checkArtifact ?? checkProductionArtifact)({
      root: input.root,
      scope,
      sourceSha: input.sourceSha,
    });
  } finally {
    // Vite preview sets NODE_ENV in this process. A preceding Desktop SSR check
    // must not change the Web build inputs relative to a fresh downstream job.
    if (previousNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
}

async function buildProductionTrainArtifacts(input, dependencies = {}) {
  const train = resolveProductionTrain(input, dependencies);
  let identity;
  if (input.issueParentEvidence) {
    if (input.env.GITHUB_JOB !== "validate_release_source") {
      throw new Error(
        "Only validate_release_source can issue parent admission evidence."
      );
    }
    identity = await (dependencies.readAdmissionIdentity ?? admissionIdentity)(
      input
    );
  }
  const checkoutSha = String(
    (
      dependencies.readHeadSha ??
      ((root) =>
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim())
    )(input.root)
  ).trim();
  if (checkoutSha !== train.sourceSha) {
    throw new Error(
      "Production train source must be the checked-out release SHA."
    );
  }
  const artifacts = {
    cli: "not_required",
    desktop: "not_required",
    web: "not_required",
    website: "not_required",
    docs: "not_required",
  };
  const artifactEvidence = [];
  for (const scope of train.artifactScopes) {
    if (scope === "cli") {
      const evidence = await admitTrainCliArtifact(input, dependencies);
      if (input.issueParentEvidence) {
        artifactEvidence.push(evidence);
      }
    } else {
      const result = await admitTrainRendererArtifact(
        input,
        scope,
        dependencies
      );
      if (input.issueParentEvidence) {
        artifactEvidence.push({
          scope,
          inputIdentity: result.inputIdentity,
          artifactSha256: result.artifactSha256,
          runtime: result.runtime,
          receiptSha256: admissionSha256(
            await readFile(
              path.join(
                input.root,
                "dev-tmp/release-artifact-check",
                `${scope}.json`
              )
            )
          ),
        });
      }
    }
    artifacts[scope] = "verified";
  }
  if (input.issueParentEvidence) {
    const evidence = parseAdmissionEvidence(
      JSON.stringify({
        version: 1,
        sourceSha: train.sourceSha,
        scopes: train.scopes,
        artifactScopes: train.artifactScopes,
        ...identity,
        artifacts: artifactEvidence,
      })
    );
    // Re-read exact clean inputs after every heavy check, before emitting proof.
    await verifyParentAdmission(
      {
        ...input,
        env: { ...input.env, [PARENT_ADMISSION_ENV]: JSON.stringify(evidence) },
      },
      train,
      dependencies
    );
    return { ...train, artifacts, parentEvidence: evidence };
  }
  return { ...train, artifacts };
}

export async function admitProductionTrainArtifacts(input, dependencies = {}) {
  if (input.issueParentEvidence) {
    if (input.env[PARENT_ADMISSION_ENV]) {
      throw new Error(
        "A parent admission issuer cannot reuse parent evidence."
      );
    }
    return buildProductionTrainArtifacts(input, dependencies);
  }
  if (
    isCoordinatedRelease(input.env) ||
    input.env[PARENT_ADMISSION_ENV] ||
    input.restoreRendererArtifact
  ) {
    const train = resolveProductionTrain(input, dependencies);
    const evidence = await verifyParentAdmission(input, train, dependencies);
    for (const scope of ["web", "website", "docs"].filter((scope) =>
      train.selectedScopes.includes(scope)
    )) {
      if (
        !ARTIFACT_ID_PATTERN.test(
          input.env[`OPENMELD_PARENT_${scope.toUpperCase()}_ARTIFACT_ID`] ?? ""
        )
      ) {
        throw new Error(
          `Parent ${scope} admission requires an immutable same-run artifact ID.`
        );
      }
      if (input.restoreRendererArtifact) {
        await restoreParentRendererArtifact(input, evidence, scope);
      }
    }
    if (
      input.restoreRendererArtifact &&
      !train.selectedScopes.some((scope) =>
        ["web", "website", "docs"].includes(scope)
      )
    ) {
      throw new Error(
        "Only a renderer stage can restore a parent renderer artifact."
      );
    }
    return { ...train, parentEvidenceVerified: true };
  }
  return buildProductionTrainArtifacts(input, dependencies);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { values } = parseArgs({
      options: {
        scope: { type: "string" },
        "source-sha": { type: "string" },
        "issue-parent-evidence": { type: "boolean", default: false },
        "restore-renderer-artifact": { type: "boolean", default: false },
      },
    });
    const result = await admitProductionTrainArtifacts({
      env: process.env,
      root: process.cwd(),
      selectedScopes: values.scope,
      sourceSha: values["source-sha"],
      issueParentEvidence: values["issue-parent-evidence"],
      restoreRendererArtifact: values["restore-renderer-artifact"],
    });
    if (result.parentEvidence) {
      if (!process.env.GITHUB_OUTPUT) {
        throw new Error("Parent admission requires GitHub step outputs.");
      }
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `parent_admission_evidence=${JSON.stringify(result.parentEvidence)}\nhas_web_artifact=${result.artifactScopes.includes("web")}\nhas_website_artifact=${result.artifactScopes.includes("website")}\nhas_docs_artifact=${result.artifactScopes.includes("docs")}\n`
      );
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
