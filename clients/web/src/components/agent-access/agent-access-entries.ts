import type {
	AgentAccessGranteeKind,
	AgentAccessRequestKind,
	AgentAccessRequestView,
	AgentProfileAccessGrantView,
} from "@openmeld/schemas";
import type { ColleagueAccess } from "#/lib/agents/colleague-access-state";

// The Agent access list (space-collaboration.md, Agent access list): one
// person's right to use an Agent Profile they do not own. Entries are a read
// projection of Core's requests and grants; they hold no state of their own.

/**
 * - `always`: an active `always` grant; every chat with the Profile.
 * - `once`: an active `once` grant; that request's chat only.
 * - `waiting`: a pending request.
 * - `declined`: the owner declined (or did not add) the latest request.
 * - `removed`: the owner allowed the latest request, then took it back.
 * - `in_space`: the Agent is a member of a group Space.
 */
export type AgentAccessRule =
	| "always"
	| "once"
	| "waiting"
	| "declined"
	| "removed"
	| "in_space";

/** What the viewer may change on a row; the surface never decides this. */
export type AgentAccessViewerRole = "owner" | "requester" | "viewer";

export type AgentAccessEntrySpace = {
	spaceId: string;
	/** `space` for an Agent that is a member of a group Space. */
	kind: AgentAccessRequestKind | "space";
};

export type AgentAccessEntry = {
	/** Stable across surfaces, so a deep link can name the row. */
	id: string;
	agent: {
		profileId: string;
		name: string;
		ownerUserId: string | null;
		ownerName: string | null;
	};
	/** Null for `in_space`, which covers the Space's members. */
	person: {
		profileId: string | null;
		userId: string | null;
		name: string;
		kind: AgentAccessGranteeKind;
	} | null;
	rule: AgentAccessRule;
	/** When the rule took effect; null while waiting or for `in_space`. */
	decidedAt: string | null;
	viewerRole: AgentAccessViewerRole;
	spaces: readonly AgentAccessEntrySpace[];
	/** The request the owner can answer, or the requester can withdraw. */
	pendingRequest: AgentAccessRequestView | null;
	/** The person's active grants for the Profile; the owner's view only. */
	grants: readonly AgentProfileAccessGrantView[];
};

export function agentAccessEntryId(input: {
	agentProfileId: string;
	/** The person's Human Profile, or the Space for `in_space`. */
	subjectId: string;
}): string {
	return `${input.agentProfileId}:${input.subjectId}`;
}

function spaceKey(space: AgentAccessEntrySpace): string {
	return space.spaceId;
}

function uniqueSpaces(
	spaces: readonly AgentAccessEntrySpace[]
): AgentAccessEntrySpace[] {
	const byId = new Map<string, AgentAccessEntrySpace>();
	for (const space of spaces) {
		byId.set(spaceKey(space), space);
	}
	return [...byId.values()];
}

function latest(
	requests: readonly AgentAccessRequestView[]
): AgentAccessRequestView | null {
	let current: AgentAccessRequestView | null = null;
	for (const request of requests) {
		if (!current || current.createdAt < request.createdAt) {
			current = request;
		}
	}
	return current;
}

/**
 * The rule the latest request leaves when no active grant covers the
 * person. Its decision is history; an allowed request whose grant is gone
 * means the access was removed.
 */
function requestRule(
	request: AgentAccessRequestView
): Exclude<AgentAccessRule, "in_space"> | null {
	switch (request.status) {
		case "pending":
			return "waiting";
		case "allowed":
			if (request.grant?.status === "active") {
				return request.decision === "always_allow" ? "always" : "once";
			}
			return "removed";
		case "declined":
		case "ignored":
			return "declined";
		default:
			// Withdrawn, voided, joined (the Agent is in the Space now) or a
			// retired Reply by DM: no access to show.
			return null;
	}
}

/**
 * The owner's entries: one per Agent and person, from the requests they can
 * answer and the grants they gave. A grant without a request in view (the
 * Agent page lists every grant) still makes a row.
 */
