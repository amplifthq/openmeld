import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route as LegacyCenterAgentChatRoute } from "./_center-agent/center-agent.chat";
import { Route as DeskRoute } from "./_center-agent/desk";
import { Route } from "./_center-agent/index";

describe("organization index route", () => {
	it("opens Spaces by default and keeps Desk available by direct link", () => {
		let thrown: unknown;
		try {
			Route.options.beforeLoad?.({
				params: { orgSlug: "acme" },
				search: {},
			} as never);
		} catch (error) {
			thrown = error;
		}
		expect(isRedirect(thrown)).toBe(true);
		expect((thrown as { options: unknown }).options).toMatchObject({
			to: "/o/acme/spaces",
			replace: true,
		});
		expect(DeskRoute.options.component).toBeTypeOf("function");
		expect(DeskRoute.options.staticData).toEqual({ appShellSection: "home" });
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
