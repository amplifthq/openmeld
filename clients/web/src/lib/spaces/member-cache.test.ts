import type {
	AgentWakeAvailability,
	SignalEnvelope,
	SpaceMemberAgentSnapshot,
	SpaceMemberHumanSnapshot,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { SpaceBootstrapSnapshot } from "#/query/spaces/bootstrap";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	applyCurrentSpaceMembersToBootstrapCache,
	applySpaceBootstrapSnapshotToCache,
	applySpaceMemberRemovalToCache,
	mergeSpaceMembersSnapshot,
} from "./member-cache";

describe("mergeSpaceMembersSnapshot", () => {
	it("keeps bootstrap membership aligned with a newer authoritative members read", () => {
		const queryClient = new QueryClient();
		const viewerProfileId = "viewer-profile";
		const spaceId = "space-123";
		const currentMembers = createSpaceMembersSnapshot({
			agents: [],
			generatedAt: "2026-09-02T00:00:02.000Z",
			humans: [
				createHumanMember(),
				createHumanMember({
					profileId: "22222222-2222-4222-8222-222222222222",
					profileName: "New Member",
				}),
			],
		});

		try {
			queryClient.setQueryData(
				spaceQueryKeys.members(spaceId, viewerProfileId),
				currentMembers
			);
			queryClient.setQueryData(
				spaceQueryKeys.bootstrap(spaceId, viewerProfileId),
				createBootstrapSnapshot({
					members: createSpaceMembersSnapshot({
						agents: [],
						generatedAt: "2026-09-02T00:00:01.000Z",
						humans: [createHumanMember()],
					}),
				})
			);

			applyCurrentSpaceMembersToBootstrapCache({
				queryClient,
				spaceId,
				viewerProfileId,
			});

			const bootstrap = queryClient.getQueryData<SpaceBootstrapSnapshot>(
				spaceQueryKeys.bootstrap(spaceId, viewerProfileId)
			);
			expect(bootstrap?.members).toStrictEqual(currentMembers);
			expect(bootstrap?.members.summary.totalCount).toBe(2);
		} finally {
			queryClient.clear();
		}
	});

	it("adds a new agent member without inventing Wake availability", () => {
		const current = createSpaceMembersSnapshot({
			agents: [],
			humans: [createHumanMember()],
		});
		const incomingAgent = createAgentMember({
			profileId: "agt_22222222-2222-4222-8222-222222222222",
			profileName: "New Agent",
		});

		const merged = mergeSpaceMembersSnapshot(current, [incomingAgent]);

		expect(merged.agents).toHaveLength(1);
		expect(merged.agents[0]?.profileName).toBe("New Agent");
		expect(merged.agents[0]?.agentWakeAvailability).toBeUndefined();
		expect(merged.summary).toMatchObject({
			agentCount: 1,
			checkingAgentCount: 0,
			humanCount: 1,
			totalCount: 2,
		});
	});

	it("keeps existing readiness when mutation response does not include it", () => {
		const existingAgent = createAgentMember({
			agentWakeAvailability: createAgentWakeAvailability("available_for_wake"),
			profileId: "agt_22222222-2222-4222-8222-222222222222",
		});
		const current = createSpaceMembersSnapshot({
			agents: [existingAgent],
			humans: [createHumanMember()],
		});
		const mutationItem = createAgentMember({
			agentWakeAvailability: undefined,
			profileId: existingAgent.profileId,
			profileName: "Renamed Agent",
		});

		const merged = mergeSpaceMembersSnapshot(current, [mutationItem]);

		expect(merged.agents).toHaveLength(1);
		expect(merged.agents[0]?.profileName).toBe("Renamed Agent");
		expect(merged.agents[0]?.agentWakeAvailability?.status).toBe(
			"available_for_wake"
		);
		expect(merged.summary.wakeableAgentCount).toBe(1);
	});

	it("keeps existing controller and activity display facts when an incoming agent item lacks readiness", () => {
		const existingAgent = createAgentMember({
			agentControllerConversationId: "conversation-123",
			agentControllerPermissionMode: "codex:fullAccess",
			agentControllerRef: "builtin:codex",
			agentWakeAvailability: createAgentWakeAvailability("available_for_wake"),
			lastSeenAt: "2026-07-01T00:05:00.000Z",
			lastSeenLabel: "Seen 1m ago",
			modelSelection: {
				modelId: "gpt-5-codex",
				reasoningLevel: "medium",
			},
			profileId: "agt_22222222-2222-4222-8222-222222222222",
			runtimeDeviceDisplayName: "Felix's MacBook Pro",
			workingDirectory: "/Users/felix/project",
		});
		const current = createSpaceMembersSnapshot({
			agents: [existingAgent],
			humans: [createHumanMember()],
		});
		const leanIncomingItem = createAgentMember({
			agentControllerConversationId: null,
			agentControllerPermissionMode: undefined,
			agentControllerRef: null,
			agentWakeAvailability: undefined,
			lastSeenAt: null,
			lastSeenLabel: null,
			modelSelection: undefined,
			profileId: existingAgent.profileId,
			profileName: "Renamed Agent",
			runtimeDeviceDisplayName: undefined,
			workingDirectory: undefined,
		});

		const merged = mergeSpaceMembersSnapshot(current, [leanIncomingItem]);

		expect(merged.agents).toHaveLength(1);
		expect(merged.agents[0]).toMatchObject({
			agentControllerConversationId: "conversation-123",
			agentControllerPermissionMode: "codex:fullAccess",
			agentControllerRef: "builtin:codex",
			lastSeenAt: "2026-07-01T00:05:00.000Z",
			lastSeenLabel: "Seen 1m ago",
			modelSelection: {
				modelId: "gpt-5-codex",
				reasoningLevel: "medium",
			},
			profileName: "Renamed Agent",
			runtimeDeviceDisplayName: "Felix's MacBook Pro",
			workingDirectory: "/Users/felix/project",
		});
		expect(merged.agents[0]?.agentWakeAvailability?.status).toBe(
			"available_for_wake"
		);
		expect(merged.summary.wakeableAgentCount).toBe(1);
	});

	it("seeds bootstrap members cache without thinning existing agent projection facts", () => {
		const queryClient = new QueryClient();
		const existingAgent = createAgentMember({
			agentControllerConversationId: "conversation-123",
			agentControllerPermissionMode: "codex:fullAccess",
			agentControllerRef: "builtin:codex",
			agentWakeAvailability: createAgentWakeAvailability("available_for_wake"),
			lastSeenAt: "2026-07-01T00:05:00.000Z",
			lastSeenLabel: "Seen 1m ago",
			profileId: "agt_22222222-2222-4222-8222-222222222222",
			runtimeDeviceDisplayName: "Felix's MacBook Pro",
		});
		const current = createSpaceMembersSnapshot({
			agents: [existingAgent],
			humans: [createHumanMember()],
		});
		const leanBootstrapMembers = createSpaceMembersSnapshot({
			agents: [
				createAgentMember({
					agentControllerConversationId: null,
					agentControllerPermissionMode: undefined,
					agentControllerRef: null,
					agentWakeAvailability: undefined,
					lastSeenAt: null,
					lastSeenLabel: null,
					profileId: existingAgent.profileId,
					runtimeDeviceDisplayName: undefined,
				}),
			],
			humans: [createHumanMember()],
		});

		try {
			queryClient.setQueryData(
				spaceQueryKeys.members("space-123", "viewer-profile"),
				current
			);

			applySpaceBootstrapSnapshotToCache({
				bootstrap: createBootstrapSnapshot({ members: leanBootstrapMembers }),
				queryClient,
				spaceId: "space-123",
				viewerProfileId: "viewer-profile",
			});

			const cached = queryClient.getQueryData<SpaceMembersSnapshot>(
				spaceQueryKeys.members("space-123", "viewer-profile")
			);
			expect(cached?.agents[0]).toMatchObject({
				agentControllerConversationId: "conversation-123",
				agentControllerPermissionMode: "codex:fullAccess",
				agentControllerRef: "builtin:codex",
				lastSeenAt: "2026-07-01T00:05:00.000Z",
				lastSeenLabel: "Seen 1m ago",
				runtimeDeviceDisplayName: "Felix's MacBook Pro",
			});
			expect(cached?.agents[0]?.agentWakeAvailability?.status).toBe(
				"available_for_wake"
			);
		} finally {
			queryClient.clear();
		}
	});

	it("does not let an older bootstrap regress current members or persisted history identity", () => {
		const queryClient = new QueryClient();
		const profileId = "agt_22222222-2222-4222-8222-222222222222";
		const currentMembers = createSpaceMembersSnapshot({
			agents: [
				createAgentMember({
					agentControllerRef: "builtin:claude",
					profileId,
				}),
			],
			generatedAt: "2026-07-01T00:00:02.000Z",
			humans: [createHumanMember()],
		});
		const staleSignal = {
			...createHistorySignal({ id: "sig-agent", ts: 10 }),
			profile: {
				agentControllerRef: "builtin:codex",
				kind: "agent",
				profileId,
				profileName: "Agent",
			},
		} as SignalEnvelope;

		try {
			queryClient.setQueryData(
				spaceQueryKeys.members("space-123", "viewer-profile"),
				currentMembers
			);

			applySpaceBootstrapSnapshotToCache({
				bootstrap: createBootstrapSnapshot({
					history: { envelopes: [staleSignal], nextCursor: null },
					members: createSpaceMembersSnapshot({
						agents: [
							createAgentMember({
								agentControllerRef: "builtin:codex",
								profileId,
							}),
						],
						generatedAt: "2026-07-01T00:00:01.000Z",
						humans: [createHumanMember()],
					}),
				}),
				queryClient,
				spaceId: "space-123",
				viewerProfileId: "viewer-profile",
			});

			const cachedMembers = queryClient.getQueryData<SpaceMembersSnapshot>(
				spaceQueryKeys.members("space-123", "viewer-profile")
			);
			const cachedHistory = queryClient.getQueryData<{
				envelopes: readonly SignalEnvelope[];
			}>(spaceQueryKeys.history("space-123", "viewer-profile"));
			expect(cachedMembers?.generatedAt).toBe("2026-07-01T00:00:02.000Z");
			expect(cachedMembers?.agents[0]?.agentControllerRef).toBe(
				"builtin:claude"
			);
			expect(cachedHistory?.envelopes[0]?.profile.agentControllerRef).toBe(
				"builtin:claude"
			);
		} finally {
			queryClient.clear();
		}
	});

	it("stamps members cache with the newer bootstrap generation", () => {
		const queryClient = new QueryClient();
		const profileId = "agt_22222222-2222-4222-8222-222222222222";

		try {
			queryClient.setQueryData(
				spaceQueryKeys.members("space-123", "viewer-profile"),
				createSpaceMembersSnapshot({
					agents: [
						createAgentMember({
							agentControllerRef: "builtin:codex",
							profileId,
						}),
					],
					generatedAt: "2026-07-01T00:00:01.000Z",
					humans: [createHumanMember()],
				})
			);

			applySpaceBootstrapSnapshotToCache({
				bootstrap: createBootstrapSnapshot({
					members: createSpaceMembersSnapshot({
						agents: [
							createAgentMember({
								agentControllerRef: "builtin:claude",
								profileId,
							}),
						],
						generatedAt: "2026-07-01T00:00:02.000Z",
						humans: [createHumanMember()],
					}),
				}),
				queryClient,
				spaceId: "space-123",
				viewerProfileId: "viewer-profile",
			});

			const cachedMembers = queryClient.getQueryData<SpaceMembersSnapshot>(
				spaceQueryKeys.members("space-123", "viewer-profile")
			);
			expect(cachedMembers?.generatedAt).toBe("2026-07-01T00:00:02.000Z");
			expect(cachedMembers?.agents[0]?.agentControllerRef).toBe(
				"builtin:claude"
			);
		} finally {
			queryClient.clear();
		}
	});

	it("does not let an older bootstrap history replace newer cached signals", () => {
		const queryClient = new QueryClient();
		const olderSignal = createHistorySignal({ id: "sig-1", ts: 10 });
		const newerSignal = createHistorySignal({ id: "sig-2", ts: 20 });

		try {
			queryClient.setQueryData(
				spaceQueryKeys.history("space-123", "viewer-profile"),
				{
					envelopes: [newerSignal],
					nextCursor: null,
				}
			);

			applySpaceBootstrapSnapshotToCache({
				bootstrap: createBootstrapSnapshot({
					history: {
						envelopes: [olderSignal],
						nextCursor: "cursor-before-sig-1",
					},
					members: createSpaceMembersSnapshot({
						agents: [],
						humans: [createHumanMember()],
					}),
				}),
				queryClient,
				spaceId: "space-123",
				viewerProfileId: "viewer-profile",
			});

			expect(
				queryClient
					.getQueryData<{ envelopes: readonly SignalEnvelope[] }>(
						spaceQueryKeys.history("space-123", "viewer-profile")
					)
					?.envelopes.map((signal) => signal.id)
			).toEqual(["sig-1", "sig-2"]);
		} finally {
			queryClient.clear();
		}
	});

	it("persists the resolved Agent controller with bootstrap history", () => {
		const queryClient = new QueryClient();
		const agent = createAgentMember({
			agentControllerRef: "builtin:codex",
			profileId: "agt_22222222-2222-4222-8222-222222222222",
		});
		const signal = {
			...createHistorySignal({ id: "sig-agent", ts: 10 }),
			profile: {
				kind: "agent",
				profileId: agent.profileId,
				profileName: agent.profileName,
			},
		} as SignalEnvelope;

		try {
			applySpaceBootstrapSnapshotToCache({
				bootstrap: createBootstrapSnapshot({
					history: { envelopes: [signal], nextCursor: null },
					members: createSpaceMembersSnapshot({
						agents: [agent],
						humans: [createHumanMember()],
					}),
				}),
				queryClient,
				spaceId: "space-123",
				viewerProfileId: "viewer-profile",
			});

			const cached = queryClient.getQueryData<{
				envelopes: readonly SignalEnvelope[];
			}>(spaceQueryKeys.history("space-123", "viewer-profile"));
			expect(cached?.envelopes[0]?.profile).toMatchObject({
				agentControllerRef: "builtin:codex",
				profileId: agent.profileId,
			});
		} finally {
			queryClient.clear();
		}
	});

	it("replaces a stale persisted Agent controller with the current bootstrap binding", () => {
		const queryClient = new QueryClient();
		const agent = createAgentMember({
			agentControllerRef: "builtin:claude",
			profileId: "agt_22222222-2222-4222-8222-222222222222",
		});
		const signal = {
			...createHistorySignal({ id: "sig-agent", ts: 10 }),
			profile: {
				agentControllerRef: "builtin:codex",
				kind: "agent",
				profileId: agent.profileId,
				profileName: agent.profileName,
			},
		} as SignalEnvelope;

		try {
			applySpaceBootstrapSnapshotToCache({
				bootstrap: createBootstrapSnapshot({
					history: { envelopes: [signal], nextCursor: null },
					members: createSpaceMembersSnapshot({
						agents: [agent],
						humans: [createHumanMember()],
					}),
				}),
				queryClient,
				spaceId: "space-123",
				viewerProfileId: "viewer-profile",
			});

			const cached = queryClient.getQueryData<{
				envelopes: readonly SignalEnvelope[];
			}>(spaceQueryKeys.history("space-123", "viewer-profile"));
			expect(cached?.envelopes[0]?.profile.agentControllerRef).toBe(
				"builtin:claude"
			);
		} finally {
			queryClient.clear();
		}
	});

	it("clears a stale persisted Agent controller when the current bootstrap member is unbound", () => {
		const queryClient = new QueryClient();
		const agent = createAgentMember({
			agentControllerRef: null,
			profileId: "agt_22222222-2222-4222-8222-222222222222",
		});
		const signal = {
			...createHistorySignal({ id: "sig-agent", ts: 10 }),
			profile: {
				agentControllerRef: "builtin:codex",
				kind: "agent",
				profileId: agent.profileId,
				profileName: agent.profileName,
			},
		} as SignalEnvelope;

		try {
			applySpaceBootstrapSnapshotToCache({
				bootstrap: createBootstrapSnapshot({
					history: { envelopes: [signal], nextCursor: null },
					members: createSpaceMembersSnapshot({
						agents: [agent],
						humans: [createHumanMember()],
					}),
				}),
				queryClient,
				spaceId: "space-123",
				viewerProfileId: "viewer-profile",
			});

			const cached = queryClient.getQueryData<{
				envelopes: readonly SignalEnvelope[];
			}>(spaceQueryKeys.history("space-123", "viewer-profile"));
			expect(cached?.envelopes[0]?.profile.agentControllerRef).toBeUndefined();
		} finally {
			queryClient.clear();
		}
	});

	it("replaces existing readiness when the mutation item includes a fresher verdict", () => {
		const existingAgent = createAgentMember({
			agentWakeAvailability: createAgentWakeAvailability("available_for_wake"),
			profileId: "agt_22222222-2222-4222-8222-222222222222",
		});
		const current = createSpaceMembersSnapshot({
			agents: [existingAgent],
			humans: [createHumanMember()],
		});
		const mutationItem = createAgentMember({
			agentWakeAvailability: createAgentWakeAvailability("offline_for_wake"),
			profileId: existingAgent.profileId,
		});

		const merged = mergeSpaceMembersSnapshot(current, [mutationItem]);

		expect(merged.agents[0]?.agentWakeAvailability?.status).toBe(
			"offline_for_wake"
		);
		expect(merged.summary.offlineAgentCount).toBe(1);
	});

	it("shows a new locally bound agent as checking while readiness catches up", () => {
		const current = createSpaceMembersSnapshot({
			agents: [],
			humans: [createHumanMember()],
		});
		const incomingAgent = createAgentMember({
			agentWakeAvailability: createAgentWakeAvailability("offline_for_wake"),
			profileId: "agt_22222222-2222-4222-8222-222222222222",
			profileName: "New Local Agent",
		});

		const merged = mergeSpaceMembersSnapshot(current, [incomingAgent], {
			pendingWakeReadinessProfileIds: [incomingAgent.profileId],
		});

		expect(merged.agents).toHaveLength(1);
		expect(merged.agents[0]?.profileName).toBe("New Local Agent");
		expect(merged.agents[0]?.agentWakeAvailability?.status).toBe(
			"checking_connection"
		);
		expect(merged.agents[0]?.agentWakeAvailability?.summary).toBe(
			"OpenMeld is checking this agent's local connection."
		);
		expect(merged.summary).toMatchObject({
			checkingAgentCount: 1,
			offlineAgentCount: 0,
			wakeableAgentCount: 0,
		});
	});

	it("does not show an unbound agent as checking when pending readiness ids are passed", () => {
		const current = createSpaceMembersSnapshot({
			agents: [],
			humans: [createHumanMember()],
		});
		const incomingAgent = createAgentMember({
			agentControllerRef: null,
			agentWakeAvailability: createAgentWakeAvailability("offline_for_wake"),
			profileId: "agt_22222222-2222-4222-8222-222222222222",
			profileName: "Manual Agent",
		});

		const merged = mergeSpaceMembersSnapshot(current, [incomingAgent], {
			pendingWakeReadinessProfileIds: [incomingAgent.profileId],
		});

		expect(merged.agents).toHaveLength(1);
		expect(merged.agents[0]?.profileName).toBe("Manual Agent");
		expect(merged.agents[0]?.agentWakeAvailability?.status).toBe(
			"offline_for_wake"
		);
		expect(merged.summary).toMatchObject({
			checkingAgentCount: 0,
			offlineAgentCount: 1,
			wakeableAgentCount: 0,
		});
	});

	it("keeps proven existing readiness even when a pending id is passed", () => {
		const existingAgent = createAgentMember({
			agentWakeAvailability: createAgentWakeAvailability("offline_for_wake"),
			profileId: "agt_22222222-2222-4222-8222-222222222222",
		});
		const current = createSpaceMembersSnapshot({
			agents: [existingAgent],
			humans: [createHumanMember()],
		});
		const mutationItem = createAgentMember({
			agentWakeAvailability: createAgentWakeAvailability("offline_for_wake"),
			profileId: existingAgent.profileId,
			profileName: "Existing Agent",
		});

		const merged = mergeSpaceMembersSnapshot(current, [mutationItem], {
			pendingWakeReadinessProfileIds: [existingAgent.profileId],
		});

		expect(merged.agents[0]?.profileName).toBe("Existing Agent");
		expect(merged.agents[0]?.agentWakeAvailability?.status).toBe(
			"offline_for_wake"
		);
		expect(merged.summary.offlineAgentCount).toBe(1);
	});

	it("optimistically removes members from members and bootstrap caches", () => {
		const queryClient = new QueryClient();
		const targetHuman = createHumanMember({
			liveNow: false,
			memberSource: "added_by_member",
			profileId: "22222222-2222-4222-8222-222222222222",
			profileName: "Mira",
		});
		const targetAgent = createAgentMember({
			agentWakeAvailability: createAgentWakeAvailability("available_for_wake"),
			profileId: "agt_22222222-2222-4222-8222-222222222222",
			profileName: "Runner",
		});
		const current = createSpaceMembersSnapshot({
			agents: [targetAgent],
			humans: [createHumanMember(), targetHuman],
		});

		try {
			queryClient.setQueryData(
				spaceQueryKeys.members("space-123", "viewer-profile"),
				current
			);
			queryClient.setQueryData(
				spaceQueryKeys.bootstrap("space-123", "viewer-profile"),
				createBootstrapSnapshot({ members: current })
			);

			applySpaceMemberRemovalToCache({
				memberProfileIds: [targetHuman.profileId, targetAgent.profileId],
				queryClient,
				spaceId: "space-123",
				viewerProfileId: "viewer-profile",
			});

			const cachedMembers = queryClient.getQueryData<SpaceMembersSnapshot>(
				spaceQueryKeys.members("space-123", "viewer-profile")
			);
			const cachedBootstrap = queryClient.getQueryData<SpaceBootstrapSnapshot>(
				spaceQueryKeys.bootstrap("space-123", "viewer-profile")
			);
			expect(cachedMembers?.humans.map((member) => member.profileName)).toEqual(
				["Felix"]
			);
			expect(cachedMembers?.agents).toEqual([]);
			expect(cachedMembers?.summary).toMatchObject({
				agentCount: 0,
				humanCount: 1,
				totalCount: 1,
				wakeableAgentCount: 0,
			});
			expect(
				cachedBootstrap?.members.humans.map((member) => member.profileName)
			).toEqual(["Felix"]);
			expect(cachedBootstrap?.members.agents).toEqual([]);
			expect(cachedBootstrap?.members.summary.totalCount).toBe(1);
		} finally {
			queryClient.clear();
		}
	});
});

