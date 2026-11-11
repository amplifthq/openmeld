import { formatHarnessDisplayName } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
	formatAgentProfileOwnerHarnessName,
	formatMemberAgentDisplayName,
	formatMemberAgentProfileDisplayName,
} from "./member-agent-display-name";

describe("MemberAgent display names", () => {
	it("derives Owner’s Harness from the owner's name and the harness", () => {
		expect(
			formatMemberAgentDisplayName({
				ownerName: "Felix Lu",
				harnessKind: "claude-code",
			})
		).toBe("Felix Lu’s Claude Code");
		expect(
			formatMemberAgentDisplayName({ ownerName: "Tali", harnessKind: "hosted" })
		).toBe("Tali’s Remote Agent");
		expect(formatHarnessDisplayName("grok-build")).toBe("Grok Build");
	});

	it.each([
		true,
		false,
	])("preserves a custom Profile name (default: %s)", (isDefaultProfile) => {
		const memberAgentName = "Felix Lu’s Claude Code";
		expect(
			formatMemberAgentProfileDisplayName({
				harnessKind: "claude-code",
				memberAgentName,
				profileName: "Claude Code",
				isDefaultProfile: true,
			})
		).toBe("Felix Lu’s Claude Code");
		expect(
			formatMemberAgentProfileDisplayName({
				harnessKind: "claude-code",
				memberAgentName,
				profileName: "PR Reviewer",
				isDefaultProfile,
			})
		).toBe("Felix Lu’s Claude Code · PR Reviewer");
	});

	it("presents a colleague's Profile from its controller and owner", () => {
		expect(
			formatAgentProfileOwnerHarnessName({
				agentControllerRef: "builtin:codex",
				ownerName: "Tali",
				profileName: "Codex",
			})
		).toBe("Tali’s Codex");
		expect(
			formatAgentProfileOwnerHarnessName({
				agentControllerRef: "builtin:codex",
				ownerName: "Tali",
				profileName: "Release bot",
			})
		).toBe("Tali’s Codex · Release bot");
	});

	it("leaves Profiles outside the MemberAgent structure unchanged", () => {
		expect(
			formatAgentProfileOwnerHarnessName({
				agentControllerRef: "hosted:center-agent",
				ownerName: null,
				profileName: "Center Agent",
			})
		).toBeNull();
		expect(
			formatAgentProfileOwnerHarnessName({
				agentControllerRef: "custom:my-script",
				ownerName: "Felix Lu",
				profileName: "Script",
			})
		).toBeNull();
	});
});
