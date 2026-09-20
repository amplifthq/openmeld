import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type { GetAgentExecutionReadinessResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	canManuallyRefreshAgentProfileConnection,
	formatAgentProfileExecutionComputerDetail,
	formatAgentWakeAvailabilityCheckedAt,
	resolveAgentProfileAutoRefreshDelayMs,
	resolveAgentProfileAvailabilityFilterState,
	resolveAgentProfileRepairActions,
	resolveAgentProfileRowWakeAvailability,
	resolveAgentProfileSetupAction,
	resolveAutoRefreshingAgentProfileIds,
	resolveDisplayedAgentWakeAvailability,
	sortAgentProfilesForDisplay,
	summarizeAgentProfileAvailabilityFilters,
	summarizeAgentProfileReadiness,
} from "./agents-page-agent-profile-helpers";

const AGENT_PROFILE_ID = "agt_40404040-4040-4040-8040-404040404040";

describe("Agent Profile availability presentation", () => {
	it("backs off automatic readiness refreshes to the 30s cap", () => {
		expect(resolveAgentProfileAutoRefreshDelayMs(1)).toBe(2000);
		expect(resolveAgentProfileAutoRefreshDelayMs(2)).toBe(4000);
		expect(resolveAgentProfileAutoRefreshDelayMs(3)).toBe(8000);
		expect(resolveAgentProfileAutoRefreshDelayMs(4)).toBe(16_000);
		expect(resolveAgentProfileAutoRefreshDelayMs(5)).toBe(30_000);
		expect(resolveAgentProfileAutoRefreshDelayMs(6)).toBe(30_000);
	});

	it("keeps expired Wake routes visually Offline while automatic refresh can still recover", () => {
		const readiness = createExpiredWakeRouteReadiness();

		expect(
			resolveDisplayedAgentWakeAvailability({
				readiness,
			})
		).toMatchObject({
			badgeLabel: "Offline",
			category: "offline",
			isRefreshing: false,
			phase: "offline",
			status: "offline_for_wake",
		});
		expect(
			summarizeAgentProfileReadiness({
				profiles: [createExpiredWakeRouteProfile()],
				readinessByProfileId: new Map([[AGENT_PROFILE_ID, readiness]]),
			})
		).toEqual({
			available: 0,
			checking: 0,
			offline: 1,
			unavailable: 0,
		});
		expect(
			canManuallyRefreshAgentProfileConnection({
				autoRefreshExhausted: false,
				currentLocalRuntimeCanReply: true,
				readiness,
			})
		).toBe(false);
	});

	it("exposes manual Check again after automatic refresh is exhausted", () => {
		const readiness = createExpiredWakeRouteReadiness();

		expect(
			resolveAgentProfileRowWakeAvailability({
				readiness,
			})
		).toMatchObject({
			badgeLabel: "Offline",
			category: "offline",
			isRefreshing: false,
			phase: "offline",
			status: "offline_for_wake",
		});
		expect(
			resolveAgentProfileRowWakeAvailability({
				readiness,
			})
		).toMatchObject({
			badgeLabel: "Offline",
			category: "offline",
			phase: "offline",
			status: "offline_for_wake",
		});
		expect(
			resolveDisplayedAgentWakeAvailability({
				readiness,
			})
		).toMatchObject({
			badgeLabel: "Offline",
			category: "offline",
			phase: "offline",
			status: "offline_for_wake",
		});
		expect(
			canManuallyRefreshAgentProfileConnection({
				autoRefreshExhausted: true,
				currentLocalRuntimeCanReply: true,
				readiness,
			})
		).toBe(true);
	});

	it("keeps Core Unavailable while refreshing a stale local agent report", () => {
		const readiness = createRefreshingLocalAgentReadiness();

		expect(
			resolveAgentProfileRowWakeAvailability({
				readiness,
			})
		).toMatchObject({
			badgeLabel: "Unavailable",
			category: "unavailable",
			isRefreshing: false,
			summary: "OpenCode is not ready on Felix's MacBook Pro.",
			tooltip: "OpenCode connection needs attention",
		});
		expect(
			resolveAgentProfileSetupAction({
				autoRefreshExhausted: false,
				currentLocalRuntimeCanReply: true,
				localAgentDisplayName: "OpenCode",
				readiness,
				serviceUpdatePath: "/update",
				setupPath: "/connect",
			})
		).toBeNull();
	});

	it("offers Check again without changing Core Unavailable after refresh times out", () => {
		const readiness = createRefreshingLocalAgentReadiness();

		expect(
			resolveAgentProfileRowWakeAvailability({
				readiness,
			})
		).toMatchObject({
			badgeLabel: "Unavailable",
			category: "unavailable",
			isRefreshing: false,
			summary: "OpenCode is not ready on Felix's MacBook Pro.",
			tooltip: "OpenCode connection needs attention",
		});
		expect(
			canManuallyRefreshAgentProfileConnection({
				autoRefreshExhausted: true,
				currentLocalRuntimeCanReply: true,
				readiness,
			})
		).toBe(true);
		expect(
			resolveAgentProfileSetupAction({
				autoRefreshExhausted: true,
				currentLocalRuntimeCanReply: true,
				localAgentDisplayName: "OpenCode",
				readiness,
				serviceUpdatePath: "/update",
				setupPath: "/connect",
			})
		).toBeNull();
	});

	it("does not rederive the Core verdict from a missing binding", () => {
		const readiness = createUnboundAgentReadiness();

		expect(
			resolveAgentProfileRowWakeAvailability({
				readiness,
			})
		).toBe(readiness.agentWakeAvailability);
	});

	it("uses the shared product priority for confirmed local agent connection choices", () => {
		const actions = resolveAgentProfileRepairActions({
			isCurrentComputer: true,
			localAgentCatalogEntries: [
				createLocalAgentCatalogEntry("claude-code", "Claude Code"),
				createLocalAgentCatalogEntry("custom-acp", "Custom ACP", "custom"),
				createLocalAgentCatalogEntry("codex", "Codex CLI"),
				createLocalAgentCatalogEntry("cursor", "Cursor CLI"),
				createLocalAgentCatalogEntry("grok-build", "Grok Build"),
				createLocalAgentCatalogEntry("opencode", "OpenCode"),
			],
			readiness: {
				...createUnboundAgentReadiness(),
				primaryActionPlan: {
					action: "reconnect_binding",
					target: { kind: "choose_local_agent" },
				},
			},
		});

		expect(actions.map((action) => action.agentControllerRef)).toEqual([
			"builtin:codex",
			"builtin:claude-code",
			"builtin:grok-build",
			"builtin:opencode",
			"builtin:cursor",
			"custom:custom-acp",
		]);
	});

	it("does not infer a missing connection before readiness is known", () => {
		expect(
			resolveAgentProfileRepairActions({
				isCurrentComputer: true,
				localAgentCatalogEntries: [
					createLocalAgentCatalogEntry("codex", "Codex CLI"),
				],
				readiness: null,
			})
		).toEqual([]);
	});

	it("does not offer to move an existing Agent through connection recovery", () => {
		expect(
			resolveAgentProfileRepairActions({
				isCurrentComputer: true,
				localAgentCatalogEntries: [
					createLocalAgentCatalogEntry("codex", "Codex"),
				],
				readiness: createReconnectBindingReadiness("agt-old", "builtin:codex"),
			})
		).toEqual([]);
	});

	it("uses the Core verdict and a concrete local-agent action when Prepare is required", () => {
		const readiness = createLocalAgentSetupReadiness();

		expect(
			resolveAgentProfileRowWakeAvailability({
				readiness,
			})
		).toBe(readiness.agentWakeAvailability);
		expect(
			resolveAgentProfileSetupAction({
				autoRefreshExhausted: false,
				currentLocalRuntimeCanReply: true,
				localAgentDisplayName: "OpenCode",
				readiness,
				serviceUpdatePath: "/update",
				setupPath: "/connect",
			})
		).toEqual({
			href: "/connect",
			label: "Connect local agent",
		});
	});

	it("uses the exact action verbs from the canonical Core action plan", () => {
		const baseReadiness = createExpiredWakeRouteReadiness();
		const reconnectReadiness = {
			...baseReadiness,
			primaryActionPlan: {
				action: "connect_service",
				target: { kind: "openmeld_service_connection" },
			},
		} as GetAgentExecutionReadinessResponse;
		const connectReadiness = {
			...reconnectReadiness,
			agentExecutionReadiness: {
				...reconnectReadiness.agentExecutionReadiness,
				facts: {
					...reconnectReadiness.agentExecutionReadiness.facts,
					localService: {
						...reconnectReadiness.agentExecutionReadiness.facts.localService,
						reasonCodes: ["service.not_installed"],
					},
				},
			},
		};
		const updateReadiness = {
			...reconnectReadiness,
			primaryActionPlan: {
				action: "update_service",
				target: { kind: "openmeld_service" },
			},
		} as GetAgentExecutionReadinessResponse;
		const resolveAction = (readiness: GetAgentExecutionReadinessResponse) =>
			resolveAgentProfileSetupAction({
				autoRefreshExhausted: false,
				currentLocalRuntimeCanReply: null,
				readiness,
				serviceUpdatePath: "/update",
				setupPath: "/connect",
			});

		expect(resolveAction(connectReadiness)?.label).toBe("Connect computer");
		expect(resolveAction(reconnectReadiness)?.label).toBe("Reconnect computer");
		expect(resolveAction(updateReadiness)?.label).toBe("Update");
	});

	it("formats the cached Core snapshot age without inventing freshness", () => {
		expect(
			formatAgentWakeAvailabilityCheckedAt(
				"2026-09-04T08:00:00.000Z",
				Date.parse("2026-09-04T08:03:20.000Z")
			)
		).toBe("checked 3 minutes ago");
		expect(formatAgentWakeAvailabilityCheckedAt("not-a-date", 0)).toBeNull();
		expect(formatAgentWakeAvailabilityCheckedAt(null, 0)).toBeNull();
	});

	it("describes a healthy binding as where the profile runs", () => {
		expect(
			formatAgentProfileExecutionComputerDetail("Felix's MacBook Pro")
		).toBe("Runs on Felix's MacBook Pro");
		expect(
			formatAgentProfileExecutionComputerDetail("Connected computer")
		).toBe("Runs on a connected computer");
	});

	it("does not count unloaded readiness as Checking for profile filters", () => {
		const offlineReadiness = createExpiredWakeRouteReadiness();
		const missingProfile = createExpiredWakeRouteProfile("agt-missing");
		const pendingProfile = createExpiredWakeRouteProfile("agt-pending");
		const erroredProfile = createExpiredWakeRouteProfile("agt-errored");
		const offlineProfile = createExpiredWakeRouteProfile();

		const profiles = [
			missingProfile,
			pendingProfile,
			erroredProfile,
			offlineProfile,
		];
		const readinessByProfileId = new Map([
			[AGENT_PROFILE_ID, offlineReadiness],
		]);
		const pendingProfileIds = new Set([pendingProfile.openMeldProfileId]);
		const errorByProfileId = new Map([
			[erroredProfile.openMeldProfileId, "Status unavailable"],
		]);

		expect(
			summarizeAgentProfileAvailabilityFilters({
				errorByProfileId,
				pendingProfileIds,
				profiles,
				readinessByProfileId,
			})
		).toEqual({
			all: 4,
			available: 0,
			checking: 0,
			offline: 1,
			unavailable: 0,
		});
		expect(
			resolveAgentProfileAvailabilityFilterState({
				errorByProfileId,
				pendingProfileIds,
				profileId: missingProfile.openMeldProfileId,
				readinessByProfileId,
			})
		).toBeNull();
		expect(
			resolveAgentProfileAvailabilityFilterState({
				errorByProfileId,
				pendingProfileIds,
				profileId: pendingProfile.openMeldProfileId,
				readinessByProfileId,
			})
		).toBeNull();
		expect(
			resolveAgentProfileAvailabilityFilterState({
				errorByProfileId,
				pendingProfileIds,
				profileId: erroredProfile.openMeldProfileId,
				readinessByProfileId,
			})
		).toBeNull();
		expect(
			resolveAgentProfileAvailabilityFilterState({
				errorByProfileId,
				pendingProfileIds,
				profileId: offlineProfile.openMeldProfileId,
				readinessByProfileId,
			})
		).toBe("offline");
	});

	it("keeps Core Offline while allowing expired Wake routes to refresh when aggregate reply readiness is blocked", () => {
		const readiness = createExpiredWakeRouteReadiness();

		expect(
			resolveDisplayedAgentWakeAvailability({
				readiness,
			})
		).toMatchObject({
			badgeLabel: "Offline",
			category: "offline",
			phase: "offline",
			status: "offline_for_wake",
		});
		expect(
			resolveAutoRefreshingAgentProfileIds({
				currentLocalRuntimeCanReply: false,
				profiles: [createExpiredWakeRouteProfile()],
				readinessByProfileId: new Map([[AGENT_PROFILE_ID, readiness]]),
			})
		).toEqual([AGENT_PROFILE_ID]);
		expect(
			canManuallyRefreshAgentProfileConnection({
				autoRefreshExhausted: true,
				currentLocalRuntimeCanReply: false,
				readiness,
			})
		).toBe(false);
	});

	it("sorts by creation when task activity is absent, regardless of binding or edits", () => {
		const oldestBoundProfile = createExpiredWakeRouteProfile(
			"agt-older-bound",
			"Older Bound Agent",
			{
				createdAt: "2026-06-01T00:00:00.000Z",
				updatedAt: "2026-06-02T00:00:00.000Z",
			}
		);
		const newestUnboundProfile = createExpiredWakeRouteProfile(
			"agt-newest-unbound",
			"Newest Unbound Agent",
			{
				createdAt: "2026-06-12T00:00:00.000Z",
				updatedAt: "2026-06-20T00:00:00.000Z",
			}
		);
		const olderUnboundProfile = createExpiredWakeRouteProfile(
			"agt-older-unbound",
			"Older Unbound Agent",
			{
				createdAt: "2026-06-10T00:00:00.000Z",
				updatedAt: "2026-06-15T00:00:00.000Z",
			}
		);
		const sameDateBProfile = createExpiredWakeRouteProfile(
			"agt-same-b",
			"Beta Agent",
			{
				createdAt: "2026-06-05T00:00:00.000Z",
				updatedAt: "2026-06-05T00:00:00.000Z",
			}
		);
		const sameDateAProfile = createExpiredWakeRouteProfile(
			"agt-same-a",
			"Alpha Agent",
			{
				createdAt: "2026-06-05T00:00:00.000Z",
				updatedAt: "2026-06-05T00:00:00.000Z",
			}
		);

		expect(
			sortAgentProfilesForDisplay({
				profiles: [
					sameDateBProfile,
					olderUnboundProfile,
					newestUnboundProfile,
					oldestBoundProfile,
					sameDateAProfile,
				],
				readinessByProfileId: new Map([
					[
						oldestBoundProfile.openMeldProfileId,
						createExpiredWakeRouteReadiness({
							agentProfileId: oldestBoundProfile.openMeldProfileId,
							bindingRoutable: true,
						}),
					],
					[
						newestUnboundProfile.openMeldProfileId,
						createExpiredWakeRouteReadiness({
							agentProfileId: newestUnboundProfile.openMeldProfileId,
							bindingRoutable: false,
						}),
					],
				]),
			}).map((profile) => profile.openMeldProfileId)
		).toEqual([
			newestUnboundProfile.openMeldProfileId,
			olderUnboundProfile.openMeldProfileId,
			sameDateAProfile.openMeldProfileId,
			sameDateBProfile.openMeldProfileId,
			oldestBoundProfile.openMeldProfileId,
		]);
	});
});