function createSpaceMembersSnapshot(input: {
	agents: readonly SpaceMemberAgentSnapshot[];
	generatedAt?: string;
	humans: readonly SpaceMemberHumanSnapshot[];
}): SpaceMembersSnapshot {
	return {
		spaceId: "space-123",
		generatedAt: input.generatedAt ?? "2026-07-01T00:00:00.000Z",
		humans: [...input.humans],
		agents: [...input.agents],
		summary: {
			totalCount: input.humans.length + input.agents.length,
			humanCount: input.humans.length,
			agentCount: input.agents.length,
			liveNowCount: [...input.humans, ...input.agents].filter(
				(member) => member.liveNow
			).length,
			wakeableAgentCount: input.agents.filter(
				(agent) => agent.agentWakeAvailability?.status === "available_for_wake"
			).length,
			checkingAgentCount: input.agents.filter(
				(agent) => agent.agentWakeAvailability?.status === "checking_connection"
			).length,
			offlineAgentCount: input.agents.filter(
				(agent) => agent.agentWakeAvailability?.status === "offline_for_wake"
			).length,
			unavailableAgentCount: input.agents.filter(
				(agent) =>
					agent.agentWakeAvailability?.status === "unavailable_for_wake"
			).length,
		},
	};
}

function createBootstrapSnapshot(input: {
	history?: SpaceBootstrapSnapshot["history"];
	members: SpaceMembersSnapshot;
}): SpaceBootstrapSnapshot {
	return {
		status: {} as SpaceBootstrapSnapshot["status"],
		members: input.members,
		history:
			input.history ??
			({
				envelopes: [],
				nextCursor: null,
			} as SpaceBootstrapSnapshot["history"]),
		threads: {} as SpaceBootstrapSnapshot["threads"],
	};
}

