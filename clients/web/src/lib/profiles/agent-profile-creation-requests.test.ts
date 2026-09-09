import { DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION } from "@openmeld/schemas";
import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	createAgentProfileCreationRequest: vi.fn(),
	listAgentProfileCreationRequests: vi.fn(),
}));
vi.mock("@openmeld/api-client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@openmeld/api-client")>()),
	createOrganizationApi: () => api,
}));
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: () => ({}),
}));

import { createAgentProfileCreationRequest } from "./agent-profile-creation-requests";

const accepted: AgentProfileCreationRequest = {
	actorProfileId: "actor",
	completedAt: null,
	configuration: DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
	createdAgentProfileId: null,
	createdAt: "2026-09-09T00:00:00.000Z",
	decidedAt: "2026-09-09T00:00:00.000Z",
	id: "creation-1",
	failureMessage: null,
	nativeSessionId: null,
	organizationId: "org-1",
	profileName: "Reviewer",
	requestedSpaceId: null,
	requesterUserId: "owner",
	sessionStrategy: "new",
	source: "web",
	status: "approved",
	statusReason: "self_request",
	targetOwnerUserId: "owner",
	updatedAt: "2026-09-09T00:00:00.000Z",
};
const command = {
	configuration: accepted.configuration,
	idempotencyKey: "one-intent",
	organizationId: accepted.organizationId,
	profileName: accepted.profileName,
	targetOwnerUserId: accepted.targetOwnerUserId,
};

describe("accepted Agent creation in Web", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		api.createAgentProfileCreationRequest
			.mockReset()
			.mockResolvedValue({ replayed: false, request: accepted });
		api.listAgentProfileCreationRequests.mockReset();
	});
	afterEach(() => vi.useRealTimers());

	it("waits on the exact accepted request and returns its completed identity", async () => {
		const completed = {
			...accepted,
			status: "completed",
			createdAgentProfileId: "same-agent",
			completedAt: "2026-09-09T00:00:03.000Z",
		};
		api.listAgentProfileCreationRequests.mockResolvedValue({
			organizationId: "org-1",
			requests: [completed],
		});
		const result = createAgentProfileCreationRequest(command);
		await vi.runAllTimersAsync();
		expect((await result).request).toEqual(completed);
		expect(api.listAgentProfileCreationRequests).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				requestId: accepted.id,
			})
		);
		expect(api.createAgentProfileCreationRequest).toHaveBeenCalledOnce();
	});

	it("preserves acceptance when the status read fails, without submitting another creation", async () => {
		api.listAgentProfileCreationRequests.mockRejectedValue(
			new Error("Temporary connection loss")
		);
		const result = createAgentProfileCreationRequest(command);
		await vi.runAllTimersAsync();
		expect((await result).request).toEqual(accepted);
		expect(api.createAgentProfileCreationRequest).toHaveBeenCalledOnce();
	});

	it("hands a still-active request back to the request view after bounded waiting", async () => {
		api.listAgentProfileCreationRequests.mockResolvedValue({
			organizationId: "org-1",
			requests: [accepted],
		});
		const result = createAgentProfileCreationRequest(command);
		await vi.runAllTimersAsync();
		expect((await result).request).toEqual(accepted);
		expect(vi.getTimerCount()).toBe(0);
		expect(api.createAgentProfileCreationRequest).toHaveBeenCalledOnce();
	});
});
