import type {
	AgentAccessRequestView,
	AgentProfileAccessGrantView,
} from "@openmeld/schemas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AgentAccessEntry,
	agentAccessEntryId,
	buildInSpaceAgentAccessEntries,
	buildOwnerAgentAccessEntries,
	buildRequesterAgentAccessEntry,
	buildRequesterSpaceJoinEntries,
	sortAgentAccessEntries,
} from "./agent-access-entries";
import {
	AgentAccessList,
	agentAccessRowDetail,
	resolveAgentAccessOwnerOptions,
	resolveAgentAccessRowControl,
} from "./agent-access-list";

vi.mock("#/components/agents/remote-agent-avatar", () => ({
	RemoteAgentAvatar: () => <span data-testid="agent-avatar" />,
}));
vi.mock("#/components/profiles/dither-profile-avatar", () => ({
	DitherProfileAvatar: () => <span data-testid="person-avatar" />,
}));

afterEach(cleanup);

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const OWNER_USER = "u-felix";
const TALI_USER = "u-tali";
const TALI_PROFILE = "hp-tali";
const AGENT = "agt-cc";
const REMOVE_ACCESS = /Remove access/u;
const EVERY_CHAT = /This applies to every chat with/u;
const ALWAYS_ALLOW_ITEM = /^Always allow /u;

function request(
	overrides: Partial<AgentAccessRequestView> = {}
): AgentAccessRequestView {
	return {
		id: "req-1",
		kind: "direct_message",
		status: "pending",
		spaceId: "dm-1",
		sourceSignalId: "sig-1",
		agentProfileId: AGENT,
		agentProfileName: "Claude Code",
		ownerUserId: OWNER_USER,
		ownerName: "Felix Lu",
		requesterProfileId: TALI_PROFILE,
		requesterName: "Tali Smoke",
		requesterKind: "member",
		createdAt: "2026-10-20T10:00:00.000Z",
		decidedAt: null,
		viewerRole: "owner",
		availableDecisions: ["allow_once", "always_allow", "decline"],
		decision: null,
		grant: null,
		...overrides,
	};
}

function grant(
	overrides: Partial<AgentProfileAccessGrantView> = {}
): AgentProfileAccessGrantView {
	return {
		id: "g-1",
		profileId: AGENT,
		granteeUserId: TALI_USER,
		granteeName: "Tali Smoke",
		granteeKind: "member",
		scope: "always",
		grantedAt: "2026-10-20T11:00:00.000Z",
		...overrides,
	};
}

function ownerEntries(input: {
	requests?: AgentAccessRequestView[];
	grants?: AgentProfileAccessGrantView[];
}) {
	return buildOwnerAgentAccessEntries({
		requests: input.requests ?? [],
		grants: input.grants ?? [],
		agents: new Map(),
		ownerUserId: OWNER_USER,
		humanProfileIdByUserId: new Map([[TALI_USER, TALI_PROFILE]]),
	});
}

