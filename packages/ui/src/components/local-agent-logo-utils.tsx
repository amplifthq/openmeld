import { resolveBuiltinAgentControllerBrand } from "@openmeld/schemas";

export function hasLocalAgentLogo(agentId: string): boolean {
  return resolveBuiltinAgentControllerBrand(agentId) !== null;
}
