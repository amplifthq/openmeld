import { HOSTED_REMOTE_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	type AgentListItem,
	buildAgentListItem,
	EMPTY_AGENT_LIST_FILTERS,
	groupAgentListItems,
	matchesAgentListItem,
	resolveTaskActivityAvailability,
	sortAgentListItems,
	sortAgentOwnerGroups,
} from "./agent-list-model";

function item(
	id: string,
	createdAt: string,
	lastTaskActivityAt: string | null = null
): AgentListItem {
	const profile: AuthProfileView = {
		openMeldProfileId: id,
		profileName: id,
		profileHandle: id,
		profileKind: "agent",
		isDefault: false,
		status: "active",
		ownerUserId: "owner",
		source: "web",
		managedRole: null,
		createdByUserId: "owner",
		creatorProfileId: null,
		lastUsedAt: null,
		createdAt,
		updatedAt: createdAt,
	};
	return {
		profile,
		lastTaskActivityAt,
		availability: "available",
		type: "Local Agent",
		controller: "Codex",
		provider: "OpenAI",
		model: "GPT",
		modelBrand: "OpenAI",
		agentControllerRef: "builtin:codex",
		searchText: "alex codex",
	};
}

describe("shared Agent lists", () => {
	const old = item(
		"older-active",
		"2026-09-01T00:00:00Z",
		"2026-09-09T00:00:00Z"
	);
	const fresh = item("fresh", "2026-09-10T00:00:00Z");
	const idle = item("idle", "2026-09-08T00:00:00Z");
	it.each([
		["openai/gpt-6-sol", "Claude", "OpenAI"],
		["anthropic/claude-opus-5.5", "GPT", "Anthropic"],
		["google/gemini-3.1-pro", "Gemini", "Google"],
		["unknown/claude-gpt", "Claude GPT", "Unknown provider"],
		["gpt-6-sol", "GPT", "Unknown provider"],
	])("groups Remote model %s by its author, independent of its label", (modelId, displayName, provider) => {
		const remote = buildAgentListItem({
			profile: fresh.profile,
			agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
			modelCatalog: {
				schemaVersion: 1,
				updatedAt: "2026-09-01T00:00:00Z",
				agentControllers: {
					"center-agent": {
						defaultModelId: modelId,
						models: [
							{
								id: modelId,
								displayName,
								unavailable: false,
								supportedReasoningLevels: [],
								minCliVersion: null,
							},
						],
					},
				},
			},
		});
		expect(remote.provider).toBe(provider);
		expect(groupAgentListItems([remote], "controller-provider")[0]?.[0]).toBe(
			`${provider} · Remote`
		);
	});
	it("keeps local controllers separate from remote providers and respects the filtered order", () => {
		const remote = {
			...fresh,
			profile: { ...fresh.profile, openMeldProfileId: "remote" },
			type: "Remote Agent",
			controller: "Remote",
		};
		const anthropic = {
			...remote,
			provider: "Anthropic",
			modelBrand: "Anthropic",
			profile: { ...remote.profile, openMeldProfileId: "anthropic" },
		};
		const results = sortAgentListItems(
			[old, remote, anthropic, idle],
			"recent"
		);
		expect(
			groupAgentListItems(results, "controller-provider").map(
				([label, agents]) => [
					label,
					agents.map((agent) => agent.profile.openMeldProfileId),
				]
			)
		).toEqual([
			["Anthropic · Remote", ["anthropic"]],
			["Codex", ["older-active", "idle"]],
			["OpenAI · Remote", ["remote"]],
		]);
		const filtered = results.filter((agent) =>
			matchesAgentListItem(agent, {
				...EMPTY_AGENT_LIST_FILTERS,
				provider: ["OpenAI"],
				type: ["Remote Agent"],
			})
		);
		expect(
			groupAgentListItems(filtered, "provider").map(([label, agents]) => [
				label,
				agents.map((agent) => agent.profile.openMeldProfileId),
			])
		).toEqual([["OpenAI", ["remote"]]]);
	});
	it("places newly created and recently working Agents first with one rule", () => {
		expect(
			sortAgentListItems([idle, old, fresh], "recent").map(
				(value) => value.profile.profileName
			)
		).toEqual(["fresh", "older-active", "idle"]);
		expect(
			sortAgentListItems([idle, old, fresh], "created").map(
				(value) => value.profile.profileName
			)
		).toEqual(["fresh", "idle", "older-active"]);
	});
	it("pins the viewer then orders people by task activity", () => {
		const groups = [
			{ ownerUserId: "new-owner", name: "New", items: [fresh] },
			{ ownerUserId: "active-owner", name: "Active", items: [old] },
			{ ownerUserId: "self", name: "Self", items: [idle] },
		];
		expect(
			sortAgentOwnerGroups(groups, "self").map((group) => group.ownerUserId)
		).toEqual(["self", "active-owner", "new-owner"]);
	});
	it("unions selections within a facet and intersects different facets and search", () => {
		const filters = {
			...EMPTY_AGENT_LIST_FILTERS,
			model: ["GPT", "Claude"],
			controller: ["Codex"],
		};
		expect(matchesAgentListItem(old, filters, "Alex")).toBe(true);
		expect(matchesAgentListItem({ ...old, model: "Claude" }, filters)).toBe(
			true
		);
		expect(matchesAgentListItem({ ...old, model: "Gemini" }, filters)).toBe(
			false
		);
		expect(
			matchesAgentListItem({ ...old, controller: "Cursor" }, filters)
		).toBe(false);
		expect(matchesAgentListItem(old, filters, "Jordan")).toBe(false);
		const availabilityFilters = {
			...filters,
			availability: ["available", "unavailable"],
		};
		expect(matchesAgentListItem(old, availabilityFilters)).toBe(true);
		expect(
			matchesAgentListItem(
				{ ...old, availability: "unavailable" },
				availabilityFilters
			)
		).toBe(true);
		expect(
			matchesAgentListItem(
				{ ...old, availability: "checking" },
				availabilityFilters
			)
		).toBe(false);
		expect(
			matchesAgentListItem(
				{ ...old, availability: "offline" },
				availabilityFilters
			)
		).toBe(false);
	});
	it("searches model and provider independently of the Agent name and narrows Local or Remote", () => {
		const codex = buildAgentListItem({
			profile: fresh.profile,
			agentControllerRef: "builtin:codex",
			modelCatalog: {
				schemaVersion: 1,
				updatedAt: "2026-09-01T00:00:00Z",
				agentControllers: {
					codex: {
						defaultModelId: "gpt-5.6-sol",
						models: [
							{
								id: "gpt-5.6-sol",
								displayName: "GPT-5.6 Sol",
								unavailable: false,
								supportedReasoningLevels: [],
								minCliVersion: null,
							},
						],
					},
				},
			},
		});
		expect(
			matchesAgentListItem(codex, EMPTY_AGENT_LIST_FILTERS, "OpenAI")
		).toBe(true);
		expect(
			matchesAgentListItem(codex, EMPTY_AGENT_LIST_FILTERS, "GPT 5.6")
		).toBe(true);
		expect(
			matchesAgentListItem(codex, {
				...EMPTY_AGENT_LIST_FILTERS,
				type: ["Local Agent"],
			})
		).toBe(true);
		expect(
			matchesAgentListItem(codex, {
				...EMPTY_AGENT_LIST_FILTERS,
				type: ["Remote Agent"],
			})
		).toBe(false);
		expect(
			buildAgentListItem({ profile: fresh.profile }).modelBrand
		).toBeNull();
	});
});

describe("task activity availability", () => {
	it("stays unknown while the runtime read is loading", () => {
		expect(resolveTaskActivityAvailability(undefined)).toBeUndefined();
	});
	it("reports availability once the runtime read answers", () => {
		expect(
			resolveTaskActivityAvailability({
				taskActivitySince: "2026-10-19T00:00:00.000Z",
			})
		).toBe(true);
		expect(resolveTaskActivityAvailability({})).toBe(false);
	});
});
