import { resolveAgentWakeAvailability } from "@openmeld/agent-runtime";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
	CurrentDeviceTargetResponse,
	CurrentLocalRuntimeReplyReadinessResponse,
	GetAgentExecutionReadinessResponse,
	LocalCliComponentUpdateProjection,
	LocalRuntimesResponse,
	LocalServiceComponentUpdateProjection,
	PrepareSessionSnapshot,
	PrepareSetupBootstrapResult,
} from "@openmeld/schemas/types";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StartFlowStateProvider } from "#/components/app/start-flow-state";
import type { ConnectRouteIntent } from "#/lib/connect/connect-route";
import type { SessionExpiredState } from "#/lib/session-expired";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE } from "./service-update-verification";
import {
	ComputerSetupFlow,
	StartBringAgentsSetupPage,
} from "./start-bring-agents-setup-page";

const createPrepareSessionMock = vi.hoisted(() => vi.fn());
const mintPrepareSessionTokenMock = vi.hoisted(() => vi.fn());
const readPrepareSessionMock = vi.hoisted(() => vi.fn());
const buildWebSetupCommandMock = vi.hoisted(() => vi.fn());
const copyCliEntryCommandMock = vi.hoisted(() => vi.fn());
const createComputerAuthorizationMutateAsyncMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const useBringAgentsSetupContextMock = vi.hoisted(() => vi.fn());
const ACTIVE_PREPARE_TOKEN_PATTERN = /preptok_active/u;
const COMPLETED_PREPARE_TOKEN_PATTERN = /preptok_completed/u;
const REFRESHED_PREPARE_TOKEN_PATTERN = /preptok_refreshed/u;
const SETUP_COMMAND_COPY = /setup command/i;
const UNUSABLE_COMMAND_PATTERN = /preptok_unusable/u;
const NEW_ATTEMPT_COMMAND_PATTERN = /preptok_new_attempt/u;

type PrepareLocalAgentCatalogEntry = NonNullable<
	PrepareSessionSnapshot["localAgentCatalog"]
>["entries"][number];

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		to,
	}: {
		children: ReactNode;
		className?: string;
		to: string;
	}) => (
		<a className={className} href={to}>
			{children}
		</a>
	),
	useNavigate: () => navigateMock,
}));

vi.mock("#/lib/cli-entry-command", () => ({
	buildWebSetupCommand: buildWebSetupCommandMock,
	copyCliEntryCommand: copyCliEntryCommandMock,
	resolveBrowserSetupCommandPlatform: () => "posix",
}));

vi.mock("#/query/auth-query", () => ({
	createComputerAuthorizationGrant: createComputerAuthorizationMutateAsyncMock,
}));

vi.mock("#/query/connect/prepare-session", () => ({
	createPrepareSession: createPrepareSessionMock,
	mintPrepareSessionToken: mintPrepareSessionTokenMock,
	readPrepareSession: readPrepareSessionMock,
}));

vi.mock("sonner", () => ({
	toast: { success: toastSuccessMock },
}));

vi.mock("./bring-agents-setup-context", () => ({
	useBringAgentsSetupContext: useBringAgentsSetupContextMock,
}));

class MockWebSocket {
	static readonly OPEN = 1;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onopen: (() => void) | null = null;
	readonly readyState = MockWebSocket.OPEN;
	readonly url: string;

	constructor(url: string) {
		this.url = url;
	}

	addEventListener(type: string, listener: () => void) {
		if (type === "open") {
			window.queueMicrotask(listener);
		}
	}

	close() {
		return undefined;
	}

	send() {
		return undefined;
	}
}

class ClosingMockWebSocket extends MockWebSocket {
	constructor(url: string) {
		super(url);
		window.setTimeout(() => {
			this.onopen?.();
			this.onclose?.();
		}, 0);
	}
}

class ControlledMockWebSocket extends MockWebSocket {
	static latest: ControlledMockWebSocket | null = null;

	constructor(url: string) {
		super(url);
		ControlledMockWebSocket.latest = this;
		window.queueMicrotask(() => this.onopen?.());
	}

	disconnectFromServer() {
		this.onclose?.();
	}

	emitSnapshot(snapshot: PrepareSessionSnapshot) {
		this.onmessage?.({
			data: JSON.stringify({
				payload: { snapshot },
				type: "snapshot_changed",
			}),
		});
	}
}

