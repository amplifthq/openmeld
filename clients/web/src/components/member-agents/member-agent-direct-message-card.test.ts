import { MEMBER_AGENT_WELCOME_PERMISSION_MODE_LINE } from "@openmeld/agent-runtime";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import { resolveMemberAgentDirectMessageCard } from "./member-agent-direct-message-card";

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

const FAILURE_WORD_PATTERN = /fail/i;

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
			note: MEMBER_AGENT_WELCOME_PERMISSION_MODE_LINE,
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

	it("uses Core's public Wakeability reason for the repair card", () => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({ availabilityCategory: "unavailable" }),
				memberAgentName,
				modelCatalog: null,
				reason: { code: "version_too_old", modelId: "claude-opus-5-5" },
			})
		).toMatchObject({
			kind: "repair",
			title: "Felix Lu’s Claude Code needs an update",
			description:
				"The installed harness can’t run claude-opus-5-5. Update it on its computer, or choose another model.",
		});
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({ availabilityCategory: "offline" }),
				memberAgentName,
				modelCatalog: null,
				reason: { code: "computer_offline" },
			})
		).toMatchObject({ kind: "offline" });
	});

	it("asks for a working folder before the first task, not after a failure", () => {
		const missing = entry({
			availabilityCategory: "unavailable",
			availabilityReasonCode: "profile.workspace.missing",
			availabilitySummary: "Choose a working folder for this Agent.",
		});
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: missing,
				memberAgentName,
				modelCatalog: null,
				hasMessages: false,
			})
		).toEqual({
			kind: "repair",
			title: "Felix Lu’s Claude Code needs a working folder",
			description: "Choose a working folder before its first task.",
		});
		const card = resolveMemberAgentDirectMessageCard({
			entry: missing,
			memberAgentName,
			modelCatalog: null,
			hasMessages: true,
		});
		expect(card).toMatchObject({
			description: "Choose a working folder before its next task.",
		});
		expect(JSON.stringify(card)).not.toMatch(FAILURE_WORD_PATTERN);
	});
});
