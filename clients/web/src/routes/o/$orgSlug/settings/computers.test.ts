import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route } from "./computers";

describe("legacy Settings Computers route", () => {
	it.each([
		[undefined, "/o/acme/computers"],
		["device-123", "/o/acme/computers/device-123"],
	] as const)("redirects to the first-level Computers home", (deviceId, to) => {
		let thrown: unknown;
		try {
			Route.options.beforeLoad?.({
				params: { deviceId, orgSlug: "acme" },
				search: { focus: "service", refresh: "setup-complete" },
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
						search?: Record<string, string>;
						to: string;
					};
				}
			).options
		).toMatchObject({
			replace: true,
			search: { focus: "service", refresh: "setup-complete" },
			to,
		});
	});
});
