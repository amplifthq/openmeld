import type { ModelCatalog } from "@openmeld/schemas/types";
import {
  type AgentControllerRef,
  HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "./agent-controller-ref";

/** Personal Remote Agents share the hosted catalog without changing identity. */
export function getAgentControllerModelCatalogId(
  controller: AgentControllerRef
): string {
  return controller.kind === HOSTED_REMOTE_AGENT_CONTROLLER_REF
    ? HOSTED_CENTER_AGENT_CONTROLLER_REF_ID
    : controller.id;
}

/** Remote Agents share hosted choices but own a distinct system default. */
export function getPersonalRemoteAgentDefaultModelId(
  catalog: ModelCatalog
): string | null {
  const controller =
    catalog.agentControllers[HOSTED_CENTER_AGENT_CONTROLLER_REF_ID];
  return (
    controller?.hostedRuntimePolicy?.personalRemoteAgentDefaultModelId ??
    controller?.defaultModelId ??
    null
  );
}
