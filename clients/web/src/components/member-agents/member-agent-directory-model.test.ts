import type { OrganizationAgentRuntimeOverviewResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	agentProfile,
	MIGRATED_LISTING,
	MIGRATED_PROFILES,
} from "#/test-support/member-agent-fixtures";
import {
	buildMemberAgentDirectory,
	narrowMemberAgentDirectory,
} from "./member-agent-directory-model";
import { buildMemberAgentIndex } from "./member-agent-index";

function detectedListing(input: {
	defaultProfileId: string | null;
	profileIds: string[];
}) {
	return buildMemberAgentIndex({
		listing: {
			ok: true,
			organizationId: "org-test",
			memberAgents: [
				{
					id: "ma-codex",
					organizationId: "org-test",
					ownerUserId: "user-felix",
					harnessKind: "codex",
					defaultProfileId: input.defaultProfileId,
					source: "detected",
					archivedAt: null,
					profiles: input.profileIds.map((openMeldProfileId) => ({
						openMeldProfileId,
						profileName: "Codex",
						isDefault: openMeldProfileId === input.defaultProfileId,
					})),
				},
			],
			unassignedProfiles: [],
		},
		ownerName: "Felix Lu",
	});
}

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

	it("reads state and work from Core presence and computers from runtime reads", () => {
		const directory = buildMemberAgentDirectory({
			index,
			ownedProfiles: MIGRATED_PROFILES,
			runtimeByProfileId: new Map([
				["agt-claude-default", runtime("agt-claude-default", "offline")],
				["agt-claude-reviewer", runtime("agt-claude-reviewer", "available")],
			]),
			presenceByMemberAgentId: new Map([
				[
					"ma-claude",
					{
						memberAgentId: "ma-claude",
						harnessKind: "claude-code",
						state: "available",
						computers: [],
						profiles: [],
						workload: { status: "ready", runningCount: 2, queuedCount: 4 },
					},
				],
				[
					"ma-codex",
					{
						memberAgentId: "ma-codex",
						harnessKind: "codex",
						state: "missing",
						computers: [],
						profiles: [],
						workload: { status: "unavailable" },
					},
				],
			]),
		});
		expect(
			directory.rows.find((row) => row.memberAgentId === "ma-claude")?.presence
		).toEqual({
			state: "available",
			runningCount: 2,
			queuedCount: 4,
			computers: ["Felix’s MacBook"],
			lastActivityAt: null,
		});
		expect(
			directory.rows.find((row) => row.memberAgentId === "ma-codex")?.presence
		).toMatchObject({
			state: "missing",
			runningCount: null,
			queuedCount: null,
		});
	});

	it("reads settled unavailable Profiles as unavailable, not checking", () => {
		const presenceFor = (
			wakeAvailability: "unavailable" | "checking"
		): Parameters<
			typeof buildMemberAgentDirectory
		>[0]["presenceByMemberAgentId"] =>
			new Map([
				[
					"ma-claude",
					{
						memberAgentId: "ma-claude",
						harnessKind: "claude-code",
						state: "checking",
						computers: [],
						profiles: [
							{ openMeldProfileId: "agt-claude-default", wakeAvailability },
							{
								openMeldProfileId: "agt-claude-reviewer",
								wakeAvailability: "unavailable",
							},
						],
						workload: { status: "unavailable" },
					},
				],
			]);
		const stateOf = (presenceByMemberAgentId: ReturnType<typeof presenceFor>) =>
			buildMemberAgentDirectory({
				index,
				ownedProfiles: MIGRATED_PROFILES,
				runtimeByProfileId: new Map(),
				presenceByMemberAgentId,
			}).rows.find((row) => row.memberAgentId === "ma-claude")?.presence.state;
		expect(stateOf(presenceFor("unavailable"))).toBe("unavailable");
		expect(stateOf(presenceFor("checking"))).toBe("checking");
	});

	it("reads an Agent without a presence answer as checking, never broken", () => {
		const directory = buildMemberAgentDirectory({
			index,
			ownedProfiles: MIGRATED_PROFILES,
			runtimeByProfileId: new Map(),
		});
		expect(directory.rows[0]?.presence.state).toBe("checking");
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

	it("shows a new MemberAgent as setting up until its Profiles are readable", () => {
		// Smoke R2B-05: the listing already names the default Profile while
		// the Profile directory has not caught up.
		const lagging = buildMemberAgentDirectory({
			index: detectedListing({
				defaultProfileId: "agt-codex",
				profileIds: ["agt-codex"],
			}),
			ownedProfiles: [],
			runtimeByProfileId: new Map(),
		});
		expect(lagging.rows[0]).toMatchObject({ profiles: [], setup: "creating" });

		// The default Profile is still being written.
		const writing = buildMemberAgentDirectory({
			index: detectedListing({ defaultProfileId: null, profileIds: [] }),
			ownedProfiles: [],
			runtimeByProfileId: new Map(),
		});
		expect(writing.rows[0]?.setup).toBe("creating");

		const ready = buildMemberAgentDirectory({
			index: detectedListing({
				defaultProfileId: "agt-codex",
				profileIds: ["agt-codex"],
			}),
			ownedProfiles: [agentProfile("agt-codex", "Codex")],
			runtimeByProfileId: new Map(),
		});
		expect(ready.rows[0]?.setup).toBe("ready");
	});

	it("never shows a migrated MemberAgent as setting up", () => {
		// Its listed Profiles are not readable here, but it was never created
		// automatically, so it shows what it has.
		const lagging = buildMemberAgentDirectory({
			index,
			ownedProfiles: [],
			runtimeByProfileId: new Map(),
		});
		expect(lagging.rows.map((row) => row.setup)).toEqual(["ready", "ready"]);
	});

	it("never shows a migrated MemberAgent without a default as setting up", () => {
		const directory = buildMemberAgentDirectory({
			index: buildMemberAgentIndex({
				listing: {
					...MIGRATED_LISTING,
					memberAgents: [
						{
							...MIGRATED_LISTING.memberAgents[0],
							defaultProfileId: null,
							profiles: [],
						} as (typeof MIGRATED_LISTING.memberAgents)[number],
					],
				},
				ownerName: "Felix Lu",
			}),
			ownedProfiles: [],
			runtimeByProfileId: new Map(),
		});
		expect(directory.rows[0]?.setup).toBe("ready");
	});
});

