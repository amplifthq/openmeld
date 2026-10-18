import type { AgentAccessRequestView } from "@openmeld/schemas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isAgentRequestCandidate,
	resolveEffectiveAddMemberProfileIds,
} from "#/components/spaces/people-agent-picker-model";
import {
	AgentAccessRequestCard,
	agentAccessOutcomeCopy,
} from "./agent-access-request-card";
import { resolveAgentRequestSpaceLabel } from "./agent-access-space-labels";
import { requesterAgentAccessCopy } from "./space-agent-access-banner";

const ALWAYS_ALLOW = /Always allow/u;
const ASKED_EVERY_TIME = /asked every time/u;
const EDITED_OR_DELETED = /edited or deleted/u;

const state = vi.hoisted(() => ({
	request: null as AgentAccessRequestView | null,
	decide: vi.fn(),
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
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: { id: "org-1", slug: "acme" },
	}),
}));

afterEach(() => {
	cleanup();
	state.request = null;
	state.decide.mockReset();
});

function request(
	overrides: Partial<AgentAccessRequestView> = {}
): AgentAccessRequestView {
	return {
		id: "aar_1",
		kind: "direct_message",
		status: "pending",
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

describe("Requester copy", () => {
	it("says who the requester waits for, and what happened", () => {
		expect(requesterAgentAccessCopy(request({ viewerRole: "requester" }))).toBe(
			"Waiting for Felix to allow PR Reviewer."
		);
		expect(
			requesterAgentAccessCopy(
				request({ viewerRole: "requester", kind: "space_join" })
			)
		).toBe("Requested Felix. PR Reviewer joins once they agree.");
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
