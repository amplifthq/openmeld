import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	agentCreationComputerFixture,
	agentCreationRecoveryFixture,
} from "#/test-support/agent-creation-computer-fixtures";
import { useAgentCreationComputerRecovery } from "./use-agent-creation-computer-recovery";

afterEach(cleanup);

describe("Agent creation computer recovery", () => {
	it.each([
		["connect_computer", false, "connect"],
		["connect_computer", true, "reconnect"],
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
		if (guidance === "check_failed") {
			act(() => result.current.computerRecovery?.onStart());
			expect(onRetry).toHaveBeenCalledOnce();
			expect(result.current.computerRecovery?.setup).toBeUndefined();
		}
	});
	it("starts a new connection without reusing the existing computer identity", () => {
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
		const button = result.current.connectAnotherComputer as ReactElement<{
			onClick: () => void;
		}>;
		act(() => button.props.onClick());
		expect(result.current.computerRecovery?.state).toBe("connect");
		expect(result.current.computerRecovery?.computerName).toBeUndefined();
		const provider = result.current.computerRecovery?.setup as ReactElement<{
			routeIntent: { connectedComputerId?: string };
		}>;
		expect(provider.props.routeIntent.connectedComputerId).toBeUndefined();
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
		act(() => result.current.computerRecovery?.onStart());
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
		expect(result.current.computerRecovery?.setup).toBeUndefined();
	});
	it("does not mount a setup session before an explicit action and clears it on close", () => {
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
		expect(result.current.computerRecovery?.setup).toBeUndefined();
		act(() => result.current.computerRecovery?.onStart());
		expect(result.current.computerRecovery?.setup).toBeTruthy();
		rerender({ enabled: false });
		rerender({ enabled: true });
		expect(result.current.computerRecovery?.setup).toBeUndefined();
	});
});