describe("StartBringAgentsSetupPage completion actions", () => {
	beforeEach(() => {
		ControlledMockWebSocket.latest = null;
		navigateMock.mockReset().mockResolvedValue(undefined);
		createPrepareSessionMock
			.mockReset()
			.mockImplementation((input: { targetSpaceId: string | null }) =>
				Promise.resolve({
					opaqueToken: "preptok_ready",
					opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
					snapshot: createReadySnapshot({
						targetSpaceId: input.targetSpaceId,
					}),
				})
			);
		mintPrepareSessionTokenMock.mockReset().mockResolvedValue({
			opaqueToken: "preptok_restored",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot(),
		});
		readPrepareSessionMock.mockReset().mockResolvedValue({
			snapshot: createReadySnapshot(),
		});
		buildWebSetupCommandMock
			.mockReset()
			.mockImplementation(
				(input: { deviceCode?: string; startSession: string }) => {
					let command = `openmeld-dev setup --start-session ${input.startSession}`;
					if (input.deviceCode) {
						command += ` --device-code ${input.deviceCode}`;
					}
					return command;
				}
			);
		copyCliEntryCommandMock.mockReset().mockResolvedValue(true);
		toastSuccessMock.mockReset();
		createComputerAuthorizationMutateAsyncMock.mockReset().mockResolvedValue({
			deviceCode: "device_ready",
			expiresIn: 180,
		});
		useBringAgentsSetupContextMock.mockReset().mockReturnValue(
			createSetupContext({
				kind: "account_computer_setup",
				resetThisComputer: false,
			})
		);
		vi.stubGlobal("WebSocket", MockWebSocket);
	});

	afterEach(() => {
		cleanup();
		window.localStorage.clear();
		window.sessionStorage.clear();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it.each([
		"prepare.account_switch_cancelled",
		"prepare.authorization_failed",
	])("replaces the unusable command with a retry after %s", async (reasonCode) => {
		const snapshot = createTerminalDisconnectedSnapshot();
		snapshot.targetSpaceId = null;
		snapshot.phase = "blocked";
		snapshot.blockers = [
			{
				blockerId: "handoff-stopped",
				stepId: "connect_terminal",
				reasonCode,
				message: "The current computer connection was not changed.",
				severity: "user_action_required",
				retryAction: "refresh",
				createdAt: snapshot.updatedAt,
			},
		];
		snapshot.steps = snapshot.steps.map((step) =>
			step.id === "connect_terminal"
				? { ...step, state: "blocked", blockerReasonCode: reasonCode }
				: step
		);
		createPrepareSessionMock.mockResolvedValueOnce({
			snapshot,
			opaqueToken: "preptok_unusable",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
		});
		renderPreparePage();
		const retry = await screen.findByRole("button", {
			name: "Get a new setup command",
		});
		expect(screen.queryByText(UNUSABLE_COMMAND_PATTERN)).toBeNull();
		expect(copyCliEntryCommandMock).not.toHaveBeenCalled();
		const next = createTerminalDisconnectedSnapshot();
		next.targetSpaceId = null;
		next.prepareSessionId = "prepare-new-attempt";
		createPrepareSessionMock.mockResolvedValueOnce({
			snapshot: next,
			opaqueToken: "preptok_new_attempt",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
		});
		fireEvent.click(retry);
		await screen.findByText(NEW_ATTEMPT_COMMAND_PATTERN);
	});

	it("returns direct computer setup back to Computers", async () => {
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				kind: "account_computer_setup",
				resetThisComputer: false,
			})
		);
		renderPreparePage();

		expect(
			await screen.findByText(
				"Computer connected. Local agents will sync in the background. Continue, or reconnect this computer."
			)
		).toBeTruthy();

		expect(
			screen
				.getByRole("link", { name: "Back to Computers" })
				.getAttribute("href")
		).toBe("/o/acme/computers?focus=service&refresh=setup-complete");
	});

	it("shows the normal Computers return action before auto-returning completed setup", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_completed",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				setupBootstrap: createCompletedSetupBootstrapResult(),
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{ refreshAll }
			)
		);

		renderPreparePage();

		expect(
			(
				await screen.findByRole("link", {
					name: "Back to Computers",
				})
			).getAttribute("href")
		).toBe("/o/acme/computers?focus=service&refresh=setup-complete");
		expect(screen.getByText("Computer connected")).toBeTruthy();
		expect(
			screen.queryByRole("link", { name: "Open OpenMeld Welcoming Space" })
		).toBeNull();
		expect(
			Array.from(document.querySelectorAll("button,a"))
				.map((element) => element.textContent?.trim())
				.filter((label) =>
					["Set up again", "Back to Computers"].includes(label ?? "")
				)
		).toEqual(["Set up again", "Back to Computers"]);
		await waitFor(() => {
			expect(refreshAll).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/computers?focus=service&refresh=setup-complete",
			});
		});
	});

	it("shows completed direct setup without waiting for retired setup bootstrap", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_completed",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				prepareSessionId: "prepare-bootstrap",
				targetSpaceId: null,
			}),
		});

		renderPreparePage({ autoReturnOnCompletion: false });

		expect(
			(
				await screen.findByRole("link", {
					name: "Back to Computers",
				})
			).getAttribute("href")
		).toBe("/o/acme/computers?focus=service&refresh=setup-complete");
		expect(
			screen.queryByRole("link", { name: "Open OpenMeld Welcoming Space" })
		).toBeNull();
		expect(readPrepareSessionMock).not.toHaveBeenCalled();
	});

	it("auto-returns completed direct setup without waiting for retired setup bootstrap", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_completed",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				prepareSessionId: "prepare-bootstrap",
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{ refreshAll }
			)
		);

		renderPreparePage();

		expect(
			(
				await screen.findByRole("link", {
					name: "Back to Computers",
				})
			).getAttribute("href")
		).toBe("/o/acme/computers?focus=service&refresh=setup-complete");
		expect(
			screen.queryByRole("link", { name: "Open OpenMeld Welcoming Space" })
		).toBeNull();
		expect(readPrepareSessionMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(refreshAll).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/computers?focus=service&refresh=setup-complete",
			});
		});
	});

	it("automatically returns direct computer setup to Computers after completion refresh", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_completed",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				setupBootstrap: createFailedSetupBootstrapResult(),
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{ refreshAll }
			)
		);

		renderPreparePage();

		await waitFor(() => {
			expect(refreshAll).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/computers?focus=service&refresh=setup-complete",
				replace: true,
			});
		});
	});

	it("keeps standalone App Connect completion visible until the user returns", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{ refreshAll }
			)
		);

		renderPreparePage({ autoReturnOnCompletion: false });

		await waitFor(() => {
			expect(refreshAll).toHaveBeenCalledTimes(1);
		});
		expect(
			screen
				.getByRole("link", { name: "Back to Computers" })
				.getAttribute("href")
		).toBe("/o/acme/computers?focus=service&refresh=setup-complete");
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("shows the current completed direct setup while current computer facts are still refreshing", async () => {
		const refreshAll = vi.fn(() => new Promise<void>(() => undefined));
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_completed",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					deviceId: null,
					refreshAll,
					runtimeLane: null,
				}
			)
		);

		renderPreparePage();

		expect(
			await screen.findByText("Checking agent availability.")
		).toBeTruthy();
		expect(screen.queryByText("Setup not finished yet.")).toBe(null);
		expect(screen.queryByText(COMPLETED_PREPARE_TOKEN_PATTERN)).toBeNull();
		expect(buildWebSetupCommandMock).not.toHaveBeenCalled();
		expect(refreshAll).toHaveBeenCalledTimes(1);
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("keeps setup complete when the completion refresh fails before current computer facts refresh", async () => {
		const refreshAll = vi
			.fn()
			.mockRejectedValue(new Error("current facts refresh failed"));
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_completed",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					deviceId: null,
					refreshAll,
					runtimeLane: null,
				}
			)
		);

		renderPreparePage();

		expect(
			await screen.findByText(
				"Computer connected. Agent availability could not refresh."
			)
		).toBeTruthy();
		expect(screen.queryByText("Setup not finished yet.")).toBe(null);
		expect(screen.queryByText(COMPLETED_PREPARE_TOKEN_PATTERN)).toBeNull();
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("reads the same Prepare Session on socket close before showing a fresh command", async () => {
		vi.stubGlobal("WebSocket", ClosingMockWebSocket);
		const refreshAll = vi.fn(() => new Promise<void>(() => undefined));
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_active",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createActiveSnapshot({
				deviceId: null,
				prepareSessionId: "prepare-active",
				runtimeLane: null,
				targetSpaceId: null,
			}),
		});
		readPrepareSessionMock.mockResolvedValueOnce({
			snapshot: createReadySnapshot({
				prepareSessionId: "prepare-active",
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					deviceId: null,
					refreshAll,
					runtimeLane: null,
				}
			)
		);

		renderPreparePage();

		expect(
			await screen.findByText("Checking agent availability.")
		).toBeTruthy();
		expect(readPrepareSessionMock).toHaveBeenCalledWith({
			prepareSessionId: "prepare-active",
		});
		await waitFor(() => expect(refreshAll).toHaveBeenCalledTimes(1));
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("does not automatically return direct computer setup to Computers when readiness refresh fails", async () => {
		const refreshAll = vi
			.fn()
			.mockRejectedValue(new Error("current facts refresh failed"));
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_ready",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				setupBootstrap: createFailedSetupBootstrapResult(),
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{ refreshAll }
			)
		);

		renderPreparePage();

		expect(
			await screen.findByText(
				"Computer connected. Agent availability could not refresh."
			)
		).toBeTruthy();
		await waitFor(() => {
			expect(refreshAll).toHaveBeenCalledTimes(1);
		});
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("does not automatically return direct computer setup from a stale completed session after the current computer changes", async () => {
		let resolveOldRefresh: () => void = () => undefined;
		const oldRefresh = new Promise<void>((resolve) => {
			resolveOldRefresh = resolve;
		});
		const oldRefreshAll = vi.fn().mockReturnValue(oldRefresh);
		const oldCompletedSnapshot = createReadySnapshot({
			deviceId: "device-old",
			prepareSessionId: "prepare-old-complete",
			runtimeLane: "dev-old",
			setupBootstrap: createFailedSetupBootstrapResult(),
			targetSpaceId: null,
		});
		const currentActiveSnapshot = createActiveSnapshot({
			prepareSessionId: "prepare-current-active",
			targetSpaceId: null,
		});
		createPrepareSessionMock
			.mockResolvedValueOnce({
				opaqueToken: "preptok_old",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				snapshot: oldCompletedSnapshot,
			})
			.mockResolvedValueOnce({
				opaqueToken: "preptok_current",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				snapshot: currentActiveSnapshot,
			});
		readPrepareSessionMock.mockImplementation(
			(input: { prepareSessionId: string }) => {
				if (input.prepareSessionId === "prepare-old-complete") {
					return Promise.resolve({ snapshot: oldCompletedSnapshot });
				}
				throw new Error(
					`Unexpected Prepare Session read: ${input.prepareSessionId}`
				);
			}
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					deviceId: "device-old",
					refreshAll: oldRefreshAll,
					runtimeLane: "dev-old",
				}
			)
		);

		const { rerender } = renderPreparePage();

		expect(
			await screen.findByText("Checking agent availability.")
		).toBeTruthy();
		await waitFor(() => {
			expect(oldRefreshAll).toHaveBeenCalledTimes(1);
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					deviceId: "device-current",
					refreshAll: vi.fn().mockResolvedValue(undefined),
					runtimeLane: "dev-local",
				}
			)
		);

		rerender(createPreparePageElement());
		resolveOldRefresh();

		await screen.findByText("Setup not finished yet.");
		expect(createPrepareSessionMock).toHaveBeenCalledWith({
			deviceId: null,
			humanProfileId: "11111111-1111-4111-8111-111111111111",
			runtimeLane: null,
			selectedLocalAgentIds: [],
			targetSpaceId: null,
		});
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("checks matching Agent Profiles after direct computer setup completes", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_ready",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				localAgentEntries: [
					buildLocalAgentCatalogEntry({
						agentId: "codex",
					}),
				],
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					agentExecutionReadinessByProfileId: new Map([
						[
							"agent-codex",
							buildAgentExecutionReadinessResponse({
								agentProfileId: "agent-codex",
							}),
						],
					]),
					agentProfiles: [
						buildAgentProfile({
							openMeldProfileId: "agent-codex",
						}),
					],
				}
			)
		);

		renderPreparePage();

		expect(await screen.findByText("Computer connected.")).toBeTruthy();
	});

	it("does not promise ready after direct computer setup when matching Core readiness still needs setup", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_ready",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				localAgentEntries: [
					buildLocalAgentCatalogEntry({
						agentId: "codex",
					}),
				],
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					agentExecutionReadinessByProfileId: new Map([
						[
							"agent-codex",
							buildAgentExecutionReadinessResponse({
								agentProfileId: "agent-codex",
								displayState: "not_ready",
								primaryAction: "run_prepare",
							}),
						],
					]),
					agentProfiles: [
						buildAgentProfile({
							openMeldProfileId: "agent-codex",
						}),
					],
				}
			)
		);

		renderPreparePage();

		expect(
			await screen.findByText(
				"Computer connected. Agent availability still needs 1 Agent Profile."
			)
		).toBeTruthy();
		expect(screen.queryByText("Computer connected.")).toBeTruthy();
	});

	it("ignores unrelated Agent Profiles when direct setup refreshes completion readiness", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_ready",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				localAgentEntries: [
					buildLocalAgentCatalogEntry({
						agentId: "codex",
					}),
				],
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					agentExecutionReadinessByProfileId: new Map([
						[
							"agent-codex",
							buildAgentExecutionReadinessResponse({
								agentProfileId: "agent-codex",
							}),
						],
						[
							"agent-claude",
							buildAgentExecutionReadinessResponse({
								agentProfileId: "agent-claude",
								agentControllerRef: "builtin:claude-code",
								displayState: "not_ready",
								primaryAction: "run_prepare",
							}),
						],
					]),
					agentProfiles: [
						buildAgentProfile({
							openMeldProfileId: "agent-codex",
						}),
						buildAgentProfile({
							openMeldProfileId: "agent-claude",
						}),
					],
				}
			)
		);

		renderPreparePage();

		expect(await screen.findByText("Computer connected.")).toBeTruthy();
		expect(
			screen.queryByText(
				"Computer connected. Agent availability still needs 1 Agent Profile."
			)
		).toBeNull();
	});

	it("starts a fresh direct setup when this computer reset is requested", async () => {
		const completedSnapshot = createReadySnapshot({ targetSpaceId: null });
		readPrepareSessionMock.mockResolvedValueOnce({
			snapshot: completedSnapshot,
		});
		window.localStorage.setItem(
			"openmeld.prepare.session.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: "preptok_completed",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				prepareSessionId: completedSnapshot.prepareSessionId,
				runtimeLane: "dev-local",
				targetSpaceId: null,
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				kind: "account_computer_setup",
				resetThisComputer: true,
			})
		);

		renderPreparePage();

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledWith({
				deviceId: null,
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				runtimeLane: null,
				selectedLocalAgentIds: [],
				targetSpaceId: null,
			});
		});
		expect(readPrepareSessionMock).not.toHaveBeenCalled();
	});

	it("keeps a fresh Add a Computer session when Terminal reports the new computer identity", async () => {
		const prepareSessionId = "prepare-add-computer";
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_add_computer",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				connectedComputerId: "computer-new",
				deviceId: "device-new-computer",
				prepareSessionId,
				runtimeLane: "prod",
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: true,
				},
				{
					deviceId: "device-existing-computer",
					runtimeLane: "prod",
				}
			)
		);

		renderPreparePage();

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledWith({
				deviceId: null,
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				runtimeLane: null,
				selectedLocalAgentIds: [],
				targetSpaceId: null,
			});
		});

		expect(
			await screen.findByRole("heading", { name: "Computer connected" })
		).toBeTruthy();
	});

	it("completes reconnect when OpenMeld Service reports a new device identity", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_reconnect",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				connectedComputerId: "computer-existing",
				deviceId: "device-after-reinstall",
				targetSpaceId: null,
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					connectedComputerId: "computer-existing",
					kind: "account_computer_setup",
					resetThisComputer: true,
				},
				{
					deviceId: "device-before-reinstall",
					runtimeLane: "dev-local",
				}
			)
		);

		renderPreparePage();

		expect(
			await screen.findByRole("heading", { name: "Computer connected" })
		).toBeTruthy();
		expect(createPrepareSessionMock).toHaveBeenCalledWith({
			connectedComputerId: "computer-existing",
			deviceId: null,
			humanProfileId: "11111111-1111-4111-8111-111111111111",
			runtimeLane: null,
			selectedLocalAgentIds: [],
			targetSpaceId: null,
		});
	});

	it("returns existing Space recovery back to the Space", async () => {
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				agentProfileIds: [],
				kind: "space_recovery",
				profileId: "profile-space-human",
				resetThisComputer: false,
				spaceId: "space-return",
			})
		);

		renderPreparePage();

		expect(
			await screen.findByText(
				"Computer connected. Local agents will sync in the background. Continue, or reconnect this computer."
			)
		).toBeTruthy();

		expect(
			screen.getByRole("link", { name: "Back to Space" }).getAttribute("href")
		).toBe("/o/acme/spaces/space-return?profileId=profile-space-human");
	});

	it("keeps a fresh reconnect flow inside the Center Agent conversation", async () => {
		const completedReconnectSnapshot = createReadySnapshot({
			connectedComputerId: "computer_1",
			deviceId: "device-after-reconnect",
			targetSpaceId: "center_agent_dm_1",
		});
		createPrepareSessionMock.mockResolvedValue({
			opaqueToken: "preptok_center_agent_reconnect",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: completedReconnectSnapshot,
		});
		readPrepareSessionMock.mockResolvedValue({
			snapshot: completedReconnectSnapshot,
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					agentProfileIds: [],
					connectedComputerId: "computer_1",
					kind: "space_recovery",
					profileId: "human_profile_1",
					resetThisComputer: true,
					spaceId: "center_agent_dm_1",
				},
				{
					deviceId: "device-before-reconnect",
					runtimeLane: "dev-local",
				}
			)
		);

		render(
			<TestQueryClientProvider>
				<StartFlowStateProvider>
					<ComputerSetupFlow
						autoReturnOnCompletion={false}
						orgSlug="acme"
						presentation="conversation"
					/>
				</StartFlowStateProvider>
			</TestQueryClientProvider>
		);

		expect(
			(await screen.findByLabelText("Computer setup")).getAttribute("data-slot")
		).toBe("computer-setup-flow");
		expect(screen.queryByRole("link", { name: "Back to Space" })).toBeNull();
		await waitFor(() => expect(createPrepareSessionMock).toHaveBeenCalled());
		expect(navigateMock).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Set up again" })).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Continue with Center Agent" })
		).toBeNull();
	});

	it("keeps sign-in recovery visible inside embedded onboarding setup", async () => {
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					sessionExpiredState: {
						ctaLabel: "Sign in again",
						href: "/login?redirect=%2Fo%2Facme%2Fonboarding",
						message: "Your session expired. Sign in again to continue.",
					},
				}
			)
		);

		render(
			<TestQueryClientProvider>
				<StartFlowStateProvider>
					<ComputerSetupFlow orgSlug="acme" presentation="embedded" />
				</StartFlowStateProvider>
			</TestQueryClientProvider>
		);

		expect(
			(await screen.findByRole("link", { name: "Sign in again" })).getAttribute(
				"href"
			)
		).toBe("/login?redirect=%2Fo%2Facme%2Fonboarding");
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
	});

	it("does not create another Terminal setup when embedded onboarding finds this computer connected", async () => {
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					currentLocalRuntimeReplyReadinessQuery: {
						data: buildCurrentLocalRuntimeReplyReadinessResponse(),
						isError: false,
						isPending: false,
						refetch: vi.fn().mockResolvedValue(undefined),
					},
				}
			)
		);

		render(createEmbeddedOnboardingComputerSetupElement());

		expect(await screen.findByText("Computer connected")).toBeTruthy();
		expect(screen.getByText("This computer")).toBeTruthy();
		expect(createPrepareSessionMock).not.toHaveBeenCalled();
		expect(screen.queryByText(SETUP_COMMAND_COPY)).toBeNull();
	});

	it("waits for computer inventory before deciding whether onboarding needs Terminal setup", async () => {
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					currentDeviceTargetQuery: {
						data: undefined,
						isError: false,
						isFetching: true,
						isPending: true,
						isSuccess: false,
					},
					currentLocalRuntimeReplyReadinessQuery: {
						data: undefined,
						isError: false,
						isFetching: false,
						isPending: true,
						refetch: vi.fn().mockResolvedValue(undefined),
					},
					deviceId: null,
					localRuntimesQuery: {
						data: undefined,
						isError: false,
						isFetching: true,
						isPending: true,
						isSuccess: false,
					},
					runtimeLane: null,
				}
			)
		);

		const view = render(createEmbeddedOnboardingComputerSetupElement());

		expect(await screen.findByText("Checking this computer…")).toBeTruthy();
		expect(createPrepareSessionMock).not.toHaveBeenCalled();

		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					currentLocalRuntimeReplyReadinessQuery: {
						data: buildDisconnectedCurrentLocalRuntimeReplyReadinessResponse(),
						isError: false,
						isFetching: false,
						isPending: false,
						refetch: vi.fn().mockResolvedValue(undefined),
					},
					localRuntimesQuery: {
						data: undefined,
						isError: false,
						isFetching: true,
						isPending: true,
						isSuccess: false,
					},
				}
			)
		);
		view.rerender(createEmbeddedOnboardingComputerSetupElement());

		expect(screen.getByText("Checking this computer…")).toBeTruthy();
		expect(createPrepareSessionMock).not.toHaveBeenCalled();

		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					currentLocalRuntimeReplyReadinessQuery: {
						data: undefined,
						isError: false,
						isFetching: false,
						isPending: true,
						refetch: vi.fn().mockResolvedValue(undefined),
					},
				}
			)
		);
		view.rerender(createEmbeddedOnboardingComputerSetupElement());

		expect(screen.getByText("Checking this computer…")).toBeTruthy();
		expect(createPrepareSessionMock).not.toHaveBeenCalled();

		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					currentLocalRuntimeReplyReadinessQuery: {
						data: buildCurrentLocalRuntimeReplyReadinessResponse(),
						isError: false,
						isFetching: false,
						isPending: false,
						refetch: vi.fn().mockResolvedValue(undefined),
					},
				}
			)
		);
		view.rerender(createEmbeddedOnboardingComputerSetupElement());

		expect(await screen.findByText("Computer connected")).toBeTruthy();
		expect(createPrepareSessionMock).not.toHaveBeenCalled();
	});

	it("fails closed when computer inventory cannot be checked", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		const readinessRefetch = vi.fn().mockResolvedValue(undefined);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					currentDeviceTargetQuery: {
						data: undefined,
						isError: true,
						isFetching: false,
						isPending: false,
						isSuccess: false,
					},
					currentLocalRuntimeReplyReadinessQuery: {
						data: undefined,
						isError: false,
						isFetching: false,
						isPending: true,
						refetch: readinessRefetch,
					},
					deviceId: null,
					refreshAll,
					runtimeLane: null,
				}
			)
		);

		render(createEmbeddedOnboardingComputerSetupElement());

		expect(
			await screen.findByText("OpenMeld could not check this computer")
		).toBeTruthy();
		expect(createPrepareSessionMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(refreshAll).toHaveBeenCalledTimes(1));
		expect(readinessRefetch).not.toHaveBeenCalled();
		expect(createPrepareSessionMock).not.toHaveBeenCalled();
	});

	it("shows Terminal setup when embedded onboarding has no existing computer to check", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_active",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
			snapshot: {
				...createTerminalDisconnectedSnapshot(),
				deviceId: null,
				targetSpaceId: null,
			},
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					kind: "account_computer_setup",
					resetThisComputer: false,
				},
				{
					currentLocalRuntimeReplyReadinessQuery: {
						data: undefined,
						isError: false,
						isFetching: false,
						isPending: true,
						refetch: vi.fn().mockResolvedValue(undefined),
					},
					deviceId: null,
					runtimeLane: null,
				}
			)
		);

		render(createEmbeddedOnboardingComputerSetupElement());

		expect(
			await screen.findByRole("button", { name: "Copy setup command" })
		).toBeTruthy();
		expect(screen.queryByText("Checking this computer…")).toBeNull();
		expect(createPrepareSessionMock).toHaveBeenCalledOnce();
	});

	it("hands a replayed automatic setup action back to the explicit Continue gate", async () => {
		const onNavigationActionAlreadyStarted = vi.fn();
		createPrepareSessionMock.mockRejectedValueOnce({
			code: "prepare.session.navigation_action_already_started",
			message:
				"This setup action has already started. Continue explicitly to create a fresh Terminal command.",
			requestId: "request-setup-replay",
			status: 409,
			upstreamCode: null,
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				agentProfileIds: [],
				kind: "space_recovery",
				profileId: "human_profile_1",
				resetThisComputer: false,
				spaceId: "center_agent_dm_1",
			})
		);

		render(
			<TestQueryClientProvider>
				<StartFlowStateProvider>
					<ComputerSetupFlow
						autoReturnOnCompletion={false}
						onNavigationActionAlreadyStarted={onNavigationActionAlreadyStarted}
						orgSlug="acme"
						presentation="conversation"
						sourceNavigationAction={{
							signalId: "setup-action-cross-browser",
							spaceId: "center_agent_dm_1",
						}}
					/>
				</StartFlowStateProvider>
			</TestQueryClientProvider>
		);

		await waitFor(() => {
			expect(onNavigationActionAlreadyStarted).toHaveBeenCalledTimes(1);
		});
		expect(createPrepareSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceNavigationAction: {
					signalId: "setup-action-cross-browser",
					spaceId: "center_agent_dm_1",
				},
			})
		);
		expect(createComputerAuthorizationMutateAsyncMock).not.toHaveBeenCalled();
	});

	it("refreshes Core readiness after setup completes and shows final ready state", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		const snapshot = createReadySnapshot({
			selectedLocalAgentIds: ["codex"],
			setupBootstrap: createFailedSetupBootstrapResult(),
		});
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_ready",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot,
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					agentProfileIds: ["agent-codex"],
					kind: "space_recovery",
					profileId: "profile-space-human",
					resetThisComputer: false,
					spaceId: "space-123",
				},
				{
					agentExecutionReadinessByProfileId: new Map([
						[
							"agent-codex",
							buildAgentExecutionReadinessResponse({
								agentProfileId: "agent-codex",
							}),
						],
					]),
					refreshAll,
				}
			)
		);

		renderPreparePage();

		expect(await screen.findByText("Computer connected.")).toBeTruthy();
		await waitFor(() => {
			expect(refreshAll).toHaveBeenCalledTimes(1);
		});
	});

	it("does not trust cached ready readiness before the completion refresh finishes", async () => {
		let finishRefresh!: () => void;
		const refreshAll = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishRefresh = resolve;
				})
		);
		const routeIntent: ConnectRouteIntent = {
			agentProfileIds: ["agent-codex"],
			kind: "space_recovery",
			profileId: "profile-space-human",
			resetThisComputer: false,
			spaceId: "space-123",
		};
		let setupContext = createSetupContext(routeIntent, {
			agentExecutionReadinessByProfileId: new Map([
				[
					"agent-codex",
					buildAgentExecutionReadinessResponse({
						agentProfileId: "agent-codex",
					}),
				],
			]),
			refreshAll,
		});
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_ready",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
			}),
		});
		useBringAgentsSetupContextMock.mockImplementation(() => setupContext);

		const view = renderPreparePage();

		expect(
			await screen.findByText("Checking agent availability.")
		).toBeTruthy();
		expect(screen.queryByText("Computer connected.")).toBeTruthy();

		setupContext = createSetupContext(routeIntent, {
			agentExecutionReadinessByProfileId: new Map([
				[
					"agent-codex",
					buildAgentExecutionReadinessResponse({
						agentProfileId: "agent-codex",
						displayState: "not_ready",
						primaryAction: "run_prepare",
					}),
				],
			]),
			refreshAll: vi.fn().mockResolvedValue(undefined),
		});
		view.rerender(createPreparePageElement());
		finishRefresh();

		expect(
			await screen.findByText(
				"Computer connected. Agent availability still needs 1 Agent Profile."
			)
		).toBeTruthy();
		expect(screen.queryByText("Computer connected.")).toBeTruthy();
	});

	it("does not promise ready when Core readiness still needs setup", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_ready",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					agentProfileIds: ["agent-codex"],
					kind: "space_recovery",
					profileId: "profile-space-human",
					resetThisComputer: false,
					spaceId: "space-123",
				},
				{
					agentExecutionReadinessByProfileId: new Map([
						[
							"agent-codex",
							buildAgentExecutionReadinessResponse({
								agentProfileId: "agent-codex",
								displayState: "not_ready",
								primaryAction: "run_prepare",
							}),
						],
					]),
				}
			)
		);

		renderPreparePage();

		expect(
			await screen.findByText(
				"Computer connected. Agent availability still needs 1 Agent Profile."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Computer connected. Agent availability still needs 1 Agent Profile."
			)
		).toBeTruthy();
		expect(screen.queryByText("Computer connected.")).toBeTruthy();
	});

	it("falls back to matched profiles when Space recovery has no explicit Agent Profile ids", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_ready",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				localAgentEntries: [
					buildLocalAgentCatalogEntry({
						agentId: "codex",
					}),
				],
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					agentProfileIds: [],
					kind: "space_recovery",
					profileId: "profile-space-human",
					resetThisComputer: false,
					spaceId: "space-123",
				},
				{
					agentExecutionReadinessByProfileId: new Map([
						[
							"agent-codex",
							buildAgentExecutionReadinessResponse({
								agentProfileId: "agent-codex",
								displayState: "not_ready",
								primaryAction: "run_prepare",
							}),
						],
					]),
					agentProfiles: [
						buildAgentProfile({
							openMeldProfileId: "agent-codex",
						}),
					],
				}
			)
		);

		renderPreparePage();

		expect(
			await screen.findByText(
				"Computer connected. Agent availability still needs 1 Agent Profile."
			)
		).toBeTruthy();
	});

	it("shows a checking state while final Core readiness is refreshing", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_ready",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: createReadySnapshot({
				selectedLocalAgentIds: ["codex"],
				setupBootstrap: createFailedSetupBootstrapResult(),
			}),
		});
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{
					agentProfileIds: ["agent-codex"],
					kind: "space_recovery",
					profileId: "profile-space-human",
					resetThisComputer: false,
					spaceId: "space-123",
				},
				{
					agentExecutionReadinessPendingProfileIds: new Set(["agent-codex"]),
				}
			)
		);

		renderPreparePage();

		expect(
			await screen.findByText("Checking agent availability.")
		).toBeTruthy();
		expect(screen.getByText("Checking agent availability.")).toBeTruthy();
	});

	it("keeps the completed state clean while the finished terminal disconnect is inside the reconnect grace window", async () => {
		const readySnapshot = createReadySnapshot({ targetSpaceId: null });
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_completed",
			opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
			snapshot: {
				...readySnapshot,
				terminalConnection: {
					...readySnapshot.terminalConnection,
					disconnectedAt: new Date().toISOString(),
				},
			},
		});

		renderPreparePage();

		expect(await screen.findByText("Computer connected")).toBeTruthy();
		expect(screen.queryByText("Setup command expired.")).toBeNull();
		expect(
			screen.queryByText("Terminal connection was interrupted. Reconnecting...")
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Refresh command" })
		).toBeNull();
	});

	it("lets the user run setup again from the completed state", async () => {
		renderPreparePage();

		await screen.findByText(
			"Computer connected. Local agents will sync in the background. Continue, or reconnect this computer."
		);

		fireEvent.click(screen.getByRole("button", { name: "Set up again" }));

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledTimes(2);
		});
	});

	it("restores the saved prepare session without minting a new command token", async () => {
		const restoredSnapshot = createTerminalDisconnectedSnapshot();
		readPrepareSessionMock.mockResolvedValueOnce({
			snapshot: restoredSnapshot,
		});
		window.localStorage.setItem(
			"openmeld.prepare.session.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: null,
				opaqueTokenExpiresAt: null,
				prepareSessionId: restoredSnapshot.prepareSessionId,
				runtimeLane: "dev-local",
				targetSpaceId: "space-123",
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				agentProfileIds: [],
				kind: "space_recovery",
				profileId: "11111111-1111-4111-8111-111111111111",
				resetThisComputer: false,
				spaceId: "space-123",
			})
		);

		renderPreparePage();

		expect(await screen.findByText("Setup command expired.")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Refresh command" })
		).toBeTruthy();
		expect(createPrepareSessionMock).not.toHaveBeenCalled();
		expect(mintPrepareSessionTokenMock).not.toHaveBeenCalled();
	});

	it("does not restore a completed Prepare Session from another Space", async () => {
		const completedSnapshotFromAnotherSpace = createReadySnapshot({
			targetSpaceId: "space-old",
		});
		readPrepareSessionMock.mockResolvedValueOnce({
			snapshot: completedSnapshotFromAnotherSpace,
		});
		window.localStorage.setItem(
			"openmeld.prepare.session.completed.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: "preptok_old",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				prepareSessionId: completedSnapshotFromAnotherSpace.prepareSessionId,
				runtimeLane: "dev-local",
				targetSpaceId: "space-old",
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				agentProfileIds: [],
				kind: "space_recovery",
				profileId: "11111111-1111-4111-8111-111111111111",
				resetThisComputer: false,
				spaceId: "space-new",
			})
		);

		renderPreparePage();

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledWith({
				deviceId: null,
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				runtimeLane: null,
				selectedLocalAgentIds: [],
				targetSpaceId: "space-new",
			});
		});
		expect(readPrepareSessionMock).not.toHaveBeenCalled();
	});

	it("starts a fresh Space recovery setup instead of restoring an old completed session when reset is requested", async () => {
		const completedSnapshot = createReadySnapshot({
			targetSpaceId: "space-repair",
		});
		readPrepareSessionMock.mockResolvedValueOnce({
			snapshot: completedSnapshot,
		});
		window.localStorage.setItem(
			"openmeld.prepare.session.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: "preptok_completed",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				prepareSessionId: completedSnapshot.prepareSessionId,
				runtimeLane: "dev-local",
				targetSpaceId: "space-repair",
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				agentProfileIds: [],
				kind: "space_recovery",
				profileId: "11111111-1111-4111-8111-111111111111",
				resetThisComputer: true,
				spaceId: "space-repair",
			})
		);

		renderPreparePage();

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledWith({
				deviceId: null,
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				runtimeLane: null,
				selectedLocalAgentIds: [],
				targetSpaceId: "space-repair",
			});
		});
		expect(readPrepareSessionMock).not.toHaveBeenCalled();
	});

	it("starts a fresh direct update setup instead of restoring an old completed session when reset is requested", async () => {
		const oldCompletedSnapshot = createReadySnapshot({
			prepareSessionId: "prepare-old-complete",
			targetSpaceId: null,
		});
		const newActiveSnapshot = {
			...createTerminalDisconnectedSnapshot(),
			prepareSessionId: "prepare-new-active",
			targetSpaceId: null,
		};
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_active",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
			snapshot: newActiveSnapshot,
		});
		readPrepareSessionMock.mockResolvedValueOnce({
			snapshot: oldCompletedSnapshot,
		});
		window.localStorage.setItem(
			"openmeld.prepare.session.completed.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: "preptok_completed",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				prepareSessionId: oldCompletedSnapshot.prepareSessionId,
				runtimeLane: "dev-local",
				targetSpaceId: null,
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				kind: "account_computer_setup",
				resetThisComputer: true,
				serviceAction: "update_service",
			})
		);

		renderPreparePage({
			autoReturnOnCompletion: false,
			selfRoute: "/o/acme/connect",
			selfRouteSearch: {
				reset: undefined,
				serviceAction: "update_service",
			},
		});

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledWith({
				deviceId: null,
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				runtimeLane: null,
				selectedLocalAgentIds: [],
				targetSpaceId: null,
			});
		});
		expect(readPrepareSessionMock).not.toHaveBeenCalled();
		expect(
			window.localStorage.getItem("openmeld.prepare.session.completed.pointer")
		).toBe(null);
		expect(
			screen.getAllByText("Update OpenMeld Service").length
		).toBeGreaterThan(0);
		expect(await screen.findByText(ACTIVE_PREPARE_TOKEN_PATTERN)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Copy update command" })
		);
		await waitFor(() => {
			expect(copyCliEntryCommandMock).toHaveBeenCalledTimes(1);
		});
		const copiedButton = screen.getByRole("button", { name: "Copied" });
		expect(
			copiedButton.querySelector('[data-icon="inline-start"]')
		).toBeTruthy();
		expect(toastSuccessMock).toHaveBeenCalledWith("CLI command copied.");
		expect(
			screen.queryByRole("button", { name: "Copy setup command" })
		).toBeNull();
	});

	it("refreshes only the setup command when the saved command token is expired", async () => {
		const restoredSnapshot = createTerminalDisconnectedSnapshot();
		readPrepareSessionMock.mockResolvedValueOnce({
			snapshot: restoredSnapshot,
		});
		mintPrepareSessionTokenMock.mockResolvedValueOnce({
			opaqueToken: "preptok_refreshed",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
			snapshot: restoredSnapshot,
		});
		buildWebSetupCommandMock.mockImplementation(
			(input: { startSession: string }) =>
				`openmeld-dev setup --start-session ${input.startSession}`
		);
		window.localStorage.setItem(
			"openmeld.prepare.session.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: null,
				opaqueTokenExpiresAt: null,
				prepareSessionId: restoredSnapshot.prepareSessionId,
				runtimeLane: "dev-local",
				targetSpaceId: "space-123",
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				agentProfileIds: [],
				kind: "space_recovery",
				profileId: "11111111-1111-4111-8111-111111111111",
				resetThisComputer: false,
				spaceId: "space-123",
			})
		);

		renderPreparePage();

		fireEvent.click(
			await screen.findByRole("button", { name: "Refresh command" })
		);

		await waitFor(() => {
			expect(mintPrepareSessionTokenMock).toHaveBeenCalledWith({
				prepareSessionId: restoredSnapshot.prepareSessionId,
			});
		});
		expect(createPrepareSessionMock).not.toHaveBeenCalled();
		await screen.findByText(REFRESHED_PREPARE_TOKEN_PATTERN);
	});

	it("automatically replaces a displayed setup command when it expires", async () => {
		const activeSnapshot = createTerminalDisconnectedSnapshot();
		readPrepareSessionMock.mockResolvedValueOnce({
			snapshot: activeSnapshot,
		});
		mintPrepareSessionTokenMock.mockResolvedValueOnce({
			opaqueToken: "preptok_refreshed",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
			snapshot: activeSnapshot,
		});
		createComputerAuthorizationMutateAsyncMock
			.mockResolvedValueOnce({
				deviceCode: "device_expiring",
				expiresIn: 0.05,
			})
			.mockResolvedValueOnce({
				deviceCode: "device_refreshed",
				expiresIn: 180,
			});
		window.localStorage.setItem(
			"openmeld.prepare.session.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: "preptok_active",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				prepareSessionId: activeSnapshot.prepareSessionId,
				runtimeLane: "dev-local",
				targetSpaceId: "space-123",
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				agentProfileIds: [],
				kind: "space_recovery",
				profileId: "11111111-1111-4111-8111-111111111111",
				resetThisComputer: false,
				spaceId: "space-123",
			})
		);

		renderPreparePage();
		await screen.findByText(ACTIVE_PREPARE_TOKEN_PATTERN);

		await waitFor(() => {
			expect(mintPrepareSessionTokenMock).toHaveBeenCalledWith({
				prepareSessionId: activeSnapshot.prepareSessionId,
			});
		});
		await screen.findByText(REFRESHED_PREPARE_TOKEN_PATTERN);
		expect(
			screen.queryByRole("button", { name: "Refresh command" })
		).toBeNull();
	});

	it("does not let an old command refresh overwrite a new computer session", async () => {
		const oldSnapshot = {
			...createTerminalDisconnectedSnapshot(),
			deviceId: "device-old",
			prepareSessionId: "prepare-old",
			runtimeLane: "dev-old",
			targetSpaceId: null,
		};
		const currentSnapshot = createActiveSnapshot({
			deviceId: "device-current",
			prepareSessionId: "prepare-current",
			runtimeLane: "dev-local",
			targetSpaceId: null,
		});
		let resolveOldRefresh: (value: {
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: PrepareSessionSnapshot;
		}) => void = () => undefined;
		const oldRefresh = new Promise<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: PrepareSessionSnapshot;
		}>((resolve) => {
			resolveOldRefresh = resolve;
		});
		readPrepareSessionMock.mockResolvedValueOnce({ snapshot: oldSnapshot });
		mintPrepareSessionTokenMock.mockReturnValueOnce(oldRefresh);
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_current",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
			snapshot: currentSnapshot,
		});
		window.localStorage.setItem(
			"openmeld.prepare.session.pointer",
			JSON.stringify({
				deviceId: "device-old",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: null,
				opaqueTokenExpiresAt: null,
				prepareSessionId: oldSnapshot.prepareSessionId,
				runtimeLane: "dev-old",
				targetSpaceId: null,
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{ kind: "account_computer_setup", resetThisComputer: false },
				{ deviceId: "device-old", runtimeLane: "dev-old" }
			)
		);

		const { rerender } = renderPreparePage();
		fireEvent.click(
			await screen.findByRole("button", { name: "Refresh command" })
		);
		await waitFor(() => {
			expect(mintPrepareSessionTokenMock).toHaveBeenCalledWith({
				prepareSessionId: "prepare-old",
			});
		});

		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{ kind: "account_computer_setup", resetThisComputer: false },
				{ deviceId: "device-current", runtimeLane: "dev-local" }
			)
		);
		rerender(createPreparePageElement());
		await waitFor(() => {
			expect(buildWebSetupCommandMock).toHaveBeenCalledWith(
				expect.objectContaining({ startSession: "preptok_current" })
			);
		});

		await act(async () => {
			resolveOldRefresh({
				opaqueToken: "preptok_old_refreshed",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				snapshot: oldSnapshot,
			});
			await oldRefresh;
		});

		expect(buildWebSetupCommandMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ startSession: "preptok_old_refreshed" })
		);
		const persistedPointer = JSON.parse(
			window.localStorage.getItem("openmeld.prepare.session.pointer") ?? "null"
		) as { prepareSessionId?: string } | null;
		expect(persistedPointer?.prepareSessionId).toBe("prepare-current");
	});

	it("does not let an old command refresh overwrite a replacement Prepare Session on the same computer", async () => {
		vi.stubGlobal("WebSocket", ControlledMockWebSocket);
		const oldSnapshot = {
			...createTerminalDisconnectedSnapshot(),
			prepareSessionId: "prepare-old",
			targetSpaceId: null,
		};
		const currentSnapshot = {
			...createTerminalDisconnectedSnapshot(),
			prepareSessionId: "prepare-current",
			targetSpaceId: null,
		};
		let resolveOldRefresh: (value: {
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: PrepareSessionSnapshot;
		}) => void = () => undefined;
		const oldRefresh = new Promise<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: PrepareSessionSnapshot;
		}>((resolve) => {
			resolveOldRefresh = resolve;
		});
		readPrepareSessionMock
			.mockResolvedValueOnce({ snapshot: oldSnapshot })
			.mockRejectedValueOnce(
				Object.assign(new Error("Prepare Session not found."), {
					code: "prepare.session.not_found",
				})
			);
		mintPrepareSessionTokenMock.mockReturnValueOnce(oldRefresh);
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_current",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
			snapshot: currentSnapshot,
		});
		window.localStorage.setItem(
			"openmeld.prepare.session.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: null,
				opaqueTokenExpiresAt: null,
				prepareSessionId: oldSnapshot.prepareSessionId,
				runtimeLane: "dev-local",
				targetSpaceId: null,
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{ kind: "account_computer_setup", resetThisComputer: false },
				{ deviceId: "device-current", runtimeLane: "dev-local" }
			)
		);

		renderPreparePage();
		fireEvent.click(
			await screen.findByRole("button", { name: "Refresh command" })
		);
		await waitFor(() => {
			expect(mintPrepareSessionTokenMock).toHaveBeenCalledWith({
				prepareSessionId: "prepare-old",
			});
		});

		ControlledMockWebSocket.latest?.disconnectFromServer();
		await waitFor(() => {
			expect(buildWebSetupCommandMock).toHaveBeenCalledWith(
				expect.objectContaining({ startSession: "preptok_current" })
			);
		});

		await act(async () => {
			resolveOldRefresh({
				opaqueToken: "preptok_old_refreshed",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				snapshot: oldSnapshot,
			});
			await oldRefresh;
		});

		expect(buildWebSetupCommandMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ startSession: "preptok_old_refreshed" })
		);
		const persistedPointer = JSON.parse(
			window.localStorage.getItem("openmeld.prepare.session.pointer") ?? "null"
		) as { prepareSessionId?: string } | null;
		expect(persistedPointer?.prepareSessionId).toBe("prepare-current");
	});

	it("invalidates an old command refresh as soon as Set up again starts", async () => {
		vi.stubGlobal("WebSocket", ControlledMockWebSocket);
		const oldSnapshot = {
			...createTerminalDisconnectedSnapshot(),
			prepareSessionId: "prepare-old",
			targetSpaceId: null,
		};
		const completedOldSnapshot = createReadySnapshot({
			prepareSessionId: "prepare-old",
			targetSpaceId: null,
		});
		const currentSnapshot = {
			...createTerminalDisconnectedSnapshot(),
			prepareSessionId: "prepare-current",
			targetSpaceId: null,
		};
		let resolveOldRefresh: (value: {
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: PrepareSessionSnapshot;
		}) => void = () => undefined;
		const oldRefresh = new Promise<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: PrepareSessionSnapshot;
		}>((resolve) => {
			resolveOldRefresh = resolve;
		});
		let resolveNewSession: (value: {
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: PrepareSessionSnapshot;
		}) => void = () => undefined;
		const newSession = new Promise<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: PrepareSessionSnapshot;
		}>((resolve) => {
			resolveNewSession = resolve;
		});
		readPrepareSessionMock.mockResolvedValueOnce({ snapshot: oldSnapshot });
		mintPrepareSessionTokenMock.mockReturnValueOnce(oldRefresh);
		createPrepareSessionMock.mockReturnValueOnce(newSession);
		window.localStorage.setItem(
			"openmeld.prepare.session.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: null,
				opaqueTokenExpiresAt: null,
				prepareSessionId: oldSnapshot.prepareSessionId,
				runtimeLane: "dev-local",
				targetSpaceId: null,
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext(
				{ kind: "account_computer_setup", resetThisComputer: false },
				{ deviceId: "device-current", runtimeLane: "dev-local" }
			)
		);

		renderPreparePage();
		fireEvent.click(
			await screen.findByRole("button", { name: "Refresh command" })
		);
		await waitFor(() => {
			expect(mintPrepareSessionTokenMock).toHaveBeenCalledWith({
				prepareSessionId: "prepare-old",
			});
		});
		act(() => {
			ControlledMockWebSocket.latest?.emitSnapshot(completedOldSnapshot);
		});
		fireEvent.click(
			await screen.findByRole("button", { name: "Set up again" })
		);

		await act(async () => {
			resolveOldRefresh({
				opaqueToken: "preptok_old_refreshed",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				snapshot: oldSnapshot,
			});
			await oldRefresh;
		});

		expect(buildWebSetupCommandMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ startSession: "preptok_old_refreshed" })
		);
		expect(
			window.localStorage.getItem("openmeld.prepare.session.pointer")
		).toBeNull();

		await act(async () => {
			resolveNewSession({
				opaqueToken: "preptok_current",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				snapshot: currentSnapshot,
			});
			await newSession;
		});
		await waitFor(() => {
			expect(buildWebSetupCommandMock).toHaveBeenCalledWith(
				expect.objectContaining({ startSession: "preptok_current" })
			);
		});
	});

	it("prefers the completed direct setup session over a newer active setup session", async () => {
		const activeSnapshot = createActiveSnapshot({
			prepareSessionId: "prepare-active",
			targetSpaceId: null,
		});
		const completedSnapshot = createReadySnapshot({
			prepareSessionId: "prepare-complete",
			targetSpaceId: null,
		});
		readPrepareSessionMock.mockImplementation(
			(input: { prepareSessionId: string }) => {
				if (input.prepareSessionId === "prepare-complete") {
					return Promise.resolve({ snapshot: completedSnapshot });
				}
				if (input.prepareSessionId === "prepare-active") {
					return Promise.resolve({ snapshot: activeSnapshot });
				}
				throw new Error(
					`Unexpected Prepare Session read: ${input.prepareSessionId}`
				);
			}
		);
		window.localStorage.setItem(
			"openmeld.prepare.session.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: "preptok_active",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				prepareSessionId: "prepare-active",
				runtimeLane: "dev-local",
				targetSpaceId: null,
			})
		);
		window.localStorage.setItem(
			"openmeld.prepare.session.completed.pointer",
			JSON.stringify({
				deviceId: "device-current",
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: "preptok_complete",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				prepareSessionId: "prepare-complete",
				runtimeLane: "dev-local",
				targetSpaceId: null,
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				kind: "account_computer_setup",
				resetThisComputer: false,
			})
		);
		renderPreparePage();

		await waitFor(() => {
			expect(readPrepareSessionMock).toHaveBeenCalledWith({
				prepareSessionId: "prepare-complete",
			});
		});
		expect(
			await screen.findByText(
				"Computer connected. Local agents will sync in the background."
			)
		).toBeTruthy();
		expect(screen.queryByText(ACTIVE_PREPARE_TOKEN_PATTERN)).toBeNull();
		expect(createPrepareSessionMock).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: "different device",
			pointerDeviceId: "device-old",
			pointerRuntimeLane: "dev-local",
			snapshotDeviceId: "device-old",
			snapshotRuntimeLane: "dev-local",
		},
		{
			name: "different lane",
			pointerDeviceId: "device-current",
			pointerRuntimeLane: "prod",
			snapshotDeviceId: "device-current",
			snapshotRuntimeLane: "prod",
		},
	])("starts a fresh direct setup instead of restoring a completed session from a $name", async ({
		pointerDeviceId,
		pointerRuntimeLane,
		snapshotDeviceId,
		snapshotRuntimeLane,
	}) => {
		const oldCompletedSnapshot = createReadySnapshot({
			deviceId: snapshotDeviceId,
			prepareSessionId: "prepare-old-complete",
			runtimeLane: snapshotRuntimeLane,
			targetSpaceId: null,
		});
		const newActiveSnapshot = createActiveSnapshot({
			prepareSessionId: "prepare-new-active",
			targetSpaceId: null,
		});
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_active",
			opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
			snapshot: newActiveSnapshot,
		});
		readPrepareSessionMock.mockResolvedValueOnce({
			snapshot: oldCompletedSnapshot,
		});
		window.localStorage.setItem(
			"openmeld.prepare.session.completed.pointer",
			JSON.stringify({
				deviceId: pointerDeviceId,
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				opaqueToken: "preptok_old",
				opaqueTokenExpiresAt: "2999-05-08T10:10:00.000Z",
				prepareSessionId: "prepare-old-complete",
				runtimeLane: pointerRuntimeLane,
				targetSpaceId: null,
			})
		);
		useBringAgentsSetupContextMock.mockReturnValue(
			createSetupContext({
				kind: "account_computer_setup",
				resetThisComputer: false,
			})
		);

		renderPreparePage();

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledWith({
				deviceId: null,
				humanProfileId: "11111111-1111-4111-8111-111111111111",
				runtimeLane: null,
				selectedLocalAgentIds: [],
				targetSpaceId: null,
			});
		});
		expect(readPrepareSessionMock).not.toHaveBeenCalled();
		await screen.findByText("Setup not finished yet.");
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("keeps the local agent install guide reachable from setup", async () => {
		renderPreparePage();

		expect(
			(
				await screen.findByRole("link", {
					name: "See the install guide",
				})
			).getAttribute("href")
		).toBe("/guides/local-agents");
	});

	describe("update_service version verification", () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it("keeps confirming instead of showing complete while the reported version is still update_required", async () => {
			useBringAgentsSetupContextMock.mockReturnValue(
				createSetupContext(
					{
						kind: "account_computer_setup",
						resetThisComputer: false,
						serviceAction: "update_service",
					},
					{
						currentLocalRuntimeReplyReadinessQuery: {
							data: buildCurrentLocalRuntimeReplyReadinessResponse({
								service: {
									installedVersion: "0.2.20",
									latestVersion: "0.2.21",
									reasonCodes: ["service.version_outdated"],
									requiredVersion: "0.2.21",
									status: "update_required",
									updatePolicy: "required",
									wakeBlocked: true,
								},
							}),
							refetch: vi.fn().mockResolvedValue(undefined),
						},
					}
				)
			);

			renderPreparePage();

			expect(
				await screen.findByText(
					"Confirming the update reached the required version on this computer..."
				)
			).toBeTruthy();
			expect(
				screen.queryByText(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE)
			).toBeNull();
			expect(
				screen.queryByRole("link", { name: "Back to Computers" })
			).toBeNull();
			await waitFor(() => {
				expect(navigateMock).not.toHaveBeenCalled();
			});
		});

		it("shows an explicit failure card instead of a green checkmark once the version check times out", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-05-08T10:00:00.000Z"));
			const refetch = vi.fn().mockResolvedValue(undefined);
			useBringAgentsSetupContextMock.mockReturnValue(
				createSetupContext(
					{
						kind: "account_computer_setup",
						resetThisComputer: false,
						serviceAction: "update_service",
					},
					{
						currentLocalRuntimeReplyReadinessQuery: {
							data: buildCurrentLocalRuntimeReplyReadinessResponse({
								service: {
									installedVersion: "0.2.20",
									latestVersion: "0.2.21",
									reasonCodes: ["service.version_outdated"],
									requiredVersion: "0.2.21",
									status: "update_required",
									updatePolicy: "required",
									wakeBlocked: true,
								},
							}),
							refetch,
						},
					}
				)
			);

			render(createPreparePageElement());

			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(60_000);
			});

			expect(
				screen.getByText(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE)
			).toBeTruthy();
			expect(
				screen.getByText((content) =>
					content.includes(
						"This computer reports OpenMeld Service v0.2.20, but v0.2.21 is required."
					)
				)
			).toBeTruthy();
			expect(
				screen.getByText((content) => content.includes("try again later"))
			).toBeTruthy();
			expect(refetch.mock.calls.length).toBeGreaterThan(0);
			expect(navigateMock).not.toHaveBeenCalled();
		});

		it("shows the confirmed version once the projection clears update_required", async () => {
			useBringAgentsSetupContextMock.mockReturnValue(
				createSetupContext(
					{
						kind: "account_computer_setup",
						resetThisComputer: false,
						serviceAction: "update_service",
					},
					{
						currentLocalRuntimeReplyReadinessQuery: {
							data: buildCurrentLocalRuntimeReplyReadinessResponse(),
							refetch: vi.fn().mockResolvedValue(undefined),
						},
					}
				)
			);

			renderPreparePage();

			expect(
				await screen.findByText(
					"Update complete. This computer now reports v0.2.21."
				)
			).toBeTruthy();
			expect(
				screen.queryByText(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE)
			).toBeNull();
		});

		it("keeps confirming instead of showing complete when the readiness query has not resolved yet", async () => {
			useBringAgentsSetupContextMock.mockReturnValue(
				createSetupContext({
					kind: "account_computer_setup",
					resetThisComputer: false,
					serviceAction: "update_service",
				})
			);

			renderPreparePage();

			expect(
				await screen.findByText(
					"Confirming the update reached the required version on this computer..."
				)
			).toBeTruthy();
			expect(
				screen.queryByText(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE)
			).toBeNull();
			expect(
				screen.queryByText(
					"Update complete. This computer now reports v0.2.21."
				)
			).toBeNull();
		});

		it("times out instead of confirming forever when the readiness query never resolves", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-05-08T10:00:00.000Z"));
			useBringAgentsSetupContextMock.mockReturnValue(
				createSetupContext({
					kind: "account_computer_setup",
					resetThisComputer: false,
					serviceAction: "update_service",
				})
			);

			render(createPreparePageElement());

			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(60_000);
			});

			expect(
				screen.getByText(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE)
			).toBeTruthy();
			expect(
				screen.queryByText(
					"Confirming the update reached the required version on this computer..."
				)
			).toBeNull();
			expect(
				screen.queryByText(
					"Update complete. This computer now reports v0.2.21."
				)
			).toBeNull();
			expect(navigateMock).not.toHaveBeenCalled();
		});

		it("recovers to confirmed once the projection clears update_required after timing out", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-05-08T10:00:00.000Z"));
			const refetch = vi.fn().mockResolvedValue(undefined);
			useBringAgentsSetupContextMock.mockReturnValue(
				createSetupContext(
					{
						kind: "account_computer_setup",
						resetThisComputer: false,
						serviceAction: "update_service",
					},
					{
						currentLocalRuntimeReplyReadinessQuery: {
							data: buildCurrentLocalRuntimeReplyReadinessResponse({
								service: {
									installedVersion: "0.2.20",
									latestVersion: "0.2.21",
									reasonCodes: ["service.version_outdated"],
									requiredVersion: "0.2.21",
									status: "update_required",
									updatePolicy: "required",
									wakeBlocked: true,
								},
							}),
							refetch,
						},
					}
				)
			);

			const { rerender } = render(createPreparePageElement());

			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(60_000);
			});

			expect(
				screen.getByText(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE)
			).toBeTruthy();

			useBringAgentsSetupContextMock.mockReturnValue(
				createSetupContext(
					{
						kind: "account_computer_setup",
						resetThisComputer: false,
						serviceAction: "update_service",
					},
					{
						currentLocalRuntimeReplyReadinessQuery: {
							data: buildCurrentLocalRuntimeReplyReadinessResponse(),
							refetch,
						},
					}
				)
			);

			await act(async () => {
				rerender(createPreparePageElement());
				await Promise.resolve();
			});

			expect(
				screen.queryByText(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE)
			).toBeNull();
			expect(
				screen.getByText("Update complete. This computer now reports v0.2.21.")
			).toBeTruthy();
		});

		it("stops re-checking the readiness projection after the component unmounts", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-05-08T10:00:00.000Z"));
			const refetch = vi.fn().mockResolvedValue(undefined);
			useBringAgentsSetupContextMock.mockReturnValue(
				createSetupContext(
					{
						kind: "account_computer_setup",
						resetThisComputer: false,
						serviceAction: "update_service",
					},
					{
						currentLocalRuntimeReplyReadinessQuery: {
							data: buildCurrentLocalRuntimeReplyReadinessResponse({
								service: {
									installedVersion: "0.2.20",
									latestVersion: "0.2.21",
									reasonCodes: ["service.version_outdated"],
									requiredVersion: "0.2.21",
									status: "update_required",
									updatePolicy: "required",
									wakeBlocked: true,
								},
							}),
							refetch,
						},
					}
				)
			);

			const { unmount } = render(createPreparePageElement());

			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
			});
			await act(async () => {
				// CURRENT_LOCAL_RUNTIME_REPLY_READINESS_REFRESH_INTERVAL_MS is 2000.
				await vi.advanceTimersByTimeAsync(4000);
			});

			const callsWhileMounted = refetch.mock.calls.length;
			expect(callsWhileMounted).toBeGreaterThan(0);

			unmount();

			await act(async () => {
				await vi.advanceTimersByTimeAsync(10_000);
			});

			expect(refetch.mock.calls.length).toBe(callsWhileMounted);
		});

		it("resets the verification window when starting a new prepare session via Set up again", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-05-08T10:00:00.000Z"));
			createPrepareSessionMock
				.mockResolvedValueOnce({
					opaqueToken: "preptok_update_a",
					opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
					snapshot: createReadySnapshot({
						prepareSessionId: "prepare-update-a",
						targetSpaceId: null,
					}),
				})
				.mockResolvedValueOnce({
					opaqueToken: "preptok_update_b",
					opaqueTokenExpiresAt: "2026-05-08T10:10:00.000Z",
					snapshot: createReadySnapshot({
						prepareSessionId: "prepare-update-b",
						targetSpaceId: null,
					}),
				});
			useBringAgentsSetupContextMock.mockReturnValue(
				createSetupContext(
					{
						kind: "account_computer_setup",
						resetThisComputer: false,
						serviceAction: "update_service",
					},
					{
						currentLocalRuntimeReplyReadinessQuery: {
							data: buildCurrentLocalRuntimeReplyReadinessResponse({
								service: {
									installedVersion: "0.2.20",
									latestVersion: "0.2.21",
									reasonCodes: ["service.version_outdated"],
									requiredVersion: "0.2.21",
									status: "update_required",
									updatePolicy: "required",
									wakeBlocked: true,
								},
							}),
							refetch: vi.fn().mockResolvedValue(undefined),
						},
					}
				)
			);

			render(createPreparePageElement());

			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(60_000);
			});

			expect(
				screen.getByText(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE)
			).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Set up again" }));

			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
				await Promise.resolve();
			});

			expect(
				screen.queryByText(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE)
			).toBeNull();
			expect(
				screen.getByText(
					"Confirming the update reached the required version on this computer..."
				)
			).toBeTruthy();
		});
	});
});