function createHistorySignal(input: {
	id: string;
	ts: number;
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts,
		profile: {
			kind: "human",
			profileId: "viewer-profile",
			profileName: "Mira",
		},
		type: "signal.text",
		data: { text: input.id },
	} as SignalEnvelope;
}

function createHumanMember(
	overrides: Partial<SpaceMemberHumanSnapshot> = {}
): SpaceMemberHumanSnapshot {
	return {
		profileId: "11111111-1111-4111-8111-111111111111",
		profileName: "Felix",
		profileKind: "human",
		status: "active",
		memberSource: "space_creator",
		memberSourceLabel: "Space creator",
		addedAt: "2026-07-01T00:00:00.000Z",
		removedAt: null,
		createdAt: "2026-07-01T00:00:00.000Z",
		updatedAt: "2026-07-01T00:00:00.000Z",
		addedByProfileId: null,
		addedByOwnerUserId: null,
		addedByDisplayName: null,
		removedByProfileId: null,
		removedByOwnerUserId: null,
		removalReason: null,
		firstEnteredAt: null,
		lastEnteredAt: null,
		lastSeenAt: null,
		lastSeenLabel: null,
		liveNow: true,
		mentionAlias: null,
		ownerUserId: "user-felix",
		ownerName: "Felix",
		...overrides,
	};
}

