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
