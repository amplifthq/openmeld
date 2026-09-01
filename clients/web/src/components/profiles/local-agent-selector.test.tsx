import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAgentSelector } from "./local-agent-selector";

const CODEX_RADIO_NAME = /codex on this computer/i;
const CLAUDE_CODE_RADIO_NAME = /claude code on this computer/i;

const CHOICES = [
	{
		agentId: "codex",
		description: "Codex on this computer.",
		label: "Codex",
		value: "codex",
	},
	{
		agentId: "claude-code",
		description: "Claude Code on this computer.",
		label: "Claude Code",
		value: "claude-code",
	},
];

afterEach(cleanup);

describe("LocalAgentSelector", () => {
	it("renders a semantic single-choice control and selects by click", () => {
		const onChange = vi.fn();
		render(
			<LocalAgentSelector
				choices={CHOICES}
				disabled={false}
				isResolving={false}
				onChange={onChange}
				value="codex"
			/>
		);

		expect(
			screen.getByRole("group", { name: "Choose a local agent" })
		).toBeTruthy();
		expect(
			(
				screen.getByRole("radio", {
					name: CODEX_RADIO_NAME,
				}) as HTMLInputElement
			).checked
		).toBe(true);
		fireEvent.click(
			screen.getByRole("radio", { name: CLAUDE_CODE_RADIO_NAME })
		);
		expect(onChange).toHaveBeenCalledWith("claude-code");
	});

	it("keeps the choices in one native radio group for keyboard navigation", () => {
		const onChange = vi.fn();
		render(
			<LocalAgentSelector
				choices={CHOICES}
				disabled={false}
				isResolving={false}
				onChange={onChange}
				value="codex"
			/>
		);

		const codex = screen.getByRole<HTMLInputElement>("radio", {
			name: CODEX_RADIO_NAME,
		});
		const claudeCode = screen.getByRole<HTMLInputElement>("radio", {
			name: CLAUDE_CODE_RADIO_NAME,
		});
		expect(codex.name).toBe(claudeCode.name);
		claudeCode.focus();
		fireEvent.click(claudeCode);
		expect(onChange).toHaveBeenCalledWith("claude-code");
	});

	it("explains the empty state without inventing an available agent", () => {
		render(
			<LocalAgentSelector
				choices={[]}
				disabled={false}
				isResolving={false}
				onChange={vi.fn()}
				value=""
			/>
		);

		expect(screen.getByText("No local agents are available")).toBeTruthy();
		expect(screen.queryByRole("radio")).toBeNull();
	});
});