function createExpiredWakeRouteProfile(
	profileId = AGENT_PROFILE_ID,
	profileName = "Expired Route Agent",
	overrides: Partial<{
		createdAt: string;
		updatedAt: string;
	}> = {}
) {
	return {
		openMeldProfileId: profileId,
		createdAt: overrides.createdAt ?? "2026-06-18T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: null,
		isDefault: false,
		lastUsedAt: null,
		managedRole: null,
		ownerName: "Felix",
		ownerUserId: "user-1",
		profileHandle: "expired-route-agent",
		profileKind: "agent" as const,
		profileName,
		source: "test",
		status: "active" as const,
		updatedAt: overrides.updatedAt ?? "2026-06-18T00:00:00.000Z",
	};
}

function createLocalAgentCatalogEntry(
	agentId: string,
	displayName: string,
	targetKind: "builtin" | "custom" = "builtin"
) {
	return {
		agentId,
		detected: true,
		displayName,
		enabled: true,
		lifecycleStatus: "active" as const,
		launchStatus: "ready" as const,
		selectable: true,
		selectableReason: null,
		targetKind,
	};
}

function createReconnectBindingReadiness(
	agentProfileId: string,
	agentControllerRef: string
): GetAgentExecutionReadinessResponse {
	const readiness = createExpiredWakeRouteReadiness({ agentProfileId });
	return {
		...readiness,
		agentControllerRef,
		agentExecutionReadiness: {
			...readiness.agentExecutionReadiness,
			agentProfileId,
			primaryAction: "reconnect_binding",
			reasonCodes: ["local_service.identity_mismatch"],
		},
		agentProfileId,
		agentWakeAvailability: {
			...readiness.agentWakeAvailability,
			action: "reconnect_binding",
			reasonCode: "local_service.identity_mismatch",
		},
		primaryActionPlan: {
			action: "reconnect_binding",
			target: {
				agentControllerRef,
				kind: "local_agent_connection",
			},
		},
	};
}

