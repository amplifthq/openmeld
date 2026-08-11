import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route } from "./index";

describe("organization directory index route", () => {
	it("redirects the Directory root to People", () => {
		let thrown: unknown;
		try {
			Route.options.beforeLoad?.({ params: { orgSlug: "acme" } } as never);
		} catch (error) {
			thrown = error;
		}

		expect(isRedirect(thrown)).toBe(true);
		expect(
			(thrown as { options: { replace?: boolean; to: string } }).options
		).toMatchObject({
			replace: true,
			to: "/o/acme/people",
		});
	});
});
