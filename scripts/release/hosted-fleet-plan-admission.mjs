#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { checkProductionArtifact } from "./production-artifact-check.mjs";
import { buildProductionReleasePlan } from "./production-release.mjs";
import { collectProductionReleaseStatus } from "./production-release-status.mjs";
import { assertProductionStageAdmission } from "./production-stage-admission.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const STATIC_HOSTED_SCOPE_ORDER = [
  "db",
  "auth",
  "web",
  "gateway",
  "core",
  "remote-agent",
];
const FLEET_SCOPES = new Set(["cloud", "full"]);

export async function admitHostedFleetPlan(input, dependencies = {}) {
  const releaseSha = requireExactSha("release SHA", input.releaseSha);
  const scope = String(input.scope ?? "").trim();
  if (!FLEET_SCOPES.has(scope)) {
    return { releaseSha, scope, skipped: true };
  }

  const releaseSource = String(input.releaseSource ?? "").trim();
  if (!releaseSource) {
    throw new Error("Hosted fleet-plan admission requires a release source.");
  }
  const readHeadSha = dependencies.readHeadSha ?? readReleaseHeadSha;
  const actualHead = requireExactSha(
    "release source HEAD",
    readHeadSha(releaseSource)
  );
  if (actualHead !== releaseSha) {
    throw new Error(
      `Hosted fleet-plan admission expected ${releaseSha}, found ${actualHead}.`
    );
  }

  const status = await (
    dependencies.collectStatus ?? collectProductionReleaseStatus
  )({
    argv: ["--ref", releaseSha],
  });
  if (status.blockers.length) {
    throw new Error(
      `Hosted fleet preflight is blocked: ${status.blockers.map((entry) => `${entry.name}: ${entry.detail}`).join(" | ")}`
    );
  }
  const selected = STATIC_HOSTED_SCOPE_ORDER.filter(
    (entry) => scope === "full" || entry !== "db"
  );
  assertProductionStageAdmission({
    components: status.components,
    selectedScopes: selected,
    sourceSha: releaseSha,
  });
  const changedPaths = [
    ...new Set(
      status.components
        .filter((entry) => entry.state === "pending")
        .flatMap((entry) => entry.changedPaths ?? [])
    ),
  ];
  const buildPlan = dependencies.buildPlan ?? buildProductionReleasePlan;
  const plan = buildPlan({
    changedPaths,
    affectedPackages: [],
    scope,
    sourceSha: releaseSha,
  });
  const deployOrderProfile = String(plan.deployOrderProfile ?? "").trim();
  const deployScopeOrder = requireStringArray(
    "planned deploy scope order",
    plan.deployScopeOrder
  );
  const selectedScopes = new Set(
    requireStringArray("planned release scopes", plan.scopes)
  );
  const supportedScopeOrder = STATIC_HOSTED_SCOPE_ORDER.filter((candidate) =>
    selectedScopes.has(candidate)
  );
  if (!hasSameValuesInOrder(deployScopeOrder, supportedScopeOrder)) {
    throw new Error(
      [
        `Hosted ${scope} release refused before any Production mutation.`,
        `The receipt-based plan at ${releaseSha} requires ${deployOrderProfile || "an unknown deploy order"}: ${deployScopeOrder.join(" -> ") || "no deploy scopes"}.`,
        `release-on-main.yml can execute only: ${supportedScopeOrder.join(" -> ") || "no deploy scopes"}.`,
        "Do not approximate this receiver-first plan with the ordinary hosted fleet workflow.",
        "Inspect the trusted ordered plan from a clean current-main worktree:",
        "  pnpm run release:status -- --json",
        "Use the guarded ordered release path printed by that plan, or add reviewed hosted support for this exact deploy-order profile before retrying.",
      ].join("\n")
    );
  }

  // This parent job completes before Database or any Worker can mutate Production.
  // A separate deploy runner must independently verify its own build output.
  await (dependencies.checkArtifact ?? checkProductionArtifact)({
    root: releaseSource,
    scope: "web",
    sourceSha: releaseSha,
  });
  return {
    deployOrderProfile,
    deployScopeOrder,
    releaseSha,
    scope,
  };
}

function hasSameValuesInOrder(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function requireStringArray(label, value) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(`Hosted fleet-plan admission requires ${label}.`);
  }
  return value;
}

function readReleaseHeadSha(releaseSource) {
  return runGit(releaseSource, ["rev-parse", "HEAD"]);
}

function runGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function requireExactSha(label, value) {
  const normalized = String(value ?? "").trim();
  if (!EXACT_SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be an exact lowercase 40-character SHA.`);
  }
  return normalized;
}

function parseArgs(argv) {
  const options = {
    releaseSha: "",
    releaseSource: "",
    scope: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--release-sha":
        options.releaseSha = readRequiredOption(argv, ++index, argument);
        break;
      case "--release-source":
        options.releaseSource = readRequiredOption(argv, ++index, argument);
        break;
      case "--scope":
        options.scope = readRequiredOption(argv, ++index, argument);
        break;
      default:
        throw new Error(`Unknown hosted fleet-plan option: ${argument}`);
    }
  }
  return options;
}

function readRequiredOption(argv, index, option) {
  const value = String(argv[index] ?? "").trim();
  if (!value) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

async function main(argv) {
  const result = await admitHostedFleetPlan(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