describe("owner access entries", () => {
	it("joins a person's request and always grant into one row", () => {
		const entries = ownerEntries({
			requests: [
				request({
					status: "allowed",
					decidedAt: "2026-10-20T11:00:00.000Z",
					availableDecisions: [],
				}),
			],
			grants: [grant()],
		});
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			id: agentAccessEntryId({
				agentProfileId: AGENT,
				subjectId: TALI_PROFILE,
			}),
			rule: "always",
			viewerRole: "owner",
			spaces: [{ spaceId: "dm-1", kind: "direct_message" }],
		});
		expect(entries[0]?.grants.map((item) => item.id)).toEqual(["g-1"]);
	});

	it("shows a pending request as waiting even when a grant exists", () => {
		const [entry] = ownerEntries({
			requests: [request()],
			grants: [grant()],
		});
		expect(entry?.rule).toBe("waiting");
		expect(entry?.pendingRequest?.id).toBe("req-1");
	});

	it("reads an active once grant as this chat only", () => {
		const [entry] = ownerEntries({
			requests: [
				request({
					status: "allowed",
					decision: "allow_once",
					grant: { status: "active", revokedAt: null },
					decidedAt: "2026-10-20T11:00:00.000Z",
					availableDecisions: [],
				}),
			],
			grants: [grant({ id: "g-once", scope: "once" })],
		});
		expect(entry?.rule).toBe("once");
		expect(entry?.decidedAt).toBe("2026-10-20T11:00:00.000Z");
	});

	it("reads an allowed request whose grant is gone as access removed", () => {
		const [entry] = ownerEntries({
			requests: [
				request({
					status: "allowed",
					decision: "always_allow",
					grant: { status: "revoked", revokedAt: "2026-10-20T11:30:00.000Z" },
					decidedAt: "2026-10-20T11:00:00.000Z",
					availableDecisions: [],
				}),
			],
		});
		expect(entry?.rule).toBe("removed");
		// No time on removed access, so the row never claims a wrong one.
		expect(entry?.decidedAt).toBeNull();
		expect(entry?.person?.userId).toBe(TALI_USER);
	});

	it("keeps only the latest request per person", () => {
		const [entry] = ownerEntries({
			requests: [
				request({ id: "old", status: "declined", availableDecisions: [] }),
				request({
					id: "new",
					spaceId: "dm-2",
					createdAt: "2026-10-20T11:30:00.000Z",
				}),
			],
		});
		expect(entry?.rule).toBe("waiting");
		expect(entry?.pendingRequest?.id).toBe("new");
		expect(entry?.spaces.map((space) => space.spaceId)).toEqual([
			"dm-1",
			"dm-2",
		]);
	});

	it("drops withdrawn requests and lists a grant without a request", () => {
		const entries = ownerEntries({
			requests: [request({ status: "withdrawn", availableDecisions: [] })],
		});
		expect(entries).toEqual([]);
		const [fromGrant] = ownerEntries({ grants: [grant()] });
		expect(fromGrant?.rule).toBe("always");
		expect(fromGrant?.spaces).toEqual([]);
	});

	it("ignores requests the viewer made", () => {
		expect(
			ownerEntries({ requests: [request({ viewerRole: "requester" })] })
		).toEqual([]);
	});
});

describe("requester access entries", () => {
	const agent = {
		profileId: AGENT,
		name: "Claude Code",
		ownerUserId: OWNER_USER,
	};
	const viewer = {
		profileId: TALI_PROFILE,
		userId: TALI_USER,
		name: "Tali Smoke",
	};

	it("maps the shared requester state to a rule", () => {
		const pending = request({
			viewerRole: "requester",
			availableDecisions: [],
		});
		const waiting = buildRequesterAgentAccessEntry({
			access: { state: "waiting", request: pending, ownerName: "Felix Lu" },
			agent,
			viewer,
			spaces: [],
		});
		expect(waiting).toMatchObject({
			rule: "waiting",
			viewerRole: "requester",
			pendingRequest: pending,
		});
		expect(
			buildRequesterAgentAccessEntry({
				access: {
					state: "always_allowed",
					request: null,
					ownerName: "Felix Lu",
				},
				agent,
				viewer,
				spaces: [],
			})?.rule
		).toBe("always");
	});

	it("shows revoked access as removed, without a time", () => {
		const revoked = request({
			viewerRole: "requester",
			status: "allowed",
			decision: "allow_once",
			grant: { status: "revoked", revokedAt: "2026-10-20T11:30:00.000Z" },
			availableDecisions: [],
		});
		const entry = buildRequesterAgentAccessEntry({
			access: { state: "revoked", request: revoked, ownerName: "Felix Lu" },
			agent,
			viewer,
			spaces: [],
		});
		expect(entry?.rule).toBe("removed");
		// The removed grant may be a standing grant, not this request's.
		expect(entry && agentAccessRowDetail(entry, NOW)).toBe("Access removed");
	});

	it("makes no row before a request is sent", () => {
		for (const state of ["draft", "none", "not_required"] as const) {
			expect(
				buildRequesterAgentAccessEntry({
					access: { state, request: null, ownerName: "Felix Lu" },
					agent,
					viewer,
					spaces: [],
				})
			).toBeNull();
		}
	});

	it("lists the viewer's pending and declined requests to add an Agent", () => {
		const entries = buildRequesterSpaceJoinEntries({
			spaceId: "s-1",
			requests: [
				request({
					kind: "space_join",
					spaceId: "s-1",
					viewerRole: "requester",
					status: "ignored",
					availableDecisions: [],
				}),
				request({
					id: "joined",
					agentProfileId: "agt-other",
					kind: "space_join",
					spaceId: "s-1",
					viewerRole: "requester",
					status: "joined",
					availableDecisions: [],
				}),
			],
		});
		expect(entries.map((entry) => entry.rule)).toEqual(["declined"]);
	});
});

