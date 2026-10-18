import type { OrganizationAgentRuntimeOverviewResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	agentProfile,
	MIGRATED_LISTING,
	MIGRATED_PROFILES,
} from "#/test-support/member-agent-fixtures";
import { buildMemberAgentDirectory } from "./member-agent-directory-model";
import { buildMemberAgentIndex } from "./member-agent-index";

type RuntimeItem =
	OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number];

function runtime(
	profileId: string,
	category: "available" | "offline" | "unavailable" | "checking",
	workload?: { activeCount: number; waitingCount: number }
): RuntimeItem {
	return {
		profileId,
		lastTaskActivityAt: null,
		readiness: {
			agentWakeAvailability: { category },
			runtimeDeviceDisplayName: "Felix’s MacBook",
		},
		...(workload
			? {
					workload: {
						status: "ready",
						activeCount: workload.activeCount,
						waitingCount: workload.waitingCount,
						queuedMessageCount: 0,
						pausedMessageCount: 0,
						items: [],
					},
				}
			: {}),
	} as unknown as RuntimeItem;
}

const index = buildMemberAgentIndex({
	listing: MIGRATED_LISTING,
	ownerName: "Felix Lu",
});

describe("MemberAgent directory", () => {
	it("lists one row per MemberAgent and an Unassigned section", () => {
		const directory = buildMemberAgentDirectory({
			index,
			ownedProfiles: MIGRATED_PROFILES,
			runtimeByProfileId: new Map(),
		});
		expect(directory.rows.map((row) => row.displayName).sort()).toEqual([
			"Felix Lu’s Claude Code",
			"Felix Lu’s Codex",
		]);
		const claude = directory.rows.find(
			(row) => row.memberAgentId === "ma-claude"
		);
		expect(
			claude?.profiles.map((profile) => profile.openMeldProfileId)
		).toEqual(["agt-claude-default", "agt-claude-reviewer"]);
		expect(
			directory.unassigned.map((entry) => [
				entry.profile.openMeldProfileId,
				entry.assignable,
			])
		).toEqual([
			["agt-new", false],
			["agt-custom", true],
		]);
	});

	it("never drops an owned Profile", () => {
		const directory = buildMemberAgentDirectory({
			index,
			ownedProfiles: MIGRATED_PROFILES,
			runtimeByProfileId: new Map(),
		});
		const shown = [
			...directory.rows.flatMap((row) => row.profiles),
			...directory.unassigned.map((entry) => entry.profile),
		].map((profile) => profile.openMeldProfileId);
		expect(shown.sort()).toEqual(
			MIGRATED_PROFILES.map((profile) => profile.openMeldProfileId).sort()
		);
		expect(new Set(shown).size).toBe(shown.length);
	});

	it("keeps managed and colleague Profiles out of the member's Agents", () => {
		const directory = buildMemberAgentDirectory({
			index,
			ownedProfiles: [
				...MIGRATED_PROFILES,
				agentProfile("agt-center", "Center Agent", {
					managedRole: "center_agent",
				}),
			],
			runtimeByProfileId: new Map(),
		});
		expect(
			directory.unassigned.some(
				(entry) => entry.profile.openMeldProfileId === "agt-center"
			)
		).toBe(false);
	});

	it("aggregates state and running and queued counts across Profiles", () => {
		const directory = buildMemberAgentDirectory({
			index,
			ownedProfiles: MIGRATED_PROFILES,
			runtimeByProfileId: new Map([
				[
					"agt-claude-default",
					runtime("agt-claude-default", "offline", {
						activeCount: 0,
						waitingCount: 1,
					}),
				],
				[
					"agt-claude-reviewer",
					runtime("agt-claude-reviewer", "available", {
						activeCount: 2,
						waitingCount: 3,
					}),
				],
				["agt-codex", runtime("agt-codex", "unavailable")],
			]),
		});
		const claude = directory.rows.find(
			(row) => row.memberAgentId === "ma-claude"
		);
		expect(claude?.presence).toMatchObject({
			state: "available",
			runningCount: 2,
			queuedCount: 4,
			computers: ["Felix’s MacBook"],
		});
		expect(
			directory.rows.find((row) => row.memberAgentId === "ma-codex")?.presence
				.state
		).toBe("unavailable");
	});

	it("picks the most recent Direct Message Session as the latest Session", () => {
		const directory = buildMemberAgentDirectory({
			index,
			ownedProfiles: MIGRATED_PROFILES,
			runtimeByProfileId: new Map(),
			directMessages: [
				{
					spaceId: "dm-old",
					spaceName: "Fix login",
					directMessageProfileIds: ["human-felix", "agt-claude-default"],
					messagePreview: { timestamp: 10, text: "", signalId: "s1" },
				},
				{
					spaceId: "dm-new",
					spaceName: "Review PR 12",
					directMessageProfileIds: ["human-felix", "agt-claude-reviewer"],
					messagePreview: { timestamp: 20, text: "", signalId: "s2" },
				},
			] as never,
		});
		expect(
			directory.rows.find((row) => row.memberAgentId === "ma-claude")
				?.latestSession
		).toMatchObject({ spaceId: "dm-new", title: "Review PR 12" });
	});
});
