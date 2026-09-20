import { BroadcastChannel as NativeBroadcastChannel } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	publishAgentReadinessInvalidationFrame,
	subscribeAgentReadinessInvalidations,
} from "./agent-readiness-invalidation-bus";

const scope = { organizationId: "org-1", storageScope: "account-1" };

describe("agent readiness invalidation bus", () => {
	it.each([
		"window",
		"broadcast",
	])("scopes and deduplicates %s delivery, including same-document listeners", async (transport) => {
		vi.stubGlobal(
			"BroadcastChannel",
			transport === "broadcast" ? NativeBroadcastChannel : undefined
		);
		const received: number[] = [];
		let done!: () => void;
		const complete = new Promise<void>((resolve) => {
			done = resolve;
		});
		const unsubscribe = subscribeAgentReadinessInvalidations((message) => {
			received.push(message.version);
			if (message.version === 3) {
				done();
			}
		}, scope);
		const publish = (version: number, messageScope = scope) =>
			publishAgentReadinessInvalidationFrame(
				{
					type: "agent.readiness.invalidated",
					spaceId: "space-1",
					agentProfileIds: ["agt-1"],
					version,
				},
				messageScope
			);
		try {
			publish(1, { ...scope, storageScope: "other-account" });
			publish(1, { ...scope, organizationId: "other-org" });
			publish(2);
			publish(2);
			publish(1);
			publish(3);
			await complete;
			expect(received).toEqual([2, 3]);
		} finally {
			unsubscribe();
		}
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("publishes targeted readiness invalidations through the window fallback", () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const received: unknown[] = [];
		const unsubscribe = subscribeAgentReadinessInvalidations((message) => {
			received.push(message);
		}, scope);

		publishAgentReadinessInvalidationFrame(
			{
				agentProfileIds: [" agt_1 ", "agt_1", "agt_2"],
				reason: " route_changed ",
				spaceId: " space_1 ",
				type: "agent.readiness.invalidated",
				version: 7,
			},
			scope
		);

		expect(received).toEqual([
			{
				...scope,
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
		}, scope);

		publishAgentReadinessInvalidationFrame(
			{
				agentProfileIds: [],
				reason: "route_changed",
				spaceId: "space_1",
				type: "agent.readiness.invalidated",
				version: 7,
			},
			scope
		);

		expect(received).toEqual([]);

		unsubscribe();
	});
});
