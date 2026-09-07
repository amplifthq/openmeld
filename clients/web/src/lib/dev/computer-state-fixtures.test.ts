import type { PeopleComputersResponse } from "@openmeld/schemas/types";
import { expect, it } from "vitest";
import {
	buildComputerStateFixtures,
	computerStateFixtureReadiness,
	setComputerStateFixtureAutomaticUpdates,
} from "./computer-state-fixtures";

// Anonymous excerpt of the September 7 staging computer.list capture.
// Only the Claude Code catalog entry is retained; totals describe that excerpt.
const source: PeopleComputersResponse["computers"][number] = {
	deviceId: "observed-computer",
	connectedComputerId: "observed-identity",
	deviceDisplayName: "Example Mac",
	deviceDisplayNameSource: "observed",
	platformFamily: "macOS",
	osVersion: "25.6.0",
	deviceType: "laptop",
	firstSeenAtMs: 1,
	lastObservedAtMs: 1,
	identityStatus: "enrolled",
	connection: { status: "disconnected", reasonCodes: [], sessions: [] },
	executionTargets: [
		{
			deviceId: "observed-computer",
			runtimeLane: "dev-local",
			userFacingCommand: "openmeld-dev",
			openMeldServiceRuntimeId: null,
			status: "partial",
			capabilities: [],
			reasonCodes: [],
			lastObservedAtMs: 1,
			localAgentControl: { refreshCatalog: true, setEnabled: true },
			localAgentCatalog: {
				totalBuiltins: 1,
				detectedSupported: 1,
				needsChoice: 0,
				needsRepair: 0,
				detectedNotSupportedYet: 0,
				notDetected: 0,
				entries: [
					{
						agentId: "claude-code",
						displayName: "Claude Code",
						targetKind: "builtin",
						detected: true,
						enabled: true,
						launchStatus: "ready",
						selectable: true,
						selectableReason: null,
						lifecycleStatus: "active",
					},
				],
			},
		},
	],
};

it("keeps simulated computers separate and does not mutate the real inventory", () => {
	const before = structuredClone(source);
	const result = buildComputerStateFixtures(source);
	expect(result).toHaveLength(7);
	expect(source).toEqual(before);
	expect(
		new Set(result.map((computer) => computer.connectedComputerId)).size
	).toBe(7);
	expect(
		result.every((computer) =>
			computer.deviceDisplayName.startsWith("Preview ·")
		)
	).toBe(true);
	const empty = result.find((computer) => computer.deviceId.endsWith("-empty"));
	expect(empty?.executionTargets[0]?.localAgentCatalog.detectedSupported).toBe(
		0
	);
	expect(empty?.executionTargets[0]?.capabilities).toEqual([]);
});

it("separates optional and blocking updates, disconnect causes, and failed checks", () => {
	const read = (id: string) =>
		computerStateFixtureReadiness(`local-computer-preview-${id}`);
	expect(read("current").localComponents.service.status).toBe("current");
	expect(read("available").localComponents.service.wakeBlocked).toBe(false);
	expect(read("required").localComponents.service.wakeBlocked).toBe(true);
	expect(read("required").service.connected).toBe(true);
	expect(read("disconnected").service.connected).toBe(false);
	expect(read("reconnect").service.reasonCodes).toContain(
		"daemon.session.reject_conflict"
	);
	expect(() => read("unknown")).toThrow("Simulated connection check failed");
	setComputerStateFixtureAutomaticUpdates(
		"local-computer-preview-current",
		false
	);
	expect(
		read("current").localComponents.maintenance?.automaticUpdatesEnabled
	).toBe(false);
	expect(read("disconnected").localComponents.maintenance).toBeUndefined();
});
