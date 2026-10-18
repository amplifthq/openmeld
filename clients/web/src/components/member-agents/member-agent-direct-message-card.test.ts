import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
	MEMBER_AGENT_PERMISSION_MODE_LINE,
	resolveMemberAgentDirectMessageCard,
} from "./member-agent-direct-message-card";

function entry(
	overrides: Partial<SpaceMemberDirectoryEntry>
): SpaceMemberDirectoryEntry {
	return {
		agentControllerRef: "builtin:claude-code",
		availabilityCategory: "available",
		availabilitySummary: null,
		modelSelection: null,
		runtimeDeviceDisplayName: "Felix’s MacBook",
		workingDirectory: null,
		...overrides,
	} as SpaceMemberDirectoryEntry;
}

const memberAgentName = "Felix Lu’s Claude Code";

describe("MemberAgent Direct Message card", () => {
	it("welcomes with computer, model, folder when known, and the permission line", () => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({
					agentControllerPermissionMode: "claude-code:default",
					workingDirectory: "~/code/openmeld",
				}),
				memberAgentName,
				modelCatalog: null,
			})
		).toEqual({
			kind: "welcome",
			title: "Felix Lu’s Claude Code is ready",
			details: [
				{ label: "Computer", value: "Felix’s MacBook" },
				{ label: "Default model", value: "The harness default" },
				{ label: "Default folder", value: "~/code/openmeld" },
			],
			note: MEMBER_AGENT_PERMISSION_MODE_LINE,
		});
	});

	it.each([
		["offline", "offline", "Felix Lu’s Claude Code is offline"],
		["unavailable", "repair", "Felix Lu’s Claude Code needs attention"],
		["checking", "checking", "Checking Felix Lu’s Claude Code"],
	])("shows one %s card", (category, kind, title) => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({ availabilityCategory: category }),
				memberAgentName,
				modelCatalog: null,
			})
		).toMatchObject({ kind, title });
	});

	it("names a non-default permission mode instead of promising prompts", () => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({
					agentControllerRef: "builtin:codex",
					agentControllerPermissionMode: "codex:fullAccess",
				}),
				memberAgentName: "Felix Lu’s Codex",
				modelCatalog: null,
			})
		).toMatchObject({
			kind: "welcome",
			note: "Permission mode is Full access.",
		});
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({ agentControllerPermissionMode: null }),
				memberAgentName,
				modelCatalog: null,
			})
		).toMatchObject({ kind: "welcome", note: null });
	});
});
