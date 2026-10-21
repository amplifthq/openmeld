import type { AgentAccessRequestView } from "@openmeld/schemas";
import type { WakeProgressItem } from "@openmeld/schemas/types";
import { useMemo } from "react";
import { useAgentAccessRequests } from "#/query/agent-access";

const NO_HELD_WAKES: ReadonlySet<string> = new Set();

function heldWakeKey(sourceSignalId: string, agentProfileId: string): string {
	return `${sourceSignalId}:${agentProfileId}`;
}

/**
 * Wakes the viewer asked for that wait on, or were refused by, the Agent
 * owner. Only an allowed or joined request runs; every other state must
 * not show as work (member-agent-program.md §4.6, §7).
 */
export function collectHeldAgentAccessWakeKeys(
	requests: readonly AgentAccessRequestView[]
): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const request of requests) {
		if (
			request.viewerRole === "requester" &&
			request.sourceSignalId &&
			request.status !== "allowed" &&
			request.status !== "joined"
		) {
			keys.add(heldWakeKey(request.sourceSignalId, request.agentProfileId));
		}
	}
	return keys.size > 0 ? keys : NO_HELD_WAKES;
}

/** Drops Wake progress, local or confirmed, for a Wake held for consent. */
export function withoutHeldAgentAccessWakeProgress<T extends WakeProgressItem>(
	items: readonly T[],
	heldKeys: ReadonlySet<string>
): readonly T[] {
	if (heldKeys.size === 0) {
		return items;
	}
	const visible = items.filter(
		(item) =>
			!(
				item.sourceSignalId &&
				heldKeys.has(heldWakeKey(item.sourceSignalId, item.targetProfileId))
			)
	);
	return visible.length === items.length ? items : visible;
}

/** The viewer's held Wakes in one Space; the request banner shows the wait. */
export function useHeldAgentAccessWakeKeys(
	spaceId: string
): ReadonlySet<string> {
	const requests = useAgentAccessRequests({ spaceId });
	return useMemo(
		() => collectHeldAgentAccessWakeKeys(requests.data ?? []),
		[requests.data]
	);
}