export function buildOwnerAgentAccessEntries(input: {
	requests: readonly AgentAccessRequestView[];
	/** The owner's active grants for the Agents in view. */
	grants: readonly AgentProfileAccessGrantView[];
	agents: ReadonlyMap<string, { name: string; ownerName: string | null }>;
	ownerUserId: string;
	/** Grantee user → Human Profile, from the Organization directory. */
	humanProfileIdByUserId: ReadonlyMap<string, string>;
}): AgentAccessEntry[] {
	const groups = new Map<string, OwnerRequestGroup>();
	for (const request of input.requests) {
		if (request.viewerRole !== "owner") {
			continue;
		}
		const id = agentAccessEntryId({
			agentProfileId: request.agentProfileId,
			subjectId: request.requesterProfileId,
		});
		const group = groups.get(id) ?? {
			agentProfileId: request.agentProfileId,
			personProfileId: request.requesterProfileId,
			requests: [],
		};
		group.requests.push(request);
		groups.set(id, group);
	}
	const grantsByPerson = new Map<string, AgentProfileAccessGrantView[]>();
	for (const grant of input.grants) {
		const id = agentAccessEntryId({
			agentProfileId: grant.profileId,
			subjectId:
				input.humanProfileIdByUserId.get(grant.granteeUserId) ??
				grant.granteeUserId,
		});
		grantsByPerson.set(id, [...(grantsByPerson.get(id) ?? []), grant]);
	}
	const userIdByHumanProfileId = new Map(
		[...input.humanProfileIdByUserId].map(([userId, profileId]) => [
			profileId,
			userId,
		])
	);
	const entries: AgentAccessEntry[] = [];
	for (const id of new Set([...groups.keys(), ...grantsByPerson.keys()])) {
		const group = groups.get(id) ?? null;
		const entry = buildOwnerEntry({
			id,
			group,
			grants: grantsByPerson.get(id) ?? [],
			personUserId: group
				? (userIdByHumanProfileId.get(group.personProfileId) ?? null)
				: null,
			agents: input.agents,
			ownerUserId: input.ownerUserId,
		});
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

type OwnerRequestGroup = {
	agentProfileId: string;
	personProfileId: string;
	requests: AgentAccessRequestView[];
};

/**
 * A pending request wins; then an active grant (`always` before `once`);
 * then what the latest request left.
 */
function resolveOwnerRule(input: {
	request: AgentAccessRequestView | null;
	grants: readonly AgentProfileAccessGrantView[];
}): Exclude<AgentAccessRule, "in_space"> | null {
	if (input.request?.status === "pending") {
		return "waiting";
	}
	if (input.grants.some((grant) => grant.scope === "always")) {
		return "always";
	}
	if (input.grants.some((grant) => grant.scope === "once")) {
		return "once";
	}
	return input.request ? requestRule(input.request) : null;
}

function newestGrantedAt(
	grants: readonly AgentProfileAccessGrantView[],
	scope: AgentProfileAccessGrantView["scope"]
): string | null {
	let newest: string | null = null;
	for (const grant of grants) {
		if (grant.scope === scope && (!newest || newest < grant.grantedAt)) {
			newest = grant.grantedAt;
		}
	}
	return newest;
}

function resolveOwnerDecidedAt(input: {
	rule: AgentAccessRule;
	request: AgentAccessRequestView | null;
	grants: readonly AgentProfileAccessGrantView[];
}): string | null {
	switch (input.rule) {
		case "waiting":
			return null;
		case "always":
		case "once":
			return (
				newestGrantedAt(input.grants, input.rule) ??
				input.request?.decidedAt ??
				null
			);
		// The grant that was removed may not be the request's, so no time
		// is shown rather than a wrong one.
		case "removed":
			return null;
		default:
			return input.request?.decidedAt ?? null;
	}
}

function buildOwnerEntry(input: {
	id: string;
	group: OwnerRequestGroup | null;
	grants: readonly AgentProfileAccessGrantView[];
	personUserId: string | null;
	agents: ReadonlyMap<string, { name: string; ownerName: string | null }>;
	ownerUserId: string;
}): AgentAccessEntry | null {
	const { grants, group } = input;
	// Adding an Agent to a group Space is Space membership, not the person's
	// own access: only a pending one belongs on their row.
	const requests = (group?.requests ?? []).filter(
		(item) => item.kind !== "space_join" || item.status === "pending"
	);
	const request = latest(requests);
	const rule = resolveOwnerRule({ request, grants });
	if (!rule) {
		return null;
	}
	const grant = grants[0] ?? null;
	const agentProfileId = group?.agentProfileId ?? grant?.profileId ?? "";
	const agent = input.agents.get(agentProfileId);
	return {
		id: input.id,
		agent: {
			profileId: agentProfileId,
			name: agent?.name ?? request?.agentProfileName ?? "Agent",
			ownerUserId: input.ownerUserId,
			ownerName: agent?.ownerName ?? request?.ownerName ?? null,
		},
		person: {
			profileId: group?.personProfileId ?? null,
			userId: grant?.granteeUserId ?? input.personUserId,
			name: request?.requesterName ?? grant?.granteeName ?? "Someone",
			kind: request?.requesterKind ?? grant?.granteeKind ?? "member",
		},
		rule,
		decidedAt: resolveOwnerDecidedAt({ rule, request, grants }),
		viewerRole: "owner",
		spaces: uniqueSpaces(
			requests
				.filter((item) => item.status !== "withdrawn")
				.map((item) => ({ spaceId: item.spaceId, kind: item.kind }))
		),
		pendingRequest: rule === "waiting" ? request : null,
		grants,
	};
}

/**
 * The requester's own entry with a teammate's Agent, from the shared
 * requester state (`useColleagueAccessState`). Null when there is nothing
 * to show yet (no request sent, or the viewer owns the Agent).
 */
export function buildRequesterAgentAccessEntry(input: {
	access: ColleagueAccess;
	agent: { profileId: string; name: string; ownerUserId: string };
	viewer: { profileId: string; userId: string; name: string };
	spaces: readonly AgentAccessEntrySpace[];
}): AgentAccessEntry | null {
	const rule = requesterRule(input.access.state);
	if (!rule) {
		return null;
	}
	const request = input.access.request;
	return {
		id: agentAccessEntryId({
			agentProfileId: input.agent.profileId,
			subjectId: input.viewer.profileId,
		}),
		agent: {
			profileId: input.agent.profileId,
			name: input.agent.name,
			ownerUserId: input.agent.ownerUserId,
			ownerName: input.access.ownerName,
		},
		person: {
			profileId: input.viewer.profileId,
			userId: input.viewer.userId,
			name: input.viewer.name,
			kind: "member",
		},
		rule,
		decidedAt: requesterDecidedAt(rule, request),
		viewerRole: "requester",
		spaces: uniqueSpaces(
			request
				? [{ spaceId: request.spaceId, kind: request.kind }, ...input.spaces]
				: input.spaces
		),
		pendingRequest: rule === "waiting" ? request : null,
		grants: [],
	};
}

function requesterDecidedAt(
	rule: AgentAccessRule,
	request: AgentAccessRequestView | null
): string | null {
	// Removed access shows no time: the grant that was removed may not be
	// the request's, and a wrong time is worse than none.
	if (rule === "waiting" || rule === "removed") {
		return null;
	}
	return request?.decidedAt ?? null;
}

function requesterRule(
	state: ColleagueAccess["state"]
): Exclude<AgentAccessRule, "in_space"> | null {
	switch (state) {
		case "waiting":
			return "waiting";
		case "approved_once":
			return "once";
		case "always_allowed":
			return "always";
		case "declined":
			return "declined";
		case "revoked":
			return "removed";
		default:
			return null;
	}
}

/**
 * The viewer's own requests to add a teammate's Agent to a group Space.
 * Direct Message requests go through the shared requester state instead.
 */
export function buildRequesterSpaceJoinEntries(input: {
	requests: readonly AgentAccessRequestView[];
	spaceId: string;
}): AgentAccessEntry[] {
	const byAgent = new Map<string, AgentAccessRequestView[]>();
	for (const request of input.requests) {
		if (
			request.viewerRole === "requester" &&
			request.kind === "space_join" &&
			request.spaceId === input.spaceId
		) {
			byAgent.set(request.agentProfileId, [
				...(byAgent.get(request.agentProfileId) ?? []),
				request,
			]);
		}
	}
	const entries: AgentAccessEntry[] = [];
	for (const requests of byAgent.values()) {
		const request = latest(requests);
		const rule = request ? requestRule(request) : null;
		if (!(request && (rule === "waiting" || rule === "declined"))) {
			continue;
		}
		entries.push({
			id: agentAccessEntryId({
				agentProfileId: request.agentProfileId,
				subjectId: request.requesterProfileId,
			}),
			agent: {
				profileId: request.agentProfileId,
				name: request.agentProfileName,
				ownerUserId: request.ownerUserId,
				ownerName: request.ownerName,
			},
			person: {
				profileId: request.requesterProfileId,
				userId: null,
				name: request.requesterName,
				kind: request.requesterKind,
			},
			rule,
			decidedAt: rule === "waiting" ? null : request.decidedAt,
			viewerRole: "requester",
			spaces: [{ spaceId: request.spaceId, kind: request.kind }],
			pendingRequest: rule === "waiting" ? request : null,
			grants: [],
		});
	}
	return entries;
}

/** Agents in a group Space that other people own: its members may mention them. */
export function buildInSpaceAgentAccessEntries(input: {
	spaceId: string;
	viewerUserId: string;
	centerAgentProfileId: string | null;
	agents: readonly {
		profileId: string;
		profileName: string;
		status: string;
		ownerUserId?: string | null;
		ownerName?: string | null;
	}[];
}): AgentAccessEntry[] {
	return input.agents
		.filter(
			(agent) =>
				agent.status === "active" &&
				agent.profileId !== input.centerAgentProfileId &&
				Boolean(agent.ownerUserId) &&
				agent.ownerUserId !== input.viewerUserId
		)
		.map((agent) => ({
			id: agentAccessEntryId({
				agentProfileId: agent.profileId,
				subjectId: input.spaceId,
			}),
			agent: {
				profileId: agent.profileId,
				name: agent.profileName,
				ownerUserId: agent.ownerUserId ?? null,
				ownerName: agent.ownerName ?? null,
			},
			person: null,
			rule: "in_space" as const,
			decidedAt: null,
			viewerRole: "viewer" as const,
			spaces: [{ spaceId: input.spaceId, kind: "space" as const }],
			pendingRequest: null,
			grants: [],
		}));
}

/** Waiting rows first, then by name. */
export function sortAgentAccessEntries(
	entries: readonly AgentAccessEntry[]
): AgentAccessEntry[] {
	return [...entries].sort((left, right) => {
		const waiting =
			Number(right.rule === "waiting") - Number(left.rule === "waiting");
		if (waiting !== 0) {
			return waiting;
		}
		return entryTitle(left).localeCompare(entryTitle(right));
	});
}

function entryTitle(entry: AgentAccessEntry): string {
	return entry.person?.name ?? entry.agent.name;
}
