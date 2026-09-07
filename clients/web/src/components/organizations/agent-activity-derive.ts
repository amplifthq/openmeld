import type {
	AgentActivityProvider,
	AgentActivityPublicEvent,
	AgentActivityPublicSession,
	AgentActivitySnapshotResponse,
} from "@openmeld/schemas/types";
import type { StatusTone } from "@openmeld/ui/lib/status-tone";

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;
const STARTED_TO_ACTIVE_FOLD_WINDOW_MS = MINUTE_MS;

export type ActivityStatusFilter = "idle" | "offline" | "working";

export type ActivityViewFilters = {
	memberUserId?: string | null;
	projectId: string | null;
	provider: AgentActivityProvider | null;
	status: string | null;
};

export type ActivityMember = {
	image: string | null;
	name: string;
};

export type ActivityNowCard = {
	durationLabel: string;
	durationMs: number;
	member: ActivityMember;
	projectName: string;
	session: AgentActivityPublicSession;
	sessionName: string;
};

export type ActivityLaneSegment = {
	durationLabel: string;
	endMs: number;
	isActive: boolean;
	isPoint: boolean;
	session: AgentActivityPublicSession;
	sessionName: string;
	startMs: number;
	startPercent: number;
	tone: StatusTone;
	widthPercent: number;
};

export type ActivitySubLane = {
	hasActive: boolean;
	lastObservedAtMs: number;
	projectId: string;
	projectName: string;
	provider: AgentActivityPublicSession["provider"];
	segments: ActivityLaneSegment[];
	sessions: AgentActivityPublicSession[];
	status: ActivityStatusFilter;
	statusDurationLabel: string;
	tone: StatusTone;
};

export type ActivityMemberLane = {
	hasActive: boolean;
	lastObservedAtMs: number;
	member: ActivityMember;
	memberUserId: string;
	subLanes: ActivitySubLane[];
};

export type ActivityFoldedMember = {
	lastObservedAtMs: number | null;
	member: ActivityMember;
	memberUserId: string;
	relativeTimeLabel: string;
};

export type ActivityFeedItem = {
	event: AgentActivityPublicEvent;
	eventId: string;
	projectName: string;
	tone: StatusTone;
	verb: ActivityFeedVerb;
};

export type ActivityFacet = {
	count: number;
	id: string;
	label: string;
};

export type ActivityTimelineTick = {
	isNow: boolean;
	positionPercent: number;
	timestampMs: number;
};

export type ActivityLongestRun = {
	durationMs: number;
	member: ActivityMember;
	memberUserId: string;
	provider: AgentActivityPublicSession["provider"];
};

export type ActivitySetupState =
	| "active"
	| "awaiting_first_session"
	| "no_projects";

export type ActivityView = {
	facets: {
		projects: ActivityFacet[];
		providers: ActivityFacet[];
		statuses: ActivityFacet[];
	};
	feedItems: ActivityFeedItem[];
	foldedHeartbeatCount: number;
	foldedMembers: ActivityFoldedMember[];
	freshness: {
		asOfMs: number;
		isStale: boolean;
		stalenessThresholdMs: number;
	};
	memberLanes: ActivityMemberLane[];
	nowCards: ActivityNowCard[];
	sessions: AgentActivityPublicSession[];
	setupState: ActivitySetupState;
	stats: {
		agentTimeTodayMs: number;
		busiestProject: {
			durationMs: number;
			id: string;
			name: string;
		} | null;
		lastActivityAtMs: number | null;
		membersActiveToday: {
			count: number;
			label: string;
			total: number | null;
		};
		sessionsToday: number;
		peakConcurrency: {
			atMs: number | null;
			count: number;
		};
		workingNow: number;
	};
	timeline: {
		longestRun: ActivityLongestRun | null;
		ticks: ActivityTimelineTick[];
		windowEndMs: number;
		windowStartMs: number;
	};
};

type ActivityFeedVerb =
	| "hit an error"
	| "session ended"
	| "started a session"
	| "started working"
	| "went idle";

type DeriveActivityViewInput = {
	filters: ActivityViewFilters;
	membersByUserId: ReadonlyMap<string, ActivityMember>;
	nowMs: number;
	snapshot: AgentActivitySnapshotResponse;
	windowMs: number;
};

