import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkWebAgentProfileRuntimeReadiness,
	ensureWebAgentProfileRuntimeBinding as ensureWebAgentProfileRuntimeBindingWithoutDefaults,
	formatWebAgentProfileRuntimeBindingFailure,
	formatWebAgentProfileRuntimeBindingFailureActionLabel,
} from "./agent-profile-runtime-binding";

const ensurePrimaryBindingMock = vi.hoisted(() => vi.fn());
const getExecutionReadinessMock = vi.hoisted(() => vi.fn());
const getPrepareReadinessMock = vi.hoisted(() => vi.fn());
const notifyRouteCatalogChangedMock = vi.hoisted(() => vi.fn());
const createWebOpenMeldApiFoundationMock = vi.hoisted(() => vi.fn());
const createOrganizationScopedWebOpenMeldApiFoundationMock = vi.hoisted(() =>
	vi.fn()
);
const ORGANIZATION_ID = "organization-1";

function ensureWebAgentProfileRuntimeBinding(
	input: Omit<
		Parameters<typeof ensureWebAgentProfileRuntimeBindingWithoutDefaults>[0],
		"organizationId"
	> & { organizationId?: string }
) {
	return ensureWebAgentProfileRuntimeBindingWithoutDefaults({
		...input,
		organizationId: input.organizationId ?? ORGANIZATION_ID,
	});
}

vi.mock("@openmeld/api-client", async () => {
	const actual = await vi.importActual<typeof import("@openmeld/api-client")>(
		"@openmeld/api-client"
	);

	return {
		...actual,
		createAgentProfileBindingApi: () => ({
			ensurePrimaryBinding: ensurePrimaryBindingMock,
			getExecutionReadiness: getExecutionReadinessMock,
			notifyRouteCatalogChanged: notifyRouteCatalogChangedMock,
		}),
		createPrepareReadinessApi: () => ({
			getReadiness: getPrepareReadinessMock,
		}),
	};
});

vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation:
		createOrganizationScopedWebOpenMeldApiFoundationMock,
	createUnscopedWebOpenMeldApiFoundation: createWebOpenMeldApiFoundationMock,
}));

