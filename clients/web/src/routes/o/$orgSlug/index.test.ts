import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route as LegacyCenterAgentChatRoute } from "./_center-agent/center-agent.chat";
import { Route } from "./_center-agent/index";

describe("organization index route", () => {
	it("opens Desk without redirecting when no conversation is requested", () => {
		expect(
			Route.options.beforeLoad?.({
				params: { orgSlug: "acme" },
				search: {},
			} as never)
		).toBeUndefined();
		expect(Route.options.component).toBeTypeOf("function");
		expect(Route.options.staticData).toEqual({ appShellSection: "home" });
	});

	it("replaces the legacy Center Agent Chat URL with the canonical chat", () => {
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
			to: "/o/acme/chats/center-agent",
		});
	});
});
