import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route as LegacyCenterAgentChatRoute } from "./_center-agent/center-agent.chat";
import { Route } from "./_center-agent/index";

describe("organization index route", () => {
	it("renders the Center Agent conversation as Home without redirecting", () => {
		expect(Route.options.beforeLoad).toBeUndefined();
		expect(Route.options.component).toBeTypeOf("function");
		expect(Route.options.loader).toBeTypeOf("function");
		expect(Route.options.preload).toBe(false);
		expect(Route.options.staticData).toEqual({ appShellSection: "home" });
	});

	it("replaces the legacy Center Agent Chat URL with Home", () => {
		let thrown: unknown;
		try {
			LegacyCenterAgentChatRoute.options.beforeLoad?.({
				params: { orgSlug: "acme" },
				search: { focusSignalId: "signal-123", view: "graph" },
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
						search?: { focusSignalId?: string; view?: string };
						to: string;
					};
				}
			).options
		).toMatchObject({
			replace: true,
			search: { focusSignalId: "signal-123", view: "graph" },
			to: "/o/acme",
		});
	});
});
