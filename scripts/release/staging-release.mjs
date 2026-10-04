#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertProductDatabaseReleaseSupported } from "./database-backend-admission.mjs";
import { executeWithProductionScopeLeases } from "./production-release.mjs";
import {
  admitWebsiteDomainRelease,
  executeObservedDomainRelease,
  prepareWebsiteDomains,
  rollbackWebsiteDomains,
} from "./website-domain-migration.mjs";

const STAGING_ENTRY_POINTS = [
  "https://staging.openmeld.ai/",
  "https://app.staging.openmeld.ai/guide.md",
  "https://auth.staging.openmeld.ai/health",
  "https://gateway.staging.openmeld.ai/health",
];
const STAGING_COMMANDS = new Set(["deploy", "plan", "verify"]);
const STAGING_SCOPED_WORKERS = new Map([
  [
    "remote-agent",
    { label: "Remote Agent", packageName: "@openmeld/remote-agent" },
  ],
  ["web", { label: "Web", packageName: "openmeld-web" }],
  ["website", { label: "Website", packageName: "openmeld-website" }],
  ["auth", { label: "Auth", packageName: "@openmeld/auth-worker" }],
]);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStagingRelease(parseStagingReleaseArgs(process.argv.slice(2))).catch(
    (error) => {
      console.error(
        `[staging-release] ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    }
  );
}

export function parseStagingReleaseArgs(argv) {
  const { domainOptions, ordinaryArgs } = splitDomainOptions(argv);
  const result = parseOrdinaryStagingArgs(ordinaryArgs);
  if (Object.keys(domainOptions).length === 0) {
    return result;
  }
  if (
    result.command !== "deploy" ||
    (domainOptions.domainPhase &&
      !["prepare", "rollback"].includes(domainOptions.domainPhase)) ||
    !domainOptions.domainEvidence
  ) {
    throw new Error(
      "Staging domain operations require deploy, an optional prepare/rollback phase, and an evidence file."
    );
  }
  return { ...result, ...domainOptions };
}

function splitDomainOptions(argv) {
  const domainOptions = {};
  const ordinaryArgs = [];
  const argumentsIterator = argv[Symbol.iterator]();
  for (const argument of argumentsIterator) {
    if (["--domain-phase", "--domain-evidence"].includes(argument)) {
      const value = argumentsIterator.next().value;
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      domainOptions[
        argument === "--domain-phase" ? "domainPhase" : "domainEvidence"
      ] = value;
    } else {
      ordinaryArgs.push(argument);
    }
  }
  return { domainOptions, ordinaryArgs };
}

function parseOrdinaryStagingArgs(argv) {
  const skipContainers = argv.includes("--containers-rollout=none");
  const args = argv.filter(
    (arg) => arg !== "--" && arg !== "--containers-rollout=none"
  );
  const command = args[0];
  if (!STAGING_COMMANDS.has(command)) {
    throw new Error("Staging release command must be plan, deploy, or verify.");
  }
  if (
    skipContainers &&
    (command === "verify" ||
      (args.includes("--scope") && !args.includes("remote-agent")))
  ) {
    throw new Error(
      "Container rollout applies only to a Remote Agent deployment."
    );
  }
  const rollout = skipContainers ? { skipContainers: true } : {};
  if (args.length === 1) {
    return { command, scope: null, ...rollout };
  }
  if (command === "verify" || args.length !== 3 || args[1] !== "--scope") {
    throw new Error(
      "Staging deploy scope must use --scope auth, web, website, or remote-agent."
    );
  }
  const scope = args[2];
  if (!STAGING_SCOPED_WORKERS.has(scope)) {
    throw new Error(
      "Staging deploy scope must be auth, web, website, or remote-agent. Use the full deploy for other database-backed components."
    );
  }
  return { command, scope, ...rollout };
}

export function buildStagingDeployStepSpecs(input = {}) {
  if (input.scope) {
    const worker = STAGING_SCOPED_WORKERS.get(input.scope);
    if (!worker) {
      throw new Error(`Unsupported scoped Staging Worker: ${input.scope}.`);
    }
    return [
      environmentContractStep(),
      stagingSecretCheckStep(),
      stagingResourceVerificationStep(),
      workerDeployStep(
        input.scope,
        worker.packageName,
        worker.label,
        input.skipContainers
      ),
      stagingResourceVerificationStep(),
      stagingEntryPointVerificationStep(),
    ];
  }
  return [
    environmentContractStep(),
    stagingSecretCheckStep(),
    stagingComponentStep({
      args: [
        "scripts/cloudflare/provision-openmeld-resources.mjs",
        "--environment",
        "staging",
        "--allow-pending-deploy",
        "--apply",
      ],
      command: "node",
      component: "release",
      label: "Create staging prerequisites",
      mutates: true,
    }),
    stagingComponentStep({
      args: [
        "scripts/cloudflare/bootstrap-openmeld-worker-identities.mjs",
        "--environment",
        "staging",
        "--apply",
      ],
      command: "node",
      component: "release",
      label: "Create staging Worker identities",
      mutates: true,
    }),
    stagingComponentStep({
      args: [
        "--filter",
        "@openmeld/auth-worker",
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "apply",
        "OPENMELD_DB",
        "--config",
        "wrangler.jsonc",
        "--env",
        "stg",
        "--remote",
      ],
      command: "pnpm",
      component: "auth",
      label: "Apply staging database migrations",
      mutates: true,
    }),
    workerDeployStep("auth", "@openmeld/auth-worker", "Auth"),
    workerDeployStep("core", "@openmeld/core", "Core"),
    workerDeployStep("gateway", "@openmeld/gateway", "Gateway"),
    workerDeployStep("web", "openmeld-web", "Web"),
    workerDeployStep(
      "remote-agent",
      "@openmeld/remote-agent",
      "Remote Agent",
      input.skipContainers
    ),
    workerDeployStep("website", "openmeld-website", "Website"),
    stagingResourceVerificationStep(),
    stagingEntryPointVerificationStep(),
  ];
}

export function buildStagingVerifyStepSpecs() {
  return [
    environmentContractStep(),
    stagingSecretCheckStep(),
    stagingResourceVerificationStep(),
    stagingEntryPointVerificationStep(),
  ];
}

async function runStagingRelease(input) {
  const steps =
    input.command === "deploy"
      ? buildStagingDeployStepSpecs(input)
      : buildStagingVerifyStepSpecs();
  if (input.command === "plan") {
    printPlan(buildStagingDeployStepSpecs(input));
    return;
  }
  if (input.command === "deploy") {
    assertProductDatabaseReleaseSupported();
    assertCleanWorktree();
    if (!process.env.CLOUDFLARE_API_TOKEN) {
      runStep(
        stagingComponentStep({
          command: "node",
          args: [
            "scripts/release/staging-release.mjs",
            ...process.argv.slice(2),
          ],
          component: "release",
          label: "Run guarded staging deployment",
          mutates: true,
        })
      );
      return;
    }
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const domainInput = {
      environment: "stg",
      sourceSha,
      scopes: input.scope
        ? [input.scope]
        : ["auth", "core", "gateway", "web", "website"],
      evidencePath: input.domainEvidence,
    };
    // Reuse the existing cross-machine leases. This intentionally serializes
    // the two environments' domain work instead of creating another lock owner.
    await executeWithProductionScopeLeases({
      scopes: ["auth", "web", "website"],
      sourceSha,
      owner: `staging:${process.cwd()}`,
      execute: async () => {
        if (input.domainPhase) {
          runStep(environmentContractStep());
          const operation =
            input.domainPhase === "prepare"
              ? prepareWebsiteDomains
              : rollbackWebsiteDomains;
          const state = await operation(domainInput);
          process.stdout.write(`${JSON.stringify(state)}\n`);
          return;
        }
        const admission = await admitWebsiteDomainRelease(domainInput);
        await executeObservedDomainRelease(domainInput, admission, () =>
          executeStagingSteps(steps)
        );
      },
    });
  } else {
    await executeStagingSteps(steps);
  }
  process.stdout.write(`\n[staging-release] ${input.command} passed.\n`);
}

async function executeStagingSteps(steps) {
  for (const step of steps) {
    process.stdout.write(`\n[staging-release] ${step.label}\n`);
    if (step.urls) {
      await verifyEntryPoints(step.urls);
      continue;
    }
    runStep(step);
  }
}

function environmentContractStep() {
  return {
    args: ["run", "verify:cloudflare:env-contract"],
    command: "pnpm",
    label: "Verify staging environment contracts",
    mutates: false,
  };
}

function stagingSecretCheckStep() {
  return {
    args: ["scripts/dev/doppler-environment.mjs", "doctor:stg"],
    command: "node",
    label: "Check staging secrets",
    mutates: false,
  };
}

function stagingResourceVerificationStep() {
  return stagingComponentStep({
    args: [
      "scripts/cloudflare/provision-openmeld-resources.mjs",
      "--environment",
      "staging",
    ],
    command: "node",
    component: "release",
    label: "Verify staging resources",
    mutates: false,
  });
}

function stagingEntryPointVerificationStep() {
  return {
    label: "Verify staging user entry points",
    mutates: false,
    urls: STAGING_ENTRY_POINTS,
  };
}

function workerDeployStep(
  component,
  packageName,
  label,
  skipContainers = false
) {
  if (component === "remote-agent" && skipContainers) {
    return stagingComponentStep({
      args: [
        "--filter",
        packageName,
        "exec",
        "sh",
        "-c",
        "pnpm run sync:secrets:stg && pnpm run deploy:stg --containers-rollout=none",
      ],
      command: "pnpm",
      component,
      label: `Deploy staging ${label} (keep existing containers)`,
      mutates: true,
    });
  }
  return stagingComponentStep({
    args: ["--filter", packageName, "run", "sync:stg"],
    command: "pnpm",
    component,
    label: `Deploy staging ${label}`,
    mutates: true,
  });
}

function stagingComponentStep(input) {
  return {
    args: [
      "scripts/dev/doppler-environment.mjs",
      "component:stg",
      input.component,
      "--",
      input.command,
      ...input.args,
    ],
    command: "node",
    label: input.label,
    mutates: input.mutates,
  };
}

function printPlan(steps) {
  process.stdout.write("OpenMeld internal staging deployment plan:\n");
  for (const [index, step] of steps.entries()) {
    process.stdout.write(
      `${String(index + 1)}. ${step.label}${step.mutates ? "" : " (read-only)"}\n`
    );
  }
}

function assertCleanWorktree() {
  const changes = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" }
  ).trim();
  if (changes.length > 0) {
    throw new Error(
      "Staging deployment requires a clean worktree so its exact source is recoverable."
    );
  }
}

function runStep(step) {
  const result = spawnSync(step.command, step.args, {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${step.label} failed with exit code ${String(result.status ?? 1)}.`
    );
  }
}

async function verifyEntryPoints(urls) {
  for (const url of urls) {
    const response = await fetch(url, {
      headers: { "user-agent": "openmeld-staging-verifier" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${String(response.status)}.`);
    }
    console.log(`[staging-release] Ready: ${url}`);
  }
}
