import { DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION } from "@openmeld/schemas";
import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCreationRequestCard } from "./agent-creation-request-card";

const CONTROLLER_AND_MODEL = /Codex.*gpt-5\.6-sol/u;
const AVAILABLE_FOR_WAKE = /Available for Wake/u;
const CHECKING_WAKE_AVAILABILITY = /Checking Wake availability/u;
const REQUEST_ACCEPTED = /Request accepted/u;

const request: AgentProfileCreationRequest = {
	actorProfileId: "actor",
	completedAt: null,
	configuration: {
		...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
		agentControllerRef: "builtin:codex",
		modelId: "gpt-5.6-sol",
	},
	createdAgentProfileId: null,
	createdAt: "2026-09-09T00:00:00.000Z",
	decidedAt: "2026-09-09T00:00:00.000Z",
	id: "creation-1",
	failureMessage: null,
	nativeSessionId: null,
	organizationId: "org-1",
	profileName: "Release Reviewer",
	requestedSpaceId: null,
	requesterUserId: "owner",
	sessionStrategy: "new",
	source: "web",
	status: "approved",
	statusReason: "self_request",
	targetOwnerUserId: "owner",
	updatedAt: "2026-09-09T00:00:00.000Z",
};

describe("AgentCreationRequestCard", () => {
	afterEach(cleanup);

	it("shows only locally known progress before the server accepts the request", () => {
		render(
			<AgentCreationRequestCard
				onModify={vi.fn()}
				onReview={vi.fn()}
				request={{
					configuration: request.configuration,
					failureMessage: null,
					id: "optimistic:one-intent",
					profileName: request.profileName,
					status: "creating",
					targetOwnerUserId: request.targetOwnerUserId,
				}}
			/>
		);

		expect(screen.getByText("Creating Agent")).toBeTruthy();
		expect(screen.queryByText(REQUEST_ACCEPTED)).toBeNull();
		expect(screen.queryByRole("button", { name: "View progress" })).toBeNull();
	});

	it("shows accepted identity and setup progress without claiming Wake availability", () => {
		render(
			<AgentCreationRequestCard
				onModify={vi.fn()}
				onReview={vi.fn()}
				request={request}
			/>
		);

		expect(screen.getByText("Release Reviewer")).toBeTruthy();
		expect(screen.getByText(CONTROLLER_AND_MODEL)).toBeTruthy();
		expect(screen.getByText("Creating Agent")).toBeTruthy();
		expect(screen.getByText(CHECKING_WAKE_AVAILABILITY)).toBeTruthy();
		expect(screen.queryByText(AVAILABLE_FOR_WAKE)).toBeNull();
	});

	it("keeps a failed request actionable instead of leaving a ghost Agent", () => {
		const onModify = vi.fn();
		const onReview = vi.fn();
		render(
			<AgentCreationRequestCard
				onModify={onModify}
				onReview={onReview}
				request={{
					...request,
					failureMessage: "The selected local agent is not connected.",
					status: "failed",
				}}
			/>
		);

		expect(screen.getByText("Needs attention")).toBeTruthy();
		expect(
			screen.getByText("The selected local agent is not connected.")
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Review and retry" }));
		fireEvent.click(screen.getByRole("button", { name: "Modify" }));
		expect(onReview).toHaveBeenCalledOnce();
		expect(onModify).toHaveBeenCalledOnce();
	});
});
