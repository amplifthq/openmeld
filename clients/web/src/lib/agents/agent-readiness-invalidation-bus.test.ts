import { afterEach, describe, expect, it, vi } from "vitest";
import {
	publishAgentReadinessInvalidationFrame,
	subscribeAgentReadinessInvalidations,
} from "./agent-readiness-invalidation-bus";

describe("agent readiness invalidation bus", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("publishes targeted readiness invalidations through the window fallback", () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const received: unknown[] = [];
		const unsubscribe = subscribeAgentReadinessInvalidations((message) => {
			received.push(message);
		});

		publishAgentReadinessInvalidationFrame({
			agentProfileIds: [" agt_1 ", "agt_1", "agt_2"],
			reason: " route_changed ",
			spaceId: " space_1 ",
			type: "agent.readiness.invalidated",
			version: 7,
		});

		expect(received).toEqual([
			{
				agentProfileIds: ["agt_1", "agt_2"],
				reason: "route_changed",
				spaceId: "space_1",
				version: 7,
			},
		]);

		unsubscribe();
	});

	it("drops invalidations without a target Agent Profile", () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const received: unknown[] = [];
		const unsubscribe = subscribeAgentReadinessInvalidations((message) => {
			received.push(message);
		});

		publishAgentReadinessInvalidationFrame({
			agentProfileIds: [],
			reason: "route_changed",
			spaceId: "space_1",
			type: "agent.readiness.invalidated",
			version: 7,
		});

		expect(received).toEqual([]);

		unsubscribe();
	});
});
