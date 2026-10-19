import { expect, it } from "vitest";
import { resolveAgentListReturn } from "./agent-list-return";

it("returns a Profile opened from a MemberAgent page to that MemberAgent", () => {
	expect(
		resolveAgentListReturn({
			agentsPath: "/o/acme/agents",
			memberAgentName: "Codex",
			returnToAgentDirectory: true,
			returnToMemberAgentId: "ma 1",
		})
	).toEqual({
		to: "/o/acme/agents?memberAgentId=ma%201",
		label: "Back to Codex",
	});
	expect(
		resolveAgentListReturn({
			agentsPath: "/o/acme/agents",
			memberAgentName: undefined,
			returnToAgentDirectory: true,
			returnToMemberAgentId: undefined,
		})
	).toEqual({ to: "/o/acme/agents", label: "Back to Agents" });
	expect(
		resolveAgentListReturn({
			agentsPath: "/o/acme/agents",
			memberAgentName: undefined,
			returnToAgentDirectory: false,
			returnToMemberAgentId: "ma",
		})
	).toBeUndefined();
});