const PROVIDER_FACETS = [
	{ id: "codex", label: "Codex" },
	{ id: "claude-code", label: "Claude Code" },
	{ id: "opencode", label: "OpenCode" },
	{ id: "cursor", label: "Cursor" },
] as const;

const STATUS_FACETS = [
	{ id: "working", label: "Working" },
	{ id: "idle", label: "Idle" },
	{ id: "offline", label: "Offline" },
] as const;

const FEED_VERBS = {
	session_active: "started working",
	session_ended: "session ended",
	session_error: "hit an error",
	session_idle: "went idle",
	session_started: "started a session",
} as const satisfies Record<
	Exclude<
		AgentActivityPublicEvent["eventType"],
		"heartbeat" | "session_updated"
	>,
	ActivityFeedVerb
>;

export function deriveActivityView(
	input: DeriveActivityViewInput
): ActivityView {
	const projectsById = new Map(
		input.snapshot.projects.map((project) => [project.id, project] as const)
	);
	const filteredSessions = input.snapshot.sessions.filter((session) =>
		matchesSessionFilters(session, input.filters, input.nowMs)
	);
	const timeline = deriveTimeline(input.nowMs, input.windowMs);
	const members = collectMembers(
		input.membersByUserId,
		filteredSessions,
		input.snapshot.sessions
	);
	const { foldedMembers, memberLanes } = deriveMemberLanes({
		filteredSessions,
		includeMembersWithoutMatchingSessions:
			(input.filters.memberUserId ?? null) === null &&
			input.filters.projectId === null &&
			input.filters.provider === null &&
			input.filters.status === null,
		members,
		nowMs: input.nowMs,
		projectsById,
		windowStartMs: timeline.windowStartMs,
	});
	const feed = deriveFeed({
		filters: input.filters,
		nowMs: input.nowMs,
		projectsById,
		recentEvents: input.snapshot.recentEvents,
	});
	const nowCards = filteredSessions
		.filter((session) => isSessionCurrentlyActive(session, input.nowMs))
		.map((session) => {
			const durationMs = Math.max(
				0,
				input.nowMs - (session.startedAtMs ?? session.lastObservedAtMs)
			);
			return {
				durationLabel: formatDuration(durationMs),
				durationMs,
				member: resolveMember(session, input.membersByUserId),
				projectName:
					projectsById.get(session.projectId)?.name ?? "Unknown Project",
				session,
				sessionName: formatSessionName(session),
			};
		})
		.sort(
			(left, right) =>
				right.durationMs - left.durationMs ||
				right.session.lastObservedAtMs - left.session.lastObservedAtMs
		);

	return {
		facets: deriveFacets(input.snapshot, input.filters, input.nowMs),
		feedItems: feed.items,
		foldedHeartbeatCount: feed.foldedHeartbeatCount,
		foldedMembers,
		freshness: {
			asOfMs: input.snapshot.asOfMs,
			isStale:
				input.nowMs - input.snapshot.asOfMs >
				input.snapshot.stalenessThresholdMs,
			stalenessThresholdMs: input.snapshot.stalenessThresholdMs,
		},
		memberLanes,
		nowCards,
		sessions: filteredSessions,
		setupState: deriveSetupState(input.snapshot),
		stats: deriveStats({
			membersByUserId: input.membersByUserId,
			nowMs: input.nowMs,
			projectsById,
			sessions: filteredSessions,
		}),
		timeline: {
			...timeline,
			longestRun: deriveLongestRun(memberLanes),
		},
	};
}

function deriveSetupState(
	snapshot: AgentActivitySnapshotResponse
): ActivitySetupState {
	if (!snapshot.projects.some((project) => project.archivedAtMs === null)) {
		return "no_projects";
	}
	return snapshot.sessions.length === 0 ? "awaiting_first_session" : "active";
}

