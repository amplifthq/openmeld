import { BroadcastChannel as NativeBroadcastChannel } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	publishAgentReadinessInvalidationFrame,
	publishAgentReadinessRecovery,
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
				refreshAll: false,
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

	it("delivers a scoped reconnect recovery to every listener regardless of Space version", () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const received: unknown[] = [];
		const unsubscribe = subscribeAgentReadinessInvalidations((message) => {
			received.push(message);
		}, scope);
		publishAgentReadinessInvalidationFrame(
			{
				agentProfileIds: ["agt_1"],
				spaceId: "space_1",
				type: "agent.readiness.invalidated",
				version: 7,
			},
			scope
		);
		received.length = 0;

		const recover = (recoveryScope = scope) =>
			publishAgentReadinessRecovery({
				...recoveryScope,
				reason: "space.live.reconnected",
				spaceId: "space_1",
			});
		recover({ ...scope, organizationId: "other-org" });
		recover();
		recover();

		expect(received).toEqual([
			{
				...scope,
				agentProfileIds: [],
				reason: "space.live.reconnected",
				refreshAll: true,
				spaceId: "space_1",
				version: 0,
			},
			{
				...scope,
				agentProfileIds: [],
				reason: "space.live.reconnected",
				refreshAll: true,
				spaceId: "space_1",
				version: 0,
			},
		]);
		unsubscribe();
	});
});
