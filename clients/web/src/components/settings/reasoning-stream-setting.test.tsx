import type { createReasoningStreamApi } from "@openmeld/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReasoningStreamSetting } from "./reasoning-stream-setting";

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("@openmeld/api-client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@openmeld/api-client")>()),
	createReasoningStreamApi: () => api,
}));
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: vi.fn(),
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org-1" },
		storageScope: "account-1",
	}),
}));
type Preference = Awaited<
	ReturnType<ReturnType<typeof createReasoningStreamApi>["get"]>
>;
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

describe("ReasoningStreamSetting loading", () => {
	it("shows the known description immediately, reveals the real switch value, and keeps it during refresh", async () => {
		const first = deferred<Preference>();
		const refresh = deferred<Preference>();
		api.get
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(refresh.promise);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<ReasoningStreamSetting />
			</QueryClientProvider>
		);
		expect(screen.getByText("Stream local Agent reasoning")).toBeTruthy();
		expect(
			screen.getByRole("status", { name: "Loading reasoning preference" })
		).toBeTruthy();
		expect(screen.queryByRole("switch")).toBeNull();
		await act(async () => first.resolve({ enabled: true }));
		expect(
			(await screen.findByRole("switch")).getAttribute("aria-checked")
		).toBe("true");
		act(() => {
			client.invalidateQueries({
				queryKey: ["reasoning-stream-preference", "account-1"],
			});
		});
		await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
		expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
			"true"
		);
		expect(screen.queryByRole("status")).toBeNull();
		await act(async () => refresh.resolve({ enabled: false }));
		await waitFor(() =>
			expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
				"false"
			)
		);
		expect(api.update).not.toHaveBeenCalled();
		client.clear();
	});

	it("reports a failed read instead of an unchecked switch or endless skeleton", async () => {
		api.get.mockRejectedValue(new Error("Unavailable"));
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<ReasoningStreamSetting />
			</QueryClientProvider>
		);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
		expect(screen.queryByRole("switch")).toBeNull();
		expect(screen.queryByRole("status")).toBeNull();
		client.clear();
	});
});
