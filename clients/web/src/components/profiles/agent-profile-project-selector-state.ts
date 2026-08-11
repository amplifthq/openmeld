import type { ProjectComputerView } from "#/components/projects/use-project-discovery";

export type AgentProfileProjectSelectorBranch =
	| "candidate"
	| "checking"
	| "connected"
	| "multiple_connections"
	| "no_candidate"
	| "service_unavailable"
	| "verification_unavailable";

type AgentProfileProjectCandidate = NonNullable<
	ProjectComputerView["discovery"]
>["candidates"][number];

export function resolveAgentProfileProjectSelectorBranch(
	view: ProjectComputerView
): AgentProfileProjectSelectorBranch {
	if (view.status === "checking") {
		return "checking";
	}
	if (view.status === "service_unavailable") {
		return "service_unavailable";
	}
	if (view.discovery?.status === "verification_unavailable") {
		return "verification_unavailable";
	}
	const availableConnections = view.connections.filter(
		(connection) => connection.status === "available"
	);
	const availableDefaultConnection = availableConnections.find(
		(connection) => connection.isDefault
	);
	if (
		availableConnections.length > 1 ||
		(availableConnections.length === 1 && !availableDefaultConnection)
	) {
		return "multiple_connections";
	}
	if (availableDefaultConnection) {
		return "connected";
	}
	if ((view.discovery?.candidates.length ?? 0) > 0) {
		return "candidate";
	}
	return "no_candidate";
}

export function resolveAgentProfileProjectCandidate(
	candidates: readonly AgentProfileProjectCandidate[],
	selectedCandidateId: string | null
): AgentProfileProjectCandidate | null {
	if (candidates.length === 1) {
		return candidates[0] ?? null;
	}
	if (!selectedCandidateId) {
		return null;
	}
	return (
		candidates.find(
			(candidate) => candidate.candidateId === selectedCandidateId
		) ?? null
	);
}
