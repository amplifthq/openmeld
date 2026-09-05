import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
	LocalRuntimesResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectDiscovery } from "./use-project-discovery";

const api = vi.hoisted(() => ({
	discoverCurrentComputerProjects: vi.fn(),
	readCurrentLocalRuntimeReplyReadiness: vi.fn(),
	readLocalRuntimes: vi.fn(),
}));

vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: () => ({ storageScope: "owner-1" }),
}));

vi.mock("#/lib/connect/local-runtimes", () => ({
	readCurrentLocalRuntimeReplyReadiness:
		api.readCurrentLocalRuntimeReplyReadiness,
	readLocalRuntimes: api.readLocalRuntimes,
}));

vi.mock(
	"#/lib/organizations/local-project-control",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("#/lib/organizations/local-project-control")
		>()),
		discoverCurrentComputerProjects: api.discoverCurrentComputerProjects,
	})
);

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("useProjectDiscovery", () => {
	it("uses a live ServiceRuntime target when no Binding names the current computer", async () => {
		api.readLocalRuntimes.mockResolvedValue(localRuntimes());
		api.readCurrentLocalRuntimeReplyReadiness.mockRejectedValue(
			new Error("Wake readiness is unrelated to Project control")
		);
		api.discoverCurrentComputerProjects.mockResolvedValue({
			clientGeneration: 1,
			projects: [],
		});
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		const { result } = renderHook(
			() =>
				useProjectDiscovery({
					organizationId: "org-1",
					projects: [projectRef("project-1")],
				}),
			{ wrapper: createWrapper(queryClient) }
		);

		await waitFor(() =>
			expect(api.discoverCurrentComputerProjects).toHaveBeenCalledOnce()
		);
		expect(result.current.serviceState).toBe("connected");
		expect(result.current.computer?.deviceId).toBe("device-live");
		expect(result.current.target).toMatchObject({
			deviceId: "device-live",
			localProjectControl: {
				connectDeclaredPath: true,
				discoverProjects: true,
			},
			runtimeLane: "prod",
		});
	});

	it("reuses saved connections across screens", async () => {
		api.readLocalRuntimes.mockResolvedValue(localRuntimes({ bound: true }));
		api.discoverCurrentComputerProjects.mockImplementation(async (input) =>
			discoveryResponse(input.clientGeneration)
		);
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const first = renderHook(
			() =>
				useProjectDiscovery({
					includeCandidates: false,
					organizationId: "org-1",
					projects: [projectRef("project-1")],
				}),
			{ wrapper: createWrapper(queryClient) }
		);

		await waitFor(() =>
			expect(first.result.current.projectView("project-1").status).toBe("ready")
		);
		first.unmount();
		const second = renderHook(
			() =>
				useProjectDiscovery({
					includeCandidates: false,
					organizationId: "org-1",
					projects: [projectRef("project-1")],
				}),
			{ wrapper: createWrapper(queryClient) }
		);

		expect(second.result.current.projectView("project-1").status).toBe("ready");
		expect(api.discoverCurrentComputerProjects).toHaveBeenCalledTimes(1);
		const request = api.discoverCurrentComputerProjects.mock.calls[0]?.[0];
		expect(request.includeCandidates).toBe(false);
	});

	it("keeps the last result visible while Check again forces a new check", async () => {
		api.readLocalRuntimes.mockResolvedValue(localRuntimes({ bound: true }));
		const nextCheck = deferred<ReturnType<typeof discoveryResponse>>();
		api.discoverCurrentComputerProjects
			.mockImplementationOnce(async (input) =>
				discoveryResponse(input.clientGeneration)
			)
			.mockImplementationOnce(async () => await nextCheck.promise);
		const { result } = renderProjectDiscovery();

		await waitFor(() =>
			expect(result.current.projectView("project-1").status).toBe("ready")
		);
		act(() => result.current.refresh());

		await waitFor(() => expect(result.current.isRefreshing).toBe(true));
		expect(result.current.projectView("project-1").status).toBe("ready");
		expect(api.discoverCurrentComputerProjects).toHaveBeenCalledTimes(2);

		act(() => nextCheck.resolve(discoveryResponse(2)));
		await waitFor(() => expect(result.current.isRefreshing).toBe(false));
	});

	it("keeps the Service connected and exposes a retryable discovery failure", async () => {
		api.readLocalRuntimes.mockResolvedValue(localRuntimes({ bound: true }));
		api.discoverCurrentComputerProjects.mockRejectedValue({
			code: "gateway.upstream_error",
			message: "Project discovery failed in Core.",
			status: 500,
			upstreamCode: "internal_error",
		});
		const { result } = renderProjectDiscovery();

		await waitFor(() =>
			expect(result.current.projectView("project-1").status).toBe(
				"discovery_failed"
			)
		);
		expect(result.current.serviceState).toBe("connected");
		expect(result.current.projectView("project-1").errorMessage).toBe(
			"OpenMeld couldn’t check this Project on this computer. Check again or connect a folder manually."
		);

		api.readLocalRuntimes.mockResolvedValueOnce({
			...localRuntimes(),
			localRuntimes: [],
		});
		act(() => result.current.refresh());

		await waitFor(() =>
			expect(result.current.serviceState).toBe("service_unavailable")
		);
		expect(result.current.projectView("project-1").errorMessage).toBe(
			"This computer isn't connected to OpenMeld right now. Reconnect it, then try again."
		);
	});

	it("reports the computer unavailable when neither a Binding nor a live ServiceRuntime target exists", async () => {
		api.readLocalRuntimes.mockResolvedValue({
			...localRuntimes(),
			localRuntimes: [],
		});
		api.readCurrentLocalRuntimeReplyReadiness.mockResolvedValue(
			replyReadinessMissing()
		);
		const { result } = renderProjectDiscovery();

		await waitFor(() =>
			expect(result.current.serviceState).toBe("service_unavailable")
		);
		expect(api.discoverCurrentComputerProjects).not.toHaveBeenCalled();
	});

	it("shows a Service retry as an active refresh", async () => {
		const serviceRetry = deferred<LocalRuntimesResponse>();
		api.readLocalRuntimes
			.mockResolvedValueOnce({
				...localRuntimes(),
				localRuntimes: [],
			})
			.mockImplementationOnce(async () => await serviceRetry.promise);
		api.readCurrentLocalRuntimeReplyReadiness.mockResolvedValue(
			replyReadinessMissing()
		);
		const { result } = renderProjectDiscovery();

		await waitFor(() =>
			expect(result.current.serviceState).toBe("service_unavailable")
		);
		act(() => result.current.refresh());

		await waitFor(() => expect(result.current.isRefreshing).toBe(true));
		expect(api.readLocalRuntimes).toHaveBeenCalledTimes(2);
		act(() =>
			serviceRetry.resolve({
				...localRuntimes(),
				localRuntimes: [],
			})
		);
		await waitFor(() => expect(result.current.isRefreshing).toBe(false));
	});

	it("keeps using the Binding target when one exists", async () => {
		api.readLocalRuntimes.mockResolvedValue(localRuntimes({ bound: true }));
		api.readCurrentLocalRuntimeReplyReadiness.mockResolvedValue(
			replyReadinessFor("device-live", "prod")
		);
		api.discoverCurrentComputerProjects.mockResolvedValue({
			clientGeneration: 1,
			projects: [],
		});
		const { result } = renderProjectDiscovery();

		await waitFor(() =>
			expect(api.discoverCurrentComputerProjects).toHaveBeenCalledOnce()
		);
		expect(result.current.serviceState).toBe("connected");
		expect(result.current.target?.isCurrent).toBe(true);
	});

	it.each([
		"missing",
		"false",
	] as const)("requires a Service update when localProjectControl is %s", async (capabilityState) => {
		api.readLocalRuntimes.mockResolvedValue(localRuntimes({ capabilityState }));
		api.readCurrentLocalRuntimeReplyReadiness.mockResolvedValue(
			replyReadinessFor("device-live", "prod")
		);
		const { result } = renderProjectDiscovery();

		await waitFor(() =>
			expect(result.current.serviceState).toBe("update_required")
		);
		expect(api.discoverCurrentComputerProjects).not.toHaveBeenCalled();
	});
});

