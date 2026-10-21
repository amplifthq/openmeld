import {
	parseAgentControllerRef,
	resolveAgentWakeAvailabilityDisplayCategory,
} from "@openmeld/agent-runtime";
import { isHostedAgentControllerRef } from "@openmeld/schemas";
import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	ModelCatalog,
} from "@openmeld/schemas/types";
import {
	modelBrandName,
	modelProviderBrandName,
} from "#/components/models/model-brand";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { resolveAgentProfileModel } from "#/lib/profiles/agent-profile-model-display";

export type AgentListSort = "recent" | "created" | "name";
export type AgentListFacet =
	| "type"
	| "availability"
	| "controller"
	| "provider"
	| "model";
export type AgentListFilters = Record<AgentListFacet, string[]>;
export type AgentListGrouping =
	| "none"
	| "controller-provider"
	| "controller"
	| "provider"
	| "model";
export const EMPTY_AGENT_LIST_FILTERS: AgentListFilters = {
	type: [],
	availability: [],
	controller: [],
	provider: [],
	model: [],
};
export const AGENT_LIST_FACETS = [
	"type",
	"availability",
	"controller",
	"provider",
	"model",
] as const;
export type AgentListItem = {
	profile: AuthProfileView;
	lastTaskActivityAt: string | null;
	availability: string;
	type: string;
	controller: string;
	provider: string;
	model: string;
	modelBrand: string | null;
	modelId?: string | null;
	agentControllerRef: string | null;
	searchText: string;
};

export function agentActivityTime(input: {
	createdAt: string;
	lastTaskActivityAt?: string | null;
}): number {
	return Math.max(
		Date.parse(input.createdAt) || 0,
		Date.parse(input.lastTaskActivityAt ?? "") || 0
	);
}

export function compareAgentListRecency(
	left: { createdAt: string; lastTaskActivityAt?: string | null },
	right: { createdAt: string; lastTaskActivityAt?: string | null }
): number {
	return (
		agentActivityTime(right) - agentActivityTime(left) ||
		Date.parse(right.createdAt) - Date.parse(left.createdAt)
	);
}

export function normalizeAgentSearch(value: string): string {
	return value
		.normalize("NFKD")
		.toLocaleLowerCase("en")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

export function buildAgentListItem(input: {
	profile: AuthProfileView;
	agentControllerRef?: string | null;
	readiness?: GetAgentExecutionReadinessResponse | null;
	modelCatalog?: ModelCatalog | null;
	lastTaskActivityAt?: string | null;
	availability?: string;
}): AgentListItem {
	const ref =
		input.readiness?.primaryBinding?.executionTarget?.agentControllerRef ??
		input.readiness?.publicProfileConfiguration?.agentControllerRef ??
		input.readiness?.agentControllerRef ??
		input.agentControllerRef ??
		null;
	const controller = parseAgentControllerRef(ref);
	const remote = isHostedAgentControllerRef(ref);
	const model = resolveAgentProfileModel({
		agentControllerRef: ref,
		modelCatalog: input.modelCatalog ?? null,
		modelSelection:
			input.readiness?.primaryBinding?.modelSelection ??
			input.readiness?.publicProfileConfiguration?.modelSelection ??
			null,
	});
	const runtimeType = remote ? "Remote Agent" : "Local Agent";
	const controllerName = remote
		? "Remote"
		: formatLocalAgentDisplayName(controller?.id ?? "");
	const modelBrand = remote
		? modelProviderBrandName(model.modelId)
		: modelBrandName(model.modelId, model.catalogModel?.displayName);
	const item = {
		profile: input.profile,
		lastTaskActivityAt: input.lastTaskActivityAt ?? null,
		availability:
			input.availability ??
			(input.readiness
				? resolveAgentWakeAvailabilityDisplayCategory(
						input.readiness.agentWakeAvailability
					)
				: "checking"),
		type: controller ? runtimeType : "Unknown type",
		controller: controller ? controllerName : "Unknown Controller",
		model: model.catalogModel?.displayName ?? model.modelId ?? "Unknown model",
		modelBrand,
		modelId: model.modelId,
		provider: modelBrand ?? "Unknown provider",
		agentControllerRef: ref,
	};
	return {
		...item,
		searchText: normalizeAgentSearch(
			[
				input.profile.profileName,
				input.profile.profileHandle,
				input.profile.ownerName,
				item.type,
				item.controller,
				item.model,
				model.modelId,
				item.modelBrand,
			].join(" ")
		),
	};
}

export function matchesAgentListItem(
	item: AgentListItem,
	filters: AgentListFilters,
	search = ""
): boolean {
	return (
		AGENT_LIST_FACETS.every(
			(facet) =>
				filters[facet].length === 0 || filters[facet].includes(item[facet])
		) &&
		normalizeAgentSearch(search)
			.split(" ")
			.every((term) => item.searchText.includes(term))
	);
}

export function sortAgentListItems(
	items: readonly AgentListItem[],
	sort: AgentListSort
): AgentListItem[] {
	return [...items].sort((left, right) => {
		let time = 0;
		if (sort === "recent") {
			time = compareAgentListRecency(
				{ ...left.profile, lastTaskActivityAt: left.lastTaskActivityAt },
				{ ...right.profile, lastTaskActivityAt: right.lastTaskActivityAt }
			);
		} else if (sort === "created") {
			time =
				Date.parse(right.profile.createdAt) -
				Date.parse(left.profile.createdAt);
		}
		return (
			time ||
			left.profile.profileName.localeCompare(right.profile.profileName, "en", {
				numeric: true,
				sensitivity: "base",
			}) ||
			left.profile.openMeldProfileId.localeCompare(
				right.profile.openMeldProfileId
			)
		);
	});
}

export function groupAgentListItems(
	items: readonly AgentListItem[],
	grouping: AgentListGrouping
) {
	const groups = new Map<string, AgentListItem[]>();
	for (const item of items) {
		let key = "";
		if (grouping === "controller-provider") {
			key =
				item.type === "Remote Agent"
					? `${item.provider} · Remote`
					: item.controller;
		} else if (grouping !== "none") {
			key = item[grouping];
		}
		const group = groups.get(key) ?? [];
		group.push(item);
		groups.set(key, group);
	}
	return [...groups].sort(([left], [right]) => left.localeCompare(right, "en"));
}

export function sortAgentOwnerGroups<
	T extends {
		ownerUserId: string;
		name: string;
		items: readonly AgentListItem[];
	},
>(groups: readonly T[], currentUserId: string): T[] {
	const latest = (group: T) =>
		Math.max(
			0,
			...group.items.map(
				(item) => Date.parse(item.lastTaskActivityAt ?? "") || 0
			)
		);
	const created = (group: T) =>
		Math.max(
			0,
			...group.items.map((item) => Date.parse(item.profile.createdAt) || 0)
		);
	return [...groups].sort(
		(left, right) =>
			Number(right.ownerUserId === currentUserId) -
				Number(left.ownerUserId === currentUserId) ||
			latest(right) - latest(left) ||
			created(right) - created(left) ||
			left.name.localeCompare(right.name, "en") ||
			left.ownerUserId.localeCompare(right.ownerUserId)
	);
}

/**
 * Whether task activity is known for the directory. Undefined until the
 * runtime overview answers, so a read still loading never reads as
 * "Task activity unavailable".
 */
export function resolveTaskActivityAvailability(
	overview: { taskActivitySince?: string } | undefined
): boolean | undefined {
	return overview ? Boolean(overview.taskActivitySince) : undefined;
}
