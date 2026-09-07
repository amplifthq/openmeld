import { describe, expect, it } from "vitest";
import { Route as CenterAgentLayoutRoute } from "./_center-agent";
import { Route as CenterAgentHomeRoute } from "./_center-agent/index";
import { Route as SpaceConversationRoute } from "./spaces/$spaceId";
import { Route as SpacesRoute } from "./spaces/index";

describe("organization route loading contract", () => {
	it.each([
		["Spaces", SpacesRoute],
		["Space conversation", SpaceConversationRoute],
		["Center Agent layout", CenterAgentLayoutRoute],
		["Center Agent conversation", CenterAgentHomeRoute],
	])("delays the %s target shell long enough to avoid a warm-navigation flash", (_, route) => {
		expect(route.options.pendingComponent).toBeTypeOf("function");
		expect(route.options.pendingMs).toBe(300);
		expect(route.options.pendingMinMs).toBe(0);
	});

	it("keeps Center Agent route preload from publishing an empty page result", () => {
		expect(CenterAgentHomeRoute.options.preload).toBe(false);
	});
});
