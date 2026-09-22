import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
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

	it("keeps known choices selectable while their current status loads", () => {
		render(
			<LocalAgentSelector
				choices={CHOICES}
				disabled={false}
				isResolving
				onChange={vi.fn()}
				selectionState={{
					agentId: "codex",
					blocksCreation: true,
					displayName: "Codex",
					kind: "checking",
				}}
				value="codex"
			/>
		);

		expect(screen.getAllByRole("radio")).toHaveLength(2);
		expect(screen.getByRole("radio", { name: CODEX_RADIO_NAME })).toBeTruthy();
		expect(screen.getByLabelText("Checking Codex")).toBeTruthy();
	});

	it("links an uninstalled selection to its exact install guide", () => {
		render(
			<LocalAgentSelector
				choices={CHOICES}
				disabled={false}
				isResolving={false}
				onChange={vi.fn()}
				selectionState={{
					agentId: "claude-code",
					blocksCreation: true,
					displayName: "Claude Code",
					guideHref: "/guides/local-agents/claude-code",
					kind: "not_installed",
				}}
				value="claude-code"
			/>
		);

		expect(
			screen.getByText("Install Claude Code on this computer.")
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open install guide" })
				.getAttribute("href")
		).toBe("/guides/local-agents/claude-code");
	});

	it("turns on the exact disabled local agent inline and settles pending state", async () => {
		const onEnable = vi.fn().mockResolvedValue(undefined);
		render(
			<LocalAgentSelector
				choices={CHOICES}
				disabled={false}
				isResolving={false}
				onChange={vi.fn()}
				selectionState={{
					agentId: "codex",
					blocksCreation: true,
					canEnable: true,
					displayName: "Codex",
					kind: "disabled",
					onEnable,
				}}
				value="codex"
			/>
		);

		fireEvent.click(screen.getByRole("switch", { name: "Enable Codex" }));
		expect(onEnable).toHaveBeenCalledOnce();
		await waitFor(() =>
			expect(
				screen
					.getByRole("switch", { name: "Enable Codex" })
					.hasAttribute("data-unchecked")
			).toBe(true)
		);
	});

	it("does not carry a pending enable request to another local agent", () => {
		let finishEnable: (() => void) | undefined;
		const onEnable = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishEnable = resolve;
				})
		);
		const props = {
			choices: CHOICES,
			disabled: false,
			isResolving: false,
			onChange: vi.fn(),
			selectionState: {
				agentId: "codex",
				blocksCreation: true,
				canEnable: true,
				displayName: "Codex",
				kind: "disabled" as const,
				onEnable,
				selectionKey: "computer-1:dev-local:codex",
			},
			value: "codex",
		};
		const { rerender } = render(<LocalAgentSelector {...props} />);

		fireEvent.click(screen.getByRole("switch", { name: "Enable Codex" }));
		expect(
			screen
				.getByRole("switch", { name: "Enable Codex" })
				.hasAttribute("data-checked")
		).toBe(true);

		rerender(
			<LocalAgentSelector
				{...props}
				selectionState={{
					...props.selectionState,
					agentId: "claude-code",
					displayName: "Claude Code",
					onEnable: vi.fn().mockResolvedValue(undefined),
					selectionKey: "computer-1:dev-local:claude-code",
				}}
				value="claude-code"
			/>
		);

		expect(
			screen
				.getByRole("switch", { name: "Enable Claude Code" })
				.hasAttribute("data-unchecked")
		).toBe(true);
		finishEnable?.();
	});

	it("does not show a late enable error on another computer", async () => {
		let rejectEnable: ((error: Error) => void) | undefined;
		const onEnable = vi.fn(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectEnable = reject;
				})
		);
		const props = {
			choices: CHOICES,
			disabled: false,
			isResolving: false,
			onChange: vi.fn(),
			selectionState: {
				agentId: "codex",
				blocksCreation: true,
				canEnable: true,
				displayName: "Codex",
				kind: "disabled" as const,
				onEnable,
				selectionKey: "computer-1:dev-local:codex",
			},
			value: "codex",
		};
		const { rerender } = render(<LocalAgentSelector {...props} />);

		fireEvent.click(screen.getByRole("switch", { name: "Enable Codex" }));
		rerender(
			<LocalAgentSelector
				{...props}
				selectionState={{
					...props.selectionState,
					onEnable: vi.fn().mockResolvedValue(undefined),
					selectionKey: "computer-2:dev-local:codex",
				}}
			/>
		);
		rejectEnable?.(new Error("Computer 1 rejected the request"));

		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(
			screen
				.getByRole("switch", { name: "Enable Codex" })
				.hasAttribute("data-unchecked")
		).toBe(true);
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
				"No local agents are available to select. Set up a supported local agent, then return to finish creating your Agent."
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
			screen.getByText("Connect a computer to choose a local agent.")
		).toBeTruthy();
		expect(screen.queryByRole("radio")).toBeNull();
	});
});
