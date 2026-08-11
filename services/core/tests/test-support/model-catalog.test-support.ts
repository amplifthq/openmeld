import { readModelCatalog } from "../../src/config/model-catalog";

export function readAvailableModelIds(agentControllerId: string): string[] {
  const controller = readModelCatalog().agentControllers[agentControllerId];
  if (!controller) {
    throw new Error(`Missing model catalog for ${agentControllerId}.`);
  }
  return controller.models
    .filter((model) => !model.unavailable)
    .map((model) => model.id);
}
