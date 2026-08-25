import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_SEED_PATH = path.join(
  "services",
  "remote-agent",
  "evals",
  "center-agent-tool-choice-seeds.json"
);

export function readCenterAgentToolChoiceSeeds(input = {}) {
  const repoRoot = input.repoRoot ?? path.resolve(import.meta.dirname, "../..");
  return parseCenterAgentToolChoiceSeeds(
    JSON.parse(readFileSync(path.join(repoRoot, DEFAULT_SEED_PATH), "utf8"))
  );
}

export function parseCenterAgentToolChoiceSeeds(value) {
  if (!(isRecord(value) && value.v === 1 && Array.isArray(value.cases))) {
    throw new Error("Center Agent tool-choice seeds must use version 1.");
  }
  const ids = new Set();
  for (const entry of value.cases) {
    if (!(isRecord(entry) && nonEmpty(entry.id) && nonEmpty(entry.prompt))) {
      throw new Error(
        "Every Center Agent tool-choice seed needs an id and prompt."
      );
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate Center Agent tool-choice seed ${entry.id}.`);
    }
    ids.add(entry.id);
    const expected = entry.expected;
    if (
      !(
        isRecord(expected) &&
        ["forbidden", "optional", "required"].includes(expected.toolPolicy) &&
        Array.isArray(expected.mustCallAny) &&
        expected.mustCallAny.every(nonEmpty)
      )
    ) {
      throw new Error(`Center Agent tool-choice seed ${entry.id} is invalid.`);
    }
  }
  return value;
}

export function evaluateCenterAgentToolChoiceTrace(seed, trace) {
  const called = new Set(trace.calledCapabilities ?? []);
  const expected = seed.expected;
  const requiredCapabilityObserved =
    expected.mustCallAny.length === 0 ||
    expected.mustCallAny.some((name) => called.has(name));
  const toolPolicySatisfied =
    expected.toolPolicy === "optional" ||
    (expected.toolPolicy === "forbidden"
      ? called.size === 0
      : called.size > 0 && requiredCapabilityObserved);
  const budgetContinuationSatisfied =
    !(expected.mustNotFinishAtToolBudget && trace.budgetExhausted) ||
    trace.taskState === "active" ||
    (trace.taskState === "finished" && trace.taskOutcome === "completed");
  return {
    budgetContinuationSatisfied,
    passed: toolPolicySatisfied && budgetContinuationSatisfied,
    requiredCapabilityObserved,
    toolPolicySatisfied,
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
