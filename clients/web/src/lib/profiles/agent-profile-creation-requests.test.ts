import { DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION } from "@openmeld/schemas";
import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	agentProfileCreationRequestQueryKeys,
	createPresentedAgentProfileCreationRequest,
} from "#/query/profiles/agent-profile-creation-requests";

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

	it("publishes the accepted request before waiting for Agent setup to finish", async () => {
		const onAccepted = vi.fn();
		const onStarted = vi.fn();
		api.listAgentProfileCreationRequests.mockResolvedValue({
			organizationId: "org-1",
			requests: [accepted],
		});
		const result = createAgentProfileCreationRequest({
			...command,
			onAccepted,
			onStarted,
		});

		expect(onStarted).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "optimistic:one-intent",
				profileName: "Reviewer",
				status: "creating",
			})
		);
		await vi.waitFor(() =>
			expect(onAccepted).toHaveBeenCalledWith(accepted, "optimistic:one-intent")
		);
		expect(api.listAgentProfileCreationRequests).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();
		await result;
	});

	it("does not misreport an accepted request when its presentation callback fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const completed = {
			...accepted,
			status: "completed" as const,
			createdAgentProfileId: "same-agent",
			completedAt: "2026-09-09T00:00:03.000Z",
		};
		api.listAgentProfileCreationRequests.mockResolvedValue({
			organizationId: "org-1",
			requests: [completed],
		});
		const result = createAgentProfileCreationRequest({
			...command,
			onAccepted: () => {
				throw new Error("Navigation failed");
			},
		});

		await vi.runAllTimersAsync();
		expect((await result).request).toEqual(completed);
		expect(api.createAgentProfileCreationRequest).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("turns the optimistic creation into a failed state when Core rejects it", async () => {
		const onFailed = vi.fn();
		api.createAgentProfileCreationRequest.mockRejectedValueOnce(
			new Error("Computer disconnected")
		);

		await expect(
			createAgentProfileCreationRequest({ ...command, onFailed })
		).rejects.toBeTruthy();
		expect(onFailed).toHaveBeenCalledWith(
			expect.objectContaining({
				failureMessage: "Computer disconnected",
				id: "optimistic:one-intent",
				status: "failed",
			}),
			expect.objectContaining({ message: "Computer disconnected" })
		);
	});

	it("reuses the unacknowledged intent after the create page unmounts and removes its failed card on acceptance", async () => {
		const queryClient = new QueryClient();
		api.createAgentProfileCreationRequest.mockRejectedValueOnce(
			new Error("Response lost")
		);
		await expect(
			createPresentedAgentProfileCreationRequest({
				...command,
				queryClient,
				onStarted: vi.fn(),
			})
		).rejects.toBeTruthy();
		api.createAgentProfileCreationRequest.mockResolvedValueOnce({
			replayed: true,
			request: {
				...accepted,
				status: "completed",
				createdAgentProfileId: "same-agent",
			},
		});
		await createPresentedAgentProfileCreationRequest({
			...command,
			idempotencyKey: "new-form-key",
			queryClient,
			onStarted: vi.fn(),
		});
		expect(
			api.createAgentProfileCreationRequest.mock.calls.map(
				([body]) => body.idempotencyKey
			)
		).toEqual(["one-intent", "one-intent"]);
		expect(
			queryClient.getQueryData(
				agentProfileCreationRequestQueryKeys.optimisticByOrganization("org-1")
			)
		).toEqual([]);
		queryClient.clear();
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
