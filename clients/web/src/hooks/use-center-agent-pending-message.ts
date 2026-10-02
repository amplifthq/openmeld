import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { recordReactUpdate } from "#/lib/observability/react-update-trace";
import {
	activateCenterAgentPendingMessageScope,
	type CenterAgentPendingMessageScope,
	readCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";

// The pending and ready routes can overlap an asynchronous attachment save.
// Observe their shared handoff instead of copying it once at mount.
export function useCenterAgentPendingMessage(
	scope: CenterAgentPendingMessageScope
) {
	const client = useQueryClient();
	const { organizationId, organizationSlug, sessionId } = scope;
	useEffect(() => {
		recordReactUpdate("center_agent_pending_scope_write");
		activateCenterAgentPendingMessageScope(client, {
			organizationId,
			organizationSlug,
			sessionId,
		});
	}, [client, organizationId, organizationSlug, sessionId]);
	const subscribe = useCallback(
		(notify: () => void) => client.getQueryCache().subscribe(notify),
		[client]
	);
	return useSyncExternalStore(
		subscribe,
		() => readCenterAgentPendingMessage(client, scope),
		() => null
	);
}
