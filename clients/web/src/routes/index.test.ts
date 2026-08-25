import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveOptionalActiveOrganizationEntryPathMock = vi.hoisted(() =>
	vi.fn()
);

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
}));

vi.mock("#/components/landing-page/landing-page", () => ({
	LandingPage: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-scope", () => ({
	resolveOptionalActiveOrganizationEntryPath:
		resolveOptionalActiveOrganizationEntryPathMock,
}));

import { loadLandingPage } from "./index";

describe("landing route loader", () => {
	beforeEach(() => {
		resolveOptionalActiveOrganizationEntryPathMock.mockReset();
	});

	it("keeps anonymous visitors on the public landing page", async () => {
		resolveOptionalActiveOrganizationEntryPathMock.mockResolvedValue(null);

		await expect(loadLandingPage()).resolves.toEqual({
			authenticatedEntryPath: null,
		});
		expect(
			resolveOptionalActiveOrganizationEntryPathMock
		).toHaveBeenCalledExactlyOnceWith({
			data: { routeFamily: "/" },
		});
	});

	it("resolves an authenticated visitor's Home entry once", async () => {
		resolveOptionalActiveOrganizationEntryPathMock.mockResolvedValue("/o/acme");

		await expect(loadLandingPage()).resolves.toEqual({
			authenticatedEntryPath: "/o/acme",
		});
		expect(
			resolveOptionalActiveOrganizationEntryPathMock
		).toHaveBeenCalledExactlyOnceWith({
			data: { routeFamily: "/" },
		});
	});
});
