import type { ModelCatalogAgentController } from "@openmeld/schemas/types";

const SEMANTIC_VERSION_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/u;

export type AgentControllerModelCompatibility =
  | { status: "supported" }
  | { status: "catalog_unavailable" }
  | { status: "not_offered" }
  | {
      currentVersion: string;
      minimumVersion: string;
      status: "requires_newer_controller";
    }
  | { status: "unknown" };

export function resolveAgentControllerModelCompatibility(input: {
  controller: ModelCatalogAgentController;
  installedVersion: string | null;
  modelId: string;
  reportedModelIds: readonly string[] | null;
}): AgentControllerModelCompatibility {
  const model = input.controller.models.find(
    (candidate) => candidate.id === input.modelId
  );
  if (!model) {
    return { status: "unknown" };
  }
  if (model.unavailable) {
    return { status: "catalog_unavailable" };
  }

  const reportedModelIds = new Set(input.reportedModelIds ?? []);
  const inventoryUsesCatalogIds = input.controller.models.some((candidate) =>
    reportedModelIds.has(candidate.id)
  );
  if (inventoryUsesCatalogIds) {
    return reportedModelIds.has(model.id)
      ? { status: "supported" }
      : { status: "not_offered" };
  }

  if (!(model.minCliVersion && input.installedVersion)) {
    return { status: "unknown" };
  }
  const versionDirection = compareSemanticVersions(
    input.installedVersion,
    model.minCliVersion
  );
  if (versionDirection === null) {
    return { status: "unknown" };
  }
  if (versionDirection < 0) {
    return {
      currentVersion: input.installedVersion,
      minimumVersion: model.minCliVersion,
      status: "requires_newer_controller",
    };
  }
  return { status: "supported" };
}

type ParsedSemanticVersion = {
  core: readonly [number, number, number];
  prerelease: readonly string[];
};

function compareSemanticVersions(left: string, right: string): number | null {
  const parsedLeft = parseSemanticVersion(left);
  const parsedRight = parseSemanticVersion(right);
  if (!(parsedLeft && parsedRight)) {
    return null;
  }
  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    const direction =
      (parsedLeft.core[index] ?? 0) - (parsedRight.core[index] ?? 0);
    if (direction !== 0) {
      return direction;
    }
  }
  return comparePrereleaseIdentifiers(
    parsedLeft.prerelease,
    parsedRight.prerelease
  );
}

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  const match = SEMANTIC_VERSION_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const core = match.slice(1, 4).map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) {
    return null;
  }
  return {
    core: [core[0] ?? 0, core[1] ?? 0, core[2] ?? 0],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrereleaseIdentifiers(
  left: readonly string[],
  right: readonly string[]
): number {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) {
      return 0;
    }
    return left.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    return comparePrereleaseIdentifier(leftPart, rightPart);
  }
  return 0;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(left);
  const rightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return left.localeCompare(right, "en");
}
