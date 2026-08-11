import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route } from "./members";

describe("legacy organization directory Members route", () => {
	it("redirects to People and preserves a focused Human Profile", () => {
		let thrown: unknown;
		try {
			Route.options.beforeLoad?.({
				params: { orgSlug: "acme" },
				search: { profileId: "human-123" },
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
			search: { profileId: "human-123" },
			to: "/o/acme/people",
		});
	});
});
