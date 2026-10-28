import type {
	FileRootEntry,
	OrganizationAgentRuntimeOverviewResponse,
} from "@openmeld/schemas/types";

export type DeskActivity =
	OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number];
export type DeskState = "working" | "paused" | "idle" | "unknown";

// Runtime execution evidence owns this state, never Computer presence or Wakeability.
export function deskState(input: {
	activity?: Pick<DeskActivity, "operationalContext">;
	generatedAt?: string;
	now: number;
	failed: boolean;
}): DeskState {
	const age = input.now - Date.parse(input.generatedAt ?? "");
	if (input.failed || !Number.isFinite(age) || age > 90_000) {
		return "unknown";
	}
	const status = input.activity?.operationalContext?.status;
	return status && status !== "checking" ? status : "unknown";
}

export const DESK_LABELS: Record<DeskState, string> = {
	working: "Working",
	paused: "Waiting to continue",
	idle: "No active work",
	unknown: "Status unavailable",
};

export function latestTeamFileByAgent(
	entries: FileRootEntry[],
	organizationId: string
) {
	const files = new Map<string, Extract<FileRootEntry, { kind: "file" }>>();
	for (const entry of entries) {
		if (
			entry.kind !== "file" ||
			entry.trashedAt ||
			entry.root.kind !== "team" ||
			entry.root.organizationId !== organizationId
		) {
			continue;
		}
		// A rename is not new work, and the original author is not the latest writer.
		const revision = entry.latestRevision;
		if (revision.createdBy.profileKind !== "agent") {
			continue;
		}
		const author = revision.createdBy.profileId;
		const previous = files.get(author);
		if (
			!previous ||
			Date.parse(revision.createdAt) >
				Date.parse(previous.latestRevision.createdAt)
		) {
			files.set(author, entry);
		}
	}
	return files;
}

export function compactDeskProgress(text: string): string {
	const normalized = text.replace(/\s+/gu, " ").trim();
	return normalized.length > 140 ? `${normalized.slice(0, 137)}…` : normalized;
}
