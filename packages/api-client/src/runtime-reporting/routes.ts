export const buildRuntimeRegistrationRoute = (deviceId: string): string =>
  `/v1/devices/${encodeURIComponent(deviceId)}/runtime-registration`;

export const buildAgentActivityEventsRoute = (deviceId: string): string =>
  `/v1/devices/${encodeURIComponent(deviceId)}/agent-activity-events`;

export const buildAgentActivitySessionReconciliationRoute = (
  deviceId: string
): string =>
  `/v1/devices/${encodeURIComponent(deviceId)}/agent-activity-session-reconciliation`;

export const buildAgentControllerTaskLifecycleEventsRoute = (
  deviceId: string
): string =>
  `/v1/devices/${encodeURIComponent(deviceId)}/agent-controller-task-lifecycle-events`;

export const buildRuntimeAgentControllerReportsRoute = (
  deviceId: string
): string =>
  `/v1/devices/${encodeURIComponent(deviceId)}/runtime-agent-controller-reports/current`;

export const buildRuntimeProviderConversationProofsRoute = (
  deviceId: string
): string =>
  `/v1/devices/${encodeURIComponent(deviceId)}/runtime-provider-conversation-proofs/current`;
