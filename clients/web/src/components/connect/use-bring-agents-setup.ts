import { useMemo } from "react";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import {
	type ConnectRouteIntent,
	DEFAULT_CONNECT_ROUTE_INTENT,
} from "#/lib/connect/connect-route";

export function useBringAgentsSetup(
	routeIntent: ConnectRouteIntent = DEFAULT_CONNECT_ROUTE_INTENT
) {
	const recovery = useLocalAgentRecoveryController();
	const selectedHumanProfileId = resolveSelectedHumanProfileIdForBringAgents({
		recoverySelectedHumanProfileId: recovery.selectedHumanProfileId,
		routeIntent,
	});
	const targetSpaceId = resolveBringAgentsSetupTargetSpaceId({ routeIntent });
	const sessionExpiredState = recovery.sessionExpiredState;
	const blockingErrorMessage = useMemo(() => {
		if (sessionExpiredState) {
			return sessionExpiredState.message;
		}

		if (recovery.blockingErrorMessage) {
			return recovery.blockingErrorMessage;
		}

		return null;
	}, [recovery.blockingErrorMessage, sessionExpiredState]);

	return {
		agentExecutionReadinessByProfileId:
			recovery.agentExecutionReadinessByProfileId,
		agentExecutionReadinessErrorByProfileId:
			recovery.agentExecutionReadinessErrorByProfileId,
		agentExecutionReadinessPendingProfileIds:
			recovery.agentExecutionReadinessPendingProfileIds,
		agentProfiles: recovery.agentProfiles,
		agentProfilesQuery: recovery.agentProfilesQuery,
		blockingErrorMessage,
		currentDeviceTargetQuery: recovery.currentDeviceTargetQuery,
		currentLocalRuntimeReplyReadinessQuery:
			recovery.currentLocalRuntimeReplyReadinessQuery,
		deviceId: recovery.deviceId,
		ensureError: null,
		ensureStatus: "ready" as const,
		forgetThisComputer: recovery.forgetThisComputer,
		gatewayLoadState: recovery.gatewayLoadState,
		loadGatewayUrl: recovery.loadGatewayUrl,
		localPreparationState: recovery.localPreparationState,
		localAgentCatalogEntries: recovery.localAgentCatalogEntries,
		localRuntimesQuery: recovery.localRuntimesQuery,
		refreshAll: recovery.refreshAll,
		runContext: recovery.runContext,
		runtimeLane: recovery.runtimeLane,
		selectedTargetDevice: recovery.selectedTargetDevice,
		sessionExpiredState,
		selectedHumanProfile: recovery.selectedHumanProfile,
		selectedHumanProfileId,
		otherLocalRuntimes: recovery.otherLocalRuntimes,
		currentComputer: recovery.currentComputer,
		targetSpaceId,
	};
}

function resolveSelectedHumanProfileIdForBringAgents(input: {
	recoverySelectedHumanProfileId: string | null;
	routeIntent: ConnectRouteIntent;
}): string | null {
	if (input.routeIntent.kind === "space_recovery") {
		return input.routeIntent.profileId ?? input.recoverySelectedHumanProfileId;
	}
	return input.recoverySelectedHumanProfileId;
}

function resolveBringAgentsSetupTargetSpaceId(input: {
	routeIntent: ConnectRouteIntent;
}): string | null {
	if (input.routeIntent.kind === "space_recovery") {
		return input.routeIntent.spaceId;
	}
	return null;
}
