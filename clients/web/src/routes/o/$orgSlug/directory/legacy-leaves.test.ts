import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route as AgentsRoute } from "./agents";
import { Route as PeopleRoute } from "./people";

describe("legacy Directory leaves", () => {
	it.each([
		[AgentsRoute, "/o/acme/agents"],
		[PeopleRoute, "/o/acme/people"],
	] as const)("redirects to the matching first-level home", (route, to) => {
		let thrown: unknown;
		try {
			route.options.beforeLoad?.({
				params: { orgSlug: "acme" },
				search: { profileId: "profile-123" },
			} as never);
		} catch (error) {
			thrown = error;
		}

		expect(isRedirect(thrown)).toBe(true);
		expect(
			(
				thrown as {
					options: {
						replace?: boolean;
						search?: { profileId?: string };
						to: string;
					};
				}
			).options
		).toMatchObject({
			replace: true,
			search: { profileId: "profile-123" },
			to,
		});
	});
});
