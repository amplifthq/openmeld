import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CenterAgentComputerSetupCard } from "./center-agent-computer-setup-card";

const computerSetupFlowMock = vi.hoisted(() => vi.fn());

vi.mock("#/components/connect/bring-agents-setup-context", () => ({
	BringAgentsSetupProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("#/components/connect/computer-setup-conversation-shell", () => ({
	ComputerSetupConversationShell: ({
		children,
		title,
	}: {
		children: ReactNode;
		title: string;
	}) => (
		<section data-slot="computer-setup-flow">
			<h3>{title}</h3>
			{children}
		</section>
	),
}));

vi.mock("#/components/connect/start-bring-agents-setup-page", () => ({
	ComputerSetupFlow: (input: unknown) => {
		computerSetupFlowMock(input);
		return <div data-testid="live-computer-setup">Live setup</div>;
	},
}));

describe("CenterAgentComputerSetupCard", () => {
	beforeEach(() => {
		localStorage.clear();
		computerSetupFlowMock.mockClear();
	});

	afterEach(() => {
		cleanup();
	});

	it("requires an explicit resume before remounting a setup action's live flow", async () => {
		const props = {
			context: {
				orgSlug: "acme",
				profileId: "human-profile-1",
				spaceId: "center-agent-dm-1",
			},
			sourceSignalId: "setup-action-1",
			target: {
				kind: "computer_setup" as const,
				mode: "reconnect" as const,
				connectedComputerId: "computer-1",
			},
		};
		const first = render(
			<StrictMode>
				<CenterAgentComputerSetupCard {...props} />
			</StrictMode>
		);

		await waitFor(() => {
			expect(screen.getByTestId("live-computer-setup")).toBeTruthy();
		});
		first.unmount();
		computerSetupFlowMock.mockClear();

		render(<CenterAgentComputerSetupCard {...props} />);

		expect(screen.queryByTestId("live-computer-setup")).toBeNull();
		expect(computerSetupFlowMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
		expect(screen.getByTestId("live-computer-setup")).toBeTruthy();
	});

	it("pauses when another browser already started the same setup action", async () => {
		render(
			<CenterAgentComputerSetupCard
				context={{
					orgSlug: "acme",
					profileId: "human-profile-1",
					spaceId: "center-agent-dm-1",
				}}
				sourceSignalId="setup-action-cross-browser"
				target={{ kind: "computer_setup", mode: "setup" }}
			/>
		);

		await waitFor(() => {
			expect(screen.getByTestId("live-computer-setup")).toBeTruthy();
		});
		const automaticFlowProps = computerSetupFlowMock.mock.lastCall?.[0] as {
			onNavigationActionAlreadyStarted: () => void;
			sourceNavigationAction: {
				signalId: string;
				spaceId: string;
			};
		};
		expect(automaticFlowProps.sourceNavigationAction).toEqual({
			signalId: "setup-action-cross-browser",
			spaceId: "center-agent-dm-1",
		});

		act(() => {
			automaticFlowProps.onNavigationActionAlreadyStarted();
		});

		expect(screen.queryByTestId("live-computer-setup")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
		expect(screen.getByTestId("live-computer-setup")).toBeTruthy();
		expect(computerSetupFlowMock.mock.lastCall?.[0]).not.toHaveProperty(
			"sourceNavigationAction"
		);
	});

	it("mounts the shared flow without a separate conversation continuation action", async () => {
		render(
			<CenterAgentComputerSetupCard
				context={{
					orgSlug: "acme",
					profileId: "human-profile-1",
					spaceId: "center-agent-dm-1",
				}}
				sourceSignalId="setup-action-2"
				target={{ kind: "computer_setup", mode: "setup" }}
			/>
		);

		await waitFor(() => {
			expect(computerSetupFlowMock).toHaveBeenCalledWith(
				expect.objectContaining({
					autoReturnOnCompletion: false,
					orgSlug: "acme",
					presentation: "conversation",
				})
			);
		});
		expect(computerSetupFlowMock.mock.lastCall?.[0]).not.toHaveProperty(
			"onContinue"
		);
	});
});
