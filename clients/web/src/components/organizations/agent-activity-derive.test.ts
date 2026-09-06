import type {
	AgentActivityPublicEvent,
	AgentActivityPublicSession,
	AgentActivitySnapshotResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	deriveActivityView,
	formatDuration,
	formatProvider,
} from "./agent-activity-derive";

const NOW_MS = new Date(2026, 6, 14, 12, 30).getTime();
const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

describe("deriveActivityView", () => {
	it("derives setup state from active Projects and the unfiltered session list", () => {
		const noProjectsView = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({ projects: [] }),
			windowMs: 4 * HOUR_MS,
		});
		const archivedProjectsView = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				projects: [
					{
						...project("project-archived", "Archived Project"),
						archivedAtMs: NOW_MS,
					},
				],
			}),
			windowMs: 4 * HOUR_MS,
		});
		const awaitingFirstSessionView = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({ sessions: [] }),
			windowMs: 4 * HOUR_MS,
		});
		const filteredActiveView = deriveActivityView({
			filters: { ...emptyFilters(), provider: "claude-code" },
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({ sessions: [session({ provider: "codex" })] }),
			windowMs: 4 * HOUR_MS,
		});

		expect(noProjectsView.setupState).toBe("no_projects");
		expect(archivedProjectsView.setupState).toBe("no_projects");
		expect(awaitingFirstSessionView.setupState).toBe("awaiting_first_session");
		expect(filteredActiveView.sessions).toEqual([]);
		expect(filteredActiveView.setupState).toBe("active");
	});

	it("returns an honest empty view without inventing activity", () => {
		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: new Map(),
			nowMs: NOW_MS,
			snapshot: snapshot(),
			windowMs: 4 * HOUR_MS,
		});

		expect(view.nowCards).toEqual([]);
		expect(view.memberLanes).toEqual([]);
		expect(view.foldedMembers).toEqual([]);
		expect(view.feedItems).toEqual([]);
		expect(view.foldedHeartbeatCount).toBe(0);
		expect(view.stats).toMatchObject({
			membersActiveToday: { count: 0, label: "0", total: null },
			sessionsToday: 0,
			workingNow: 0,
		});
	});

	it("uses last observation for a missing start and rejects an expired active claim", () => {
		const currentSession = session({
			id: "session-current",
			lastObservedAtMs: NOW_MS - 26 * MINUTE_MS,
			startedAtMs: null,
		});
		const expiredSession = session({
			expiresAtMs: NOW_MS,
			id: "session-expired",
			lastObservedAtMs: NOW_MS - 5 * MINUTE_MS,
			startedAtMs: null,
			title: "Expired active claim",
		});

		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({ sessions: [currentSession, expiredSession] }),
			windowMs: 4 * HOUR_MS,
		});

		expect(view.nowCards).toHaveLength(1);
		expect(view.nowCards[0]).toMatchObject({
			durationLabel: "26m",
			sessionName: "Codex Plugin session",
		});
		expect(
			view.memberLanes
				.flatMap((memberLane) => memberLane.subLanes)
				.flatMap((subLane) => subLane.segments)
				.find((segment) => segment.session.id === "session-expired")
		).toMatchObject({ isActive: false, isPoint: true });
	});

	it("clamps four-hour bands and groups each member by provider and Project", () => {
		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				sessions: [
					session({
						id: "codex-active",
						startedAtMs: NOW_MS - 5 * HOUR_MS,
					}),
					session({
						clientKind: "claude-code-cli",
						expiresAtMs: NOW_MS - HOUR_MS,
						id: "claude-idle",
						isActive: false,
						lastObservedAtMs: NOW_MS - HOUR_MS,
						model: "claude-opus-4-1",
						projectId: "project-two",
						provider: "claude-code",
						startedAtMs: NOW_MS - 2 * HOUR_MS,
						status: "idle",
					}),
					session({
						expiresAtMs: NOW_MS - 5 * HOUR_MS,
						id: "mira-old",
						isActive: false,
						lastObservedAtMs: NOW_MS - 5 * HOUR_MS,
						memberName: "Mira",
						memberUserId: "user-2",
						startedAtMs: NOW_MS - 6 * HOUR_MS,
						status: "ended",
					}),
					session({
						clientKind: "unknown",
						id: "missing-directory-member",
						memberName: "Noah",
						memberUserId: "user-missing",
						projectId: "project-two",
						provider: "opencode",
						startedAtMs: NOW_MS - 10 * MINUTE_MS,
					}),
				],
			}),
			windowMs: 4 * HOUR_MS,
		});

		const felixLane = view.memberLanes.find(
			(memberLane) => memberLane.memberUserId === "user-1"
		);
		expect(felixLane?.subLanes).toHaveLength(2);
		expect(
			felixLane?.subLanes.find((subLane) => subLane.provider === "codex")
				?.segments[0]
		).toMatchObject({ startPercent: 0, widthPercent: 100 });
		expect(
			felixLane?.subLanes.find((subLane) => subLane.provider === "claude-code")
				?.segments[0]
		).toMatchObject({ startPercent: 50, widthPercent: 25 });
		expect(view.foldedMembers.map((member) => member.memberUserId)).toContain(
			"user-2"
		);
		expect(
			view.memberLanes.find(
				(memberLane) => memberLane.memberUserId === "user-missing"
			)?.member
		).toEqual({ image: null, name: "Noah" });
		expect(view.timeline.ticks).toHaveLength(5);
		expect(view.timeline.ticks.at(-1)).toMatchObject({
			isNow: true,
			positionPercent: 100,
		});
	});

	it("folds sampling noise and keeps only the newest adjacent state transition", () => {
		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				recentEvents: [
					event({ eventId: "heartbeat-new", eventType: "heartbeat" }),
					event({
						eventId: "active-new",
						eventType: "session_active",
						observedAtMs: NOW_MS - MINUTE_MS,
					}),
					event({
						eventId: "active-old",
						eventType: "session_active",
						observedAtMs: NOW_MS - 2 * MINUTE_MS,
					}),
					event({
						eventId: "updated",
						eventType: "session_updated",
						status: "unknown",
					}),
					event({ eventId: "heartbeat-old", eventType: "heartbeat" }),
				],
			}),
			windowMs: 4 * HOUR_MS,
		});

		expect(view.foldedHeartbeatCount).toBe(2);
		expect(view.feedItems).toHaveLength(1);
		expect(view.feedItems[0]).toMatchObject({
			eventId: "active-new",
			verb: "started working",
		});
	});

	it("returns every filtered state change and keeps counting folded heartbeats", () => {
		const transitions = Array.from({ length: 31 }, (_, index) =>
			event({
				eventId: `transition-${String(index)}`,
				memberUserId: `user-${String(index)}`,
				observedAtMs: NOW_MS - index * MINUTE_MS,
			})
		);
		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				recentEvents: [
					...transitions,
					event({ eventId: "heartbeat-after-limit", eventType: "heartbeat" }),
				],
			}),
			windowMs: 4 * HOUR_MS,
		});

		expect(view.feedItems).toHaveLength(31);
		expect(view.foldedHeartbeatCount).toBe(1);
	});

	it("computes each facet against the other two selected dimensions", () => {
		const view = deriveActivityView({
			filters: {
				projectId: "project-one",
				provider: "codex",
				status: null,
			},
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				sessions: [
					session({ id: "p1-codex-working" }),
					session({
						clientKind: "claude-code-cli",
						expiresAtMs: NOW_MS - MINUTE_MS,
						id: "p1-claude-idle",
						isActive: false,
						provider: "claude-code",
						status: "idle",
					}),
					session({
						expiresAtMs: NOW_MS - MINUTE_MS,
						id: "p2-codex-ended",
						isActive: false,
						projectId: "project-two",
						status: "ended",
					}),
				],
			}),
			windowMs: 4 * HOUR_MS,
		});

		expect(facetCounts(view.facets.projects)).toEqual({
			"project-one": 1,
			"project-two": 1,
		});
		expect(facetCounts(view.facets.providers)).toMatchObject({
			"claude-code": 1,
			codex: 1,
			cursor: 0,
			opencode: 0,
		});
		expect(facetCounts(view.facets.statuses)).toEqual({
			idle: 0,
			offline: 0,
			working: 1,
		});
		expect(view.nowCards.map((card) => card.session.id)).toEqual([
			"p1-codex-working",
		]);
	});

	it("hides members whose activity does not match the selected filters", () => {
		const view = deriveActivityView({
			filters: {
				projectId: "project-two",
				provider: null,
				status: null,
			},
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				sessions: [
					session({ id: "felix-project-one" }),
					session({
						id: "mira-project-two",
						memberName: "Mira",
						memberUserId: "user-2",
						projectId: "project-two",
					}),
				],
			}),
			windowMs: 4 * HOUR_MS,
		});

		expect(view.memberLanes.map((lane) => lane.memberUserId)).toEqual([
			"user-2",
		]);
		expect(view.foldedMembers).toEqual([]);
	});

	it("counts local-today sessions and members without requiring a directory row", () => {
		const todayStarted = new Date(2026, 6, 14, 0, 1).getTime();
		const yesterday = new Date(2026, 6, 13, 23, 59).getTime();
		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				asOfMs: NOW_MS - 6 * MINUTE_MS,
				sessions: [
					session({ id: "today-observed" }),
					session({
						expiresAtMs: yesterday,
						id: "today-started",
						isActive: false,
						lastObservedAtMs: yesterday,
						memberName: "Noah",
						memberUserId: "user-missing",
						startedAtMs: todayStarted,
						status: "ended",
					}),
					session({
						expiresAtMs: yesterday,
						id: "yesterday",
						isActive: false,
						lastObservedAtMs: yesterday,
						startedAtMs: yesterday,
						status: "ended",
					}),
				],
				stalenessThresholdMs: 5 * MINUTE_MS,
			}),
			windowMs: 4 * HOUR_MS,
		});

		expect(view.stats).toMatchObject({
			membersActiveToday: { count: 2, label: "2/2", total: 2 },
			sessionsToday: 2,
			workingNow: 1,
		});
		expect(view.freshness.isStale).toBe(true);
	});

	it("parameterizes the Rhythm window and keeps historical segments neutral", () => {
		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				sessions: [
					session({ id: "active", startedAtMs: NOW_MS - 2 * HOUR_MS }),
					session({
						expiresAtMs: NOW_MS - 20 * MINUTE_MS,
						id: "idle",
						isActive: false,
						lastObservedAtMs: NOW_MS - 20 * MINUTE_MS,
						startedAtMs: NOW_MS - 40 * MINUTE_MS,
						status: "idle",
					}),
					session({
						expiresAtMs: NOW_MS - 2 * HOUR_MS,
						id: "outside-window",
						isActive: false,
						lastObservedAtMs: NOW_MS - 2 * HOUR_MS,
						startedAtMs: NOW_MS - 3 * HOUR_MS,
						status: "ended",
					}),
				],
			}),
			windowMs: HOUR_MS,
		});

		expect(view.timeline.windowStartMs).toBe(NOW_MS - HOUR_MS);
		expect(
			view.memberLanes
				.flatMap((lane) => lane.subLanes)
				.flatMap((lane) => lane.segments)
				.map((segment) => [segment.session.id, segment.tone])
		).toEqual([
			["active", "ready"],
			["idle", "muted"],
		]);
		expect(view.timeline.longestRun).toMatchObject({
			durationMs: HOUR_MS,
			member: { name: "Felix" },
			provider: "codex",
		});
	});

	it("hides a whole-hour tick when it would collide with Now", () => {
		const nowMs = new Date(2026, 6, 14, 12, 2).getTime();
		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs,
			snapshot: snapshot({ asOfMs: nowMs }),
			windowMs: HOUR_MS,
		});

		expect(view.timeline.ticks).toEqual([
			{ isNow: true, positionPercent: 100, timestampMs: nowMs },
		]);
	});

	it("derives today's span totals, peak concurrency, and busiest Project", () => {
		const at = (hour: number, minute = 0) =>
			new Date(2026, 6, 14, hour, minute).getTime();
		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				sessions: [
					session({
						expiresAtMs: at(11),
						id: "wake-one",
						isActive: false,
						lastObservedAtMs: at(11),
						startedAtMs: at(9),
						status: "ended",
					}),
					session({
						expiresAtMs: at(12),
						id: "wake-two",
						isActive: false,
						lastObservedAtMs: at(12),
						startedAtMs: at(10),
						status: "ended",
					}),
					session({
						expiresAtMs: at(12),
						id: "router",
						isActive: false,
						lastObservedAtMs: at(12),
						projectId: "project-two",
						startedAtMs: at(11, 30),
						status: "ended",
					}),
				],
			}),
			windowMs: 4 * HOUR_MS,
		});

		expect(view.stats.agentTimeTodayMs).toBe(4.5 * HOUR_MS);
		expect(view.stats.peakConcurrency).toEqual({ count: 2, atMs: at(10) });
		expect(view.stats.busiestProject).toMatchObject({
			durationMs: 4 * HOUR_MS,
			id: "project-one",
			name: "OpenMeld",
		});
	});

	it("folds a started-to-active transition for the same work identity within 60 seconds", () => {
		const view = deriveActivityView({
			filters: emptyFilters(),
			membersByUserId: members(),
			nowMs: NOW_MS,
			snapshot: snapshot({
				recentEvents: [
					event({
						eventId: "active",
						eventType: "session_active",
						observedAtMs: NOW_MS - 30_000,
					}),
					event({
						eventId: "started",
						eventType: "session_started",
						observedAtMs: NOW_MS - 60_000,
					}),
					event({
						eventId: "started-other-project",
						eventType: "session_started",
						observedAtMs: NOW_MS - 60_000,
						projectId: "project-two",
					}),
				],
			}),
			windowMs: 4 * HOUR_MS,
		});

		expect(view.feedItems.map((item) => [item.eventId, item.verb])).toEqual([
			["active", "started working"],
			["started-other-project", "started a session"],
		]);
	});
});