function createExpiredWakeRouteReadiness(
	input: { agentProfileId?: string; bindingRoutable?: boolean } = {}
): GetAgentExecutionReadinessResponse {
	return {
		agentControllerRef: "builtin:codex",
		agentExecutionReadiness: {
			agentProfileId: input.agentProfileId ?? AGENT_PROFILE_ID,
			displayState: "not_ready",
			facts: {
				binding: {
					reasonCodes: ["agent_profile_binding.command_eligible"],
					routable: input.bindingRoutable ?? true,
					source: "binding_truth",
				},
				claim: {
					executionBlocked: false,
					grantsClaimSuccess: false,
					reasonCodes: ["claim.not_checked"],
					source: "not_checked",
				},
				localService: {
					reachable: true,
					refreshable: true,
					reasonCodes: ["service.ready"],
					source: "runtime_transport",
				},
				profile: {
					active: true,
					reasonCodes: ["profile.active"],
					source: "profile_identity",
				},
				providerAccount: {
					blocked: false,
					expiresAtMs: null,
					observedAtMs: null,
					provider: null,
					reasonCodes: [],
					source: "not_checked",
				},
				providerConversation: {
					agentControllerConversationId: null,
					errorCode: null,
					errorMessage: null,
					errorType: null,
					expiresAtMs: null,
					method: null,
					observedAtMs: null,
					provider: null,
					ready: true,
					reasonCodes: [],
					required: false,
					source: "not_required",
					status: "not_required",
				},
				readinessImpact: {
					blocked: false,
					expiresAtMs: null,
					impactKind: null,
					observedAtMs: null,
					reasonCodes: [],
					source: "not_checked",
				},
				route: {
					deviceId: "device-office",
					lane: "dev-local",
					observedAt: "2026-06-18T00:00:00.000Z",
					online: false,
					reasonCodes: ["route.not_registered"],
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
					reasonCodes: [],
					source: "runtime_transport",
				},
			},
			primaryAction: "check_status",
			reasonCodes: ["agent_execution.route_offline"],
		},
		agentProfileId: AGENT_PROFILE_ID,
		agentWakeAvailability: {
			action: "check_status",
			badgeLabel: "Offline",
			category: "offline",
			isRefreshing: false,
			label: "Offline for Wake",
			phase: "offline",
			reasonCode: "agent_execution.route_offline",
			status: "offline_for_wake",
			summary: "This agent's connection is offline.",
			tooltip: "Agent connection is offline",
		},
		agentWakeRouteRegistration: {
			daemonSessionId: "daemon-session-expired-route",
			deviceId: "device-office",
			lane: "dev-local",
			reasonCode: "wake_route.registration_expired",
			reportedAtMs: 1_768_000_000_000,
			serviceVersion: "0.7.70",
			status: "expired",
		},
		generatedAt: "2026-06-18T00:00:00.000Z",
		ownerUserId: "user-1",
		primaryBinding: null,
		primaryActionPlan: { action: "none", target: null },
		profileName: "Expired Route Agent",
		routeDeviceId: "device-office",
		routeLane: "dev-local",
		runtimeDeviceDisplayName: "Felix's MacBook Pro",
		wakeRouteEvidence: {
			observedAt: "2026-06-18T00:00:00.000Z",
			reasonCode: "route.not_registered",
			status: "offline",
		},
		wakeRouteStatus: { status: "offline" },
	};
}