describe("in-Space entries", () => {
	it("lists only active Agents other people own", () => {
		const entries = buildInSpaceAgentAccessEntries({
			spaceId: "s-1",
			viewerUserId: TALI_USER,
			centerAgentProfileId: "agt-center",
			agents: [
				{
					profileId: AGENT,
					profileName: "Claude Code",
					status: "active",
					ownerUserId: OWNER_USER,
					ownerName: "Felix Lu",
				},
				{
					profileId: "agt-mine",
					profileName: "Codex",
					status: "active",
					ownerUserId: TALI_USER,
				},
				{
					profileId: "agt-center",
					profileName: "Center",
					status: "active",
					ownerUserId: OWNER_USER,
				},
				{
					profileId: "agt-gone",
					profileName: "Gone",
					status: "removed",
					ownerUserId: OWNER_USER,
				},
			],
		});
		expect(entries.map((entry) => entry.agent.profileId)).toEqual([AGENT]);
		expect(entries[0]).toMatchObject({
			rule: "in_space",
			viewerRole: "viewer",
			person: null,
		});
	});
});

function ownerAlwaysEntry(): AgentAccessEntry {
	const [entry] = ownerEntries({ grants: [grant()] });
	if (!entry) {
		throw new Error("missing entry");
	}
	return entry;
}

describe("row copy and controls", () => {
	it("words the rule for the viewer and adds when it took effect", () => {
		const entry = ownerAlwaysEntry();
		expect(agentAccessRowDetail(entry, NOW)).toBe("Always allowed · 1h ago");
		expect(agentAccessRowDetail(entry, NOW, { ruleShownInControl: true })).toBe(
			"Allowed 1h ago"
		);
		expect(
			agentAccessRowDetail({ ...entry, rule: "waiting", decidedAt: null }, NOW)
		).toBe("Waiting for you");
		expect(
			agentAccessRowDetail(
				{
					...entry,
					agent: { ...entry.agent, ownerName: "Felix Lu" },
					rule: "waiting",
					decidedAt: null,
					viewerRole: "requester",
				},
				NOW
			)
		).toBe("Waiting for Felix Lu");
	});

	it("offers the owner only an upgrade from this chat and removal", () => {
		const always = ownerAlwaysEntry();
		expect(resolveAgentAccessOwnerOptions(always)).toEqual({
			alwaysAllow: false,
			remove: true,
		});
		const once = {
			...always,
			rule: "once" as const,
			grants: [grant({ scope: "once" })],
		};
		expect(resolveAgentAccessOwnerOptions(once)).toEqual({
			alwaysAllow: true,
			remove: true,
		});
		const removed = { ...always, rule: "removed" as const, grants: [] };
		expect(resolveAgentAccessOwnerOptions(removed)).toEqual({
			alwaysAllow: false,
			remove: false,
		});
		const external = {
			...once,
			person: always.person
				? { ...always.person, kind: "external" as const }
				: null,
		};
		expect(resolveAgentAccessOwnerOptions(external).alwaysAllow).toBe(false);
	});

	it("gives each role only its own control", () => {
		const always = ownerAlwaysEntry();
		const pending = request();
		const control = (entry: AgentAccessEntry, readOnly = false) =>
			resolveAgentAccessRowControl({ entry, readOnly, canAskAgain: true }).kind;
		expect(control(always)).toBe("owner_manage");
		expect(control({ ...always, rule: "once", grants: [], person: null })).toBe(
			"none"
		);
		expect(
			control({ ...always, rule: "waiting", pendingRequest: pending })
		).toBe("owner_decide");
		expect(
			control({
				...always,
				viewerRole: "requester",
				rule: "waiting",
				pendingRequest: pending,
				grants: [],
			})
		).toBe("requester_withdraw");
		expect(
			control({
				...always,
				viewerRole: "requester",
				rule: "declined",
				grants: [],
			})
		).toBe("requester_ask_again");
		expect(control({ ...always, viewerRole: "viewer" })).toBe("none");
		expect(control(always, true)).toBe("none");
	});
});

