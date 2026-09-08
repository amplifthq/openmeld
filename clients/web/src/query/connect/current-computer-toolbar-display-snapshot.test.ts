import { describe, expect, it } from "vitest";
import {
	createCurrentComputerToolbarDisplaySnapshot,
	currentComputerToolbarDisplaySnapshotSchema,
	readCurrentComputerToolbarAttention,
} from "./current-computer-toolbar-display-snapshot";

describe("disconnected computer display persistence", () => {
	it.each([
		"danger",
		"muted",
	])("restores %s disconnection snapshots as ordinary status", (tone) => {
		const snapshot = currentComputerToolbarDisplaySnapshotSchema.parse({
			version: 1,
			currentComputer: {
				deviceId: "computer-a",
				attention: { reason: "service_not_connected", tone },
			},
		});
		expect(readCurrentComputerToolbarAttention(snapshot)).toMatchObject({
			label: "Disconnected",
			tone: "muted",
			reason: "service_not_connected",
		});
	});
	it("retains disconnected status across a new snapshot round trip", () => {
		const snapshot = createCurrentComputerToolbarDisplaySnapshot({
			deviceId: "computer-a",
			status: {
				label: "Disconnected",
				reason: "service_not_connected",
				showLabel: true,
				tone: "muted",
			},
		});
		expect(readCurrentComputerToolbarAttention(snapshot)?.reason).toBe(
			"service_not_connected"
		);
	});
});
