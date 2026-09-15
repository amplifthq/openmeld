import { DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION } from "@openmeld/schemas";
import type {
	AgentProfileCreationRequest,
	ListAgentProfileCreationRequestsResponse,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	agentProfileCreationRequestQueryKeys,
	removeOptimisticAgentProfileCreation,
	upsertAcceptedAgentProfileCreationRequest,
	upsertOptimisticAgentProfileCreation,
} from "./agent-profile-creation-requests";

describe("accepted Agent creation request cache", () => {
	it("keeps client-only creation state separate from server request identities", () => {
		const queryClient = new QueryClient();
		const creation = {
			configuration: DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
			failureMessage: null,
			id: "optimistic:one-intent",
			profileName: "Reviewer",
			status: "creating" as const,
			targetOwnerUserId: "user-1",
		};
		upsertOptimisticAgentProfileCreation({
			creation,
			organizationId: "org-1",
			queryClient,
		});

		expect(
			queryClient.getQueryData(
				agentProfileCreationRequestQueryKeys.optimisticByOrganization("org-1")
			)
		).toEqual([creation]);
		expect(
			queryClient.getQueryData(
				agentProfileCreationRequestQueryKeys.byOrganization("org-1")
			)
		).toBeUndefined();

		removeOptimisticAgentProfileCreation({
			id: creation.id,
			organizationId: "org-1",
			queryClient,
		});
		expect(
			queryClient.getQueryData(
				agentProfileCreationRequestQueryKeys.optimisticByOrganization("org-1")
			)
		).toEqual([]);
	});

	it("inserts a new accepted request without inventing an Agent Profile", () => {
		const queryClient = new QueryClient();
		upsertAcceptedAgentProfileCreationRequest({
			organizationId: "org-1",
			queryClient,
			request: createRequest("request-1"),
		});

		expect(
			queryClient.getQueryData<ListAgentProfileCreationRequestsResponse>(
				agentProfileCreationRequestQueryKeys.byOrganization("org-1")
			)
		).toEqual({
			organizationId: "org-1",
			requests: [createRequest("request-1")],
		});
	});

	it("replaces the matching request and preserves the rest", () => {
		const queryClient = new QueryClient();
		const key = agentProfileCreationRequestQueryKeys.byOrganization("org-1");
		queryClient.setQueryData(key, {
			organizationId: "org-1",
			requests: [createRequest("request-1"), createRequest("request-2")],
		});
		const failed = {
			...createRequest("request-1"),
			failureMessage: "The local agent could not connect.",
			status: "failed" as const,
		};

		upsertAcceptedAgentProfileCreationRequest({
			organizationId: "org-1",
			queryClient,
			request: failed,
		});

		expect(
			queryClient
				.getQueryData<ListAgentProfileCreationRequestsResponse>(key)
				?.requests.map((request) => request.id)
		).toEqual(["request-1", "request-2"]);
		expect(
			queryClient.getQueryData<ListAgentProfileCreationRequestsResponse>(key)
				?.requests[0]
		).toEqual(failed);
	});
});

function createRequest(id: string): AgentProfileCreationRequest {
	return {
		actorProfileId: "human-1",
		completedAt: null,
		configuration: DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
		createdAgentProfileId: null,
		createdAt: "2026-09-15T00:00:00.000Z",
		decidedAt: "2026-09-15T00:00:00.000Z",
		failureMessage: null,
		id,
		nativeSessionId: null,
		organizationId: "org-1",
		profileName: "Reviewer",
		requestedSpaceId: null,
		requesterUserId: "user-1",
		sessionStrategy: "new",
		source: "web",
		status: "approved",
		statusReason: "self_request",
		targetOwnerUserId: "user-1",
		updatedAt: "2026-09-15T00:00:00.000Z",
	};
}