function renderPreparePage(
	input: ComponentProps<typeof StartBringAgentsSetupPage> = {}
) {
	return render(createPreparePageElement(input));
}

function createPreparePageElement(
	input: ComponentProps<typeof StartBringAgentsSetupPage> = {}
) {
	return (
		<TestQueryClientProvider>
			<StartFlowStateProvider>
				<StartBringAgentsSetupPage orgSlug="acme" {...input} />
			</StartFlowStateProvider>
		</TestQueryClientProvider>
	);
}

function createEmbeddedOnboardingComputerSetupElement() {
	return (
		<TestQueryClientProvider>
			<StartFlowStateProvider>
				<ComputerSetupFlow
					autoReturnOnCompletion={false}
					orgSlug="acme"
					preferExistingConnection
					presentation="embedded"
				/>
			</StartFlowStateProvider>
		</TestQueryClientProvider>
	);
}

function createSetupContext(
	routeIntent: ConnectRouteIntent,
	overrides: Partial<{
		agentExecutionReadinessByProfileId: Map<
			string,
			GetAgentExecutionReadinessResponse
		>;
		agentExecutionReadinessErrorByProfileId: Map<string, string>;
		agentExecutionReadinessPendingProfileIds: Set<string>;
		agentProfiles: ReturnType<typeof buildAgentProfile>[];
		agentProfilesQuery: { isPending: boolean };
		currentDeviceTargetQuery: {
			data: CurrentDeviceTargetResponse | undefined;
			isError?: boolean;
			isFetching?: boolean;
			isPending?: boolean;
			isSuccess?: boolean;
		};
		currentLocalRuntimeReplyReadinessQuery: {
			data: CurrentLocalRuntimeReplyReadinessResponse | undefined;
			isError?: boolean;
			isFetching?: boolean;
			isPending?: boolean;
			refetch: ReturnType<typeof vi.fn>;
		};
		deviceId: string | null;
		localRuntimesQuery: {
			data: LocalRuntimesResponse | undefined;
			isError?: boolean;
			isFetching?: boolean;
			isPending?: boolean;
			isSuccess?: boolean;
		};
		refreshAll: ReturnType<typeof vi.fn>;
		runtimeLane: string | null;
		sessionExpiredState: SessionExpiredState | null;
	}> = {}
) {
	const targetSpaceId = resolveSetupContextTargetSpaceId(routeIntent);
	const deviceId =
		overrides.deviceId === undefined ? "device-current" : overrides.deviceId;
	const runtimeLane =
		overrides.runtimeLane === undefined ? "dev-local" : overrides.runtimeLane;
	const inventoryRuntimeLane =
		runtimeLane === "prod" ||
		runtimeLane === "dev-local" ||
		runtimeLane === "canary"
			? runtimeLane
			: null;
	const defaultCurrentDeviceTarget: CurrentDeviceTargetResponse =
		deviceId === null || inventoryRuntimeLane === null
			? { availability: "missing" }
			: {
					availability: "resolved",
					deviceId,
					runtimeLane: inventoryRuntimeLane,
				};
	const defaultLocalRuntimes = {
		currentDeviceId: deviceId,
		currentRuntimeLane: inventoryRuntimeLane,
		localRuntimes: [],
	} satisfies LocalRuntimesResponse;
	return {
		agentExecutionReadinessByProfileId:
			overrides.agentExecutionReadinessByProfileId ?? new Map(),
		agentExecutionReadinessErrorByProfileId:
			overrides.agentExecutionReadinessErrorByProfileId ?? new Map(),
		agentExecutionReadinessPendingProfileIds:
			overrides.agentExecutionReadinessPendingProfileIds ?? new Set(),
		agentProfiles: overrides.agentProfiles ?? [],
		agentProfilesQuery: overrides.agentProfilesQuery ?? { isPending: false },
		blockingErrorMessage: null,
		currentDeviceTargetQuery: {
			data:
				overrides.currentDeviceTargetQuery === undefined
					? defaultCurrentDeviceTarget
					: overrides.currentDeviceTargetQuery.data,
			isError: overrides.currentDeviceTargetQuery?.isError ?? false,
			isFetching: overrides.currentDeviceTargetQuery?.isFetching ?? false,
			isPending: overrides.currentDeviceTargetQuery?.isPending ?? false,
			isSuccess: overrides.currentDeviceTargetQuery?.isSuccess ?? true,
		},
		currentLocalRuntimeReplyReadinessQuery: {
			data: overrides.currentLocalRuntimeReplyReadinessQuery?.data,
			isError:
				overrides.currentLocalRuntimeReplyReadinessQuery?.isError ?? false,
			isFetching:
				overrides.currentLocalRuntimeReplyReadinessQuery?.isFetching ?? false,
			isPending:
				overrides.currentLocalRuntimeReplyReadinessQuery?.isPending ?? false,
			refetch:
				overrides.currentLocalRuntimeReplyReadinessQuery?.refetch ??
				vi.fn().mockResolvedValue(undefined),
		},
		deviceId,
		loadGatewayUrl: vi.fn().mockResolvedValue("http://localhost:8080"),
		localRuntimesQuery: {
			data:
				overrides.localRuntimesQuery === undefined
					? defaultLocalRuntimes
					: overrides.localRuntimesQuery.data,
			isError: overrides.localRuntimesQuery?.isError ?? false,
			isFetching: overrides.localRuntimesQuery?.isFetching ?? false,
			isPending: overrides.localRuntimesQuery?.isPending ?? false,
			isSuccess: overrides.localRuntimesQuery?.isSuccess ?? true,
		},
		refreshAll: overrides.refreshAll ?? vi.fn().mockResolvedValue(undefined),
		routeIntent,
		runtimeLane,
		selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
		selectedTargetDevice: {
			deviceDisplayName: "This computer",
		},
		sessionExpiredState: overrides.sessionExpiredState ?? null,
		targetSpaceId,
	};
}

