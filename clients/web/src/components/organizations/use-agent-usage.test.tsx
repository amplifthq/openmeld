import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCurrentOrganizationProfileDirectory } from "#/lib/organizations/organization-directory";
import { readOrganizationAiUsage } from "#/lib/organizations/organization-usage";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { useAgentUsage } from "./use-agent-usage";

vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationProfileDirectory: vi.fn(),
}));
vi.mock("#/lib/organizations/organization-usage", () => ({
	readOrganizationAiUsage: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

function directory(): OrganizationProfileDirectoryResponse {
	return {
		organizationId: "org-1",
		generatedAt: "2026-10-06T00:00:00.000Z",
		members: [],
		agentProfiles: [
			["mine", "user-1", false],
			["other", "user-2", false],
			["center", "user-1", true],
		].map(([profileId, ownerUserId, isCenterAgent]) => ({
			profileId: String(profileId),
			ownerUserId: String(ownerUserId),
			isCenterAgent: Boolean(isCenterAgent),
			organizationId: "org-1",
			profileKind: "agent",
			profileName: String(profileId),
			profileHandle: String(profileId),
			ownerName: String(ownerUserId),
			isDefault: false,
			status: "active",
			source: "user",
			managedRole: null,
			createdByUserId: String(ownerUserId),
			creatorProfileId: null,
			lastUsedAt: null,
			createdAt: "2026-10-06T00:00:00.000Z",
			updatedAt: "2026-10-06T00:00:00.000Z",
			agentControllerRef: "builtin:codex",
		})),
	};
}

describe("personal Agent usage scope", () => {
	it.each([
		"local",
		"remote",
	] as const)("filters %s usage to owned non-Center Agents and preserves an empty selection on refresh", async (runtime) => {
		vi.mocked(readCurrentOrganizationProfileDirectory).mockResolvedValue(
			directory()
		);
		vi.mocked(readOrganizationAiUsage).mockResolvedValue({
			fromMs: 1,
			toMs: 2,
			models: [],
		});
		const { result } = renderHook(
			() =>
				useAgentUsage({
					organizationId: "org-1",
					userId: "user-1",
					query: { fromMs: 1, toMs: 2, runtime },
				}),
			{ wrapper: TestQueryClientProvider }
		);
		await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
		expect(vi.mocked(readOrganizationAiUsage).mock.calls[0][0]).toMatchObject({
			organizationId: "org-1",
			query: { runtime, agentProfileIds: ["mine"] },
		});
		vi.mocked(readCurrentOrganizationProfileDirectory).mockResolvedValue({
			...directory(),
			agentProfiles: [],
		});
		await act(() => result.current.refresh());
		await waitFor(() =>
			expect(
				vi.mocked(readOrganizationAiUsage).mock.lastCall?.[0].query
					.agentProfileIds
			).toEqual([])
		);
		expect(
			vi
				.mocked(readOrganizationAiUsage)
				.mock.calls.every(
					([input]) => input.query.agentProfileIds !== undefined
				)
		).toBe(true);
	});
	it("does not query personal usage while ownership is pending or unavailable", async () => {
		let rejectRead!: (reason: Error) => void;
		vi.mocked(readCurrentOrganizationProfileDirectory).mockReturnValue(
			new Promise((_, reject) => {
				rejectRead = reject;
			})
		);
		const { result } = renderHook(
			() =>
				useAgentUsage({
					organizationId: "org-1",
					userId: "user-1",
					query: { fromMs: 1, toMs: 2, runtime: "local" },
				}),
			{ wrapper: TestQueryClientProvider }
		);
		expect(result.current.pending).toBe(true);
		expect(readOrganizationAiUsage).not.toHaveBeenCalled();
		await act(async () =>
			rejectRead(
				Object.assign(new Error("Membership required"), {
					code: "organization.membership_required",
				})
			)
		);
		await waitFor(() => expect(result.current.failed).toBe(true));
		expect(readOrganizationAiUsage).not.toHaveBeenCalled();
	});
});
