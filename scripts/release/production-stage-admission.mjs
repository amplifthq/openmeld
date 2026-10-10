#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

import { expandRequestedReleaseScopes } from "./production-release.mjs";
import { collectProductionReleaseStatus } from "./production-release-status.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const HOSTED_SCOPE_ALIASES = new Map([
  ["database", "db"],
  ["database-auth", "db,auth"],
  ["database-core", "db,core"],
]);

export function assertProductionStageAdmission(input) {
  const selected = new Set(input.selectedScopes);
  const pendingComponents = input.components.filter(
    (component) => component.state === "pending"
  );
  const pendingScopes = pendingComponents.map((component) => component.scope);
  // The planner inspected each receipt baseline, including semantic changes
  // such as Task Inbox retirement. Recombining paths here loses that proof and
  // can reverse a receiver/producer dependency.
  const dependencies = pendingComponents.flatMap((component) =>
    (component.compatibilityDependencies ?? [])
      .filter(([, producer]) => producer === component.scope)
      .map((edge) => ({ component, edge }))
  );
  const required = new Set(selected);
  for (let previousSize = -1; previousSize !== required.size; ) {
    previousSize = required.size;
    for (const dependency of dependencies) {
      const [receiver, producer] = dependency.edge;
      if (
        required.has(producer) &&
        !isProductionCompatibilityReceiverSatisfied(
          input.components,
          dependency.component,
          dependency.edge,
          input.sourceSha
        )
      ) {
        required.add(receiver);
      }
    }
  }
  const unresolved = input.components.filter(
    (component) =>
      component.state === "unknown" &&
      required.has(component.scope) &&
      !(
        selected.has(component.scope) &&
        (component.recovery?.kind === "guarded-health-resume" ||
          (component.scope === "db" &&
            component.recovery?.kind === "guarded-postgresql-forward-retry") ||
          (component.scope === "core" &&
            component.recovery?.kind === "guarded-core-upload-retry")) &&
        component.recovery.admission === "candidate" &&
        component.recovery.sourceSha === input.sourceSha
      )
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

  // A multi-scope selection is intent, not proof that Core's receiver has
  // deployed. Remote must enter a later, receipt-verified stage.
  const coreMustPrecedeRemote =
    selected.has("remote-agent") &&
    dependencies.some(
      ({ component, edge }) =>
        edge[0] === "core" &&
        edge[1] === "remote-agent" &&
        !isProductionCompatibilityReceiverSatisfied(
          input.components,
          component,
          edge,
          input.sourceSha
        )
    );
  const prerequisiteScopes = [...required].filter(
    (scope) =>
      !(
        (selected.has(scope) && !(scope === "core" && coreMustPrecedeRemote)) ||
        input.components.some(
          (component) =>
            component.scope === scope && component.state === "current"
        )
      )
  );
  if (prerequisiteScopes.length > 0) {
    throw new Error(
      `Production stage ${input.selectedScopes.join(", ")} is ahead of pending prerequisite ${prerequisiteScopes.join(", ")}. Complete the compatibility prerequisite through its current guarded workflow and verified receipt, then rerun this preflight. Do not bypass the guard or substitute the latest CLI tag as a fleet baseline.`
    );
  }
  return {
    pendingScopes,
    prerequisiteScopes,
    selectedScopes: input.selectedScopes,
  };
}

export function isProductionCompatibilityReceiverSatisfied(
  components,
  producerComponent,
  edge,
  sourceSha
) {
  const [receiver, producer] = edge;
  const receiverComponent = components.find(
    (component) => component.scope === receiver
  );
  if (receiverComponent?.state === "current") {
    return true;
  }
  if (receiverComponent?.state !== "pending") {
    return false;
  }
  const obligations = (producerComponent.compatibilityObligations ?? []).filter(
    (obligation) =>
      obligation.receiver === receiver && obligation.producer === producer
  );
  // A matching pair does not prove its other contracts, including contracts
  // with no witness. Missing obligation metadata cannot admit a pending receiver.
  return (
    obligations.length > 0 &&
    obligations.every((obligation) =>
      (producerComponent.compatibilityReceiverWitnesses ?? []).some(
        (witness) =>
          witness.receiver === receiver &&
          witness.producer === producer &&
          witness.contracts?.includes(obligation.contract) &&
          witness.evidence?.result === "match" &&
          witness.evidence.baselineSha === receiverComponent.sha &&
          witness.evidence.targetSha === sourceSha
      )
    )
  );
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
  const sourceBlockers = status.sourceValidationBlockers ?? status.blockers;
  if (sourceBlockers.length > 0) {
    throw new Error(
      `Production train preflight is blocked: ${sourceBlockers
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
