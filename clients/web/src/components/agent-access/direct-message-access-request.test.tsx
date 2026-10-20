import type { AgentAccessRequestView } from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSpaceComposerPolicy } from "#/components/spaces/space-composer-copy";
import type { ColleagueAccessState } from "#/lib/agents/colleague-access-state";
import {
	type DirectMessageAccessRequest,
	DirectMessageRequestCardStatus,
	directMessageAccessBadge,
	directMessageAccessRequestCopy,
	resolveColleagueDirectMessageAgent,
	resolveDirectMessageRequestCardStatus,
} from "./direct-message-access-request";

const pendingRequest = {
	id: "req_1",
	sourceSignalId: "sig_1",
	status: "pending",
} as AgentAccessRequestView;

function accessRequest(
	state: DirectMessageAccessRequest["access"]["state"]
): DirectMessageAccessRequest {
	return {
		agentName: "Codex",
		ownerName: "Tali Smoke",
		access: { state, request: pendingRequest, ownerName: "Tali Smoke" },
	};
}

describe("Direct Message with a teammate's Agent that asks first", () => {
	afterEach(cleanup);

	it("frames the first message as the request", () => {
		expect(
			directMessageAccessRequestCopy({
				agentName: "Codex",
				ownerName: "Tali Smoke",
			})
		).toEqual({
			emptyStateTitle: "Ask Tali Smoke to use Codex",
			emptyStateDescription:
				"Tali sees your request first. Codex starts after Tali approves.",
			composerPlaceholder: "Tell Tali what you need Codex for…",
			waitingComposerHint: "Codex will reply after Tali approves",
		});
	});

	it("labels the header by state and keeps the visibility label before a request", () => {
		const badges = Object.fromEntries(
			(
				[
					"draft",
					"waiting",
					"approved_once",
					"always_allowed",
					"declined",
					"revoked",
				] as ColleagueAccessState[]
			).map((state) => [state, directMessageAccessBadge(state)])
		);
		expect(badges).toEqual({
			draft: null,
			waiting: "Waiting for approval",
			approved_once: "Approved once",
			always_allowed: "Always allowed",
			declined: "Declined",
			revoked: "Access removed",
		});
	});

	it("shows the wait and Withdraw on the request card, and the owner's decline", () => {
		expect(
			resolveDirectMessageRequestCardStatus(accessRequest("waiting"))
		).toEqual({ text: "Waiting for Tali Smoke", canWithdraw: true });
		expect(
			resolveDirectMessageRequestCardStatus(accessRequest("declined"))
		).toEqual({ text: "Tali declined", canWithdraw: false });
		expect(
			resolveDirectMessageRequestCardStatus(accessRequest("revoked"))
		).toEqual({ text: "Tali Smoke removed your access", canWithdraw: false });
		for (const state of ["draft", "approved_once", "always_allowed"] as const) {
			expect(resolveDirectMessageRequestCardStatus(accessRequest(state))).toBe(
				null
			);
		}
	});

	it("withdraws from the request card", () => {
		const onWithdraw = vi.fn();
		render(
			<DirectMessageRequestCardStatus
				busy={false}
				onWithdraw={onWithdraw}
				request={accessRequest("waiting")}
			/>
		);
		expect(screen.getByText("Waiting for Tali Smoke")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		expect(onWithdraw).toHaveBeenCalledOnce();
	});

	it("finds only an active Agent another member owns", () => {
		const agent = (
			profileId: string,
			ownerUserId: string | null,
			status = "active"
		) =>
			({
				profileId,
				profileName: "Codex",
				ownerUserId,
				status,
			}) as SpaceMembersSnapshot["agents"][number];
		const snapshot = (agents: SpaceMembersSnapshot["agents"]) =>
			({ humans: [], agents }) as unknown as SpaceMembersSnapshot;
		expect(
			resolveColleagueDirectMessageAgent({
				snapshot: snapshot([
					agent("agt_mine", "felix"),
					agent("agt_org", null),
					agent("agt_left", "tali", "removed"),
					agent("agt_codex", "tali"),
				]),
				viewerUserId: "felix",
			})?.profileId
		).toBe("agt_codex");
		expect(
			resolveColleagueDirectMessageAgent({
				snapshot: snapshot([agent("agt_mine", "felix")]),
				viewerUserId: "felix",
			})
		).toBeNull();
	});

	it("writes the request in the composer: placeholder and Send request", () => {
		const policy = resolveSpaceComposerPolicy({
			canSendMessage: true,
			conversationKind: "agent_conversation",
			placement: "conversation",
			requestPlaceholder: "Tell Tali what you need Codex for…",
			targetName: "Codex",
			text: "",
		});
		expect(policy.placeholder).toBe("Tell Tali what you need Codex for…");
		expect(policy.sendButtonLabel).toBe("Send request");
		const thread = resolveSpaceComposerPolicy({
			canSendMessage: true,
			conversationKind: "agent_conversation",
			placement: "thread",
			requestPlaceholder: "Tell Tali what you need Codex for…",
			text: "",
		});
		expect(thread.sendButtonLabel).toBe("Send reply");
	});
});
