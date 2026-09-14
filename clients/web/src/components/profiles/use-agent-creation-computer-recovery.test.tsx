import {
	type LocalAgentCatalogCapability,
	projectLocalAgentCatalogFromCapabilities,
	resolveSelectableCandidates,
} from "@openmeld/agent-runtime";
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	agentCreationComputerFixture,
	agentCreationRecoveryFixture,
} from "#/test-support/agent-creation-computer-fixtures";
import { AgentCreationComputerRecoveryPanel } from "./agent-creation-computer-recovery";
import { useAgentCreationComputerRecovery } from "./use-agent-creation-computer-recovery";

afterEach(cleanup);

describe("Agent creation computer recovery", () => {
	it.each([
		["connect_computer", false, "connect"],
		["connect_computer", true, "connect"],
		["check_failed", true, "check_failed"],
		["checking", true, "checking"],
		["set_up_local_agents", true, "local_agents"],
	] as const)("presents %s with saved computer %s as %s", (guidance, saved, expected) => {
		const onRetry = vi.fn();
		const { result } = renderHook(() =>
			useAgentCreationComputerRecovery({
				enabled: true,
				orgSlug: "acme",
				recovery: agentCreationRecoveryFixture({
					computers: saved ? [agentCreationComputerFixture()] : [],
					deviceId: saved ? "office-mac" : null,
					onSelect: vi.fn(),
				}),
				guidance,
				hasLocalAgents: false,
				isPending: false,
				onRetry,
			})
		);
		expect(result.current.computerRecovery?.state).toBe(expected);
		expect(Boolean(result.current.computerRecovery?.setup)).toBe(
			guidance === "connect_computer"
		);
		if (guidance === "check_failed") {
			act(() => result.current.computerRecovery?.onStart());
			expect(onRetry).toHaveBeenCalledOnce();
			expect(result.current.computerRecovery?.setup).toBeUndefined();
		}
	});
	it.each([
		null,
		"office-mac",
	])("does not attach a new machine to the sole offline account Computer (routing=%s)", (deviceId) => {
		const { result } = renderHook(() =>
			useAgentCreationComputerRecovery({
				enabled: true,
				recovery: agentCreationRecoveryFixture({
					computers: [agentCreationComputerFixture()],
					deviceId,
					onSelect: vi.fn(),
				}),
				guidance: "connect_computer",
				hasLocalAgents: false,
				isPending: false,
				onRetry: vi.fn(),
			})
		);
		const provider = result.current.computerRecovery?.setup as ReactElement<{
			routeIntent: { connectedComputerId?: string };
		}>;
		expect(result.current.computerRecovery?.state).toBe("connect");
		expect(provider.props.routeIntent.connectedComputerId).toBeUndefined();
		expect(result.current.reconnectComputerId).toBeUndefined();
		render(result.current.computerRecovery?.computerChoices);
		expect(screen.getByDisplayValue("Connect a new computer")).toBe(
			screen.getByRole("combobox", { name: "Computer to reconnect" })
		);
	});
	// The Service sync filters unregistered controllers and submits no report
	// when none are installed. Thus both fresh/no-report and checked/no-install
	// reach the catalog projector with []: neither proves an installation result.
	it.each<{ scenario: string; capabilities: LocalAgentCatalogCapability[] }>([
		{ scenario: "new computer before its first report", capabilities: [] },
		{
			scenario: "no installed controllers (sync submits no reports)",
			capabilities: [],
		},
		{
			scenario: "reported controller with unknown status",
			capabilities: [
				{
					agentControllerRef: "builtin:codex",
					status: "unknown",
					enabled: true,
				},
			],
		},
		{
			scenario: "discovered ready controller",
			capabilities: [
				{ agentControllerRef: "builtin:codex", status: "ready", enabled: true },
			],
		},
	])("uses real catalog projections for $scenario", ({ capabilities }) => {
		const catalog = projectLocalAgentCatalogFromCapabilities({ capabilities });
		const candidates = resolveSelectableCandidates(
			catalog.entries.map((entry) => ({ ...entry, registered: entry.detected }))
		);
		const { result } = renderHook(() =>
			useAgentCreationComputerRecovery({
				enabled: true,
				recovery: agentCreationRecoveryFixture({
					computers: [agentCreationComputerFixture()],
					deviceId: "office-mac",
					onSelect: vi.fn(),
				}),
				guidance: "set_up_local_agents",
				hasLocalAgents: candidates.length > 0,
				isPending: false,
				onRetry: vi.fn(),
			})
		);
		if (capabilities[0]?.status === "ready") {
			expect(result.current.computerRecovery).toBeUndefined();
			return;
		}
		const recovery = result.current.computerRecovery;
		if (!recovery) {
			throw new Error("Expected recovery guidance for unavailable details");
		}
		render(<AgentCreationComputerRecoveryPanel recovery={recovery} />);
		expect(
			screen.getByText("Local agent details aren’t available")
		).toBeTruthy();
		expect(screen.queryByText("No supported agents detected")).toBeNull();
		expect(
			screen.getByText(
				"If you haven’t installed a local agent, install one such as Codex or Claude Code, then check again."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", {
					name: "See the install guide (opens in a new tab)",
				})
				.getAttribute("href")
		).toBe("/guides/local-agents");
	});
	it("needs no computer setup when the selected computer has local agents", () => {
		const { result } = renderHook(() =>
			useAgentCreationComputerRecovery({
				enabled: true,
				recovery: agentCreationRecoveryFixture({
					computers: [agentCreationComputerFixture()],
					deviceId: "office-mac",
					onSelect: vi.fn(),
				}),
				guidance: "set_up_local_agents",
				hasLocalAgents: true,
				isPending: false,
				onRetry: vi.fn(),
			})
		);
		expect(result.current.computerRecovery).toBeUndefined();
	});
	it("pins recovery to the selected stable computer, then follows its verified new runtime", () => {
		const onSelect = vi.fn();
		const onRetry = vi.fn();
		const { result } = renderHook(() =>
			useAgentCreationComputerRecovery({
				enabled: true,
				orgSlug: "acme",
				recovery: agentCreationRecoveryFixture({
					computers: [
						agentCreationComputerFixture("Other Mac", "other-mac"),
						agentCreationComputerFixture(),
					],
					deviceId: "office-mac",
					onSelect,
				}),
				guidance: "connect_computer",
				hasLocalAgents: false,
				isPending: false,
				onRetry,
			})
		);
		render(result.current.computerRecovery?.computerChoices);
		fireEvent.change(
			screen.getByRole("combobox", { name: "Computer to reconnect" }),
			{ target: { value: "office-mac" } }
		);
		const provider = result.current.computerRecovery?.setup as ReactElement<{
			routeIntent: { connectedComputerId: string };
			children: ReactElement<{ onCompleted: (snapshot: unknown) => void }>;
		}>;
		expect(provider.props.routeIntent.connectedComputerId).toBe(
			"computer-office-mac"
		);
		act(() =>
			provider.props.children.props.onCompleted({
				deviceId: "office-mac-reinstalled",
				runtimeLane: "dev-local",
			})
		);
		expect(onSelect).toHaveBeenCalledWith({
			deviceId: "office-mac-reinstalled",
			runtimeLane: "dev-local",
		});
		expect(onRetry).toHaveBeenCalledOnce();
		// Keep the workflow visible until the owning readiness projection refreshes.
		expect(result.current.computerRecovery?.setup).toBeTruthy();
	});
	it("shows setup immediately when open and never mounts it while closed", () => {
		const base = {
			orgSlug: "acme",
			recovery: agentCreationRecoveryFixture({
				computers: [agentCreationComputerFixture()],
				deviceId: "office-mac",
				onSelect: vi.fn(),
			}),
			guidance: "connect_computer" as const,
			hasLocalAgents: true,
			isPending: false,
			onRetry: vi.fn(),
		};
		const { result, rerender } = renderHook(
			({ enabled }) => useAgentCreationComputerRecovery({ ...base, enabled }),
			{ initialProps: { enabled: true } }
		);
		expect(result.current.computerRecovery?.setup).toBeTruthy();
		rerender({ enabled: false });
		expect(result.current.computerRecovery).toBeUndefined();
		rerender({ enabled: true });
		expect(result.current.computerRecovery?.setup).toBeTruthy();
	});
});
