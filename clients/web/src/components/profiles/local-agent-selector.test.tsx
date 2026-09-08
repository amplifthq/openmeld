import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAgentSelector } from "./local-agent-selector";

const CODEX_RADIO_NAME = /^codex$/i;
const CLAUDE_CODE_RADIO_NAME = /^claude code$/i;

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
	it("keeps a reported check in progress distinct from failed or missing setup", () => {
		render(
			<LocalAgentSelector
				choices={[]}
				disabled={false}
				emptyState={{
					kind: "checking",
					centerAgentHref: null,
					primaryActionHref: null,
				}}
				isResolving={false}
				onChange={vi.fn()}
				value=""
			/>
		);
		expect(screen.getByRole("status").textContent).toContain(
			"Waiting for this computer"
		);
		expect(
			screen.queryByRole("button", { name: "Retry local agent check" })
		).toBeNull();
		expect(screen.queryByText("Set up local agents")).toBeNull();
	});
	it("does not ask to connect while local agents are still being checked", () => {
		const props = {
			choices: [],
			disabled: false,
			isResolving: true,
			onChange: vi.fn(),
			value: "",
			surface: "page" as const,
			emptyState: {
				kind: "connect_computer" as const,
				primaryActionHref: "/o/acme/connect",
				centerAgentHref: null,
			},
		};
		const { rerender } = render(<LocalAgentSelector {...props} />);
		expect(
			screen.getByRole("status", { name: "Checking available local agents" })
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Connect Computer" })).toBeNull();
		rerender(<LocalAgentSelector {...props} isResolving={false} />);
		expect(
			screen
				.getByRole("link", { name: "Connect Computer" })
				.getAttribute("href")
		).toBe("/o/acme/connect");
	});
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
			screen.getByRole("group", {
				name: "Choose a local agent",
			})
		).toBeTruthy();
		expect(
			(
				screen.getByRole("radio", {
					name: CODEX_RADIO_NAME,
				}) as HTMLInputElement
			).checked
		).toBe(true);
		expect(
			document.querySelector('[data-slot="magnifying-dock-item-caption"]')
				?.textContent
		).toBe("Codex");
		expect(screen.queryByText("Codex on this computer.")).toBeNull();
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

	it("guides a connected computer to set up local agents", () => {
		render(
			<LocalAgentSelector
				choices={[]}
				disabled={false}
				emptyState={{
					centerAgentHref: null,
					kind: "set_up_local_agents",
					primaryActionHref: null,
				}}
				isResolving={false}
				onChange={vi.fn()}
				value=""
			/>
		);

		expect(screen.getByText("Set up local agents")).toBeTruthy();
		expect(
			screen.getByText(
				"No local agents are available to select. Set up a local agent such as Codex or Claude Code, then return to finish creating your Agent."
			)
		).toBeTruthy();
		expect(screen.queryByRole("radio")).toBeNull();
	});

	it("guides a computer-less account to Connect Computer", () => {
		render(
			<LocalAgentSelector
				choices={[]}
				disabled={false}
				emptyState={{
					centerAgentHref: null,
					kind: "connect_computer",
					primaryActionHref: null,
				}}
				isResolving={false}
				onChange={vi.fn()}
				surface="page"
				value=""
			/>
		);

		expect(screen.getByText("Connect Computer")).toBeTruthy();
		expect(
			screen.getByText(
				"Connect a computer so OpenMeld can check its local agents. Then return to finish creating your Agent."
			)
		).toBeTruthy();
		expect(screen.queryByRole("radio")).toBeNull();
	});
});