function createRefreshingLocalAgentReadiness(): GetAgentExecutionReadinessResponse {
	const readiness = createExpiredWakeRouteReadiness();
	return {
		...readiness,
		agentControllerRef: "builtin:opencode",
		agentExecutionReadiness: {
			...readiness.agentExecutionReadiness,
			facts: {
				...readiness.agentExecutionReadiness.facts,
				route: {
					deviceId: "device-office",
					lane: "dev-local",
					observedAt: "2026-06-18T00:00:00.000Z",
					online: true,
					reasonCodes: ["route.registered"],
					source: "daemon_route",
				},
				runtime: {
					ready: false,
					reasonCodes: ["runtime.agent_controller_report_stale"],
					source: "prepare_readiness",
				},
			},
			primaryAction: "check_status",
			reasonCodes: ["runtime.agent_controller_report_stale"],
		},
		agentWakeAvailability: {
			action: "check_status",
			badgeLabel: "Unavailable",
			category: "unavailable",
			isRefreshing: false,
			label: "OpenCode connection needs attention",
			phase: "unavailable",
			reasonCode: "runtime.agent_controller_report_stale",
			status: "unavailable_for_wake",
			summary: "OpenCode is not ready on Felix's MacBook Pro.",
			tooltip: "OpenCode connection needs attention",
		},
		agentWakeRouteRegistration: {
			...readiness.agentWakeRouteRegistration,
			reasonCode: "wake_route.registration_registered",
			status: "registered",
		},
		primaryActionPlan: {
			action: "check_status",
			target: { kind: "status" },
		},
		runtimeDeviceDisplayName: "Felix's MacBook Pro",
		wakeRouteEvidence: {
			observedAt: "2026-06-18T00:00:00.000Z",
			reasonCode: "online",
			status: "online",
		},
		wakeRouteStatus: {
			connectionGeneration: 1,
			daemonSessionId: "daemon-session-expired-route",
			deviceId: "device-office",
			lane: "dev-local",
			lastHeartbeatMs: 1_768_000_000_000,
			leaseEpoch: 1,
			status: "ready",
		},
	};
}