function deriveMemberLanes(input: {
	filteredSessions: AgentActivityPublicSession[];
	includeMembersWithoutMatchingSessions: boolean;
	members: ReadonlyMap<string, ActivityMember>;
	nowMs: number;
	projectsById: ReadonlyMap<
		string,
		AgentActivitySnapshotResponse["projects"][number]
	>;
	windowStartMs: number;
}) {
	const sessionsByMember = groupBy(
		input.filteredSessions,
		(session) => session.memberUserId
	);
	const memberLanes: ActivityMemberLane[] = [];
	const foldedMembers: ActivityFoldedMember[] = [];

	for (const [memberUserId, member] of input.members) {
		const memberSessions = sessionsByMember.get(memberUserId) ?? [];
		if (
			memberSessions.length === 0 &&
			!input.includeMembersWithoutMatchingSessions
		) {
			continue;
		}
		const recentSessions = memberSessions.filter((session) =>
			sessionIntersectsWindow(session, input.windowStartMs, input.nowMs)
		);
		const lastObservedAtMs = maximumTimestamp(memberSessions);
		if (recentSessions.length === 0) {
			foldedMembers.push({
				lastObservedAtMs,
				member,
				memberUserId,
				relativeTimeLabel:
					lastObservedAtMs === null
						? "No recorded activity"
						: formatRelativeTime(lastObservedAtMs, input.nowMs),
			});
			continue;
		}

		const subLanes = deriveSubLanes({
			nowMs: input.nowMs,
			projectsById: input.projectsById,
			sessions: recentSessions,
			windowStartMs: input.windowStartMs,
		});
		memberLanes.push({
			hasActive: subLanes.some((subLane) => subLane.hasActive),
			lastObservedAtMs: lastObservedAtMs ?? 0,
			member,
			memberUserId,
			subLanes,
		});
	}

	memberLanes.sort(
		(left, right) =>
			Number(right.hasActive) - Number(left.hasActive) ||
			right.lastObservedAtMs - left.lastObservedAtMs ||
			left.member.name.localeCompare(right.member.name)
	);
	foldedMembers.sort(
		(left, right) =>
			(right.lastObservedAtMs ?? -1) - (left.lastObservedAtMs ?? -1) ||
			left.member.name.localeCompare(right.member.name)
	);

	return { foldedMembers, memberLanes };
}

function deriveSubLanes(input: {
	nowMs: number;
	projectsById: ReadonlyMap<
		string,
		AgentActivitySnapshotResponse["projects"][number]
	>;
	sessions: AgentActivityPublicSession[];
	windowStartMs: number;
}): ActivitySubLane[] {
	const windowDurationMs = input.nowMs - input.windowStartMs;
	const groupedSessions = groupBy(
		input.sessions,
		(session) => `${session.provider}:${session.projectId}`
	);
	const subLanes: ActivitySubLane[] = [];

	for (const sessions of groupedSessions.values()) {
		const sortedSessions = [...sessions].sort(
			(left, right) => right.lastObservedAtMs - left.lastObservedAtMs
		);
		const representativeSession =
			sortedSessions.find((session) =>
				isSessionCurrentlyActive(session, input.nowMs)
			) ?? sortedSessions[0];
		if (!representativeSession) {
			continue;
		}
		const status = resolveSessionStatus(representativeSession, input.nowMs);
		const segments = sortedSessions.map((session) => {
			const rawStartMs = session.startedAtMs ?? session.lastObservedAtMs;
			const startMs = Math.max(rawStartMs, input.windowStartMs);
			const isActive = isSessionCurrentlyActive(session, input.nowMs);
			const endMs = isActive
				? input.nowMs
				: Math.min(session.lastObservedAtMs, input.nowMs);
			const isPoint = endMs <= startMs;
			return {
				durationLabel: formatDuration(Math.max(0, endMs - rawStartMs)),
				endMs,
				isActive,
				isPoint,
				session,
				sessionName: formatSessionName(session),
				startMs,
				startPercent: roundPercentage(
					((startMs - input.windowStartMs) / windowDurationMs) * 100
				),
				tone: isActive ? "ready" : "muted",
				widthPercent: isPoint
					? 0
					: roundPercentage(((endMs - startMs) / windowDurationMs) * 100),
			} satisfies ActivityLaneSegment;
		});
		const lastObservedAtMs = representativeSession.lastObservedAtMs;
		const statusDurationLabel = resolveStatusDurationLabel({
			lastObservedAtMs,
			nowMs: input.nowMs,
			session: representativeSession,
			status,
		});
		subLanes.push({
			hasActive: segments.some((segment) => segment.isActive),
			lastObservedAtMs,
			projectId: representativeSession.projectId,
			projectName:
				input.projectsById.get(representativeSession.projectId)?.name ??
				"Unknown Project",
			provider: representativeSession.provider,
			segments,
			sessions: sortedSessions,
			status,
			statusDurationLabel,
			tone: resolveSessionTone(representativeSession, input.nowMs),
		});
	}

	return subLanes.sort(
		(left, right) =>
			Number(right.hasActive) - Number(left.hasActive) ||
			right.lastObservedAtMs - left.lastObservedAtMs ||
			left.provider.localeCompare(right.provider) ||
			left.projectName.localeCompare(right.projectName)
	);
}

