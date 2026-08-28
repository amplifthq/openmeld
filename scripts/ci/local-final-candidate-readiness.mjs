#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { readDevMachineSnapshot } from "../dev/dev-status.mjs";

const GIBIBYTE = 1024 ** 3;
const CRITICAL_DISK_FLOOR_BYTES = GIBIBYTE;
const CONSTRAINED_DISK_FLOOR_BYTES = 8 * GIBIBYTE;

export function evaluateLocalCandidateReadiness(input) {
  const otherActiveStacks = input.activeStacks.filter(
    (stack) =>
      path.resolve(stack.repoRoot) !== path.resolve(input.candidateRoot)
  );
  const otherActiveProcessCount = otherActiveStacks.reduce(
    (sum, stack) => sum + stack.processCount,
    0
  );
  const blocked = input.availableBytes < CRITICAL_DISK_FLOOR_BYTES;
  const constrained =
    !blocked &&
    (input.availableBytes < CONSTRAINED_DISK_FLOOR_BYTES ||
      otherActiveProcessCount > 0);
  let state = "available";
  if (blocked) {
    state = "blocked";
  } else if (constrained) {
    state = "constrained";
  }
  return {
    availableBytes: input.availableBytes,
    blocked,
    candidateRoot: path.resolve(input.candidateRoot),
    otherActiveProcessCount,
    otherActiveStacks,
    state,
  };
}

export function renderLocalCandidateReadiness(readiness) {
  const lines = [
    "Local Final Candidate resource preflight",
    `Candidate root: ${readiness.candidateRoot}`,
    `State: ${readiness.state}`,
    `Available disk: ${(readiness.availableBytes / GIBIBYTE).toFixed(1)} GiB`,
    `Other active dev stacks: ${String(readiness.otherActiveStacks.length)} (${String(readiness.otherActiveProcessCount)} processes)`,
  ];
  if (readiness.blocked) {
    lines.push(
      "Local execution stopped: available disk is below the 1.0 GiB machine-safety floor. Hosted Final Candidate or safe local cleanup remains available."
    );
  } else if (readiness.state === "constrained") {
    lines.push(
      "The local fallback may proceed. These machine facts are informational; they do not decide merge, review, or release scope."
    );
  } else {
    lines.push("No local resource constraint was detected.");
  }
  return `${lines.join("\n")}\n`;
}

export function runLocalFinalCandidateReadiness(input = {}) {
  const candidateRoot = path.resolve(
    input.candidateRoot ??
      parseCandidateRoot(input.argv ?? process.argv.slice(2))
  );
  const snapshot =
    input.snapshot ?? readDevMachineSnapshot({ repoRoot: candidateRoot });
  const readiness = evaluateLocalCandidateReadiness({
    activeStacks: snapshot.activeStacks,
    availableBytes: snapshot.availableBytes,
    candidateRoot,
  });
  (input.write ?? ((value) => process.stdout.write(value)))(
    renderLocalCandidateReadiness(readiness)
  );
  return readiness.blocked ? 1 : 0;
}

function parseCandidateRoot(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--candidate-root") {
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--candidate-root requires a value.");
    }
    return value;
  }
  return process.cwd();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runLocalFinalCandidateReadiness();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