describe("ensureWebAgentProfileRuntimeBinding", () => {
	beforeEach(() => {
		createWebOpenMeldApiFoundationMock.mockReset().mockReturnValue({
			requestJson: vi.fn(),
		});
		createOrganizationScopedWebOpenMeldApiFoundationMock
			.mockReset()
			.mockReturnValue({ requestJson: vi.fn() });
		getExecutionReadinessMock
			.mockReset()
			.mockResolvedValue(readyExecutionReadiness());
		getPrepareReadinessMock.mockReset().mockResolvedValue(readyReadiness());
		notifyRouteCatalogChangedMock.mockReset().mockResolvedValue({
			notifiedSessions: 1,
			ok: true,
		});
		ensurePrimaryBindingMock.mockReset().mockResolvedValue({
			binding: {
				agentProfileId: "agt-codex",
				authoritySource: "binding_truth",
				bindingId: "binding-codex",
				bindingState: "enabled_primary",
				dispatchEligibility: {
					reasonCodes: ["agent_profile_binding.command_eligible"],
					routable: true,
					status: "routable",
				},
				grantsClaimSuccess: false,
				reasonCodes: ["agent_profile_binding.command_eligible"],
				resolutionSource: "binding_truth",
				routable: true,
				executionTarget: {
					agentControllerRef: "builtin:codex",
					openMeldServiceRuntimeId: {
						source: "runtime_registry_authority",
						value: "runtime-opaque-codex",
					},
				},
			},
			grantsClaimSuccess: false,
			outcome: "created",
			reasonCodes: ["agent_profile_binding.command_eligible"],
			routable: true,
			status: "accepted",
		});
	});

	it("ensures Binding with only authority Runtime evidence from Prepare readiness", async () => {
		const result = await ensureWebAgentProfileRuntimeBinding({
			actorProfileId: "human-1",
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "canary",
		});

		expect(result).toMatchObject({
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			lane: "canary",
			routable: true,
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority",
				value: "runtime-opaque-codex",
			},
			status: "accepted",
		});
		expect(notifyRouteCatalogChangedMock).not.toHaveBeenCalled();
		expect(getExecutionReadinessMock).not.toHaveBeenCalled();
		expect(createWebOpenMeldApiFoundationMock).toHaveBeenCalledWith({
			openMeldProfileId: "human-1",
		});
		expect(
			createOrganizationScopedWebOpenMeldApiFoundationMock
		).toHaveBeenCalledWith({
			openMeldProfileId: "human-1",
			organizationId: ORGANIZATION_ID,
		});
		expect(getPrepareReadinessMock).toHaveBeenCalledWith({
			agentControllerRefs: ["builtin:codex"],
			deviceId: "device-1",
			lane: "canary",
		});
		expect(ensurePrimaryBindingMock).toHaveBeenCalledWith({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			lane: "canary",
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority",
				value: "runtime-opaque-codex",
			},
		});
		const bindingRequest = ensurePrimaryBindingMock.mock.calls.at(0)?.[0];
		expect(bindingRequest).not.toHaveProperty("ownerAccountId");
		expect(bindingRequest).not.toHaveProperty("callerPrincipalId");
		expect(bindingRequest).not.toHaveProperty("creatorProfileId");
		expect(bindingRequest).not.toHaveProperty("spaceId");
	});

	it("passes selected model intent into the Binding request", async () => {
		await ensureWebAgentProfileRuntimeBinding({
			actorProfileId: "human-1",
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			modelId: "gpt-5.4-mini",
			reasoningLevel: "medium",
			runtimeLane: "canary",
		});

		expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileId: "agt-codex",
				modelId: "gpt-5.4-mini",
				reasoningLevel: "medium",
			})
		);
	});

	it("passes the provider-native Session ID into the authoritative Binding request", async () => {
		const sessionInventorySelection = {
			computerId: "computer-1",
			nativeSessionId: "native-codex-thread-1",
			organizationId: "organization-1",
			ownerUserId: "user-1",
			projectId: "project-1",
			provider: "codex" as const,
		};
		await ensureWebAgentProfileRuntimeBinding({
			actorProfileId: "human-1",
			agentControllerConversationId: "native-codex-thread-1",
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "canary",
			sessionInventorySelection,
		});

		expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentControllerConversationId: "native-codex-thread-1",
				agentProfileId: "agt-codex",
				sessionInventorySelection,
			})
		);
		expect(
			createOrganizationScopedWebOpenMeldApiFoundationMock
		).toHaveBeenCalledWith({
			openMeldProfileId: "human-1",
			organizationId: "organization-1",
		});
	});

	it("passes selected Agent Controller Permission Mode into the Binding request", async () => {
		await ensureWebAgentProfileRuntimeBinding({
			actorProfileId: "human-1",
			agentProfileId: "agt-codex",
			agentControllerPermissionMode: "codex:approveForMe",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "canary",
		});

		expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentControllerPermissionMode: "codex:approveForMe",
				agentProfileId: "agt-codex",
			})
		);
	});

	it("passes selected Codex Collaboration Mode into the Binding request", async () => {
		await ensureWebAgentProfileRuntimeBinding({
			actorProfileId: "human-1",
			agentProfileId: "agt-codex",
			agentControllerCollaborationMode: "codex:plan",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "canary",
		});

		expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentControllerCollaborationMode: "codex:plan",
				agentProfileId: "agt-codex",
			})
		);
	});

	it("passes OpenCode permission intent into the Binding request", async () => {
		const openCodePermission = {
			bash: {
				"*": "deny",
				"git status *": "allow",
			},
			edit: "ask",
		} as const;
		getPrepareReadinessMock.mockResolvedValueOnce(
			readyReadinessForAgentController("builtin:opencode")
		);

		await ensureWebAgentProfileRuntimeBinding({
			actorProfileId: "human-1",
			agentProfileId: "agt-opencode",
			agentControllerRef: "builtin:opencode",
			deviceId: "device-1",
			openCodePermission,
			runtimeLane: "canary",
		});

		expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileId: "agt-opencode",
				openCodePermission,
			})
		);
	});

	it("passes explicit reconnect mode when reconnecting an Agent Profile", async () => {
		ensurePrimaryBindingMock.mockResolvedValueOnce({
			binding: {
				agentProfileId: "agt-codex",
				authoritySource: "binding_truth",
				bindingId: "binding-codex",
				bindingState: "enabled_primary",
				dispatchEligibility: {
					reasonCodes: ["agent_profile_binding.command_eligible"],
					routable: true,
					status: "routable",
				},
				grantsClaimSuccess: false,
				reasonCodes: ["agent_profile_binding.command_eligible"],
				resolutionSource: "binding_truth",
				routable: true,
				executionTarget: {
					agentControllerRef: "builtin:codex",
					openMeldServiceRuntimeId: {
						source: "runtime_registry_authority",
						value: "runtime-opaque-codex",
					},
				},
			},
			grantsClaimSuccess: false,
			outcome: "reconnected",
			reasonCodes: ["agent_profile_binding.command_eligible"],
			routable: true,
			status: "accepted",
		});

		await expect(
			ensureWebAgentProfileRuntimeBinding({
				agentProfileId: "agt-codex",
				agentControllerRef: "builtin:codex",
				deviceId: "device-1",
				runtimeLane: "canary",
				writeMode: "reconnect",
			})
		).resolves.toMatchObject({
			outcome: "reconnected",
			status: "accepted",
		});

		expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileId: "agt-codex",
				writeMode: "reconnect",
			})
		);
	});

	it("does not create Binding when Prepare readiness has no authority openMeldServiceRuntimeId", async () => {
		getPrepareReadinessMock.mockResolvedValueOnce({
			...readyReadiness(),
			openMeldServiceRuntimeId: undefined,
			status: "not_ready",
		});

		const result = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		expect(result).toMatchObject({
			reason: "runtime_readiness_unavailable",
			routable: false,
			status: "unavailable",
		});
		expect(ensurePrimaryBindingMock).not.toHaveBeenCalled();
	});

	it("does not create Binding when authority Runtime evidence has a stale agent controller report", async () => {
		const result = await checkWebAgentProfileRuntimeReadiness({
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});
		expect(result.status).toBe("accepted");

		getPrepareReadinessMock.mockResolvedValueOnce({
			...readyReadiness(),
			nonRunnableCapabilities: [
				{
					agentControllerRef: "builtin:codex",
					expiresAtMs: 1_713_131_200_000,
					observedAtMs: 1_713_130_600_000,
					reasonCodes: [
						"runtime.agent_controller_report_stale",
						"runtime.agent_controller_report.ready",
					],
					status: "stale",
				},
			],
			runnableCapabilities: [],
			status: "not_ready",
			summary: {
				displayState: "stale",
				ready: false,
				reasonCodes: [
					"runtime.agent_controller_report_stale",
					"runtime.agent_controller_report.ready",
				],
			},
		});

		const staleResult = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		if (staleResult.status === "accepted") {
			throw new Error("expected stale readiness failure");
		}
		expect(staleResult).toMatchObject({
			agentControllerRef: "builtin:codex",
			reason: "runtime_readiness_unavailable",
			reasonCodes: [
				"agent_profile_binding.runtime_readiness_unavailable",
				"runtime.agent_controller_report_stale",
				"runtime.agent_controller_report.ready",
			],
			routable: false,
			status: "unavailable",
		});
		expect(formatWebAgentProfileRuntimeBindingFailure(staleResult)).toBe(
			"Connect local agent after OpenMeld refreshes this computer's local agent list."
		);
		expect(
			formatWebAgentProfileRuntimeBindingFailureActionLabel(staleResult)
		).toBe("Connect local agent");
		expect(ensurePrimaryBindingMock).not.toHaveBeenCalled();
	});

	it("does not create Binding from stale capability evidence that was already unavailable", async () => {
		getPrepareReadinessMock.mockResolvedValueOnce({
			...readyReadiness(),
			nonRunnableCapabilities: [
				{
					agentControllerRef: "builtin:codex",
					expiresAtMs: 1_713_131_200_000,
					observedAtMs: 1_713_130_600_000,
					reasonCodes: [
						"runtime.agent_controller_report_stale",
						"runtime.agent_controller_report_unavailable",
					],
					status: "stale",
				},
			],
			runnableCapabilities: [],
			status: "not_ready",
			summary: {
				displayState: "stale",
				ready: false,
				reasonCodes: [
					"runtime.agent_controller_report_stale",
					"runtime.agent_controller_report_unavailable",
				],
			},
		});

		const result = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		expect(result).toMatchObject({
			agentControllerRef: "builtin:codex",
			reason: "runtime_readiness_unavailable",
			routable: false,
			status: "unavailable",
		});
		expect(ensurePrimaryBindingMock).not.toHaveBeenCalled();
	});

	it("does not create Binding from a non-authority openMeldServiceRuntimeId source", async () => {
		getPrepareReadinessMock.mockResolvedValueOnce({
			...readyReadiness(),
			openMeldServiceRuntimeId: {
				source: "runtime_lookup_input",
				value: "owner_account:owner-1:device-1:dev-local",
			},
		});

		const result = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		expect(result).toMatchObject({
			reason: "runtime_readiness_unavailable",
			routable: false,
			status: "unavailable",
		});
		expect(ensurePrimaryBindingMock).not.toHaveBeenCalled();
	});

	it("does not create Binding when the selected agentControllerRef is invalid", async () => {
		const result = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:bad agent id",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		expect(result).toMatchObject({
			reason: "runtime_readiness_unavailable",
			routable: false,
			status: "unavailable",
		});
		expect(getPrepareReadinessMock).not.toHaveBeenCalled();
		expect(ensurePrimaryBindingMock).not.toHaveBeenCalled();
	});

	it("accepts Binding after a restarted service reports the local agent ready", async () => {
		vi.useFakeTimers();
		ensurePrimaryBindingMock
			.mockResolvedValueOnce({
				grantsClaimSuccess: false,
				reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
				routable: false,
				status: "rejected",
			})
			.mockResolvedValueOnce({
				grantsClaimSuccess: false,
				reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
				routable: false,
				status: "rejected",
			});

		const resultPromise = ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});
		await vi.advanceTimersByTimeAsync(3000);
		const result = await resultPromise;
		vi.useRealTimers();

		expect(result).toMatchObject({
			agentControllerRef: "builtin:codex",
			routable: true,
			status: "accepted",
		});
		expect(ensurePrimaryBindingMock).toHaveBeenCalledTimes(3);
	});

	it("retries a stale local agent report while the service refreshes it", async () => {
		vi.useFakeTimers();
		ensurePrimaryBindingMock.mockResolvedValueOnce({
			grantsClaimSuccess: false,
			reasonCodes: ["agent_profile_binding.agent_controller_report_stale"],
			routable: false,
			status: "rejected",
		});

		const resultPromise = ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});
		await vi.advanceTimersByTimeAsync(1500);
		const result = await resultPromise;
		vi.useRealTimers();

		expect(result).toMatchObject({
			routable: true,
			status: "accepted",
		});
		expect(ensurePrimaryBindingMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry a permanent Binding owner mismatch", async () => {
		ensurePrimaryBindingMock.mockResolvedValue({
			grantsClaimSuccess: false,
			reasonCodes: ["agent_profile_binding.owner_mismatch"],
			routable: false,
			status: "rejected",
		});

		const result = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		expect(result).toEqual({
			agentControllerRef: "builtin:codex",
			reason: "binding_rejected",
			reasonCodes: ["agent_profile_binding.owner_mismatch"],
			routable: false,
			status: "rejected",
		});
		expect(ensurePrimaryBindingMock).toHaveBeenCalledTimes(1);
	});

	it("explains when the authoritative Session is no longer resumable", () => {
		expect(
			formatWebAgentProfileRuntimeBindingFailure({
				agentControllerRef: "builtin:codex",
				reason: "binding_rejected",
				reasonCodes: ["agent_profile_binding.session_resume_unavailable"],
				routable: false,
				status: "rejected",
			})
		).toBe(
			"This Session changed or is no longer available to resume. Refresh Agent Activity and choose it again."
		);
	});

	it("explains that an Agent's Profile cannot change harness", () => {
		expect(
			formatWebAgentProfileRuntimeBindingFailure({
				agentControllerRef: "builtin:codex",
				reason: "binding_rejected",
				reasonCodes: ["agent_profile_binding.member_agent_harness_locked"],
				routable: false,
				status: "rejected",
			})
		).toBe(
			"This Agent Profile belongs to an Agent and can't move to another harness. Create a Profile under that harness's Agent instead."
		);
	});

	it("explains the missing local agent report after bounded retries are exhausted", async () => {
		vi.useFakeTimers();
		ensurePrimaryBindingMock.mockResolvedValue({
			grantsClaimSuccess: false,
			reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
			routable: false,
			status: "rejected",
		});

		const resultPromise = ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});
		await vi.advanceTimersByTimeAsync(6000);
		const result = await resultPromise;
		vi.useRealTimers();

		expect(result).toEqual({
			agentControllerRef: "builtin:codex",
			reason: "binding_rejected",
			reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
			routable: false,
			status: "rejected",
		});
		expect(ensurePrimaryBindingMock).toHaveBeenCalledTimes(5);
		if (result.status === "accepted") {
			throw new Error("expected missing report failure");
		}
		expect(formatWebAgentProfileRuntimeBindingFailure(result)).toBe(
			"This computer hasn't reported that this local agent is ready yet. Reconnect the computer, then try again."
		);
	});

	it("keeps an accepted Binding saved when local readiness confirmation has not propagated yet", async () => {
		notifyRouteCatalogChangedMock.mockResolvedValueOnce({
			notifiedSessions: 0,
			ok: true,
		});

		const result = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		expect(result).toMatchObject({
			agentControllerRef: "builtin:codex",
			outcome: "created",
			routable: true,
			status: "accepted",
		});
		expect(notifyRouteCatalogChangedMock).not.toHaveBeenCalled();
		expect(getExecutionReadinessMock).not.toHaveBeenCalled();
	});

	it("relies on the Core binding write to notify local routes", async () => {
		const result = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		expect(result).toMatchObject({
			agentControllerRef: "builtin:codex",
			outcome: "created",
			routable: true,
			status: "accepted",
		});
		expect(notifyRouteCatalogChangedMock).not.toHaveBeenCalled();
		expect(getExecutionReadinessMock).not.toHaveBeenCalled();
	});

	it("keeps Binding save success separate from later workspace readiness", async () => {
		getExecutionReadinessMock.mockResolvedValue(
			workspaceMissingExecutionReadiness()
		);

		const result = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		expect(result).toMatchObject({
			agentControllerRef: "builtin:codex",
			outcome: "created",
			routable: true,
			status: "accepted",
		});
		expect(getExecutionReadinessMock).not.toHaveBeenCalled();
	});

	it.each([
		"service.update_required",
		"daemon.runtime_contract.mismatch",
	])("uses Computer update copy for %s failures", async (reasonCode) => {
		ensurePrimaryBindingMock.mockResolvedValueOnce({
			grantsClaimSuccess: false,
			reasonCodes: [reasonCode],
			routable: false,
			status: "rejected",
		});

		const result = await ensureWebAgentProfileRuntimeBinding({
			agentProfileId: "agt-codex",
			agentControllerRef: "builtin:codex",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		});

		if (result.status === "accepted") {
			throw new Error("expected service update failure");
		}
		expect(formatWebAgentProfileRuntimeBindingFailure(result)).toBe(
			"Update OpenMeld on your computer before connecting that local agent."
		);
		expect(formatWebAgentProfileRuntimeBindingFailureActionLabel(result)).toBe(
			"Update OpenMeld on Computer"
		);
	});
});

