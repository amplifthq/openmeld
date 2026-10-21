import { AGENT_CONTROLLER_MODEL_INVENTORY_LIMIT } from "@openmeld/schemas";
import type { ModelCatalogAgentController } from "@openmeld/schemas/types";
import { compareAgentControllerVersions } from "./agent-controller-version";

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
  if (reportedModelIds.has(model.id)) {
    return { status: "supported" };
  }
  // A full bounded report may omit models that the controller still offers.
  // Only an unsaturated, aligned inventory can prove absence.
  if (
    inventoryUsesCatalogIds &&
    (input.reportedModelIds?.length ?? 0) <
      AGENT_CONTROLLER_MODEL_INVENTORY_LIMIT
  ) {
    return { status: "not_offered" };
  }

  if (!(model.minCliVersion && input.installedVersion)) {
    return { status: "unknown" };
  }
  const versionDirection = compareAgentControllerVersions(
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
