import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import type {
	ComputerPowerState,
	PeopleComputersResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeopleComputerInventory } from "#/lib/connect/local-runtimes";
import { startQueryKeys } from "#/query/query-keys";
import { ComputerPowerSettings } from "./computer-power-settings";

const api = vi.hoisted(() => ({ power: vi.fn(), inventory: vi.fn() }));
vi.mock("@openmeld/api-client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@openmeld/api-client")>()),
	createComputerPowerApi: () => api.power,
}));
vi.mock("#/lib/connect/local-runtimes", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/connect/local-runtimes")>()),
	readLocalRuntimes: api.inventory,
}));

const target = { deviceId: "computer-office", runtimeLane: "prod" } as const;
const storageScope = "owner-power-test";
const inventoryKey = startQueryKeys.localRuntimes(storageScope);
const power: ComputerPowerState = {
	enabled: true,
	revision: 3,
	active: false,
	supported: true,
	problem: null,
};

function inventory(heartbeat: number | null): PeopleComputerInventory {
	const computers: PeopleComputersResponse["computers"] = [
		{
			deviceId: target.deviceId,
			deviceDisplayName: "Office computer",
			deviceDisplayNameSource: "observed",
			deviceType: "desktop",
			platformFamily: "macOS",
			osVersion: null,
			firstSeenAtMs: 1,
			lastObservedAtMs: 2,
			identityStatus: "enrolled",
			executionTargets: [],
			connection: {
				status: heartbeat === null ? "disconnected" : "connected",
				reasonCodes: [],
				sessions:
					heartbeat === null
						? []
						: [
								{
									...target,
									lastHeartbeatMs: heartbeat,
									serviceVersion: null,
									executionCompatibility: {
										status: "compatible",
										expectedEpoch: "test-epoch",
										observedEpoch: "test-epoch",
										reasonCode: "daemon.runtime_contract.compatible",
									},
									serviceUpdate: { wakeBlocked: false, reasonCodes: [] },
								},
							],
			},
		},
	];
	return {
		currentDeviceId: target.deviceId,
		currentRuntimeLane: target.runtimeLane,
		localRuntimes: [],
		peopleComputers: { generatedAt: new Date().toISOString(), computers },
	};
}

describe("ComputerPowerSettings connection polling", () => {
	let client: QueryClient;
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
		vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		api.power.mockResolvedValue(power);
	});
	afterEach(() => {
		cleanup();
		client.clear();
		vi.useRealTimers();
	});

	async function observeConnection(heartbeat: number | null) {
		const snapshot = inventory(heartbeat);
		api.inventory.mockResolvedValue(snapshot);
		await act(async () => {
			client.setQueryData(inventoryKey, snapshot);
			await vi.advanceTimersByTimeAsync(0);
		});
	}
	async function advance(ms: number) {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ms);
		});
	}
	async function renderSettings() {
		render(
			<QueryClientProvider client={client}>
				<ComputerPowerSettings storageScope={storageScope} target={target} />
			</QueryClientProvider>
		);
		await advance(0);
	}

	it("polls only a live selected connection and resumes after reconnect", async () => {
		await observeConnection(null);
		await renderSettings();
		await screen.findByText(
			"Reconnect this computer to manage sleep prevention."
		);
		await advance(15_000);
		expect(api.power).not.toHaveBeenCalled();
		expect(
			screen.getByText("Reconnect this computer to manage sleep prevention.")
		).toBeTruthy();

		await observeConnection(100);
		await screen.findByRole("switch", { name: "Prevent sleep during tasks" });
		expect(api.power).toHaveBeenCalledTimes(1);
		expect(api.power).toHaveBeenLastCalledWith(target, { operation: "read" });
		expect(
			screen
				.getByRole("switch", { name: "Prevent sleep during tasks" })
				.getAttribute("aria-checked")
		).toBe("true");
		await advance(5000);
		expect(api.power).toHaveBeenCalledTimes(2);

		await observeConnection(null);
		await screen.findByText(
			"Reconnect this computer to manage sleep prevention."
		);
		await advance(15_000);
		expect(api.power).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole("switch")).toBeNull();
		await observeConnection(200);
		await screen.findByRole("switch", { name: "Prevent sleep during tasks" });
		expect(api.power).toHaveBeenCalledTimes(3);
	});

	it.each([
		"new heartbeat",
		"explicit retry",
		"mutation reconnect",
	])("pauses after a disconnected response until %s", async (recovery) => {
		const disconnected = new OpenMeldApiClientHttpError({
			code: "upstream_error",
			upstreamCode: "computer.target_disconnected",
			message: "Service disconnected during this request.",
			status: 503,
			rawBody: "",
		});
		if (recovery !== "mutation reconnect") {
			api.power.mockRejectedValueOnce(disconnected);
		}
		await observeConnection(100);
		await renderSettings();
		if (recovery === "mutation reconnect") {
			const control = await screen.findByRole("switch", {
				name: "Prevent sleep during tasks",
			});
			api.power.mockRejectedValueOnce(disconnected);
			fireEvent.click(control);
		}
		await screen.findByRole("alert");
		const failedRequests = recovery === "mutation reconnect" ? 2 : 1;
		await advance(15_000);
		expect(api.power).toHaveBeenCalledTimes(failedRequests);
		expect(screen.getByRole("alert").textContent).toBe(
			"Service disconnected during this request."
		);
		expect(screen.queryByRole("switch")).toBeNull();

		// A newly fetched inventory with the same heartbeat is not reconnection evidence.
		await observeConnection(100);
		await advance(15_000);
		expect(api.power).toHaveBeenCalledTimes(failedRequests);
		if (recovery !== "explicit retry") {
			await observeConnection(200);
		} else {
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		}
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(api.power).toHaveBeenCalledTimes(failedRequests + 1);
		await advance(5000);
		expect(api.power).toHaveBeenCalledTimes(failedRequests + 2);
	});
});
