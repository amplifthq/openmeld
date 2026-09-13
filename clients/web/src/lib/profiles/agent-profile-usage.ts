import type {
	GetAgentExecutionReadinessResponse,
	OrganizationComputerRecord,
} from "@openmeld/schemas/types";

export function resolveAgentProfileUsage(
	readiness:
		| Pick<
				GetAgentExecutionReadinessResponse,
				"routeDeviceId" | "ownerUserId" | "agentControllerRef"
		  >
		| undefined,
	computers: readonly Pick<
		OrganizationComputerRecord,
		"computerId" | "ownerUserId" | "deviceDisplayName" | "localAgents"
	>[]
) {
	if (
		!(
			readiness?.routeDeviceId &&
			readiness.ownerUserId &&
			readiness.agentControllerRef
		)
	) {
		return null;
	}
	const computer = computers.find(
		(item) =>
			item.computerId === readiness.routeDeviceId &&
			item.ownerUserId === readiness.ownerUserId
	);
	const limits = computer?.localAgents.find(
		(agent) => agent.agentControllerRef === readiness.agentControllerRef
	)?.details?.usageLimits;
	return limits?.length && computer
		? { computerName: computer.deviceDisplayName, limits }
		: null;
}