function resolveStatusDurationLabel(input: {
	lastObservedAtMs: number;
	nowMs: number;
	session: AgentActivityPublicSession;
	status: ActivityStatusFilter;
}) {
	if (input.status === "working") {
		return formatDuration(
			Math.max(
				0,
				input.nowMs -
					(input.session.startedAtMs ?? input.session.lastObservedAtMs)
			)
		);
	}
	if (input.status === "idle") {
		return formatDuration(Math.max(0, input.nowMs - input.lastObservedAtMs));
	}
	return formatRelativeTime(input.lastObservedAtMs, input.nowMs);
}

function deriveFeed(input: {
	filters: ActivityViewFilters;
	nowMs: number;
	projectsById: ReadonlyMap<
		string,
		AgentActivitySnapshotResponse["projects"][number]
	>;
	recentEvents: AgentActivityPublicEvent[];
}) {
	let foldedHeartbeatCount = 0;
	const items: ActivityFeedItem[] = [];
	let previousKey: string | null = null;
	const foldedStartedEventIds = collectFoldedStartedEventIds(
		input.recentEvents.filter((event) =>
			matchesEventFilters(event, input.filters)
		)
	);

	for (const event of input.recentEvents) {
		if (!matchesEventFilters(event, input.filters)) {
			continue;
		}
		if (event.eventType === "heartbeat") {
			foldedHeartbeatCount += 1;
			continue;
		}
		if (event.eventType === "session_updated") {
			continue;
		}
		if (foldedStartedEventIds.has(event.eventId)) {
			continue;
		}
		const key = `${event.memberUserId}:${event.provider}:${event.projectId}:${event.eventType}`;
		if (key === previousKey) {
			continue;
		}
		previousKey = key;
		items.push({
			event,
			eventId: event.eventId,
			projectName:
				input.projectsById.get(event.projectId)?.name ?? "Unknown Project",
			tone: resolveEventTone(event),
			verb: FEED_VERBS[event.eventType],
		});
	}

	return { foldedHeartbeatCount, items };
}

function collectFoldedStartedEventIds(events: AgentActivityPublicEvent[]) {
	const activeEvents = events.filter(
		(event) => event.eventType === "session_active"
	);
	return new Set(
		events
			.filter((event) => event.eventType === "session_started")
			.filter((startedEvent) =>
				activeEvents.some(
					(activeEvent) =>
						activeEvent.memberUserId === startedEvent.memberUserId &&
						activeEvent.provider === startedEvent.provider &&
						activeEvent.projectId === startedEvent.projectId &&
						activeEvent.observedAtMs >= startedEvent.observedAtMs &&
						activeEvent.observedAtMs - startedEvent.observedAtMs <=
							STARTED_TO_ACTIVE_FOLD_WINDOW_MS
				)
			)
			.map((event) => event.eventId)
	);
}

function deriveFacets(
	snapshot: AgentActivitySnapshotResponse,
	filters: ActivityViewFilters,
	nowMs: number
) {
	const projectSessions = snapshot.sessions.filter((session) =>
		matchesSessionFilters(session, { ...filters, projectId: null }, nowMs)
	);
	const providerSessions = snapshot.sessions.filter((session) =>
		matchesSessionFilters(session, { ...filters, provider: null }, nowMs)
	);
	const statusSessions = snapshot.sessions.filter((session) =>
		matchesSessionFilters(session, { ...filters, status: null }, nowMs)
	);

	return {
		projects: [...snapshot.projects]
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((project) => ({
				count: projectSessions.filter(
					(session) => session.projectId === project.id
				).length,
				id: project.id,
				label: project.name,
			})),
		providers: PROVIDER_FACETS.map((provider) => ({
			...provider,
			count: providerSessions.filter(
				(session) => session.provider === provider.id
			).length,
		})),
		statuses: STATUS_FACETS.map((status) => ({
			...status,
			count: statusSessions.filter(
				(session) => resolveSessionStatus(session, nowMs) === status.id
			).length,
		})),
	};
}

