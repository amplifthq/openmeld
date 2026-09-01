import type {
	AgentStreamToolPart,
	AgentWorkActivity,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceAgentToolActivity } from "./space-agent-tool-activity";

const CODE_MODE_PATTERN = /codemode/iu;
const REVIEWED_SOURCE_PATTERN = /Reviewed source files/u;

afterEach(cleanup);

describe("SpaceAgentToolActivity", () => {
	it("keeps the working state visible beside concrete live work", () => {
		render(
			<SpaceAgentToolActivity
				item={{
					agentStreamState: createStreamingState([
						createPart("spaces.read", "output-available"),
						createPart("github.issues.search", "input-available", {
							toolCallId: "tool-call-2",
						}),
					]),
				}}
			/>
		);

		const trigger = screen.getByRole("button", {
			name: "Agent is working. Work summary: Searching GitHub issues…",
		});
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(trigger.getAttribute("aria-busy")).toBe("true");
		expect(trigger.classList.contains("px-0")).toBe(true);
		expect(trigger.textContent).toContain("Agent is working");
		expect(trigger.textContent).toContain("Searching GitHub issues…");
		expect(
			trigger
				.querySelector("canvas")
				?.getAttribute("data-space-agent-orb-state")
		).toBe("searching");

		expect(screen.queryByRole("list", { name: "Work steps" })).toBeNull();
		fireEvent.click(trigger);
		const viewport = screen.getByRole("list", { name: "Work steps" });
		expect(
			viewport
				.closest('[data-slot="thinking-steps-content"]')
				?.classList.contains("px-1")
		).toBe(false);
		expect(viewport.className).toContain("max-h-[min(12rem,30dvh)]");
		expect(within(viewport).getByText("Checked available Spaces")).toBeTruthy();
		expect(within(viewport).getByText("Searching GitHub issues…")).toBeTruthy();
		expect(screen.queryByText("OpenMeld task complete")).toBeNull();
		expect(screen.queryByText("Ran a command")).toBeNull();
	});

	it.each([
		["output-available", "Reviewed source files"],
		["output-error", "Couldn't review source files"],
	] as const)("keeps the latest concrete %s work in the live summary", (state, expectedSummary) => {
		render(
			<SpaceAgentToolActivity
				item={{
					agentStreamState: createStreamingState([
						createPart("source.read", state),
					]),
				}}
			/>
		);

		const trigger = screen.getByRole("button", {
			name: `Agent is working. Work summary: ${expectedSummary}`,
		});
		expect(trigger).toBeTruthy();
		expect(
			trigger
				.querySelector("canvas")
				?.getAttribute("data-space-agent-orb-state")
		).toBe("solving");
		expect(screen.queryByText("Preparing the response…")).toBeNull();
	});

	it("uses shaping while the Agent creates a draft", () => {
		render(
			<SpaceAgentToolActivity
				item={{
					agentStreamState: createStreamingState([
						createPart("organization.document.draft", "input-available"),
					]),
				}}
			/>
		);

		expect(
			screen
				.getByRole("button", {
					name: "Agent is working. Work summary: Drafting an Organization Document…",
				})
				.querySelector("canvas")
				?.getAttribute("data-space-agent-orb-state")
		).toBe("shaping");
	});

	it("hides internal tools when no safe work meaning is available", () => {
		const { container } = render(
			<SpaceAgentToolActivity
				item={{
					agentStreamState: createStreamingState([
						{
							type: "tool",
							toolCallId: "codemode-call",
							toolName: "codemode",
							state: "output-error",
						},
					]),
				}}
			/>
		);

		expect(container.innerHTML).toBe("");
		expect(screen.queryByText(CODE_MODE_PATTERN)).toBeNull();
	});

	it("groups consecutive repeated work into one useful step", () => {
		render(
			<SpaceAgentToolActivity
				item={{
					agentStreamState: createStreamingState([
						createPart("source.read", "output-available"),
						createPart("source.read", "output-available", {
							toolCallId: "tool-call-2",
						}),
					]),
				}}
			/>
		);
		fireEvent.click(screen.getByTestId("space-agent-tool-activity"));

		expect(
			screen.getByText("Reviewed source files · 2 steps", {
				selector: "[data-slot=thinking-step-label]",
			})
		).toBeTruthy();
		expect(
			screen.getAllByText(REVIEWED_SOURCE_PATTERN, {
				selector: "[data-slot=thinking-step-label]",
			})
		).toHaveLength(1);
	});

	it("pauses auto-follow when the user scrolls up and resumes on request", () => {
		const { rerender } = render(
			<SpaceAgentToolActivity
				item={{
					agentStreamState: createStreamingState([
						createPart("spaces.read", "output-available"),
						createPart("projects.read", "output-available", {
							toolCallId: "tool-call-2",
						}),
					]),
				}}
			/>
		);
		fireEvent.click(screen.getByTestId("space-agent-tool-activity"));
		const viewport = screen.getByRole("list", { name: "Work steps" });
		Object.defineProperty(viewport, "clientHeight", {
			configurable: true,
			value: 100,
		});
		Object.defineProperty(viewport, "scrollHeight", {
			configurable: true,
			value: 400,
		});
		viewport.scrollTop = 0;
		fireEvent.scroll(viewport);

		rerender(
			<SpaceAgentToolActivity
				item={{
					agentStreamState: createStreamingState([
						createPart("spaces.read", "output-available"),
						createPart("projects.read", "output-available", {
							toolCallId: "tool-call-2",
						}),
						createPart("tests.run", "input-available", {
							toolCallId: "tool-call-3",
						}),
					]),
				}}
			/>
		);

		const resume = screen.getByRole("button", {
			name: "1 new step · Jump to latest",
		});
		expect(viewport.scrollTop).toBe(0);
		fireEvent.click(resume);
		expect(viewport.scrollTop).toBe(400);
		expect(
			screen.queryByRole("button", {
				name: "1 new step · Jump to latest",
			})
		).toBeNull();
	});

	it("keeps the final Work summary collapsed and links to full details", () => {
		const onOpenDetails = vi.fn();
		render(
			<SpaceAgentToolActivity
				item={{
					agentActivity: {
						v: 1,
						steps: [
							createDurableStep("space.context.read", "output-available"),
							createDurableStep("github.issues.search", "output-error"),
						],
						truncated: true,
					},
				}}
				onOpenDetails={onOpenDetails}
				placement="message"
			/>
		);

		const trigger = screen.getByRole("button", {
			name: "Work summary: Completed 2 work steps · Couldn't search GitHub issues",
		});
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(trigger.classList.contains("w-fit")).toBe(true);
		expect(trigger.classList.contains("w-full")).toBe(false);

		fireEvent.click(trigger);
		expect(screen.getByText("Reviewed Space context")).toBeTruthy();
		expect(screen.getByText("Couldn't search GitHub issues")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "View all work details" })
		);
		expect(onOpenDetails).toHaveBeenCalledOnce();
	});

	it("counts tool calls instead of lifecycle events and keeps mixed outcomes exact", () => {
		render(
			<SpaceAgentToolActivity
				item={{
					agentStreamState: createStreamingState([
						createPart("source.search", "input-available", {
							toolCallId: "search-1",
						}),
						createPart("source.search", "output-available", {
							toolCallId: "search-1",
						}),
						createPart("source.search", "input-available", {
							toolCallId: "search-2",
						}),
						createPart("source.search", "output-error", {
							toolCallId: "search-2",
						}),
					]),
				}}
			/>
		);
		fireEvent.click(screen.getByTestId("space-agent-tool-activity"));

		expect(screen.getByText("Searched the codebase")).toBeTruthy();
		expect(
			screen.getByText("Couldn't search the codebase", {
				selector: "[data-slot=thinking-step-label]",
			})
		).toBeTruthy();
		expect(
			screen.queryByText("Couldn't search the codebase · 4 steps")
		).toBeNull();
	});
});

function createStreamingState(toolParts: readonly AgentStreamToolPart[]) {
	return {
		reasonCode: null,
		sequence: toolParts.length,
		status: "streaming" as const,
		streamId: "stream:submission-1",
		toolParts,
	};
}

function createPart(
	key: AgentWorkActivity["key"],
	state: AgentStreamToolPart["state"],
	overrides: Partial<AgentStreamToolPart> = {}
): AgentStreamToolPart {
	return {
		type: "tool",
		toolCallId: "tool-call-1",
		toolName: `tool:${key}`,
		state,
		work: { key, v: 1 },
		...overrides,
	};
}

function createDurableStep(
	key: AgentWorkActivity["key"],
	state: AgentStreamToolPart["state"]
) {
	return {
		toolName: `tool:${key}`,
		state,
		work: { key, v: 1 } as const,
	};
}
