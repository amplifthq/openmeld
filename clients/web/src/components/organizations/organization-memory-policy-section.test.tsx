import type { CenterAgentOrganizationMemoryPolicyResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { centerAgentQueryKeys } from "#/query/organizations/center-agent";
import { OrganizationMemoryPolicySection } from "./organization-memory-policy-section";

const api = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }));
vi.mock("#/lib/organizations/center-agent-memory", () => ({
	readCurrentOrganizationCenterAgentMemoryPolicy: api.read,
	setCurrentOrganizationCenterAgentMemoryPolicy: api.update,
}));

function policy(enabled: boolean): CenterAgentOrganizationMemoryPolicyResponse {
	return {
		organizationId: "org-memory",
		organizationMemoryOptIn: enabled,
		provider: "zep_cloud",
		updatedByUserId: null,
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
function renderSection() {
	const client = new QueryClient({
		defaultOptions: { queries: { retryDelay: 0 } },
	});
	render(
		<QueryClientProvider client={client}>
			<OrganizationMemoryPolicySection
				isPersonalWorkspace={false}
				organizationId="org-memory"
				roleState={{ canManage: true, errorMessage: null, isPending: false }}
			/>
		</QueryClientProvider>
	);
	return client;
}
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

describe("Organization memory policy loading", () => {
	it("does not present memory as off before reading it and retains the real value during refresh", async () => {
		const initial = deferred<CenterAgentOrganizationMemoryPolicyResponse>();
		const refresh = deferred<CenterAgentOrganizationMemoryPolicyResponse>();
		api.read
			.mockReturnValueOnce(initial.promise)
			.mockReturnValueOnce(refresh.promise);
		const client = renderSection();
		expect(screen.getByText("Remember shared conversations")).toBeTruthy();
		expect(screen.queryByRole("switch")).toBeNull();
		expect(
			screen.getByRole("status", { name: "Loading memory setting" })
		).toBeTruthy();
		await act(async () => initial.resolve(policy(true)));
		expect(
			(await screen.findByRole("switch")).getAttribute("aria-checked")
		).toBe("true");
		act(() => {
			client
				.invalidateQueries({
					queryKey: centerAgentQueryKeys.memoryPolicy("org-memory"),
				})
				.catch(console.error);
		});
		await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
		expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
			"true"
		);
		expect(screen.queryByRole("status")).toBeNull();
		await act(async () => refresh.resolve(policy(false)));
		await waitFor(() =>
			expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
				"false"
			)
		);
		expect(api.update).not.toHaveBeenCalled();
		client.clear();
	});

	it("shows a retryable failure instead of confirming that memory is off", async () => {
		api.read.mockRejectedValue(new Error("Memory policy unavailable"));
		const client = renderSection();
		await screen.findByRole("alert");
		expect(screen.queryByRole("switch")).toBeNull();
		expect(screen.queryByRole("status")).toBeNull();
		api.read.mockResolvedValue(policy(true));
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(
			(await screen.findByRole("switch")).getAttribute("aria-checked")
		).toBe("true");
		expect(api.update).not.toHaveBeenCalled();
		client.clear();
	});
});