describe("AgentAccessList", () => {
	it("answers a pending request inline without Always for external people", () => {
		const decide = vi.fn();
		const pending = request({
			requesterKind: "external",
			availableDecisions: ["allow_once", "decline"],
		});
		const [entry] = ownerEntries({ requests: [pending] });
		render(
			<AgentAccessList
				actions={{ busy: false, decide }}
				entries={entry ? [entry] : []}
				nowMs={NOW}
			/>
		);
		expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
		expect(decide).toHaveBeenCalledWith(pending, "allow_once");
	});

	it("lets the requester withdraw their own pending row", () => {
		const withdraw = vi.fn();
		const pending = request({
			viewerRole: "requester",
			availableDecisions: [],
		});
		const entry = buildRequesterAgentAccessEntry({
			access: { state: "waiting", request: pending, ownerName: "Felix Lu" },
			agent: { profileId: AGENT, name: "Claude Code", ownerUserId: OWNER_USER },
			viewer: {
				profileId: TALI_PROFILE,
				userId: TALI_USER,
				name: "Tali Smoke",
			},
			spaces: [],
		});
		render(
			<AgentAccessList
				actions={{ busy: false, withdraw }}
				entries={entry ? [entry] : []}
				nowMs={NOW}
			/>
		);
		expect(screen.getByText("Tali Smoke (you)")).toBeTruthy();
		expect(screen.getByText("Waiting for Felix Lu")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		expect(withdraw).toHaveBeenCalledWith(pending);
	});

	it("shows rows without controls when read-only", () => {
		render(
			<AgentAccessList
				actions={{ busy: false, removeAccess: vi.fn() }}
				entries={[ownerAlwaysEntry()]}
				nowMs={NOW}
				readOnly
			/>
		);
		expect(screen.getByText("Always allowed · 1h ago")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("removes an always grant only after one confirmation", async () => {
		const removeAccess = vi.fn();
		const entry = ownerAlwaysEntry();
		render(
			<AgentAccessList
				actions={{ busy: false, removeAccess }}
				entries={[entry]}
				nowMs={NOW}
			/>
		);
		fireEvent.click(
			screen.getByRole("button", { name: REMOVE_ACCESS_TRIGGER })
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: REMOVE_ACCESS })
		);
		expect(removeAccess).not.toHaveBeenCalled();
		expect(await screen.findByText(EVERY_CHAT)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: REMOVE_ACCESS }));
		expect(removeAccess).toHaveBeenCalledWith(entry);
	});

	it("always allows a once row from its menu without asking", async () => {
		const alwaysAllow = vi.fn();
		const always = ownerAlwaysEntry();
		const once = {
			...always,
			rule: "once" as const,
			grants: [grant({ scope: "once" })],
		};
		render(
			<AgentAccessList
				actions={{ busy: false, alwaysAllow }}
				entries={[once]}
				nowMs={NOW}
			/>
		);
		fireEvent.click(
			screen.getByRole("button", { name: REMOVE_ACCESS_TRIGGER })
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: ALWAYS_ALLOW_ITEM })
		);
		expect(alwaysAllow).toHaveBeenCalledWith(once);
	});

	it("marks the deep-linked row", () => {
		const entry = ownerAlwaysEntry();
		const scrollIntoView = vi.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		render(
			<AgentAccessList
				entries={[entry]}
				highlightId={entry.id}
				nowMs={NOW}
				readOnly
			/>
		);
		const row = document.getElementById(`agent-access-entry-${entry.id}`);
		expect(row?.dataset.highlighted).toBe("true");
		expect(scrollIntoView).toHaveBeenCalled();
	});

	it("puts waiting rows first", () => {
		const always = ownerAlwaysEntry();
		const waiting = {
			...always,
			id: "w",
			rule: "waiting" as const,
			person: always.person ? { ...always.person, name: "Zed" } : null,
		};
		expect(
			sortAgentAccessEntries([always, waiting]).map((entry) => entry.id)
		).toEqual(["w", always.id]);
	});
});

const REMOVE_ACCESS_TRIGGER = /change access for Tali Smoke/u;
