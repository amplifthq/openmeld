import type {
	CurrentDeviceTargetResponse,
	PeopleComputersResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectComputerInventory } from "#/lib/connect/local-runtimes";
import { agentCreationComputerFixture } from "#/test-support/agent-creation-computer-fixtures";
import { useLocalRuntimeQueries } from "./use-local-runtime-queries";

const api = vi.hoisted(() => ({
	inventory: vi.fn(),
	preference: vi.fn(),
	readiness: vi.fn(),
}));
vi.mock("#/lib/connect/local-runtimes", async (original) => ({
	...(await original<typeof import("#/lib/connect/local-runtimes")>()),
	readLocalRuntimes: api.inventory,
	readPeopleComputerReplyReadiness: api.readiness,
}));
vi.mock("#/lib/connect/current-device-target", () => ({
	resolveCurrentDeviceTarget: api.preference,
}));
vi.mock("#/components/connect/prepare-session-pointer", () => ({
	readCompletedPrepareSessionPointer: () => null,
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("progressive Computer queries", () => {
	it("does not lose readable Computers when preference lookup fails", async () => {
		const inventory: PeopleComputersResponse = {
			generatedAt: "2026-09-18T12:00:00.000Z",
			computers: [agentCreationComputerFixture()],
		};
		api.inventory.mockResolvedValue(projectComputerInventory(inventory));
		api.preference.mockRejectedValue({
			code: "gateway.upstream_error",
			status: 503,
			message: "Unavailable",
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retryDelay: 0 } },
		});
		const { result } = renderHook(
			() => useLocalRuntimeQueries({ storageScope: "owner-a" }),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				),
			}
		);
		await waitFor(() =>
			expect(result.current.currentDeviceTargetQuery.isError).toBe(true)
		);
		expect(result.current.localRuntimesQuery.isSuccess).toBe(true);
		expect(
			result.current.localRuntimesQuery.data?.localRuntimes[0]
				?.deviceDisplayName
		).toBe("Office Mac");
		expect(result.current.deviceId).toBeNull();
		expect(api.readiness).not.toHaveBeenCalled();
		client.clear();
	});

	it("renders inventory first, shares each read, and waits for preference evidence before selecting a target", async () => {
		const response = deferred<CurrentDeviceTargetResponse>();
		api.preference.mockReturnValue(response.promise);
		const inventory: PeopleComputersResponse = {
			generatedAt: "2026-09-18T12:00:00.000Z",
			computers: [agentCreationComputerFixture()],
		};
		api.inventory.mockResolvedValue(projectComputerInventory(inventory));
		api.readiness.mockReturnValue(new Promise(() => undefined));
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const { result } = renderHook(
			() => ({
				first: useLocalRuntimeQueries({ storageScope: "owner-a" }),
				second: useLocalRuntimeQueries({ storageScope: "owner-a" }),
			}),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				),
			}
		);
		await waitFor(() =>
			expect(result.current.first.localRuntimesQuery.isSuccess).toBe(true)
		);
		expect(result.current.first.deviceId).toBeNull();
		expect(
			result.current.first.localRuntimesQuery.data?.localRuntimes[0]
				?.deviceDisplayName
		).toBe("Office Mac");
		expect(api.inventory).toHaveBeenCalledOnce();
		expect(api.preference).toHaveBeenCalledOnce();
		expect(api.readiness).not.toHaveBeenCalled();
		await act(async () =>
			response.resolve({
				availability: "resolved",
				deviceId: "office-mac",
				runtimeLane: "prod",
			})
		);
		await waitFor(() =>
			expect(result.current.first.deviceId).toBe("office-mac")
		);
		expect(result.current.first.localRuntimesQuery.data?.currentDeviceId).toBe(
			"office-mac"
		);
		expect(
			result.current.second.localRuntimesQuery.data?.localRuntimes[0]?.isCurrent
		).toBe(true);
		expect(api.inventory).toHaveBeenCalledOnce();
		expect(api.readiness).toHaveBeenCalledWith({
			deviceId: "office-mac",
			runtimeLane: "prod",
		});
		client.clear();
	});
});
