import type { AgentAccessRequestView } from "@openmeld/schemas";
import { useMemo } from "react";
import { useAgentAccessRequests } from "#/query/agent-access";

/** The requester's view of a request, as one short Space list line. */
export function resolveAgentRequestSpaceLabel(
	request: AgentAccessRequestView
): string | null {
	const { agentProfileName: agent, ownerName: owner } = request;
	if (request.kind === "space_join") {
		switch (request.status) {
			case "pending":
				return `Requested ${owner} · ${agent}`;
			case "joined":
				return `${agent} joined`;
			case "ignored":
				return `${owner} didn't add ${agent}`;
			default:
				return null;
		}
	}
	switch (request.status) {
		case "pending":
			return `Waiting for ${owner} · ${agent}`;
		case "declined":
			return `${owner} declined · ${agent}`;
		default:
			return null;
	}
}

/** The newest request state per Space for requests the viewer made. */
export function useAgentRequestSpaceLabels(): ReadonlyMap<string, string> {
	const requests = useAgentAccessRequests({ role: "requester" });
	return useMemo(() => {
		const latest = new Map<string, AgentAccessRequestView>();
		for (const request of requests.data ?? []) {
			const current = latest.get(request.spaceId);
			if (!current || current.createdAt < request.createdAt) {
				latest.set(request.spaceId, request);
			}
		}
		const labels = new Map<string, string>();
		for (const [spaceId, request] of latest) {
			const label = resolveAgentRequestSpaceLabel(request);
			if (label) {
				labels.set(spaceId, label);
			}
		}
		return labels;
	}, [requests.data]);
}
