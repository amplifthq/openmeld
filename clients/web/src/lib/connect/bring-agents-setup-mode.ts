import type {
	CurrentDeviceTargetResponse,
	LocalAgentCatalogEntry,
	LocalAgentCatalogEntryWithLifecycle,
} from "@openmeld/schemas/types";

type LocalAgentCatalogPrepareEntry =
	| LocalAgentCatalogEntry
	| LocalAgentCatalogEntryWithLifecycle;

export type BringAgentsSetupState =
	| {
			kind: "none";
	  }
	| {
			kind: "repair_local_agents";
			agentIds: readonly string[];
	  };

export function resolveBringAgentsSetupState(input: {
	currentDeviceTarget: CurrentDeviceTargetResponse;
	localAgentCatalogEntries?: readonly LocalAgentCatalogPrepareEntry[] | null;
}): BringAgentsSetupState {
	if (input.currentDeviceTarget.availability !== "resolved") {
		return {
			kind: "none",
		};
	}

	return resolveLocalAgentCatalogPrepareState(
		input.localAgentCatalogEntries ?? null
	);
}

function resolveLocalAgentCatalogPrepareState(
	catalogEntries: readonly LocalAgentCatalogPrepareEntry[] | null
): BringAgentsSetupState {
	if (catalogEntries === null) {
		return {
			kind: "none",
		};
	}

	const hasRunnableLocalAgents =
		hasReadySelectableLocalAgentCatalogEntries(catalogEntries);
	const repairableBuiltinAgentIds = [
		...new Set(
			catalogEntries.flatMap((entry) =>
				entry.targetKind === "builtin" &&
				isActiveLocalAgentCatalogEntry(entry) &&
				(!entry.selectable || entry.launchStatus !== "ready")
					? [entry.agentId]
					: []
			)
		),
	];

	if (!hasRunnableLocalAgents && repairableBuiltinAgentIds.length > 0) {
		return {
			kind: "repair_local_agents",
			agentIds: repairableBuiltinAgentIds,
		};
	}

	return {
		kind: "none",
	};
}

export function hasReadySelectableLocalAgentCatalogEntries(
	entries: readonly LocalAgentCatalogPrepareEntry[]
): boolean {
	return entries.some(
		(entry) =>
			isActiveLocalAgentCatalogEntry(entry) &&
			entry.selectable &&
			entry.launchStatus === "ready"
	);
}

function isActiveLocalAgentCatalogEntry(
	entry: LocalAgentCatalogPrepareEntry
): boolean {
	return !("lifecycleStatus" in entry) || entry.lifecycleStatus !== "suspended";
}
