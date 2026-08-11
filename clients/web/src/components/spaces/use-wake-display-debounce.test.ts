import {
	createSpaceMemberAgentSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { SpaceMemberAgentSnapshot } from "@openmeld/schemas/types";
import { buildSpaceMemberDirectory } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import { reconcileWakeDisplayDebounce } from "#/components/agents/use-agent-wake-availability-display-debounce";
import { applyWakeAvailabilityDisplayOverride } from "./use-wake-display-debounce";

const DEBOUNCE_MS = 20_000;
// Use the fixture's default profile id so it passes OpenMeld runtime-id validation
// in buildSpaceMemberDirectory (the projection test runs the real builder).
const PROFILE_ID = createSpaceMemberAgentSnapshot({}).profileId;

type WakeStatus = NonNullable<
	SpaceMemberAgentSnapshot["agentWakeAvailability"]
>["status"];

function agentsWith(status: WakeStatus): SpaceMemberAgentSnapshot[] {
	return [
		createSpaceMemberAgentSnapshot({
			agentWakeAvailability: { status },
			profileId: PROFILE_ID,
		}),
	];
}

type Step = ReturnType<typeof reconcileWakeDisplayDebounce>;

function step(input: {
	agents: SpaceMemberAgentSnapshot[];
	nowMs: number;
	previous: Step["nextState"];
}): Step {
	return reconcileWakeDisplayDebounce({
		agents: input.agents,
		debounceMs: DEBOUNCE_MS,
		nowMs: input.nowMs,
		previous: input.previous,
	});
}

const isOverridden = (result: Step): boolean =>
	result.overrideByProfileId.has(PROFILE_ID);

describe("reconcileWakeDisplayDebounce (asymmetric display debounce)", () => {
	it("keeps Available across a sub-window available -> checking -> available flicker", () => {
		// t=0 Available: shows itself, no override needed.
		let result = step({
			agents: agentsWith("available_for_wake"),
			nowMs: 0,
			previous: new Map(),
		});
		expect(isOverridden(result)).toBe(false);

		// t=1000 Checking: within window -> smoothed to Available.
		result = step({
			agents: agentsWith("checking_connection"),
			nowMs: 1000,
			previous: result.nextState,
		});
		expect(isOverridden(result)).toBe(true);

		// t=5000 still Checking, still inside the window -> still Available.
		result = step({
			agents: agentsWith("checking_connection"),
			nowMs: 5000,
			previous: result.nextState,
		});
		expect(isOverridden(result)).toBe(true);

		// t=8000 recovers to Available -> override cleared, shows real Available.
		result = step({
			agents: agentsWith("available_for_wake"),
			nowMs: 8000,
			previous: result.nextState,
		});
		expect(isOverridden(result)).toBe(false);
	});

	it("surfaces Checking once the debounce window elapses", () => {
		let result = step({
			agents: agentsWith("available_for_wake"),
			nowMs: 0,
			previous: new Map(),
		});
		// Degrade starts at t=1000.
		result = step({
			agents: agentsWith("checking_connection"),
			nowMs: 1000,
			previous: result.nextState,
		});
		expect(isOverridden(result)).toBe(true);

		// t=21_000: elapsed since degrade start (1000) is exactly DEBOUNCE_MS -> off.
		result = step({
			agents: agentsWith("checking_connection"),
			nowMs: 21_000,
			previous: result.nextState,
		});
		expect(isOverridden(result)).toBe(false);
	});

	it("surfaces a terminal Offline immediately, even mid-window", () => {
		let result = step({
			agents: agentsWith("available_for_wake"),
			nowMs: 0,
			previous: new Map(),
		});
		result = step({
			agents: agentsWith("checking_connection"),
			nowMs: 1000,
			previous: result.nextState,
		});
		expect(isOverridden(result)).toBe(true);

		// Offline mid-window -> surfaced immediately (R1: never mask a real drop).
		result = step({
			agents: agentsWith("offline_for_wake"),
			nowMs: 3000,
			previous: result.nextState,
		});
		expect(isOverridden(result)).toBe(false);
	});

	it("surfaces a terminal Unavailable immediately, even mid-window", () => {
		let result = step({
			agents: agentsWith("available_for_wake"),
			nowMs: 0,
			previous: new Map(),
		});
		result = step({
			agents: agentsWith("checking_connection"),
			nowMs: 1000,
			previous: result.nextState,
		});
		expect(isOverridden(result)).toBe(true);

		result = step({
			agents: agentsWith("unavailable_for_wake"),
			nowMs: 3000,
			previous: result.nextState,
		});
		expect(isOverridden(result)).toBe(false);
	});

	it("does not fake Available on a cold-start Checking (no anchor)", () => {
		// First-ever reading is Checking: nothing to fall back to -> show Checking.
		const result = step({
			agents: agentsWith("checking_connection"),
			nowMs: 0,
			previous: new Map(),
		});
		expect(isOverridden(result)).toBe(false);
	});

	it("schedules a wake-up at the window edge while smoothing", () => {
		let result = step({
			agents: agentsWith("available_for_wake"),
			nowMs: 0,
			previous: new Map(),
		});
		result = step({
			agents: agentsWith("checking_connection"),
			nowMs: 1000,
			previous: result.nextState,
		});
		// Timer must fire at degradeStart + debounce so the row flips to Checking
		// even if the backend stops pushing fresh snapshots.
		expect(result.nextWakeAtMs).toBe(1000 + DEBOUNCE_MS);
	});
});

describe("applyWakeAvailabilityDisplayOverride (visual projection)", () => {
	const availableSnapshot = createSpaceMemberAgentSnapshot({
		agentWakeAvailability: { status: "available_for_wake" },
		profileId: PROFILE_ID,
	}).agentWakeAvailability;

	const checkingEntry = buildSpaceMemberDirectory(
		createSpaceMembersSnapshot({
			agents: agentsWith("checking_connection"),
		})
	).sections[0]?.entries[0];

	it("projects a Checking agent row onto the Available snapshot's visuals", () => {
		if (!(availableSnapshot && checkingEntry)) {
			throw new Error("fixture setup failed");
		}
		expect(checkingEntry.presenceStatus).toBe("checking_connection");

		const projected = applyWakeAvailabilityDisplayOverride(
			checkingEntry,
			availableSnapshot
		);

		expect(projected.presenceStatus).toBe("wakeable");
		expect(projected.availabilityCategory).toBe("available");
		expect(projected.availabilityBadgeLabel).toBe("Available");
		expect(projected.availabilityIsRefreshing).toBe(false);
		// Identity fields are untouched so business lookups by profileId still work.
		expect(projected.profileId).toBe(checkingEntry.profileId);
	});

	it("leaves human entries untouched", () => {
		if (!(availableSnapshot && checkingEntry)) {
			throw new Error("fixture setup failed");
		}
		const humanEntry = { ...checkingEntry, profileKind: "human" as const };
		const projected = applyWakeAvailabilityDisplayOverride(
			humanEntry,
			availableSnapshot
		);
		expect(projected.presenceStatus).toBe(humanEntry.presenceStatus);
	});
});