describe("narrowMemberAgentDirectory", () => {
	const directory = buildMemberAgentDirectory({
		index: buildMemberAgentIndex({
			listing: MIGRATED_LISTING,
			ownerName: "Felix Lu",
		}),
		ownedProfiles: MIGRATED_PROFILES,
		runtimeByProfileId: new Map(),
	});

	it("keeps a MemberAgent while any of its Profiles is visible, in list order", () => {
		const narrowed = narrowMemberAgentDirectory({
			directory,
			visibleProfileIds: ["agt-codex", "agt-claude-reviewer", "agt-custom"],
			filtered: true,
		});
		expect(narrowed.rows.map((row) => row.memberAgentId)).toEqual([
			"ma-codex",
			"ma-claude",
		]);
		expect(
			narrowed.unassigned.map((entry) => entry.profile.openMeldProfileId)
		).toEqual(["agt-custom"]);
	});

	it("drops a MemberAgent whose Profiles are all filtered out", () => {
		const narrowed = narrowMemberAgentDirectory({
			directory,
			visibleProfileIds: ["agt-codex"],
			filtered: true,
		});
		expect(narrowed.rows.map((row) => row.memberAgentId)).toEqual(["ma-codex"]);
		expect(narrowed.unassigned).toEqual([]);
	});

	it("keeps a MemberAgent still being set up only while nothing is filtered", () => {
		const settingUp = buildMemberAgentDirectory({
			index: detectedListing({ defaultProfileId: null, profileIds: [] }),
			ownedProfiles: [],
			runtimeByProfileId: new Map(),
		});
		expect(
			narrowMemberAgentDirectory({
				directory: settingUp,
				visibleProfileIds: [],
				filtered: false,
			}).rows
		).toHaveLength(1);
		expect(
			narrowMemberAgentDirectory({
				directory: settingUp,
				visibleProfileIds: [],
				filtered: true,
			}).rows
		).toHaveLength(0);
	});
});