function deriveStats(input: {
	membersByUserId: ReadonlyMap<string, ActivityMember>;
	nowMs: number;
	projectsById: ReadonlyMap<
		string,
		AgentActivitySnapshotResponse["projects"][number]
	>;
	sessions: AgentActivityPublicSession[];
}) {
	const startOfToday = new Date(input.nowMs);
	startOfToday.setHours(0, 0, 0, 0);
	const startOfTodayMs = startOfToday.getTime();
	const sessionsToday = input.sessions.filter(
		(session) =>
			isTimestampToday(session.lastObservedAtMs, startOfTodayMs, input.nowMs) ||
			(session.startedAtMs !== null &&
				isTimestampToday(session.startedAtMs, startOfTodayMs, input.nowMs))
	);
	const todaySpans = input.sessions.flatMap((session) => {
		const span = intersectSessionWithWindow(
			session,
			startOfTodayMs,
			input.nowMs
		);
		return span ? [{ ...span, projectId: session.projectId }] : [];
	});
	const activeMemberCount = new Set(
		sessionsToday.map((session) => session.memberUserId)
	).size;
	const memberTotal =
		input.membersByUserId.size > 0 ? input.membersByUserId.size : null;
	const durationByProjectId = new Map<string, number>();
	for (const span of todaySpans) {
		durationByProjectId.set(
			span.projectId,
			(durationByProjectId.get(span.projectId) ?? 0) + span.durationMs
		);
	}
	const busiestProjectEntry = [...durationByProjectId.entries()].sort(
		([leftId, leftDuration], [rightId, rightDuration]) =>
			rightDuration - leftDuration ||
			(input.projectsById.get(leftId)?.name ?? "Unknown Project").localeCompare(
				input.projectsById.get(rightId)?.name ?? "Unknown Project"
			)
	)[0];
	const busiestProject = busiestProjectEntry
		? {
				durationMs: busiestProjectEntry[1],
				id: busiestProjectEntry[0],
				name:
					input.projectsById.get(busiestProjectEntry[0])?.name ??
					"Unknown Project",
			}
		: null;

	return {
		agentTimeTodayMs: todaySpans.reduce(
			(total, span) => total + span.durationMs,
			0
		),
		busiestProject,
		lastActivityAtMs: maximumTimestamp(input.sessions),
		membersActiveToday: {
			count: activeMemberCount,
			label:
				memberTotal === null
					? String(activeMemberCount)
					: `${String(activeMemberCount)}/${String(memberTotal)}`,
			total: memberTotal,
		},
		peakConcurrency: derivePeakConcurrency(todaySpans),
		sessionsToday: sessionsToday.length,
		workingNow: input.sessions.filter((session) =>
			isSessionCurrentlyActive(session, input.nowMs)
		).length,
	};
}

function deriveTimeline(nowMs: number, requestedWindowMs: number) {
	const windowMs = Math.max(MINUTE_MS, requestedWindowMs);
	const windowStartMs = nowMs - windowMs;
	const latestWholeHour = new Date(nowMs);
	latestWholeHour.setMinutes(0, 0, 0);
	const wholeHourMs = latestWholeHour.getTime();
	const tickStepHours = resolveTimelineTickStepHours(windowMs);
	const tickStepMs = tickStepHours * HOUR_MS;
	const alignedWholeHourMs =
		wholeHourMs - (new Date(wholeHourMs).getHours() % tickStepHours) * HOUR_MS;
	const ticks: ActivityTimelineTick[] = [];
	for (
		let timestampMs = alignedWholeHourMs;
		timestampMs >= windowStartMs;
		timestampMs -= tickStepMs
	) {
		const positionPercent = roundPercentage(
			((timestampMs - windowStartMs) / windowMs) * 100
		);
		if (100 - positionPercent >= 4) {
			ticks.push({ isNow: false, positionPercent, timestampMs });
		}
	}
	ticks.sort((left, right) => left.timestampMs - right.timestampMs);
	ticks.push({ isNow: true, positionPercent: 100, timestampMs: nowMs });
	return { ticks, windowEndMs: nowMs, windowStartMs };
}

function resolveTimelineTickStepHours(windowMs: number) {
	const windowHours = windowMs / HOUR_MS;
	if (windowHours <= 4) {
		return 1;
	}
	if (windowHours <= 8) {
		return 2;
	}
	if (windowHours <= 16) {
		return 4;
	}
	return 6;
}

