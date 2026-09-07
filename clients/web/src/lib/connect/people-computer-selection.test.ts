import type { PeopleComputersResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { selectPeopleComputerTarget } from "./people-computer-selection";

const inventory: PeopleComputersResponse = {
	generatedAt: "2026-09-07T00:00:00.000Z",
	computers: ["old", "new"].map((deviceId) => ({
		deviceId,
		deviceDisplayName: "Same name",
		deviceDisplayNameSource: "observed",
		deviceType: "laptop",
		platformFamily: "macOS",
		osVersion: null,
		firstSeenAtMs: 1,
		lastObservedAtMs: 2,
		identityStatus: "unconfirmed",
		executionTargets: [],
		connection: { status: "disconnected", reasonCodes: [], sessions: [] },
	})),
};

describe("browser Computer selection", () => {
	const input = {
		inventory,
		completedSetup: {
			deviceId: "new",
			runtimeLane: "prod",
			humanProfileId: "human",
		},
		selectedHumanProfileId: "human",
		routingPreference: {
			availability: "resolved",
			deviceId: "old",
			runtimeLane: "prod",
		} as const,
	};
	it("opens the completed second-computer setup without changing account routing", () => {
		expect(
			selectPeopleComputerTarget({ ...input, selection: "browser" })
		).toEqual({ deviceId: "new", runtimeLane: "prod" });
		expect(
			selectPeopleComputerTarget({ ...input, selection: "routing" })
		).toEqual({ deviceId: "old", runtimeLane: "prod" });
	});
	it("keeps an explicit computer and lane instead of applying account routing", () => {
		expect(
			selectPeopleComputerTarget({
				...input,
				explicitTarget: { deviceId: "new", runtimeLane: "canary" },
			})
		).toEqual({ deviceId: "new", runtimeLane: "canary" });
		expect(
			selectPeopleComputerTarget({
				...input,
				explicitTarget: { deviceId: "not-owned", runtimeLane: "prod" },
			})
		).toBeNull();
	});
	it("does not reuse another identity's handoff or invent ownership from local storage", () => {
		expect(
			selectPeopleComputerTarget({
				...input,
				selection: "browser",
				selectedHumanProfileId: "different-human",
			})
		).toEqual({ deviceId: "old", runtimeLane: "prod" });
		expect(
			selectPeopleComputerTarget({
				...input,
				selection: "browser",
				inventory: { ...inventory, computers: [] },
			})
		).toBeNull();
	});
	it("does not select an arbitrary historical computer when neither setup nor routing chooses it", () => {
		expect(
			selectPeopleComputerTarget({ inventory, completedSetup: null })
		).toBeNull();
	});
	it("does not reuse account routing as proof of this browser's setup", () => {
		expect(
			selectPeopleComputerTarget({
				...input,
				completedSetup: null,
				selection: "setup",
			})
		).toBeNull();
		expect(
			selectPeopleComputerTarget({ ...input, selection: "setup" })
		).toEqual({ deviceId: "new", runtimeLane: "prod" });
		expect(
			selectPeopleComputerTarget({
				...input,
				selection: "setup",
				selectedHumanProfileId: "different-human",
			})
		).toBeNull();
	});
});