function createUnboundAgentReadiness(): GetAgentExecutionReadinessResponse {
	const readiness = createRefreshingLocalAgentReadiness();
	return {
		...readiness,
		agentExecutionReadiness: {
			...readiness.agentExecutionReadiness,
			facts: {
				...readiness.agentExecutionReadiness.facts,
				binding: {
					reasonCodes: ["agent_profile_binding.missing"],
					routable: false,
					source: "missing",
				},
			},
			primaryAction: "reconnect_binding",
			reasonCodes: ["agent_profile_binding.missing"],
		},
		agentWakeAvailability: {
			...readiness.agentWakeAvailability,
			reasonCode: "agent_profile_binding.missing",
		},
		primaryActionPlan: {
			action: "reconnect_binding",
			target: {
				agentControllerRef: "builtin:opencode",
				kind: "local_agent_connection",
			},
		},
		runtimeDeviceDisplayName: null,
	};
}

function createLocalAgentSetupReadiness(): GetAgentExecutionReadinessResponse {
	const readiness = createRefreshingLocalAgentReadiness();
	return {
		...readiness,
		agentExecutionReadiness: {
			...readiness.agentExecutionReadiness,
			facts: {
				...readiness.agentExecutionReadiness.facts,
				runtime: {
					ready: false,
					reasonCodes: ["workspace.missing"],
					source: "prepare_readiness",
				},
			},
			primaryAction: "run_prepare",
			reasonCodes: ["workspace.missing"],
		},
		agentWakeAvailability: {
			...readiness.agentWakeAvailability,
			reasonCode: "workspace.missing",
		},
		primaryActionPlan: {
			action: "run_prepare",
			target: { kind: "current_computer" },
		},
	};
}