function deriveLongestRun(
	memberLanes: ActivityMemberLane[]
): ActivityLongestRun | null {
	let longestRun: ActivityLongestRun | null = null;
	for (const memberLane of memberLanes) {
		for (const subLane of memberLane.subLanes) {
			for (const segment of subLane.segments) {
				const durationMs = Math.max(0, segment.endMs - segment.startMs);
				if (durationMs <= (longestRun?.durationMs ?? 0)) {
					continue;
				}
				longestRun = {
					durationMs,
					member: memberLane.member,
					memberUserId: memberLane.memberUserId,
					provider: subLane.provider,
				};
			}
		}
	}
	return longestRun;
}

function intersectSessionWithWindow(
	session: AgentActivityPublicSession,
	windowStartMs: number,
	windowEndMs: number
) {
	const startMs = Math.max(
		session.startedAtMs ?? session.lastObservedAtMs,
		windowStartMs
	);
	const endMs = Math.min(
		isSessionCurrentlyActive(session, windowEndMs)
			? windowEndMs
			: session.lastObservedAtMs,
		windowEndMs
	);
	if (endMs <= startMs) {
		return null;
	}
	return { durationMs: endMs - startMs, endMs, startMs };
}

function derivePeakConcurrency(spans: { endMs: number; startMs: number }[]) {
	const transitions = spans
		.flatMap((span) => [
			{ atMs: span.startMs, delta: 1 },
			{ atMs: span.endMs, delta: -1 },
		])
		.sort((left, right) => left.atMs - right.atMs || left.delta - right.delta);
	let concurrent = 0;
	let peak = 0;
	let peakAtMs: number | null = null;
	for (const transition of transitions) {
		concurrent += transition.delta;
		if (concurrent > peak) {
			peak = concurrent;
			peakAtMs = transition.atMs;
		}
	}
	return { atMs: peakAtMs, count: peak };
}

function collectMembers(
	directoryMembers: ReadonlyMap<string, ActivityMember>,
	filteredSessions: AgentActivityPublicSession[],
	allSessions: AgentActivityPublicSession[]
) {
	const members = new Map(directoryMembers);
	for (const session of [...allSessions, ...filteredSessions]) {
		if (!members.has(session.memberUserId)) {
			members.set(session.memberUserId, {
				image: null,
				name: session.memberName,
			});
		}
	}
	return members;
}

function matchesSessionFilters(
	session: AgentActivityPublicSession,
	filters: ActivityViewFilters,
	nowMs: number
) {
	return (
		((filters.memberUserId ?? null) === null ||
			session.memberUserId === filters.memberUserId) &&
		(filters.projectId === null || session.projectId === filters.projectId) &&
		(filters.provider === null || session.provider === filters.provider) &&
		(filters.status === null ||
			matchesStatusFilter(session, filters.status, nowMs))
	);
}

function matchesStatusFilter(
	session: AgentActivityPublicSession,
	status: string,
	nowMs: number
) {
	if (status === "active" || status === "working") {
		return isSessionCurrentlyActive(session, nowMs);
	}
	if (status === "idle") {
		return resolveSessionStatus(session, nowMs) === "idle";
	}
	if (
		status === "offline" ||
		status === "ended" ||
		status === "error" ||
		status === "unknown"
	) {
		return resolveSessionStatus(session, nowMs) === "offline";
	}
	return false;
}

function matchesEventFilters(
	event: AgentActivityPublicEvent,
	filters: ActivityViewFilters
) {
	if (
		(filters.memberUserId ?? null) !== null &&
		event.memberUserId !== filters.memberUserId
	) {
		return false;
	}
	if (filters.projectId !== null && event.projectId !== filters.projectId) {
		return false;
	}
	if (filters.provider !== null && event.provider !== filters.provider) {
		return false;
	}
	if (filters.status === null) {
		return true;
	}
	if (filters.status === "active" || filters.status === "working") {
		return event.status === "active";
	}
	if (filters.status === "idle") {
		return event.status === "idle";
	}
	return ["ended", "error", "unknown"].includes(event.status);
}

function sessionIntersectsWindow(
	session: AgentActivityPublicSession,
	windowStartMs: number,
	nowMs: number
) {
	const startMs = session.startedAtMs ?? session.lastObservedAtMs;
	const endMs = isSessionCurrentlyActive(session, nowMs)
		? nowMs
		: Math.min(session.lastObservedAtMs, nowMs);
	return startMs <= nowMs && endMs >= windowStartMs;
}

