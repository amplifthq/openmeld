import type {
	AuthProfileView,
	CurrentDeviceTargetResponse,
	PeopleComputer,
	PeopleComputersResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearCompletedPrepareSessionPointer,
	writeCompletedPrepareSessionPointer,
} from "#/components/connect/prepare-session-pointer";
import { startQueryKeys } from "#/query/query-keys";
import { agentCreationComputerFixture } from "#/test-support/agent-creation-computer-fixtures";
import {
	shouldLoadTeamOnboardingState,
	useCompleteOnboardingState,
} from "./complete-onboarding-state";

const api = vi.hoisted(() => ({
	inventory: vi.fn(),
	preference: vi.fn(),
	profiles: vi.fn(),
	duplicatePreference: vi.fn(),
}));
const scope = vi.hoisted(() => ({
	currentUserId: "owner-a",
	storageScope: "owner-a",
}));
vi.mock("@openmeld/api-client", async (original) => ({
	...(await original<typeof import("@openmeld/api-client")>()),
	createCurrentDeviceApi: () => ({
		listPeopleComputers: api.inventory,
		getCurrentTarget: api.duplicatePreference,
	}),
}));
vi.mock("#/lib/connect/current-device-target", () => ({
	resolveCurrentDeviceTarget: api.preference,
}));
vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: api.profiles,
}));
vi.mock("#/lib/openmeld-api/client", () => ({
	createUnscopedWebOpenMeldApiFoundation: () => ({}),
}));
vi.mock("#/lib/dev/computer-state-fixtures", () => ({
	withComputerStateFixtures: (data: PeopleComputersResponse) => data,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		...scope,
		currentOrganization: {
			id: "personal-workspace",
			name: "Personal Workspace",
			isPersonal: true,
		},
	}),
}));
// These independent sections deliberately remain pending; they must not gate the Computer summary.
vi.mock("#/lib/organizations/connector-connections", () => ({
	listCurrentOrganizationAppConnections: () => new Promise(() => undefined),
}));
vi.mock("#/lib/organizations/center-agent-memory", () => ({
	readCurrentOrganizationCenterAgentMemoryPolicy: () =>
		new Promise(() => undefined),
}));

const selectedTarget = { deviceId: "office-mac", runtimeLane: "prod" } as const;
const preference: CurrentDeviceTargetResponse = {
	availability: "resolved",
	...selectedTarget,
};
const human: AuthProfileView = {
	openMeldProfileId: "human-a",
	profileName: "Owner",
	profileHandle: "owner",
	profileKind: "human",
	ownerUserId: "owner-a",
	isDefault: true,
	status: "active",
	source: "account",
	managedRole: null,
	createdByUserId: "owner-a",
	creatorProfileId: null,
	lastUsedAt: null,
	createdAt: "2026-09-18T00:00:00.000Z",
	updatedAt: "2026-09-18T00:00:00.000Z",
};
function computer(id: string, name: string, agentName: string): PeopleComputer {
	const target: PeopleComputer["executionTargets"][number] = {
		deviceId: id,
		runtimeLane: "prod",
		userFacingCommand: "openmeld",
		openMeldServiceRuntimeId: null,
		status: "ready",
		capabilities: [],
		localAgentControl: { refreshCatalog: false, setEnabled: false },
		reasonCodes: [],
		lastObservedAtMs: 1,
		localAgentCatalog: {
			totalBuiltins: 1,
			detectedSupported: 1,
			needsChoice: 0,
			needsRepair: 0,
			detectedNotSupportedYet: 0,
			notDetected: 0,
			entries: [
				{
					agentId: "codex",
					displayName: agentName,
					targetKind: "builtin",
					detected: true,
					enabled: true,
					launchStatus: "ready",
					selectable: true,
					selectableReason: null,
					lifecycleStatus: "active",
				},
			],
		},
	};
	return {
		...agentCreationComputerFixture(name, id),
		executionTargets: [target],
		connection: {
			status: "connected",
			reasonCodes: [],
			sessions: [
				{
					deviceId: id,
					runtimeLane: "prod",
					lastHeartbeatMs: 1,
					serviceVersion: null,
					serviceUpdate: { wakeBlocked: false, reasonCodes: [] },
					executionCompatibility: {
						status: "compatible",
						expectedEpoch: "test",
						observedEpoch: "test",
						reasonCode: "daemon.runtime_contract.compatible",
					},
				},
			],
		},
	};
}
function inventory(): PeopleComputersResponse {
	return {
		generatedAt: "2026-09-18T00:00:00.000Z",
		computers: [
			computer("other-mac", "Other Mac", "Other Agent"),
			computer("office-mac", "Office Mac", "Codex"),
		],
	};
}
function completedSetup(humanProfileId = "human-a", deviceId = "office-mac") {
	writeCompletedPrepareSessionPointer({
		humanProfileId,
		deviceId,
		runtimeLane: "prod",
		prepareSessionId: "completed-setup",
		opaqueToken: null,
		opaqueTokenExpiresAt: null,
		targetSpaceId: null,
	});
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
const clients: QueryClient[] = [];
function renderCompletion(enabled = true) {
	const client = new QueryClient({
		defaultOptions: { queries: { retryDelay: 0 } },
	});
	clients.push(client);
	const hook = renderHook(() => useCompleteOnboardingState({ enabled }), {
		wrapper: ({ children }: { children: ReactNode }) =>
			createElement(QueryClientProvider, { client }, children),
	});
	return { ...hook, client };
}
beforeEach(() => {
	vi.resetAllMocks();
	scope.currentUserId = "owner-a";
	scope.storageScope = "owner-a";
	clearCompletedPrepareSessionPointer();
	api.inventory.mockResolvedValue(inventory());
	api.preference.mockResolvedValue(preference);
	api.profiles.mockResolvedValue([human]);
});
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) {
		client.clear();
	}
	clearCompletedPrepareSessionPointer();
});