describe("formatProvider", () => {
	it("preserves the client-specific public provider name", () => {
		expect(formatProvider(session())).toBe("Codex Plugin");
	});

	it("names Cursor IDE and CLI activity explicitly", () => {
		expect(
			formatProvider(session({ clientKind: "cursor-ide", provider: "cursor" }))
		).toBe("Cursor IDE");
		expect(
			formatProvider(session({ clientKind: "cursor-cli", provider: "cursor" }))
		).toBe("Cursor CLI");
	});
});

describe("formatDuration", () => {
	it("uses a human just-now label below one minute", () => {
		expect(formatDuration(59_999)).toBe("just now");
		expect(formatDuration(MINUTE_MS)).toBe("1m");
	});
});

function emptyFilters() {
	return { projectId: null, provider: null, status: null };
}

function members() {
	return new Map([
		["user-1", { image: "https://example.test/felix.png", name: "Felix" }],
		["user-2", { image: null, name: "Mira" }],
	]);
}

function snapshot(
	overrides: Partial<AgentActivitySnapshotResponse> = {}
): AgentActivitySnapshotResponse {
	return {
		asOfMs: NOW_MS,
		digests: [],
		digestsTruncated: false,
		organizationId: "org-acme",
		projects: [
			project("project-one", "OpenMeld"),
			project("project-two", "Agent Router"),
		],
		recentEvents: [],
		sessions: [],
		sessionsTruncated: false,
		stalenessThresholdMs: 5 * MINUTE_MS,
		...overrides,
	};
}

