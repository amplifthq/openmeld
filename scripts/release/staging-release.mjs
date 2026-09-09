#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const STAGING_ENTRY_POINTS = [
  "https://staging.openmeld.ai/guide.md",
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
  const skipContainers = argv.includes("--containers-rollout=none");
  const args = argv.filter(
    (arg) => arg !== "--" && arg !== "--containers-rollout=none"
  );
  const command = args[0];
  if (!STAGING_COMMANDS.has(command)) {
    throw new Error("Staging release command must be plan, deploy, or verify.");
  }
  if (skipContainers && (command === "verify" || args.includes("web"))) {
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
      "Staging deploy scope must use --scope web or --scope remote-agent."
    );
  }
  const scope = args[2];
  if (!STAGING_SCOPED_WORKERS.has(scope)) {
    throw new Error(
      "Staging deploy scope must be web or remote-agent. Use the full deploy for database-backed components."
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
    assertCleanWorktree();
  }

  for (const step of steps) {
    process.stdout.write(`\n[staging-release] ${step.label}\n`);
    if (step.urls) {
      await verifyEntryPoints(step.urls);
      continue;
    }
    runStep(step);
  }
  process.stdout.write(`\n[staging-release] ${input.command} passed.\n`);
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