function readyReadiness() {
	return readyReadinessForAgentController("builtin:codex");
}

function readyReadinessForAgentController(agentControllerRef: string) {
	return {
		agentControllerReportsRead: true,
		nonRunnableCapabilities: [],
		projection: {
			allRunnableCapabilitiesPrepared: {
				status: "prepared",
			},
			projectionStatus: "ready",
			reasonCodes: [],
			serviceReadiness: {
				status: "running",
			},
		},
		runnableCapabilities: [
			{
				agentControllerRef,
				expiresAtMs: 1_713_131_800_000,
				observedAtMs: 1_713_131_200_000,
				reasonCodes: [],
				status: "ready",
			},
		],
		openMeldServiceRuntimeId: {
			source: "runtime_registry_authority",
			value: "runtime-opaque-codex",
		},
		status: "ready",
		summary: {
			displayState: "ready",
			ready: true,
			reasonCodes: [],
		},
	};
}

function readyExecutionReadiness() {
	return {
		agentExecutionReadiness: {
			displayState: "ready",
			facts: {
				binding: {
					reasonCodes: ["agent_profile_binding.command_eligible"],
					routable: true,
					source: "binding_truth",
				},
				claim: {
					executionBlocked: false,
					grantsClaimSuccess: false,
					reasonCodes: ["claim.eligible"],
					source: "claim_diagnostics",
				},
				providerAccount: {
					blocked: false,
					expiresAtMs: null,
					observedAtMs: null,
					provider: null,
					reasonCodes: [],
					source: "not_checked",
				},
				localService: {
					reachable: true,
					reasonCodes: ["runtime_transport.session_reachable"],
					refreshable: false,
					source: "runtime_transport",
				},
				profile: {
					active: true,
					reasonCodes: ["agent_profile.active"],
					source: "profile_identity",
				},
				route: {
					deviceId: "device-1",
					lane: "dev-local",
					observedAt: "2026-05-14T00:00:00.000Z",
					online: true,
					reasonCodes: ["daemon_route.online"],
					source: "daemon_route",
				},
				runtime: {
					ready: true,
					reasonCodes: ["runtime.ready"],
					source: "prepare_readiness",
				},
				service: {
					executionCompatible: true,
					expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
					observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
					reasonCodes: ["service.execution_compatible"],
					source: "runtime_transport",
				},
			},
			primaryAction: "none",
			reasonCodes: ["agent_execution.ready"],
		},
		agentProfileId: "agt-codex",
		agentControllerRef: "builtin:codex",
		daemonRouteObservation: {
			observedAt: "2026-05-14T00:00:00.000Z",
			reasonCode: "online",
			status: "online",
		},
		generatedAt: "2026-05-14T00:00:00.000Z",
		ownerUserId: "user-1",
		primaryActionPlan: {
			action: "none",
			target: null,
		},
		profileName: "felix-codex",
		routeDeviceId: "device-1",
		routeLane: "dev-local",
		runtimeDeviceDisplayName: "Felix's MacBook Pro",
	};
}

function workspaceMissingExecutionReadiness() {
	const readiness = readyExecutionReadiness();
	return {
		...readiness,
		agentExecutionReadiness: {
			...readiness.agentExecutionReadiness,
			displayState: "blocked",
			facts: {
				...readiness.agentExecutionReadiness.facts,
				route: {
					deviceId: "device-1",
					lane: "dev-local",
					observedAt: "2026-05-14T00:00:00.000Z",
					reasonCodes: ["daemon.profile.offline"],
					source: "daemon_route",
					status: "offline",
				},
				runtime: {
					ready: false,
					reasonCodes: ["workspace.missing"],
					source: "prepare_readiness",
				},
			},
			primaryAction: "run_prepare",
			reasonCodes: ["workspace.missing"],
		},
		daemonRouteObservation: {
			observedAt: "2026-05-14T00:00:00.000Z",
			reasonCode: "daemon.profile.offline",
			status: "offline",
		},
		routeDeviceId: null,
		routeLane: null,
	};
}
