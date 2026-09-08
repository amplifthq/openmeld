import type { AuthProfileView } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDeskSpace } from "./use-desk-space";

const { list, create } = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock("#/lib/spaces/account-spaces", () => ({ listAccountSpaceItems: list }));
vi.mock("#/lib/spaces/create-space-in-organization", () => ({
	createSpaceInOrganization: create,
}));
const profile: AuthProfileView = {
	createdAt: "2026-08-18T00:00:00.000Z",
	createdByUserId: "user-mira",
	creatorProfileId: null,
	isDefault: true,
	lastUsedAt: null,
	managedRole: null,
	openMeldProfileId: "11111111-1111-4111-8111-111111111111",
	ownerName: "Mira",
	ownerUserId: "user-mira",
	profileHandle: "mira",
	profileKind: "human",
	profileName: "Mira",
	source: "manual",
	status: "active",
	updatedAt: "2026-08-18T00:00:00.000Z",
};
const key = "openmeld.desk.space:user-mira:org-mira";
beforeEach(() => {
	localStorage.clear();
	list.mockReset().mockResolvedValue({
		pinnedItems: [],
		spaceItems: [],
		recentlyDeletedItems: [],
	});
	create.mockReset().mockResolvedValue({
		spaceId: "space-new",
		meta: { organizationId: "org-mira" },
	});
	// Model the browser's exclusive lock across independent query clients/tabs.
	let tail = Promise.resolve();
	vi.stubGlobal("navigator", {
		locks: {
			request: (_key: string, action: () => Promise<unknown>) => {
				const next = tail.then(action);
				tail = next.then(
					() => undefined,
					() => undefined
				);
				return next;
			},
		},
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
function openDesk() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return renderHook(
		() =>
			useDeskSpace({
				profile,
				organizationId: "org-mira",
				storageScope: "user-mira",
			}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		}
	);
}
it("creates one private ordinary Space for concurrent entries", async () => {
	const first = openDesk();
	const second = openDesk();
	await waitFor(() =>
		expect(first.result.current.ready && second.result.current.ready).toBe(true)
	);
	expect(create).toHaveBeenCalledTimes(1);
	expect(create).toHaveBeenCalledWith({
		actingProfile: profile,
		organizationId: "org-mira",
		space: {
			name: "Getting started",
			accessMode: "members_only",
			visibility: "private",
		},
	});
	expect(first.result.current.spaceId).toBe(second.result.current.spaceId);
});
it("reopens the same Space as the human after a reload", async () => {
	localStorage.setItem(key, "space-existing");
	const desk = openDesk();
	await waitFor(() => expect(desk.result.current.ready).toBe(true));
	expect(desk.result.current.spaceId).toBe("space-existing");
	expect(desk.result.current.profileId).toBe(profile.openMeldProfileId);
	expect(create).not.toHaveBeenCalled();
});
it("does not recreate a saved Space that disappeared from the index", async () => {
	localStorage.setItem(key, "space-deleted");
	const desk = openDesk();
	await waitFor(() => expect(desk.result.current.ready).toBe(true));
	expect(create).not.toHaveBeenCalled();
});
it("never blindly repeats a creation whose response was lost", async () => {
	create.mockRejectedValueOnce(new Error("Connection lost"));
	const first = openDesk();
	await waitFor(() =>
		expect(first.result.current.error).toBe("Connection lost")
	);
	first.unmount();
	const retry = openDesk();
	await waitFor(() =>
		expect(retry.result.current.error).toContain("Couldn’t confirm")
	);
	expect(create).toHaveBeenCalledTimes(1);
});
it("does not create when the account Space index cannot be read", async () => {
	list.mockRejectedValueOnce(new Error("Offline"));
	const desk = openDesk();
	await waitFor(() => expect(desk.result.current.error).toBe("Offline"));
	expect(create).not.toHaveBeenCalled();
});