function resolveMember(
	session: AgentActivityPublicSession,
	membersByUserId: ReadonlyMap<string, ActivityMember>
): ActivityMember {
	return (
		membersByUserId.get(session.memberUserId) ?? {
			image: null,
			name: session.memberName,
		}
	);
}

function resolveSessionStatus(
	session: AgentActivityPublicSession,
	nowMs: number
): ActivityStatusFilter {
	if (isSessionCurrentlyActive(session, nowMs)) {
		return "working";
	}
	return session.status === "idle" ? "idle" : "offline";
}

function resolveSessionTone(
	session: AgentActivityPublicSession,
	nowMs: number
): StatusTone {
	if (isSessionCurrentlyActive(session, nowMs)) {
		return "ready";
	}
	if (session.status === "idle") {
		return "warning";
	}
	return session.status === "error" ? "danger" : "muted";
}

function resolveEventTone(event: AgentActivityPublicEvent): StatusTone {
	if (event.status === "active") {
		return "ready";
	}
	if (event.status === "idle") {
		return "warning";
	}
	return event.status === "error" ? "danger" : "muted";
}

function groupBy<T>(items: T[], resolveKey: (item: T) => string) {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = resolveKey(item);
		const group = groups.get(key);
		if (group) {
			group.push(item);
		} else {
			groups.set(key, [item]);
		}
	}
	return groups;
}

function maximumTimestamp(sessions: AgentActivityPublicSession[]) {
	if (sessions.length === 0) {
		return null;
	}
	return Math.max(...sessions.map((session) => session.lastObservedAtMs));
}

function isTimestampToday(
	timestampMs: number,
	startOfTodayMs: number,
	nowMs: number
) {
	return timestampMs >= startOfTodayMs && timestampMs <= nowMs;
}

function roundPercentage(value: number) {
	return Math.round(Math.max(0, Math.min(100, value)) * 1000) / 1000;
}

export function isSessionCurrentlyActive(
	session: AgentActivityPublicSession,
	currentTimeMs: number
) {
	return session.isActive && session.expiresAtMs > currentTimeMs;
}

export function formatProvider(session: AgentActivityPublicSession) {
	if (session.provider === "claude-code") {
		return "Claude Code";
	}
	if (session.provider === "opencode") {
		return "OpenCode";
	}
	if (session.provider === "cursor") {
		if (session.clientKind === "cursor-ide") {
			return "Cursor IDE";
		}
		return session.clientKind === "cursor-cli" ? "Cursor CLI" : "Cursor";
	}
	if (session.clientKind === "codex-app") {
		return "Codex Plugin";
	}
	return session.clientKind === "codex-cli" ? "Codex CLI" : "Codex";
}

export function formatProviderName(
	provider: AgentActivityPublicSession["provider"]
) {
	if (provider === "claude-code") {
		return "Claude Code";
	}
	if (provider === "cursor") {
		return "Cursor";
	}
	return provider === "opencode" ? "OpenCode" : "Codex";
}

export function formatSessionName(session: AgentActivityPublicSession) {
	return session.title ?? `${formatProvider(session)} session`;
}

export function formatDuration(durationMs: number) {
	const totalMinutes = Math.max(0, Math.floor(durationMs / MINUTE_MS));
	if (totalMinutes < 1) {
		return "just now";
	}
	if (totalMinutes < 60) {
		return `${String(totalMinutes)}m`;
	}
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${String(hours)}h ${String(minutes).padStart(2, "0")}m`;
}

export function resolveSessionDurationMs(
	session: AgentActivityPublicSession,
	nowMs: number
) {
	const endMs = isSessionCurrentlyActive(session, nowMs)
		? nowMs
		: session.lastObservedAtMs;
	return Math.max(0, endMs - (session.startedAtMs ?? session.lastObservedAtMs));
}

export function formatRelativeTime(timestampMs: number, relativeToMs: number) {
	if (timestampMs >= relativeToMs) {
		return "Just now";
	}
	const minutes = Math.max(
		1,
		Math.round((relativeToMs - timestampMs) / MINUTE_MS)
	);
	if (minutes < 60) {
		return `${String(minutes)}m ago`;
	}
	const hours = Math.round(minutes / 60);
	return hours < 24
		? `${String(hours)}h ago`
		: `${String(Math.round(hours / 24))}d ago`;
}
