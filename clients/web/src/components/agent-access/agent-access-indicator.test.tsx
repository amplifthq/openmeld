import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatPublicWakeabilityReason } from "#/lib/agents/agent-viewer-access";
import {
	AgentAccessIndicator,
	resolveAgentChatActionLabel,
	resolveColleagueAgentChatProgress,
} from "./agent-access-indicator";

describe("AgentAccessIndicator", () => {
	afterEach(cleanup);

	it("tells a colleague they can use the Agent", () => {
		render(
			<AgentAccessIndicator
				access={{ kind: "can_use", ownerName: "Tali Smoke" }}
			/>
		);
		expect(screen.getByTestId("agent-access-indicator").textContent).toBe(
			"You can use"
		);
	});

	it("names the owner who answers first", () => {
		render(
			<AgentAccessIndicator
				access={{ kind: "asks_owner", ownerName: "Tali Smoke" }}
			/>
		);
		expect(screen.getByTestId("agent-access-indicator").textContent).toBe(
			"Asks Tali Smoke"
		);
	});

	it("offers Ask to use only when the owner answers first", () => {
		expect(
			resolveAgentChatActionLabel({
				access: { kind: "asks_owner", ownerName: "Tali Smoke" },
				profileName: "Codex",
			})
		).toBe("Ask to use");
		expect(
			resolveAgentChatActionLabel({
				access: { kind: "can_use", ownerName: "Tali Smoke" },
				profileName: "Codex",
			})
		).toBe("Chat with Codex");
		expect(
			resolveAgentChatActionLabel({ access: null, profileName: "Codex" })
		).toBe("Chat with Codex");
	});
});

describe("colleague chat action states", () => {
	const asksOwner = { kind: "asks_owner", ownerName: "Tali Smoke" } as const;
	const label = (
		progress: ReturnType<typeof resolveColleagueAgentChatProgress>,
		access: Parameters<
			typeof resolveAgentChatActionLabel
		>[0]["access"] = asksOwner
	) => resolveAgentChatActionLabel({ access, profileName: "Codex", progress });

	it("asks to use before any Direct Message exists", () => {
		const progress = resolveColleagueAgentChatProgress({
			hasDirectMessage: false,
			pendingProfileIds: [],
			profileId: "agt_codex",
		});
		expect(progress).toBe("none");
		expect(label(progress)).toBe("Ask to use");
	});

	it("opens the chat once a Direct Message exists and nothing waits", () => {
		const progress = resolveColleagueAgentChatProgress({
			hasDirectMessage: true,
			pendingProfileIds: ["agt_other"],
			profileId: "agt_codex",
		});
		expect(progress).toBe("chat_open");
		expect(label(progress)).toBe("Open chat");
	});

	it("waits for the owner while the viewer's request is pending", () => {
		const progress = resolveColleagueAgentChatProgress({
			hasDirectMessage: true,
			pendingProfileIds: ["agt_codex"],
			profileId: "agt_codex",
		});
		expect(progress).toBe("waiting");
		expect(label(progress)).toBe("Waiting for Tali Smoke");
	});

	it("chats directly with an always grant or an Agent that does not ask", () => {
		expect(label("waiting", { kind: "can_use", ownerName: "Tali Smoke" })).toBe(
			"Chat with Codex"
		);
		expect(label("chat_open", null)).toBe("Chat with Codex");
	});
});

describe("formatPublicWakeabilityReason", () => {
	it.each([
		[{ code: "harness_turned_off" }, "Turned off on its computer"],
		[{ code: "no_working_folder" }, "No working folder"],
		[{ code: "computer_offline" }, "Computer offline"],
		[{ code: "usage_exhausted", resetAt: null }, "Usage limit reached"],
	] as const)("names %j neutrally", (reason, label) => {
		expect(formatPublicWakeabilityReason(reason)).toBe(label);
	});
});
