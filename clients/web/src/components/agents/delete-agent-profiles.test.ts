import type { AuthProfileView } from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startQueryKeys } from "#/query/query-keys";
import { deleteAgentProfiles } from "./delete-agent-profiles";

function profile(index: number): AuthProfileView {
	return {
		openMeldProfileId: `agt_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
		profileName: `Agent ${index}`,
		profileHandle: `agent-${index}`,
		profileKind: "agent",
		isDefault: false,
		status: "active",
		ownerUserId: "owner",
		source: "web",
		managedRole: null,
		createdByUserId: "owner",
		creatorProfileId: null,
		lastUsedAt: null,
		createdAt: "2026-09-01T00:00:00Z",
		updatedAt: "2026-09-01T00:00:00Z",
	};
}

describe("batch Agent deletion", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("preserves successful deletions when another fails, treats already removed as success, and skips other owners and managed Agents", async () => {
		const profiles = [
			profile(1),
			profile(2),
			profile(3),
			{ ...profile(4), ownerUserId: "teammate" },
			{ ...profile(5), managedRole: "center_agent" as const },
		];
		const pendingResponses = Array.from({ length: 3 }, () => {
			let resolve!: (response: Response) => void;
			return {
				promise: new Promise<Response>((done) => {
					resolve = done;
				}),
				resolve: (response: Response) => resolve(response),
			};
		});
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(() => pendingResponses[0]?.promise)
			.mockImplementationOnce(() => pendingResponses[1]?.promise)
			.mockImplementationOnce(() => pendingResponses[2]?.promise);
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient();
		const key = startQueryKeys.profilesForStorageScope("account");
		queryClient.setQueryData(key, profiles);
		const deletion = deleteAgentProfiles({
			profiles,
			currentUserId: "owner",
			organizationId: "org",
			queryClient,
			storageScope: "account",
		});
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		expect(queryClient.getQueryData(key)).toEqual(profiles.slice(3));
		pendingResponses[0]?.resolve(
			Response.json({ ok: true, profile: profiles[0] })
		);
		pendingResponses[1]?.resolve(
			Response.json(
				{ ok: false, code: "FORBIDDEN", message: "Permission changed." },
				{ status: 403 }
			)
		);
		pendingResponses[2]?.resolve(
			Response.json(
				{ ok: false, code: "NOT_FOUND", message: "Profile not found." },
				{ status: 404 }
			)
		);
		const failures = await deletion;
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(failures.map((value) => value.profileId)).toEqual([
			profiles[1]?.openMeldProfileId,
			profiles[3]?.openMeldProfileId,
			profiles[4]?.openMeldProfileId,
		]);
		expect(queryClient.getQueryData(key)).toEqual([
			profiles[1],
			profiles[3],
			profiles[4],
		]);
		expect(failures[0]?.message).toContain("Permission changed");
	});
});
