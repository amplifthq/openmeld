import type { LocalAgentCatalogEntryWithLifecycle } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	hasReadySelectableLocalAgentCatalogEntries,
	resolveBringAgentsSetupState,
} from "./bring-agents-setup-mode";

describe("resolveBringAgentsSetupState", () => {
	it("returns none when this account has no current computer", () => {
		expect(
			resolveBringAgentsSetupState({
				currentDeviceTarget: {
					availability: "missing",
				},
				localAgentCatalogEntries: [
					createLocalAgentCatalogEntry({
						agentId: "codex",
						launchStatus: "needs_repair",
						selectable: false,
						selectableReason: "needs_repair",
					}),
				],
			})
		).toEqual({ kind: "none" });
	});

	it("returns none when the Local Runtime catalog has not loaded", () => {
		expect(
			resolveBringAgentsSetupState({
				currentDeviceTarget: {
					availability: "resolved",
					deviceId: "device-1",
					runtimeLane: "dev-local",
				},
				localAgentCatalogEntries: null,
			})
		).toEqual({ kind: "none" });
	});

	it("returns none when at least one builtin local agent is ready", () => {
		expect(
			resolveBringAgentsSetupState({
				currentDeviceTarget: {
					availability: "resolved",
					deviceId: "device-1",
					runtimeLane: "dev-local",
				},
				localAgentCatalogEntries: [
					createLocalAgentCatalogEntry({
						agentId: "codex",
						launchStatus: "ready",
						selectable: true,
					}),
					createLocalAgentCatalogEntry({
						agentId: "claude-code",
						launchStatus: "needs_repair",
						selectable: false,
						selectableReason: "needs_repair",
					}),
				],
			})
		).toEqual({ kind: "none" });
	});

	it("returns repair_local_agents when only repairable builtin agents are available", () => {
		expect(
			resolveBringAgentsSetupState({
				currentDeviceTarget: {
					availability: "resolved",
					deviceId: "device-1",
					runtimeLane: "dev-local",
				},
				localAgentCatalogEntries: [
					createLocalAgentCatalogEntry({
						agentId: "codex",
						launchStatus: "needs_repair",
						selectable: false,
						selectableReason: "needs_repair",
					}),
					createLocalAgentCatalogEntry({
						agentId: "claude-code",
						detected: false,
						enabled: false,
						launchStatus: "not_available",
						selectable: false,
						selectableReason: "not_detected",
					}),
				],
			})
		).toEqual({
			kind: "repair_local_agents",
			agentIds: ["codex", "claude-code"],
		});
	});

	it("ignores suspended agents when deciding whether setup has usable local agents", () => {
		expect(
			resolveBringAgentsSetupState({
				currentDeviceTarget: {
					availability: "resolved",
					deviceId: "device-1",
					runtimeLane: "dev-local",
				},
				localAgentCatalogEntries: [
					createLocalAgentCatalogEntry({
						agentId: "openclaw",
						lifecycleStatus: "suspended",
						launchStatus: "ready",
						selectable: true,
					}),
				],
			})
		).toEqual({ kind: "none" });
	});
});

describe("hasReadySelectableLocalAgentCatalogEntries", () => {
	it("requires both selectable and ready", () => {
		expect(
			hasReadySelectableLocalAgentCatalogEntries([
				createLocalAgentCatalogEntry({
					launchStatus: "ready",
					selectable: false,
					selectableReason: "needs_repair",
				}),
				createLocalAgentCatalogEntry({
					launchStatus: "needs_repair",
					selectable: true,
				}),
			])
		).toBe(false);
		expect(
			hasReadySelectableLocalAgentCatalogEntries([
				createLocalAgentCatalogEntry({
					launchStatus: "ready",
					selectable: true,
				}),
			])
		).toBe(true);
	});

	it("does not count suspended ready agents", () => {
		expect(
			hasReadySelectableLocalAgentCatalogEntries([
				createLocalAgentCatalogEntry({
					lifecycleStatus: "suspended",
					launchStatus: "ready",
					selectable: true,
				}),
			])
		).toBe(false);
	});
});

function createLocalAgentCatalogEntry(
	overrides: Partial<LocalAgentCatalogEntryWithLifecycle> = {}
): LocalAgentCatalogEntryWithLifecycle {
	const selectable = overrides.selectable ?? true;
	return {
		agentId: overrides.agentId ?? "codex",
		detected: overrides.detected ?? true,
		displayName: overrides.displayName ?? "Codex",
		enabled: overrides.enabled ?? true,
		lifecycleStatus: overrides.lifecycleStatus ?? "active",
		launchStatus:
			overrides.launchStatus ?? (selectable ? "ready" : "needs_repair"),
		selectable,
		selectableReason:
			overrides.selectableReason ?? (selectable ? null : "needs_repair"),
		targetKind: overrides.targetKind ?? "builtin",
	};
}
