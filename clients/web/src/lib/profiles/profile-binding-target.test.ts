import type {
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	type ProfileBindingCatalogExecutionTargetSources,
	resolveProfileBindingCatalogExecutionTarget,
} from "./profile-binding-target";

function executionTarget(input: {
	agentId: string;
	deviceId: string;
	isCurrent?: boolean;
}): LocalRuntimeExecutionTarget {
	return {
		deviceId: input.deviceId,
		isCurrent: input.isCurrent ?? false,
		localAgentCatalog: {
			entries: [
				{
					agentId: input.agentId,
					detected: true,
					displayName: input.agentId,
					enabled: true,
					launchStatus: "ready",
					lifecycleStatus: "active",
					selectable: true,
					selectableReason: null,
					targetKind: "builtin",
				},
			],
		},
	} as LocalRuntimeExecutionTarget;
}

function computer(input: {
	connectedComputerId: string;
	deviceId: string;
	executionTargets: LocalRuntimeExecutionTarget[];
}): LocalRuntimeComputer {
	return input as LocalRuntimeComputer;
}

function sources(
	computers: LocalRuntimeComputer[],
	selectedExecutionTarget?: LocalRuntimeExecutionTarget
): ProfileBindingCatalogExecutionTargetSources {
	return {
		localRuntimesQuery: { data: { localRuntimes: computers } },
		selectedExecutionTarget,
	} as ProfileBindingCatalogExecutionTargetSources;
}

describe("resolveProfileBindingCatalogExecutionTarget", () => {
	it("selects the Local Agent target from the requested public Computer", () => {
		const currentTarget = executionTarget({
			agentId: "codex",
			deviceId: "device-current",
			isCurrent: true,
		});
		const sessionTarget = executionTarget({
			agentId: "codex",
			deviceId: "device-session",
		});

		expect(
			resolveProfileBindingCatalogExecutionTarget(
				sources(
					[
						computer({
							connectedComputerId: "computer-current",
							deviceId: "device-current",
							executionTargets: [currentTarget],
						}),
						computer({
							connectedComputerId: "computer-session",
							deviceId: "device-session",
							executionTargets: [sessionTarget],
						}),
					],
					currentTarget
				),
				{
					connectedComputerId: "computer-session",
					localAgentId: "codex",
				}
			)
		).toBe(sessionTarget);
	});

	it("does not fall back to another Computer when the requested one is unavailable", () => {
		const currentTarget = executionTarget({
			agentId: "codex",
			deviceId: "device-current",
			isCurrent: true,
		});

		expect(
			resolveProfileBindingCatalogExecutionTarget(
				sources(
					[
						computer({
							connectedComputerId: "computer-current",
							deviceId: "device-current",
							executionTargets: [currentTarget],
						}),
					],
					currentTarget
				),
				{
					connectedComputerId: "computer-session",
					localAgentId: "codex",
				}
			)
		).toBeNull();
	});
});