function buildCurrentLocalRuntimeReplyReadinessResponse(input?: {
	cli?: LocalCliComponentUpdateProjection;
	service?: LocalServiceComponentUpdateProjection;
}): CurrentLocalRuntimeReplyReadinessResponse {
	return {
		canReplyFromThisComputer: true,
		currentTarget: {
			availability: "resolved",
			deviceId: "device-current",
			runtimeLane: "dev-local",
		},
		generatedAt: "2026-05-08T10:00:00.000Z",
		localComponents: {
			agentSetupCommand:
				"npm install -g openmeld@latest && openmeld setup --view agent",
			generatedAt: "2026-05-08T10:00:00.000Z",
			humanSetupCommand: "npm install -g openmeld@latest && openmeld setup",
			schemaVersion: 1,
			cli: input?.cli ?? {
				commandContractVersion:
					"openmeld-cli-command-contract-2026-05-local-components-v1",
				installedPackageVersion: "0.2.21",
				latestPackageVersion: "0.2.21",
				reasonCodes: [],
				requiredCommandContractVersion: null,
				status: "current",
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			service: input?.service ?? {
				installedVersion: "0.2.21",
				latestVersion: "0.2.21",
				reasonCodes: [],
				requiredVersion: null,
				status: "current",
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			skills: {
				expectedBundleHash: "hash-current",
				expectedTargetCount: 1,
				installedBundleHash: "hash-current",
				reasonCodes: [],
				skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
				status: "current",
				targetCount: 1,
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			setupAction: "none",
			setupActionDescription:
				"OpenMeld local components are aligned for this computer.",
			setupActionLabel: "Everything is up to date",
		},
		message: "OpenMeld Service is connected on this computer.",
		nextAction: "none",
		primaryBlocker: "none",
		runtime: {
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority",
				value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
			},
			deviceDisplayName: "This computer",
			deviceId: "device-current",
			executionTargetStatus: "ready",
			lastObservedAtMs: 1_768_000_000_000,
			reasonCodes: [],
			runtimeLane: "dev-local",
			signInOnlyBlockers: false,
		},
		service: {
			connected: true,
			executionCompatibility: null,
			matchingCurrentRuntime: true,
			reasonCodes: [],
			sessionDeviceId: "device-current",
			sessionLane: "dev-local",
		},
		status: "ready",
	};
}

function buildDisconnectedCurrentLocalRuntimeReplyReadinessResponse(): CurrentLocalRuntimeReplyReadinessResponse {
	const connected = buildCurrentLocalRuntimeReplyReadinessResponse();
	return {
		...connected,
		canReplyFromThisComputer: false,
		message:
			"OpenMeld Service is not connected for this account on this computer.",
		nextAction: "reconnect_service",
		primaryBlocker: "service_not_connected",
		service: {
			...connected.service,
			connected: false,
			matchingCurrentRuntime: false,
			reasonCodes: ["service.current_runtime_session_missing"],
			sessionDeviceId: null,
			sessionLane: null,
		},
		status: "blocked",
	};
}

function buildAgentProfile(input: { openMeldProfileId: string }) {
	return {
		openMeldProfileId: input.openMeldProfileId,
		createdAt: "2026-05-08T10:00:00.000Z",
		createdByUserId: null,
		creatorProfileId: null,
		isDefault: false,
		lastUsedAt: null,
		ownerName: "Test User",
		ownerUserId: "user-123",
		profileHandle: input.openMeldProfileId,
		profileKind: "agent" as const,
		profileName: input.openMeldProfileId,
		source: "test",
		status: "active" as const,
		updatedAt: "2026-05-08T10:00:00.000Z",
	};
}

function resolveSetupContextTargetSpaceId(
	routeIntent: ConnectRouteIntent
): string | null {
	if (routeIntent.kind === "space_recovery") {
		return routeIntent.spaceId;
	}
	return null;
}

function buildAgentExecutionReadinessResponse(input: {
	agentProfileId: string;
	agentControllerRef?: string;
	displayState?: "blocked" | "not_ready" | "ready" | "unknown";
	primaryAction?: GetAgentExecutionReadinessResponse["agentExecutionReadiness"]["primaryAction"];
}): GetAgentExecutionReadinessResponse {
	const displayState = input.displayState ?? "ready";
	const ready = displayState === "ready";
	const primaryAction = input.primaryAction ?? (ready ? "none" : "run_prepare");
	const agentExecutionReadiness: GetAgentExecutionReadinessResponse["agentExecutionReadiness"] =
		{
			agentProfileId: input.agentProfileId,
			displayState,
			facts: {
				profile: {
					active: true,
					reasonCodes: ["profile.active"],
					source: "profile_identity",
				},
				binding: {
					reasonCodes: ["agent_profile_binding.command_eligible"],
					routable: true,
					source: "binding_truth",
				},
				claim: {
					executionBlocked: false,
					grantsClaimSuccess: false,
					reasonCodes: ["claim.not_checked"],
					source: "not_checked",
				},
				providerAccount: {
					blocked: false,
					expiresAtMs: null,
					observedAtMs: null,
					provider: null,
					reasonCodes: [],
					source: "not_checked",
				},
				providerConversation: {
					agentControllerConversationId: null,
					errorCode: null,
					errorMessage: null,
					errorType: null,
					expiresAtMs: null,
					method: null,
					observedAtMs: null,
					provider: null,
					ready: true,
					reasonCodes: [],
					required: false,
					source: "not_required",
					status: "not_required",
				},
				readinessImpact: {
					blocked: false,
					expiresAtMs: null,
					impactKind: null,
					observedAtMs: null,
					reasonCodes: [],
					source: "not_checked",
				},
				localService: {
					reachable: true,
					refreshable: true,
					reasonCodes: ["service.ready"],
					source: "runtime_transport",
				},
				service: {
					executionCompatible: true,
					expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
					observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
					reasonCodes: ["daemon.runtime_contract.compatible"],
					source: "runtime_transport",
				},
				route: {
					deviceId: "device-current",
					lane: "dev-local",
					observedAt: "2026-05-08T10:00:00.000Z",
					online: true,
					reasonCodes: ["daemon_route.online"],
					source: "daemon_route",
				},
				runtime: {
					ready,
					reasonCodes: ready
						? ["runtime.ready"]
						: ["runtime.agent_controller_report_stale"],
					source: "prepare_readiness",
				},
			},
			primaryAction,
			reasonCodes: ready
				? ["agent_execution.ready"]
				: ["runtime.agent_controller_report_stale"],
		};
	const wakeRouteEvidence: GetAgentExecutionReadinessResponse["wakeRouteEvidence"] =
		{
			observedAt: "2026-05-08T10:00:00.000Z",
			reasonCode: "online",
			status: "online",
		};
	const wakeRouteStatus: GetAgentExecutionReadinessResponse["wakeRouteStatus"] =
		{
			connectionGeneration: 1,
			daemonSessionId: `daemon-session-${input.agentProfileId}`,
			deviceId: "device-current",
			lane: "dev-local",
			lastHeartbeatMs: 1_768_000_000_000,
			leaseEpoch: 1,
			status: "ready",
		};
	const agentWakeRouteRegistration: GetAgentExecutionReadinessResponse["agentWakeRouteRegistration"] =
		{
			status: "registered",
			reasonCode: "wake_route.registered",
			reportedAtMs: 1_768_000_000_000,
			daemonSessionId: `daemon-session-${input.agentProfileId}`,
			deviceId: "device-current",
			lane: "dev-local",
			serviceVersion: "0.7.52",
		};
	return {
		agentExecutionReadiness,
		agentProfileId: input.agentProfileId,
		agentControllerRef: input.agentControllerRef ?? "builtin:codex",
		agentWakeRouteRegistration,
		wakeRouteEvidence,
		wakeRouteStatus,
		generatedAt: "2026-05-08T10:00:00.000Z",
		ownerUserId: "user-123",
		primaryBinding: null,
		primaryActionPlan: buildPrimaryActionPlan(primaryAction),
		profileName: "Test Codex",
		agentWakeAvailability: resolveAgentWakeAvailability({
			agentWakeRouteRegistration,
			wakeRouteStatus,
			readiness: agentExecutionReadiness,
		}),
		routeDeviceId: "device-current",
		routeLane: "dev-local",
		runtimeDeviceDisplayName: "This computer",
	};
}

function buildPrimaryActionPlan(
	primaryAction: GetAgentExecutionReadinessResponse["agentExecutionReadiness"]["primaryAction"]
): GetAgentExecutionReadinessResponse["primaryActionPlan"] {
	switch (primaryAction) {
		case "none":
			return { action: "none", target: null };
		case "reconnect_binding":
			return {
				action: "reconnect_binding",
				target: {
					agentControllerRef: "builtin:codex",
					kind: "local_agent_connection",
				},
			};
		case "run_prepare":
			return {
				action: "run_prepare",
				target: {
					kind: "current_computer",
				},
			};
		case "update_service":
			return {
				action: "update_service",
				target: {
					kind: "openmeld_service",
				},
			};
		case "check_status":
			return {
				action: "check_status",
				target: {
					kind: "status",
				},
			};
		case "fix_provider_account":
			return {
				action: "fix_provider_account",
				target: {
					kind: "provider_account",
					provider: "claude-code",
				},
			};
		default:
			return {
				action: "check_status",
				target: {
					kind: "status",
				},
			};
	}
}

function createReadySnapshot(
	input: {
		connectedComputerId?: string | null;
		deviceId?: string | null;
		localAgentEntries?: readonly PrepareLocalAgentCatalogEntry[];
		prepareSessionId?: string;
		runtimeLane?: string | null;
		selectedLocalAgentIds?: readonly string[];
		setupBootstrap?: PrepareSetupBootstrapResult;
		targetSpaceId?: string | null;
	} = {}
): PrepareSessionSnapshot {
	const now = "2026-05-08T10:00:00.000Z";
	const selectedLocalAgentIds = [...(input.selectedLocalAgentIds ?? [])];
	const localAgentEntries = [...(input.localAgentEntries ?? [])];
	return {
		blockers: [],
		completedAt: now,
		...(input.connectedComputerId === undefined
			? {}
			: { connectedComputerId: input.connectedComputerId }),
		createdAt: now,
		deviceId: input.deviceId === undefined ? "device-current" : input.deviceId,
		diagnosticCorrelationId: "diag-123",
		expiresAt: "2026-05-08T11:00:00.000Z",
		humanProfileId: "11111111-1111-4111-8111-111111111111",
		lifecycleStatus: "completed",
		localAgentCatalog: {
			detectedNotSupportedYet: 0,
			detectedSupported: localAgentEntries.length,
			entries: localAgentEntries,
			needsChoice: localAgentEntries.length,
			needsRepair: 0,
			notDetected: 0,
			totalBuiltins: localAgentEntries.length,
		},
		localReadinessSnapshot: null,
		ownerUserId: "user-123",
		phase: "ready",
		prepareSessionId: input.prepareSessionId ?? "prepare-123",
		runtimeLane:
			input.runtimeLane === undefined ? "dev-local" : input.runtimeLane,
		selectedLocalAgentIds,
		sessionRevision: 7,
		...(input.setupBootstrap === undefined
			? {}
			: { setupBootstrap: input.setupBootstrap }),
		steps: [
			createCompleteStep("computer", "Computer", "This computer"),
			createCompleteStep(
				"connect_terminal",
				"Connect Terminal",
				"Terminal is connected."
			),
			createCompleteStep(
				"choose_local_agents",
				"Choose local agents",
				"No local agents selected."
			),
			createCompleteStep(
				"prepare_selected_agents",
				"Set up selected agents",
				"Skipped. No local agents selected."
			),
			createCompleteStep(
				"refresh_service",
				"Start or refresh OpenMeld Service",
				"Skipped. OpenMeld Service is only needed for selected local agents."
			),
			createCompleteStep(
				"report_runtime",
				"Connect selected agents to OpenMeld",
				"Skipped. There are no selected local agents to report."
			),
			createCompleteStep(
				"verify_setup",
				"Verify setup",
				"Skipped. There are no selected local agents to verify."
			),
			createCompleteStep(
				"ready",
				"Available for Wake",
				"Computer connected. Local agents will sync in the background."
			),
		],
		targetSpaceId:
			input.targetSpaceId === undefined ? "space-123" : input.targetSpaceId,
		terminalConnection: {
			connectedAt: now,
			connectionEpoch: 1,
			connectionId: "terminal-123",
			disconnectedAt: now,
			disconnectReason: "completed",
			lastSeenAt: now,
			status: "disconnected",
		},
		updatedAt: now,
	};
}

function createCompletedSetupBootstrapResult(): PrepareSetupBootstrapResult {
	return {
		status: "completed",
		assistantProfile: null,
		binding: null,
		humanProfile: {
			openMeldProfileId: "human-mira",
			profileKind: "human",
			profileName: "Mira",
		},
		facts: null,
		membership: null,
		retryCommand: null,
		warnings: [],
		welcomeMessage: null,
		welcomingSpace: null,
	};
}

function createFailedSetupBootstrapResult(): PrepareSetupBootstrapResult {
	return {
		status: "failed",
		diagnostics: {
			errorName: "BootstrapError",
			selectedAgentIds: ["codex"],
		},
		failedStep: "space_create",
		message: "Space creation failed.",
		reason: "bootstrap_failed",
		retryCommand: "openmeld setup",
	};
}

function createActiveSnapshot(input: {
	deviceId?: string | null;
	prepareSessionId: string;
	runtimeLane?: string | null;
	targetSpaceId: string | null;
}): PrepareSessionSnapshot {
	const snapshot = createReadySnapshot({
		deviceId: input.deviceId,
		prepareSessionId: input.prepareSessionId,
		runtimeLane: input.runtimeLane,
		targetSpaceId: input.targetSpaceId,
	});
	return {
		...snapshot,
		completedAt: null,
		lifecycleStatus: "active",
		phase: "waiting_for_agent_selection",
		selectedLocalAgentIds: [],
		steps: snapshot.steps.map((step) =>
			step.id === "ready"
				? createStep("ready", "pending", "Available for Wake", "")
				: step
		),
	};
}

function buildLocalAgentCatalogEntry(input: {
	agentId: string;
	displayName?: string;
	targetKind?: "builtin" | "custom";
}): PrepareLocalAgentCatalogEntry {
	return {
		agentId: input.agentId,
		detected: true,
		displayName: input.displayName ?? input.agentId,
		enabled: true,
		launchStatus: "ready",
		selectable: true,
		selectableReason: null,
		targetKind: input.targetKind ?? "builtin",
	};
}

function createTerminalDisconnectedSnapshot(): PrepareSessionSnapshot {
	const now = "2026-05-08T10:00:00.000Z";
	return {
		blockers: [],
		completedAt: null,
		createdAt: now,
		deviceId: "device-current",
		diagnosticCorrelationId: "diag-123",
		expiresAt: "2026-05-08T11:00:00.000Z",
		humanProfileId: "11111111-1111-4111-8111-111111111111",
		lifecycleStatus: "active",
		localAgentCatalog: null,
		localReadinessSnapshot: null,
		ownerUserId: "user-123",
		phase: "terminal_disconnected",
		prepareSessionId: "prepare-restore",
		runtimeLane: "dev-local",
		selectedLocalAgentIds: [],
		sessionRevision: 3,
		steps: [
			createCompleteStep("computer", "Computer", "This computer"),
			createStep(
				"connect_terminal",
				"terminal_disconnected",
				"Connect Terminal",
				"Refresh the setup command and run it again to reconnect."
			),
			createStep(
				"choose_local_agents",
				"pending",
				"Choose local agents",
				"Choose the local agents OpenMeld should connect."
			),
			createStep(
				"prepare_selected_agents",
				"pending",
				"Set up selected agents",
				"OpenMeld is connecting the selected local agents."
			),
			createStep(
				"refresh_service",
				"pending",
				"Start or refresh OpenMeld Service",
				"OpenMeld Service keeps local agents available in the background."
			),
			createStep(
				"report_runtime",
				"pending",
				"Connect selected agents to OpenMeld",
				"OpenMeld is saving which selected agents this computer can run."
			),
			createStep(
				"verify_setup",
				"pending",
				"Verify setup",
				"OpenMeld is checking setup for the selected agents."
			),
			createStep("ready", "pending", "Available for Wake", ""),
		],
		targetSpaceId: "space-123",
		terminalConnection: {
			connectedAt: now,
			connectionEpoch: 1,
			connectionId: "terminal-123",
			disconnectedAt: now,
			disconnectReason: "socket_closed",
			lastSeenAt: now,
			status: "disconnected",
		},
		updatedAt: now,
	};
}

function createCompleteStep(
	id: PrepareSessionSnapshot["steps"][number]["id"],
	title: string,
	summary: string
): PrepareSessionSnapshot["steps"][number] {
	return createStep(id, "complete", title, summary);
}

function createStep(
	id: PrepareSessionSnapshot["steps"][number]["id"],
	state: PrepareSessionSnapshot["steps"][number]["state"],
	title: string,
	summary: string
): PrepareSessionSnapshot["steps"][number] {
	const now = "2026-05-08T10:00:00.000Z";
	return {
		blockerReasonCode: null,
		completedAt: state === "complete" ? now : null,
		id,
		startedAt: state === "pending" ? null : now,
		state,
		summary,
		title,
		updatedAt: now,
	};
}
