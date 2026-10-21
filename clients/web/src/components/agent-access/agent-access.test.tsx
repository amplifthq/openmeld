import type { AgentAccessRequestView } from "@openmeld/schemas";
import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { WakeProgressItem } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isAgentRequestCandidate,
	resolveEffectiveAddMemberProfileIds,
} from "#/components/spaces/people-agent-picker-model";
import {
	MessageScroller,
	MessageScrollerContent,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "#/components/spaces/primitives/message-scroller";
import {
	AgentAccessRequestCard,
	agentAccessOutcomeCopy,
	canMessageAgentAccessRequester,
} from "./agent-access-request-card";
import { resolveAgentRequestSpaceLabel } from "./agent-access-space-labels";
import {
	collectHeldAgentAccessWakeKeys,
	withoutHeldAgentAccessWakeProgress,
} from "./held-agent-access-wake-progress";
import {
	requesterAgentAccessCopy,
	SpaceAgentAccessBar,
	SpaceAgentAccessPreviews,
	type SpaceAgentAccessRequestsState,
	splitAgentAccessDecisions,
} from "./space-agent-access-requests";
import {
	addAgentRequestMentionSelection,
	buildSpaceAgentRequestMentionItems,
	groupSpaceAgentRequestMentionItems,
	resolveAgentRequestMentionProfileIds,
} from "./space-agent-request-mentions";

const ALWAYS_ALLOW = /Always allow/u;
const ASKED_EVERY_TIME = /asked every time/u;
const EDITED_OR_DELETED = /edited or deleted/u;
const JOIN_TO_POST = /join to post/u;

const state = vi.hoisted(() => ({
	request: null as AgentAccessRequestView | null,
	decide: vi.fn(),
	openDirectMessage: vi.fn(),
}));
vi.mock("#/query/agent-access", () => ({
	useAgentAccessRequest: () => ({
		data: state.request,
		isPending: false,
		isRefetchError: false,
		error: null,
		refetch: vi.fn(),
	}),
	useDecideAgentAccessRequest: () => ({
		isPending: false,
		mutateAsync: state.decide,
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: (props: { children: unknown; to: string }) => (
		<a href={props.to}>{props.children as string}</a>
	),
	useNavigate: () => vi.fn(),
}));
vi.mock("#/components/member-agents/use-member-agents", () => ({
	useMemberAgentIndex: () => ({
		index: {
			byProfileId: new Map([["agt_1", { harnessKind: "claude-code" }]]),
		},
	}),
}));
vi.mock("#/lib/spaces/use-open-direct-message", () => ({
	useOpenDirectMessage: () => ({
		open: state.openDirectMessage,
		pendingProfileId: null,
	}),
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: { id: "org-1", slug: "acme" },
	}),
}));

afterEach(() => {
	cleanup();
	state.request = null;
	state.decide.mockReset();
	state.openDirectMessage.mockReset();
});

function request(
	overrides: Partial<AgentAccessRequestView> = {}
): AgentAccessRequestView {
	return {
		id: "aar_1",
		kind: "direct_message",
		status: "pending",
		decision: null,
		grant: null,
		spaceId: "space-1",
		sourceSignalId: "signal-1",
		agentProfileId: "agt_1",
		agentProfileName: "PR Reviewer",
		ownerUserId: "felix",
		ownerName: "Felix",
		requesterProfileId: "tali-profile",
		requesterName: "Tali",
		requesterKind: "member",
		createdAt: "2026-10-19T00:00:00.000Z",
		decidedAt: null,
		viewerRole: "owner",
		availableDecisions: ["allow_once", "always_allow", "decline"],
		...overrides,
	};
}

describe("Agent owner answer card", () => {
	it("offers Allow once, Always allow <colleague> and Decline", () => {
		state.request = request();
		state.decide.mockResolvedValue({ request: request() });
		render(<AgentAccessRequestCard requestId="aar_1" />);
		expect(screen.getByText("Tali wants to use PR Reviewer")).toBeTruthy();
		const labels = screen
			.getAllByRole("button")
			.map((button) => button.textContent);
		expect(labels).toEqual(["Allow once", "Always allow Tali", "Decline"]);
		fireEvent.click(screen.getByRole("button", { name: "Always allow Tali" }));
		expect(state.decide).toHaveBeenCalledWith({
			decision: "always_allow",
			requestId: "aar_1",
		});
	});

	it("never offers always allow to someone outside the organization", () => {
		state.request = request({
			kind: "external_message",
			requesterKind: "external",
			availableDecisions: ["allow_once", "decline"],
		});
		render(<AgentAccessRequestCard requestId="aar_1" />);
		expect(screen.queryByRole("button", { name: ALWAYS_ALLOW })).toBeNull();
		expect(screen.getByText(ASKED_EVERY_TIME)).toBeTruthy();
	});

	it("shows the outcome instead of choices once answered", () => {
		state.request = request({
			status: "joined",
			kind: "space_join",
			availableDecisions: [],
		});
		render(<AgentAccessRequestCard requestId="aar_1" />);
		expect(screen.queryByRole("button")).toBeNull();
		expect(
			screen.getByText(agentAccessOutcomeCopy(state.request))
		).toBeTruthy();
	});
});

describe("Owner answer to a Space request", () => {
	const spaceJoin = (overrides: Partial<AgentAccessRequestView> = {}) =>
		request({
			kind: "space_join",
			availableDecisions: ["join", "ignore"],
			...overrides,
		});
	function inConversation(children: ReactNode) {
		return (
			<MessageScrollerProvider>
				<MessageScroller>
					<MessageScrollerViewport>
						<MessageScrollerContent>{children}</MessageScrollerContent>
					</MessageScrollerViewport>
				</MessageScroller>
			</MessageScrollerProvider>
		);
	}
	function spaceState(
		requests: AgentAccessRequestView[]
	): SpaceAgentAccessRequestsState {
		return {
			requests,
			busy: false,
			error: null,
			decide: vi.fn(async () => undefined),
			withdraw: vi.fn(),
			messageRequester: vi.fn(),
			messagePending: false,
		};
	}

	it("keeps every Core decision: one primary, the rest in the overflow", () => {
		expect(splitAgentAccessDecisions(["join", "ignore"])).toEqual({
			primary: "join",
			secondary: ["ignore"],
		});
		expect(splitAgentAccessDecisions([])).toEqual({
			primary: null,
			secondary: [],
		});
	});

	it("labels the Space decisions plainly in the Inbox too", () => {
		state.request = spaceJoin();
		render(<AgentAccessRequestCard requestId="aar_1" />);
		expect(
			screen.getAllByRole("button").map((button) => button.textContent)
		).toEqual(["Add to Space", "Don't add", "Message Tali"]);
	});

	it("opens the DM with the requester without answering the request", () => {
		state.request = spaceJoin();
		render(<AgentAccessRequestCard requestId="aar_1" />);
		fireEvent.click(screen.getByRole("button", { name: "Message Tali" }));
		expect(state.openDirectMessage).toHaveBeenCalledWith("tali-profile");
		expect(state.decide).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Add to Space" })).toBeTruthy();
	});

	it("only offers Message <requester> to the owner of a pending member request", () => {
		expect(canMessageAgentAccessRequester(spaceJoin())).toBe(true);
		expect(
			canMessageAgentAccessRequester(spaceJoin({ status: "joined" }))
		).toBe(false);
		expect(
			canMessageAgentAccessRequester(spaceJoin({ viewerRole: "requester" }))
		).toBe(false);
		expect(
			canMessageAgentAccessRequester(spaceJoin({ requesterKind: "external" }))
		).toBe(false);
		expect(canMessageAgentAccessRequester(request())).toBe(false);
	});

	it("shows the owner one line about the Agent, with one primary action", () => {
		const requestState = spaceState([spaceJoin()]);
		render(<SpaceAgentAccessBar state={requestState} />);
		expect(screen.getByText("Tali asked to add PR Reviewer here")).toBeTruthy();
		expect(screen.queryByText(JOIN_TO_POST)).toBeNull();
		expect(
			screen.getAllByRole("button").map((button) => button.textContent)
		).toEqual(["Tali asked to add PR Reviewer here", "Add to Space", ""]);
		expect(screen.getByRole("button", { name: "More choices" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Add to Space" }));
		expect(requestState.decide).toHaveBeenCalledWith(
			requestState.requests[0],
			"join"
		);
	});

	it("puts Message <requester> first in the overflow and leaves the request open", async () => {
		const requestState = spaceState([spaceJoin()]);
		render(<SpaceAgentAccessBar state={requestState} />);
		fireEvent.click(screen.getByRole("button", { name: "More choices" }));
		const items = await screen.findAllByRole("menuitem");
		expect(items.map((item) => item.textContent)).toEqual([
			"Message Tali",
			"Don't add",
		]);
		fireEvent.click(items[0] as HTMLElement);
		expect(requestState.messageRequester).toHaveBeenCalledWith(
			requestState.requests[0]
		);
		expect(requestState.decide).not.toHaveBeenCalled();
	});

	it("keeps the summary as plain text while older history hides the preview", () => {
		render(
			<SpaceAgentAccessBar
				previewsVisible={false}
				state={spaceState([spaceJoin()])}
			/>
		);
		expect(
			screen.queryByRole("button", {
				name: "Tali asked to add PR Reviewer here",
			})
		).toBeNull();
		expect(screen.getByText("Tali asked to add PR Reviewer here")).toBeTruthy();
	});

	it("lets the requester withdraw from the same bar", () => {
		const pending = spaceJoin({
			viewerRole: "requester",
			availableDecisions: [],
		});
		const requestState = spaceState([pending]);
		render(<SpaceAgentAccessBar state={requestState} />);
		expect(
			screen.getByText("Waiting for Felix to add PR Reviewer.")
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		expect(requestState.withdraw).toHaveBeenCalledWith(pending);
	});

	it("previews the requested Agent in the conversation for its owner only", () => {
		const requestState = spaceState([
			spaceJoin(),
			spaceJoin({
				id: "aar_2",
				viewerRole: "requester",
				availableDecisions: [],
			}),
		]);
		render(inConversation(<SpaceAgentAccessPreviews state={requestState} />));
		const previews = screen.getAllByRole("group");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.getAttribute("aria-label")).toBe(
			"Request to add PR Reviewer"
		);
		expect(screen.getByText("Not in this Space yet")).toBeTruthy();
		expect(
			screen.getByText(
				"Tali asked to add it to this Space. If you add it, it joins and answers their message."
			)
		).toBeTruthy();
		expect(screen.queryByText(JOIN_TO_POST)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Add to Space" }));
		expect(requestState.decide).toHaveBeenCalledWith(
			requestState.requests[0],
			"join"
		);
	});

	it("disables both places while an answer is in flight", () => {
		const requestState = { ...spaceState([spaceJoin()]), busy: true };
		render(
			<>
				{inConversation(<SpaceAgentAccessPreviews state={requestState} />)}
				<SpaceAgentAccessBar state={requestState} />
			</>
		);
		for (const button of screen.getAllByRole("button", {
			name: "Add to Space",
		})) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
		}
	});
});

describe("Requester copy", () => {
	it("says who the requester waits for, and what happened", () => {
		expect(requesterAgentAccessCopy(request({ viewerRole: "requester" }))).toBe(
			"Waiting for Felix to allow PR Reviewer."
		);
		expect(
			requesterAgentAccessCopy(
				request({ viewerRole: "requester", kind: "space_join" })
			)
		).toBe("Waiting for Felix to add PR Reviewer.");
		expect(
			requesterAgentAccessCopy(
				request({ viewerRole: "requester", status: "voided" })
			)
		).toMatch(EDITED_OR_DELETED);
		expect(
			requesterAgentAccessCopy(
				request({ viewerRole: "requester", status: "allowed" })
			)
		).toBeNull();
	});

	it("labels the requester's Space list row with the request state", () => {
		const join = request({ kind: "space_join", viewerRole: "requester" });
		expect(resolveAgentRequestSpaceLabel(join)).toBe(
			"Requested Felix · PR Reviewer"
		);
		expect(resolveAgentRequestSpaceLabel({ ...join, status: "joined" })).toBe(
			"PR Reviewer joined"
		);
		expect(resolveAgentRequestSpaceLabel({ ...join, status: "ignored" })).toBe(
			"Felix didn't add PR Reviewer"
		);
	});
});

describe("Add members with MemberAgents", () => {
	const felixHuman = {
		profileId: "felix-human",
		profileKind: "human" as const,
		profileName: "Felix",
		searchText: "felix",
		ownerUserId: "felix",
	};
	const felixAgent = {
		profileId: "agt_1",
		profileKind: "agent" as const,
		profileName: "PR Reviewer",
		searchText: "pr reviewer",
		ownerUserId: "felix",
		ownerHumanProfileId: "felix-human",
	};
	const groups = {
		personGroups: [
			{
				agentCandidates: [felixAgent],
				humanAlreadyMember: false,
				humanCandidate: felixHuman,
				id: "felix",
				lastActiveAt: null,
				name: "Felix",
				searchText: "felix",
			},
		],
	} as unknown as Parameters<
		typeof resolveEffectiveAddMemberProfileIds
	>[0]["candidateGroups"];

	it("asks for another member's Agent without adding its owner", () => {
		expect(isAgentRequestCandidate(felixAgent, "tali")).toBe(true);
		expect([
			...resolveEffectiveAddMemberProfileIds({
				agentRequestsFor: "tali",
				candidateGroups: groups,
				selectedProfileIds: new Set(["agt_1"]),
			}),
		]).toEqual(["agt_1"]);
	});

	it("keeps the owner's own Agent selection with the owner", () => {
		expect(isAgentRequestCandidate(felixAgent, "felix")).toBe(false);
		expect(
			[
				...resolveEffectiveAddMemberProfileIds({
					agentRequestsFor: "felix",
					candidateGroups: groups,
					selectedProfileIds: new Set(["agt_1"]),
				}),
			].sort()
		).toEqual(["agt_1", "felix-human"]);
	});
});

describe("A held Wake never shows as work", () => {
	const wake = (overrides: Partial<WakeProgressItem>) =>
		({
			sourceSignalId: "signal-1",
			targetProfileId: "agt_1",
			phase: "request_sent",
			...overrides,
		}) as WakeProgressItem;

	it("drops progress for the requester's waiting or refused Wakes only", () => {
		const keys = collectHeldAgentAccessWakeKeys([
			request({ viewerRole: "requester" }),
			request({
				id: "aar_2",
				sourceSignalId: "signal-2",
				status: "declined",
				viewerRole: "requester",
			}),
			request({
				id: "aar_3",
				sourceSignalId: "signal-3",
				status: "allowed",
				viewerRole: "requester",
			}),
			request({ id: "aar_4", sourceSignalId: "signal-4" }),
		]);
		const items = [
			wake({}),
			wake({ sourceSignalId: "signal-2" }),
			wake({ sourceSignalId: "signal-3" }),
			wake({ sourceSignalId: "signal-4" }),
			wake({ targetProfileId: "agt_2" }),
		];
		expect(
			withoutHeldAgentAccessWakeProgress(items, keys).map(
				(item) => `${item.sourceSignalId}:${item.targetProfileId}`
			)
		).toEqual(["signal-3:agt_1", "signal-4:agt_1", "signal-1:agt_2"]);
	});

	it("keeps the same list when nothing is held", () => {
		const items = [wake({})];
		expect(
			withoutHeldAgentAccessWakeProgress(
				items,
				collectHeldAgentAccessWakeKeys([])
			)
		).toBe(items);
	});
});

describe("Mentioning a colleague's Agent outside the Space", () => {
	const profile = (
		overrides: Partial<
			Parameters<
				typeof buildSpaceAgentRequestMentionItems
			>[0]["agentProfiles"][number]
		>
	) => ({
		agentControllerRef: null,
		avatarUrl: null,
		createdAt: "2026-10-19T00:00:00.000Z",
		isCenterAgent: false,
		lastUsedAt: null,
		ownerName: "Felix",
		ownerUserId: "felix",
		profileHandle: null,
		profileId: "agt_codex",
		profileName: "Codex",
		status: "active" as "active" | "disabled",
		...overrides,
	});
	const snapshot = createSpaceMembersSnapshot({
		humans: [
			createSpaceMemberHumanSnapshot({
				profileId: "tali-profile",
				profileName: "Tali",
			}),
		],
		agents: [
			createSpaceMemberAgentSnapshot({
				profileId: "agt_member",
				profileName: "Reviewer",
			}),
			// The current user's own Codex is a member under the same name.
			createSpaceMemberAgentSnapshot({
				profileId: "agt_tali_codex",
				profileName: "Codex",
			}),
		],
	});

	it("offers only other owners' active Agents not in the Space, by owner", () => {
		const items = buildSpaceAgentRequestMentionItems({
			agentProfiles: [
				profile({}),
				profile({ profileId: "agt_mine", ownerUserId: "tali" }),
				profile({ profileId: "agt_member", profileName: "Reviewer" }),
				profile({ profileId: "agt_same_name", profileName: "Tali" }),
				profile({ profileId: "agt_tali_codex", ownerUserId: "tali" }),
				profile({ profileId: "agt_center", isCenterAgent: true }),
				profile({ profileId: "agt_disabled", status: "disabled" }),
				profile({
					profileId: "agt_ana",
					profileName: "Cursor",
					ownerName: "Ana",
					ownerUserId: "ana",
				}),
			] as never,
			currentUserId: "tali",
			snapshot,
		});
		expect(
			groupSpaceAgentRequestMentionItems(items).map((group) => [
				group.ownerName,
				group.items.map((item) => item.profileId),
			])
		).toEqual([
			["Ana", ["agt_ana"]],
			["Felix", ["agt_codex", "agt_same_name"]],
		]);
	});

	it("dedupes by profile id only, never by name or Harness", () => {
		const items = buildSpaceAgentRequestMentionItems({
			agentProfiles: [
				// Same name and Harness as the member Codex, different profile.
				profile({ agentControllerRef: "builtin:codex" }),
				profile({
					profileId: "agt_member",
					profileName: "Reviewer",
					agentControllerRef: "builtin:codex",
				}),
			] as never,
			currentUserId: "tali",
			snapshot,
		});
		expect(items.map((item) => [item.profileId, item.mentionName])).toEqual([
			["agt_codex", "Felix's Codex"],
		]);
		// The owner-qualified mention never resolves as the member's "@Codex".
		expect(
			resolveAgentRequestMentionProfileIds({
				selections: [{ profileId: "agt_codex", profileName: "Felix's Codex" }],
				text: "@Codex please check, and @Felix's Codex too",
			})
		).toEqual(["agt_codex"]);
		expect(
			resolveAgentRequestMentionProfileIds({
				selections: [{ profileId: "agt_codex", profileName: "Felix's Codex" }],
				text: "@Codex please check",
			})
		).toEqual([]);
	});

	it("carries each Agent's shared Wake availability", () => {
		const unavailable = {
			action: "none",
			badgeLabel: "Unavailable",
			category: "unavailable",
			isRefreshing: false,
			label: "Unavailable for Wake",
			phase: "unavailable",
			reasonCode: null,
			status: "unavailable_for_wake",
			summary: "This Agent is unavailable for Wake.",
			tooltip: "Unavailable for Wake",
		} as const;
		const [item] = buildSpaceAgentRequestMentionItems({
			agentProfiles: [profile({})] as never,
			availabilityByProfileId: new Map([["agt_codex", unavailable as never]]),
			currentUserId: "tali",
			snapshot,
		});
		expect(item?.availability?.badgeLabel).toBe("Unavailable");
	});

	it("never counts a longer name as a shorter chosen one", () => {
		const selections = [
			{ profileId: "agt_alice", profileName: "Reviewer" },
			{ profileId: "agt_bob", profileName: "Reviewer Pro" },
		];
		expect(
			resolveAgentRequestMentionProfileIds({
				selections,
				text: "@Reviewer Pro please look",
			})
		).toEqual(["agt_bob"]);
		expect(
			resolveAgentRequestMentionProfileIds({
				selections,
				text: "@Reviewer and @Reviewer Pro",
			})
		).toEqual(["agt_bob", "agt_alice"]);
		expect(
			resolveAgentRequestMentionProfileIds({
				selections,
				text: "@Reviewers are busy",
			})
		).toEqual([]);
	});

	it("keeps one choice per name, the latest", () => {
		expect(
			addAgentRequestMentionSelection(
				[{ profileId: "agt_alice", profileName: "Reviewer" }],
				{ profileId: "agt_bob", profileName: "Reviewer" }
			)
		).toEqual([{ profileId: "agt_bob", profileName: "Reviewer" }]);
	});

	it("asks only for chosen Agents whose mention is still in the message", () => {
		expect(
			resolveAgentRequestMentionProfileIds({
				selections: [
					{ profileId: "agt_codex", profileName: "Felix's Codex" },
					{ profileId: "agt_ana", profileName: "Ana's Cursor" },
				],
				text: "@Felix's Codex can you review this?",
			})
		).toEqual(["agt_codex"]);
	});
});
