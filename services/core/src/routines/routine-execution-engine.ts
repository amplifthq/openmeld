import type { CoreBindings } from "../lib/bindings";

export const ROUTINE_EXECUTION_ENGINES = ["legacy", "workflow"] as const;

export type RoutineExecutionEngine = (typeof ROUTINE_EXECUTION_ENGINES)[number];

export type RoutineExecutionEngineSelection = {
  engine: RoutineExecutionEngine;
  source: "default" | "legacy_organization_override";
};

const DEFAULT_ROUTINE_EXECUTION_ENGINE: RoutineExecutionEngine = "workflow";

export function resolveRoutineExecutionEngine(input: {
  env: CoreBindings;
  organizationId: string;
}): RoutineExecutionEngine {
  return resolveRoutineExecutionEngineSelection(input).engine;
}

export function resolveRoutineExecutionEngineSelection(input: {
  env: CoreBindings;
  organizationId: string;
}): RoutineExecutionEngineSelection {
  const defaultEngine = parseRoutineExecutionEngine(
    input.env.OPENMELD_ROUTINE_ENGINE_DEFAULT
  );
  const legacyOrganizationIds = parseOrganizationIdSet(
    input.env.OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS
  );
  if (legacyOrganizationIds.has(input.organizationId)) {
    return { engine: "legacy", source: "legacy_organization_override" };
  }
  return { engine: defaultEngine, source: "default" };
}

export function assertRoutineWorkflowConfiguration(env: CoreBindings): void {
  const defaultEngine = parseRoutineExecutionEngine(
    env.OPENMELD_ROUTINE_ENGINE_DEFAULT
  );
  if (defaultEngine === "workflow" && !env.OPENMELD_ROUTINE_RUN_WORKFLOW) {
    throw new Error(
      "OPENMELD_ROUTINE_RUN_WORKFLOW is required when the Workflow Routine engine is enabled"
    );
  }
}

function parseRoutineExecutionEngine(
  value: string | undefined
): RoutineExecutionEngine {
  const normalized = value?.trim() || DEFAULT_ROUTINE_EXECUTION_ENGINE;
  if (normalized === "legacy" || normalized === "workflow") {
    return normalized;
  }
  throw new Error(
    `OPENMELD_ROUTINE_ENGINE_DEFAULT must be legacy or workflow; received ${JSON.stringify(value)}`
  );
}

function parseOrganizationIdSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((organizationId) => organizationId.trim())
      .filter(Boolean)
  );
}
