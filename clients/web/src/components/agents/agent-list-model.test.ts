import type { AuthProfileView } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	type AgentListItem,
	EMPTY_AGENT_LIST_FILTERS,
	matchesAgentListItem,
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
		model: "GPT",
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
	});
});
