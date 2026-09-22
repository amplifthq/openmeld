#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildProductionReleasePlan,
  expandRequestedReleaseScopes,
} from "./production-release.mjs";
import { collectProductionReleaseStatus } from "./production-release-status.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const HOSTED_SCOPE_ALIASES = new Map([
  ["database", "db"],
  ["database-auth", "db,auth"],
  ["database-core", "db,core"],
]);

export function assertProductionStageAdmission(input) {
  const unresolved = input.components.filter(
    (component) => component.state === "unknown"
  );
  if (unresolved.length > 0) {
    throw new Error(
      `Production train evidence is unresolved: ${unresolved
        .map(
          (component) =>
            `${component.scope}: ${component.reason ?? "component evidence is unavailable"}`
        )
        .join(" | ")}`
    );
  }

  const pendingComponents = input.components.filter(
    (component) => component.state === "pending"
  );
  const pendingScopes = pendingComponents.map((component) => component.scope);
  if (pendingScopes.length === 0) {
    return {
      pendingScopes: [],
      prerequisiteScopes: [],
      selectedScopes: input.selectedScopes,
    };
  }
  const changedPaths = [
    ...new Set(
      pendingComponents.flatMap((component) => component.changedPaths ?? [])
    ),
  ];
  const pendingPlan = buildProductionReleasePlan({
    affectedPackages: [],
    changedPaths,
    scope: pendingScopes.join(","),
    sourceSha: input.sourceSha,
  });
  const pendingOrder = pendingPlan.deployScopeOrder.filter((scope) =>
    pendingScopes.includes(scope)
  );
  const selectedPending = pendingOrder.filter((scope) =>
    input.selectedScopes.includes(scope)
  );
  if (selectedPending.length === 0) {
    return {
      pendingScopes: pendingOrder,
      prerequisiteScopes: [],
      selectedScopes: input.selectedScopes,
    };
  }
  const lastSelectedIndex = Math.max(
    ...selectedPending.map((scope) => pendingOrder.indexOf(scope))
  );
  const prerequisiteScopes = pendingOrder
    .slice(0, lastSelectedIndex + 1)
    .filter((scope) => !input.selectedScopes.includes(scope));
  if (prerequisiteScopes.length > 0) {
    throw new Error(
      `Production stage ${input.selectedScopes.join(", ")} is ahead of pending prerequisite ${prerequisiteScopes.join(", ")}. Complete the prerequisite through its current guarded workflow and verified receipt, then rerun this preflight. Pending train order: ${pendingOrder.join(" -> ")}. Do not bypass the guard or substitute the latest CLI tag as a fleet baseline.`
    );
  }
  return {
    pendingScopes: pendingOrder,
    prerequisiteScopes,
    selectedScopes: input.selectedScopes,
  };
}

export async function runProductionStageAdmission(input = {}) {
  const sourceSha = String(input.sourceSha ?? "").trim();
  if (!EXACT_SHA_PATTERN.test(sourceSha)) {
    throw new Error("Production stage admission requires an exact source SHA.");
  }
  const selectedScopes = resolveSelectedScopes(input.scope);
  const status = await (input.collectStatus ?? collectProductionReleaseStatus)({
    argv: ["--ref", sourceSha, ...(input.repo ? ["--repo", input.repo] : [])],
    adapters: input.adapters,
  });
  if (status.blockers.length > 0) {
    throw new Error(
      `Production train preflight is blocked: ${status.blockers
        .map((blocker) => `${blocker.name}: ${blocker.detail}`)
        .join(" | ")}`
    );
  }
  const admission = assertProductionStageAdmission({
    components: status.components,
    selectedScopes,
    sourceSha,
  });
  (input.write ?? ((value) => process.stdout.write(value)))(
    [
      "Production stage admission",
      `Source: ${sourceSha}`,
      `Selected scopes: ${selectedScopes.join(", ")}`,
      `Receipt-based pending train: ${admission.pendingScopes.join(" -> ") || "none"}`,
      "Result: PASS",
      "",
    ].join("\n")
  );
  return admission;
}

function resolveSelectedScopes(scope) {
  const normalized = HOSTED_SCOPE_ALIASES.get(String(scope).trim()) ?? scope;
  const scopes = expandRequestedReleaseScopes(normalized);
  if (!scopes) {
    throw new Error("Production stage admission requires an explicit scope.");
  }
  return scopes;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--repo", "--scope", "--source-sha"].includes(key)) {
      throw new Error(`Unknown production stage admission option: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${key} requires a value.`);
    }
    if (key === "--repo") {
      options.repo = value;
    } else if (key === "--scope") {
      options.scope = value;
    } else {
      options.sourceSha = value;
    }
    index += 1;
  }
  if (!options.scope) {
    throw new Error("Production stage admission requires --scope.");
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runProductionStageAdmission(parseOptions(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