function renderProjectDiscovery() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return renderHook(
		() =>
			useProjectDiscovery({
				organizationId: "org-1",
				projects: [projectRef("project-1")],
			}),
		{ wrapper: createWrapper(queryClient) }
	);
}

function projectRef(id: string) {
	return { id, updatedAtMs: 1 };
}

function discoveryResponse(clientGeneration: number) {
	return {
		checkedAtMs: 1,
		clientGeneration,
		deviceId: "device-live",
		gitStatus: "available" as const,
		projects: [
			{
				candidates: [],
				connections: [],
				projectId: "project-1",
				status: "not_found" as const,
			},
		],
		requestId: `request-${String(clientGeneration)}`,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createWrapper(queryClient: QueryClient) {
	return function Wrapper(input: PropsWithChildren) {
		return (
			<QueryClientProvider client={queryClient}>
				{input.children}
			</QueryClientProvider>
		);
	};
}

function localRuntimes(input?: {
	bound?: boolean;
	capabilityState?: "false" | "missing";
}): LocalRuntimesResponse {
	const target: LocalRuntimeExecutionTarget = {
		capabilities: [],
		deviceId: "device-live",
		isCurrent: input?.bound === true,
		lastObservedAtMs: 1_720_000_000_000,
		localAgentCatalog: {
			detectedNotSupportedYet: 0,
			detectedSupported: 0,
			entries: [],
			needsChoice: 0,
			needsRepair: 0,
			notDetected: 0,
			totalBuiltins: 0,
		},
		localAgentControl: {
			refreshCatalog: true,
			setEnabled: true,
			setProfileWorkspace: true,
		},
		...(input?.capabilityState === "missing"
			? {}
			: {
					localProjectControl: {
						connectCandidate: true,
						connectDeclaredPath: input?.capabilityState !== "false",
						discoverProjects: true,
						moveConnection: true,
						removeConnection: true,
						removeMissingConnections: true,
						setDefaultConnection: true,
					},
				}),
		reasonCodes: [],
		runtimeLane: "prod",
		status: "ready",
		userFacingCommand: "openmeld",
		openMeldServiceRuntimeId: {
			source: "runtime_registry_authority",
			value: "runtime-live",
		},
	};
	const computer: LocalRuntimeComputer = {
		connectedComputerId: "computer-live",
		connectionStatus: "connected",
		deviceDisplayName: "Felix’s Mac",
		deviceDisplayNameSource: "observed",
		deviceId: "device-live",
		deviceType: "laptop",
		executionTargets: [target],
		firstSeenAtMs: 1_710_000_000_000,
		isCurrent: input?.bound === true,
		lastObservedAtMs: 1_720_000_000_000,
		legacyDeviceIds: ["device-live"],
		osVersion: "26.0",
		platformFamily: "macOS",
	};
	return {
		currentConnectedComputerId: input?.bound ? "computer-live" : null,
		currentDeviceId: input?.bound ? "device-live" : null,
		currentRuntimeLane: input?.bound ? "prod" : null,
		legacyDeviceEvidence: [],
		localRuntimes: [computer],
	};
}

function replyReadinessMissing(): CurrentLocalRuntimeReplyReadinessResponse {
	return {
		canReplyFromThisComputer: false,
		currentTarget: { availability: "missing" },
		service: { connected: false },
		status: "blocked",
	} as CurrentLocalRuntimeReplyReadinessResponse;
}

function replyReadinessFor(
	deviceId: string,
	runtimeLane: "prod"
): CurrentLocalRuntimeReplyReadinessResponse {
	return {
		canReplyFromThisComputer: true,
		currentTarget: {
			availability: "resolved",
			deviceId,
			runtimeLane,
		},
		service: {
			connected: true,
		},
		status: "ready",
	} as CurrentLocalRuntimeReplyReadinessResponse;
}
