import { afterEach, describe, expect, it, vi } from "vitest";
import {
	readCurrentOrganizationAgentRuntimeOverview,
	readCurrentOrganizationDirectory,
	readCurrentOrganizationProfileDirectory,
} from "./organization-directory";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("readCurrentOrganizationDirectory", () => {
	it("requests authoritative member activity from the Organization directory", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				agentProfiles: [],
				generatedAt: "2026-08-01T00:00:00.000Z",
				members: [],
				organizationId: "org-1",
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		await readCurrentOrganizationDirectory({ organizationId: "org-1" });

		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"/v1/organizations/current/directory?includeMemberLastActiveAt=true"
			),
			expect.objectContaining({ credentials: "include" })
		);
	});

	it("reads profile identity without using the full runtime directory route", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				agentProfiles: [],
				generatedAt: "2026-08-01T00:00:00.000Z",
				members: [],
				organizationId: "org-1",
			})
		);
		vi.stubGlobal("fetch", fetchMock);
		const abortController = new AbortController();

		await readCurrentOrganizationProfileDirectory({
			organizationId: "org-1",
			signal: abortController.signal,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"/v1/organizations/current/profile-directory?includeTaskActivity=true&includeModelSelection=true&includeMemberLastActiveAt=true"
			),
			expect.objectContaining({
				credentials: "include",
				signal: abortController.signal,
			})
		);
	});

	it("reads Agent runtime state from its independent overview route", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				agentProfiles: [],
				generatedAt: "2026-08-01T00:00:00.000Z",
				organizationId: "org-1",
			})
		);
		vi.stubGlobal("fetch", fetchMock);
		const abortController = new AbortController();

		await readCurrentOrganizationAgentRuntimeOverview({
			organizationId: "org-1",
			signal: abortController.signal,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"/v1/organizations/current/agent-runtime-overview?"
			),
			expect.objectContaining({
				credentials: "include",
				signal: abortController.signal,
			})
		);
		const requestUrl = new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]));
		expect(requestUrl.searchParams.get("includeUsageLimits")).toBe("true");
		expect(requestUrl.searchParams.get("agentProfileWorkRecoveryVersion")).toBe(
			"2"
		);
		expect(requestUrl.searchParams.get("includeTaskActivity")).toBe("true");
	});
});