function project(id: string, name: string) {
	return {
		archivedAtMs: null,
		canArchive: true,
		canManage: true,
		createdAtMs: 1,
		createdByUserId: "user-1",
		id,
		name,
		organizationId: "org-acme",
		repositoryFingerprint: null,
		slug: id,
		updatedAtMs: 1,
	};
}

function session(
	overrides: Partial<AgentActivityPublicSession> = {}
): AgentActivityPublicSession {
	return {
		clientKind: "codex-app",
		expiresAtMs: NOW_MS + MINUTE_MS,
		gitBranch: "main",
		gitCommit: null,
		id: "session-default",
		isActive: true,
		lastObservedAtMs: NOW_MS,
		memberName: "Felix",
		memberUserId: "user-1",
		model: "gpt-5.6-sol",
		projectId: "project-one",
		provider: "codex",
		startedAtMs: NOW_MS - HOUR_MS,
		status: "active",
		title: null,
		...overrides,
	} as AgentActivityPublicSession;
}

function event(
	overrides: Partial<AgentActivityPublicEvent> = {}
): AgentActivityPublicEvent {
	return {
		clientKind: "codex-app",
		eventId: "event-default",
		eventType: "session_active",
		memberName: "Felix",
		memberUserId: "user-1",
		observedAtMs: NOW_MS,
		projectId: "project-one",
		provider: "codex",
		status: "active",
		title: "Build Agent Activity",
		...overrides,
	};
}

function facetCounts(facets: ReadonlyArray<{ count: number; id: string }>) {
	return Object.fromEntries(facets.map((facet) => [facet.id, facet.count]));
}
