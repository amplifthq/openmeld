import type { AgentAccessRequestView } from "@openmeld/schemas";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatPublicWakeabilityReason } from "#/lib/agents/agent-viewer-access";
import type {
	ColleagueAccess,
	ColleagueAccessState,
} from "#/lib/agents/colleague-access-state";
import {
	AgentAccessIndicator,
	resolveAgentChatActionLabel,
	resolveColleagueRequestSpaceId,
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
	const asksOwner = { kind: "asks_owner", ownerName: "Tali" } as const;
	const colleague = (
		state: ColleagueAccessState,
		spaceId: string | null = null
	): ColleagueAccess => ({
		state,
		ownerName: "Tali Smoke",
		request: spaceId ? ({ spaceId } as AgentAccessRequestView) : null,
	});
	const label = (state: ColleagueAccessState) =>
		resolveAgentChatActionLabel({
			access: asksOwner,
			colleagueAccess: colleague(state),
			profileName: "Codex",
		});

	it.each([
		["none", "Ask to use"],
		["draft", "Ask to use"],
		["waiting", "Waiting for Tali Smoke"],
		["approved_once", "Chat with Codex"],
		["always_allowed", "Chat with Codex"],
		["not_required", "Chat with Codex"],
		["declined", "Declined"],
		["revoked", "Ask to use"],
	] as const)("labels %s as %s", (state, expected) => {
		expect(label(state)).toBe(expected);
	});

	it("chats directly with an Agent that does not ask its owner", () => {
		expect(
			resolveAgentChatActionLabel({
				access: { kind: "can_use", ownerName: "Tali Smoke" },
				colleagueAccess: colleague("none"),
				profileName: "Codex",
			})
		).toBe("Chat with Codex");
	});

	it("opens the request's own Direct Message while waiting, allowed once, or declined", () => {
		expect(resolveColleagueRequestSpaceId(colleague("waiting", "dm-1"))).toBe(
			"dm-1"
		);
		expect(resolveColleagueRequestSpaceId(colleague("declined", "dm-1"))).toBe(
			"dm-1"
		);
		// A draft reopens the current Direct Message instead of a new one.
		expect(resolveColleagueRequestSpaceId(colleague("draft"))).toBeNull();
		expect(
			resolveColleagueRequestSpaceId(colleague("approved_once", "dm-1"))
		).toBe("dm-1");
		// Revoked access asks again from the current Direct Message.
		expect(
			resolveColleagueRequestSpaceId(colleague("revoked", "dm-1"))
		).toBeNull();
		expect(resolveColleagueRequestSpaceId(null)).toBeNull();
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
