#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { checkProductionArtifact } from "./production-artifact-check.mjs";
import {
  buildProductionReleasePlan,
  expandRequestedReleaseScopes,
} from "./production-release.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
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
    artifactScopes: [
      ...(desktopSelected ? ["desktop"] : []),
      ...(plan.scopes.includes("web") ? ["web"] : []),
    ],
    productionScopes: [...plan.scopes],
    selectedScopes: [...selectedScopes],
    scopes,
    sourceSha: plan.sourceSha,
  };
}

export async function admitProductionTrainArtifacts(input, dependencies = {}) {
  const train = resolveProductionTrain(input, dependencies);
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
  const artifacts = { desktop: "not_required", web: "not_required" };
  for (const scope of train.artifactScopes) {
    await (dependencies.checkArtifact ?? checkProductionArtifact)({
      root: input.root,
      scope,
      sourceSha: train.sourceSha,
    });
    artifacts[scope] = "verified";
  }
  return { ...train, artifacts };
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
      },
    });
    const result = await admitProductionTrainArtifacts({
      env: process.env,
      root: process.cwd(),
      selectedScopes: values.scope,
      sourceSha: values["source-sha"],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
