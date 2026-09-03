import type { AuthProfileView } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	isOrdinaryActiveAgentProfile,
	resolveAgentExecutionReadinessState,
	resolveShouldLoadAgentExecutionReadiness,
	shouldRefreshLocalRuntimeAfterServiceReconnect,
} from "#/components/agents/use-local-agent-recovery-controller";

describe("resolveAgentExecutionReadinessState", () => {
	it("keeps cached rows stable while their shared batch refetches", () => {
		const cachedReadiness = {
			agentProfileId: "agent-one",
		} as unknown as import("@openmeld/schemas/types").GetAgentExecutionReadinessResponse;
		const state = resolveAgentExecutionReadinessState({
			agentProfiles: [
				{ openMeldProfileId: "agent-one" },
				{ openMeldProfileId: "agent-two" },
			],
			queryBatches: [
				{
					profileIds: ["agent-one", "agent-two"],
					query: {
						data: { items: [cachedReadiness] },
						error: null,
						fetchStatus: "fetching",
						isError: false,
						isPending: false,
					},
				},
			],
		});

		expect(state.pendingProfileIds.has("agent-one")).toBe(false);
		expect(state.pendingProfileIds.has("agent-two")).toBe(true);
		expect(state.byProfileId.get("agent-one")).toBe(cachedReadiness);
	});
});

function buildAgentProfile(
	overrides: Partial<AuthProfileView> = {}
): AuthProfileView {
	return {
		openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
		createdAt: "2026-07-07T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: null,
		isDefault: false,
		lastUsedAt: null,
		managedRole: null,
		ownerUserId: "user-1",
		profileHandle: "agent",
		profileKind: "agent",
		profileName: "Agent",
		source: "cli_create",
		status: "active",
		updatedAt: "2026-07-07T00:00:00.000Z",
		...overrides,
	};
}

describe("isOrdinaryActiveAgentProfile", () => {
	it("keeps Center Agent managed profiles out of ordinary Agent Profile lists", () => {
		expect(isOrdinaryActiveAgentProfile(buildAgentProfile())).toBe(true);
		expect(
			isOrdinaryActiveAgentProfile(
				buildAgentProfile({
					managedRole: "center_agent",
					profileName: "Center Agent",
				})
			)
		).toBe(false);
	});
});

describe("resolveShouldLoadAgentExecutionReadiness", () => {
	it("loads bound-runtime readiness even when the current computer cannot reply", () => {
		expect(
			resolveShouldLoadAgentExecutionReadiness({
				activeOrganizationId: "org-acme",
				currentLocalRuntimeCanReply: false,
				scope: "bound_runtime",
				shouldLoadAgentExecutionReadinessBase: true,
			})
		).toBe(true);
	});

	it("keeps current-local-runtime readiness gated by the current computer", () => {
		expect(
			resolveShouldLoadAgentExecutionReadiness({
				activeOrganizationId: "org-acme",
				currentLocalRuntimeCanReply: false,
				scope: "current_local_runtime",
				shouldLoadAgentExecutionReadinessBase: true,
			})
		).toBe(false);
		expect(
			resolveShouldLoadAgentExecutionReadiness({
				activeOrganizationId: "org-acme",
				currentLocalRuntimeCanReply: true,
				scope: "current_local_runtime",
				shouldLoadAgentExecutionReadinessBase: true,
			})
		).toBe(true);
	});

	it("keeps the default setup scope gated by the current computer", () => {
		expect(
			resolveShouldLoadAgentExecutionReadiness({
				activeOrganizationId: "org-acme",
				currentLocalRuntimeCanReply: undefined,
				scope: undefined,
				shouldLoadAgentExecutionReadinessBase: true,
			})
		).toBe(false);
		expect(
			resolveShouldLoadAgentExecutionReadiness({
				activeOrganizationId: "org-acme",
				currentLocalRuntimeCanReply: true,
				scope: undefined,
				shouldLoadAgentExecutionReadinessBase: true,
			})
		).toBe(true);
	});

	it("does not load readiness when the caller disabled readiness loading", () => {
		expect(
			resolveShouldLoadAgentExecutionReadiness({
				activeOrganizationId: "org-acme",
				currentLocalRuntimeCanReply: true,
				scope: "bound_runtime",
				shouldLoadAgentExecutionReadinessBase: false,
			})
		).toBe(false);
	});

	it("does not load final Agent Profile readiness without a canonical Organization", () => {
		expect(
			resolveShouldLoadAgentExecutionReadiness({
				activeOrganizationId: null,
				currentLocalRuntimeCanReply: true,
				scope: "bound_runtime",
				shouldLoadAgentExecutionReadinessBase: true,
			})
		).toBe(false);
	});
});

describe("shouldRefreshLocalRuntimeAfterServiceReconnect", () => {
	it("refreshes only when the current OpenMeld Service regains reply readiness", () => {
		expect(
			shouldRefreshLocalRuntimeAfterServiceReconnect({
				currentLocalRuntimeCanReply: true,
				previousLocalRuntimeCanReply: false,
			})
		).toBe(true);
		expect(
			shouldRefreshLocalRuntimeAfterServiceReconnect({
				currentLocalRuntimeCanReply: true,
				previousLocalRuntimeCanReply: null,
			})
		).toBe(false);
		expect(
			shouldRefreshLocalRuntimeAfterServiceReconnect({
				currentLocalRuntimeCanReply: true,
				previousLocalRuntimeCanReply: true,
			})
		).toBe(false);
		expect(
			shouldRefreshLocalRuntimeAfterServiceReconnect({
				currentLocalRuntimeCanReply: false,
				previousLocalRuntimeCanReply: true,
			})
		).toBe(false);
	});
});