function createAgentMember(
	overrides: Partial<SpaceMemberAgentSnapshot> = {}
): SpaceMemberAgentSnapshot {
	return {
		profileId: "agt_11111111-1111-4111-8111-111111111111",
		profileName: "Agent",
		profileKind: "agent",
		status: "active",
		memberSource: "added_by_member",
		memberSourceLabel: "Added by Felix",
		addedAt: "2026-07-01T00:00:01.000Z",
		removedAt: null,
		createdAt: "2026-07-01T00:00:01.000Z",
		updatedAt: "2026-07-01T00:00:01.000Z",
		addedByProfileId: "11111111-1111-4111-8111-111111111111",
		addedByOwnerUserId: "user-felix",
		addedByDisplayName: "Felix",
		removedByProfileId: null,
		removedByOwnerUserId: null,
		removalReason: null,
		firstEnteredAt: null,
		lastEnteredAt: null,
		lastSeenAt: null,
		lastSeenLabel: null,
		liveNow: false,
		mentionAlias: null,
		ownerUserId: "user-felix",
		ownerName: "Felix",
		agentControllerRef: "builtin:codex",
		agentControllerConversationId: null,
		ownerWakeDiagnostics: null,
		...overrides,
	};
}

function createAgentWakeAvailability(
	status: "available_for_wake" | "checking_connection" | "offline_for_wake"
): AgentWakeAvailability {
	if (status === "available_for_wake") {
		return {
			action: "none",
			badgeLabel: "Available",
			category: "available",
			isRefreshing: false,
			label: "Available",
			phase: "available",
			reasonCode: "agent_execution.ready",
			status,
			summary: "OpenMeld can launch this agent.",
			tooltip: "Available for Wake",
		};
	}
	if (status === "checking_connection") {
		return {
			action: "check_status",
			badgeLabel: "Checking",
			category: "checking",
			isRefreshing: true,
			label: "Checking connection",
			phase: "checking_status",
			reasonCode: "agent_execution.check_status",
			status,
			summary: "OpenMeld is checking this agent's local connection.",
			tooltip: "Checking Wake availability",
		};
	}
	return {
		action: "connect_service",
		badgeLabel: "Offline",
		category: "offline",
		isRefreshing: false,
		label: "Offline",
		phase: "service_not_connected",
		reasonCode: "agent_execution.service_offline",
		status,
		summary: "This agent's connection is offline.",
		tooltip: "Offline for Wake",
	};
}
