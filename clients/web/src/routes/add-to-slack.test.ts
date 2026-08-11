import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveOptionalActiveOrganizationSlugMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/organization-scope", () => ({
	resolveOptionalActiveOrganizationSlug:
		resolveOptionalActiveOrganizationSlugMock,
}));

import { Route } from "./add-to-slack";

describe("add-to-slack route", () => {
	beforeEach(() => {
		resolveOptionalActiveOrganizationSlugMock.mockReset();
	});

	it("sends anonymous visitors to login with the stable funnel entry as the return target", async () => {
		resolveOptionalActiveOrganizationSlugMock.mockResolvedValue(null);

		const thrown = await readBeforeLoadRedirect();

		expect(isRedirect(thrown)).toBe(true);
		expect(
			(
				thrown as {
					options: { search: { redirect: unknown }; to: string };
				}
			).options
		).toMatchObject({
			search: { redirect: "/add-to-slack" },
			to: "/login",
		});
		expect(
			resolveOptionalActiveOrganizationSlugMock
		).toHaveBeenCalledExactlyOnceWith({
			data: { routeFamily: "/add-to-slack" },
		});
	});

	it("sends authenticated visitors to the active organization picker with Slack install intent", async () => {
		resolveOptionalActiveOrganizationSlugMock.mockResolvedValue("acme");

		const thrown = await readBeforeLoadRedirect();

		expect(isRedirect(thrown)).toBe(true);
		expect(
			(
				thrown as {
					options: {
						replace: boolean;
						search: { intent: unknown };
						to: string;
					};
				}
			).options
		).toMatchObject({
			replace: true,
			search: { intent: "slack-install" },
			to: "/o/acme/organizations",
		});
	});
});

async function readBeforeLoadRedirect(): Promise<unknown> {
	try {
		await Route.options.beforeLoad?.({
			location: {
				href: "/add-to-slack",
				pathname: "/add-to-slack",
			},
		} as never);
	} catch (error) {
		return error;
	}
	throw new Error("Expected add-to-slack beforeLoad to redirect.");
}
