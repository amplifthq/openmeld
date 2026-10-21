import { expect, it } from "vitest";
import { resolveAgentListReturn } from "./agent-list-return";

it("returns a Profile opened from the Agents page to the Agents list", () => {
	expect(
		resolveAgentListReturn({
			agentsPath: "/o/acme/agents",
			returnToAgentDirectory: true,
		})
	).toEqual({ to: "/o/acme/agents", label: "Back to Agents" });
	expect(
		resolveAgentListReturn({
			agentsPath: "/o/acme/agents",
			returnToAgentDirectory: false,
		})
	).toBeUndefined();
});
