import type {
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatComputerTabLocalAgents } from "./agents-page-computer";
import { ComputerSummaryCardContent } from "./agents-page-computer-tabs";

type DeviceAgentCatalogEntry =
	LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"][number];

describe("ComputerSummaryCardContent", () => {
	it("keeps suspended local agents out of the computer summary icons", () => {
		render(
			<ComputerSummaryCardContent
				device={buildComputer(
					buildExecutionTarget({
						entries: [
							buildCatalogEntry({
								agentId: "codex",
								displayName: "Codex",
								lifecycleStatus: "active",
							}),
							buildCatalogEntry({
								agentId: "opencode",
								displayName: "OpenCode",
								lifecycleStatus: "active",
							}),
							buildCatalogEntry({
								agentId: "openclaw",
								displayName: "OpenClaw",
								lifecycleStatus: "suspended",
							}),
						],
					})
				)}
				recordState={{ kind: "normal" }}
			/>
		);

		expect(screen.getByTestId("local-agent-logo-codex")).toBeTruthy();
		expect(screen.getByTestId("local-agent-logo-opencode")).toBeTruthy();
		expect(screen.queryByTestId("local-agent-logo-openclaw")).toBeNull();
	});
});

describe("formatComputerTabLocalAgents", () => {
	it("does not count suspended local agents as available on the computer summary", () => {
		const executionTarget = buildExecutionTarget({
			entries: [
				buildCatalogEntry({
					agentId: "openclaw",
					displayName: "OpenClaw",
					lifecycleStatus: "suspended",
				}),
			],
		});

		expect(formatComputerTabLocalAgents(executionTarget)).toBe(
			"No local agents"
		);
	});
});

function buildComputer(
	executionTarget: LocalRuntimeExecutionTarget
): LocalRuntimeComputer {
	return {
		deviceDisplayName: "Felix's MacBook Pro",
		deviceDisplayNameSource: "observed",
		deviceId: "device-macbook-pro",
		deviceType: "laptop",
		executionTargets: [executionTarget],
		firstSeenAtMs: 1_719_600_000_000,
		isCurrent: true,
		lastObservedAtMs: 1_719_600_000_000,
		osVersion: "25.5.0",
		platformFamily: "macOS",
	};
}

function buildExecutionTarget(input: {
	entries: readonly DeviceAgentCatalogEntry[];
}): LocalRuntimeExecutionTarget {
	return {
		openMeldServiceRuntimeId: {
			source: "runtime_registry_authority",
			value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
		},
		capabilities: input.entries.map((entry) => ({
			agentControllerRef: `builtin:${entry.agentId}`,
			agentControllerInterface: null,
			enabled: entry.enabled,
			reasonCodes: [],
			status: "ready",
		})),
		deviceId: "device-macbook-pro",
		isCurrent: true,
		lastObservedAtMs: 1_719_600_000_000,
		localAgentCatalog: {
			detectedNotSupportedYet: 0,
			detectedSupported: input.entries.length,
			entries: [...input.entries],
			needsChoice: 0,
			needsRepair: 0,
			notDetected: 0,
			totalBuiltins: input.entries.length,
		},
		localAgentControl: { refreshCatalog: true, setEnabled: true },
		reasonCodes: [],
		runtimeLane: "dev-local",
		status: "ready",
		userFacingCommand: "openmeld-dev",
	};
}

function buildCatalogEntry(input: {
	agentId: string;
	displayName: string;
	lifecycleStatus: DeviceAgentCatalogEntry["lifecycleStatus"];
}): DeviceAgentCatalogEntry {
	return {
		agentId: input.agentId,
		detected: true,
		displayName: input.displayName,
		enabled: true,
		lifecycleStatus: input.lifecycleStatus,
		launchStatus: "ready",
		selectable: true,
		selectableReason: null,
		targetKind: "builtin",
	};
}