describe("onboarding completion state", () => {
	it("keeps team-only queries disabled for Personal Workspace", () => {
		expect(
			shouldLoadTeamOnboardingState({
				enabled: true,
				isPersonal: true,
			})
		).toBe(false);
	});

	it("loads team-only state for an organization Ready screen", () => {
		expect(
			shouldLoadTeamOnboardingState({
				enabled: true,
				isPersonal: false,
			})
		).toBe(true);
	});

	it("reveals the selected Computer and agents from raw inventory when the independent preference arrives", async () => {
		const rawInventory = inventory();
		const selected = rawInventory.computers.find(
			(entry) => entry.deviceId === selectedTarget.deviceId
		);
		if (!selected) {
			throw new Error("Missing selected fixture");
		}
		selected.executionTargets.push(
			...selected.executionTargets.map((target) => ({
				...target,
				runtimeLane: "canary" as const,
				userFacingCommand: "openmeld-canary" as const,
				localAgentCatalog: {
					...target.localAgentCatalog,
					entries: target.localAgentCatalog.entries.map((entry) => ({
						...entry,
						displayName: "Canary-only Agent",
					})),
				},
			}))
		);
		api.inventory.mockResolvedValue(rawInventory);
		const read = deferred<CurrentDeviceTargetResponse>();
		api.preference.mockReturnValue(read.promise);
		const { result, client } = renderCompletion();
		await waitFor(() =>
			expect(
				client.getQueryState(startQueryKeys.localRuntimes("owner-a"))?.status
			).toBe("success")
		);
		expect(result.current.computerName).toBeNull();
		expect(result.current.localAgentNames).toEqual([]);
		await act(async () => read.resolve(preference));
		await waitFor(() => expect(result.current.computerName).toBe("Office Mac"));
		expect(result.current.localAgentNames).toEqual(["Codex"]);
		expect(api.inventory).toHaveBeenCalledTimes(1);
		expect(api.preference).toHaveBeenCalledTimes(1);
		expect(api.duplicatePreference).not.toHaveBeenCalled();
		expect(
			client.getQueryData(startQueryKeys.localRuntimes("owner-a"))
		).toMatchObject({ currentDeviceId: null });
	});

	it.each([
		"pending",
		"failed",
		"other-target",
	] as const)("uses this account's completed setup when routing is %s", async (routingState) => {
		completedSetup();
		if (routingState === "pending") {
			api.preference.mockReturnValue(new Promise(() => undefined));
		}
		if (routingState === "failed") {
			api.preference.mockRejectedValue(new Error("Preference unavailable"));
		}
		if (routingState === "other-target") {
			api.preference.mockResolvedValue({
				...preference,
				deviceId: "other-mac",
			});
		}
		const { result } = renderCompletion();
		await waitFor(() => expect(result.current.computerName).toBe("Office Mac"));
		expect(result.current.localAgentNames).toEqual(["Codex"]);
		expect(api.duplicatePreference).not.toHaveBeenCalled();
	});

	it("does not replace a failed preference with the only live session, and recovers on retry", async () => {
		api.inventory.mockResolvedValue({
			...inventory(),
			computers: [computer("office-mac", "Office Mac", "Codex")],
		});
		api.preference.mockRejectedValue(new Error("Preference unavailable"));
		const { result, client } = renderCompletion();
		await waitFor(() =>
			expect(
				client.getQueryState(startQueryKeys.currentDeviceTarget("owner-a"))
					?.status
			).toBe("error")
		);
		expect(result.current.computerName).toBeNull();
		expect(result.current.localAgentNames).toEqual([]);
		api.preference.mockResolvedValue(preference);
		await act(async () => {
			await client.invalidateQueries({
				queryKey: startQueryKeys.currentDeviceTarget("owner-a"),
			});
		});
		await waitFor(() => expect(result.current.computerName).toBe("Office Mac"));
	});

	it.each([
		"foreign-profile",
		"foreign-owner",
		"missing-computer",
		"profile-read-failed",
	] as const)("does not trust completed setup with %s", async (reason) => {
		completedSetup(
			reason === "foreign-profile" ? "human-other" : "human-a",
			reason === "missing-computer" ? "not-owned" : "office-mac"
		);
		api.preference.mockReturnValue(new Promise(() => undefined));
		if (reason === "foreign-owner") {
			api.profiles.mockResolvedValue([
				{ ...human, ownerUserId: "another-account" },
			]);
		}
		if (reason === "profile-read-failed") {
			api.profiles.mockRejectedValue(new Error("Profile unavailable"));
		}
		const { result, client } = renderCompletion();
		await waitFor(() =>
			expect(
				client.getQueryState(startQueryKeys.localRuntimes("owner-a"))?.status
			).toBe("success")
		);
		// Let the validation read settle; no hint may manufacture ownership.
		await waitFor(() =>
			expect(
				client.getQueryState(startQueryKeys.profilesForStorageScope("owner-a"))
					?.status
			).toBe(reason === "profile-read-failed" ? "error" : "success")
		);
		expect(result.current.computerName).toBeNull();
		expect(result.current.localAgentNames).toEqual([]);
	});

	it("does not read optional completion queries before the completion step", async () => {
		completedSetup();
		renderCompletion(false);
		await act(async () => undefined);
		expect(api.inventory).not.toHaveBeenCalled();
		expect(api.preference).not.toHaveBeenCalled();
		expect(api.profiles).not.toHaveBeenCalled();
	});
});
