import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { AgentInterfacePage } from "./agent-interface-page";

const createPrepareSessionMock = vi.hoisted(() => vi.fn());
const createComputerAuthorizationMutateAsyncMock = vi.hoisted(() => vi.fn());
const listStartProfilesMock = vi.hoisted(() => vi.fn());
const buildWebSetupCommandMock = vi.hoisted(() => vi.fn());
const resolveBrowserSetupCommandPlatformMock = vi.hoisted(() => vi.fn());
const beginTextClipboardWriteMock = vi.hoisted(() => vi.fn());
const copyTextToClipboardMock = vi.hoisted(() => vi.fn());
const OPEN_OPENMELD_SKILL_RE = /Open OpenMeld Skill/i;
const PRIVATE_PROMPT_SIGN_IN_RE =
	/Sign in to create a private, expiring setup prompt/;
const PUBLIC_SKILL_DESCRIPTION_RE = /It does not include private setup access/;
const LOCAL_AGENTS_ALL_RE = /local-agents all/;
const OPENMELD_SKILL_PATH_RE = /SKILL\.md/;
const EXPIRES_IN_RE = /Expires in/;
const TEN_MINUTE_EXPIRY_RE = /Expires in (10:00|09:5\d)/i;

vi.mock("#/components/app/cross-page-header", () => ({
	CrossPageHeader: () => <header>OpenMeld header</header>,
}));

vi.mock("#/query/auth-query", () => ({
	createComputerAuthorizationGrant: createComputerAuthorizationMutateAsyncMock,
}));

vi.mock("#/query/connect/prepare-session", () => ({
	createPrepareSession: createPrepareSessionMock,
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: listStartProfilesMock,
}));

vi.mock("#/lib/cli-entry-command", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/cli-entry-command")
	>("#/lib/cli-entry-command");
	return {
		...actual,
		buildWebSetupCommand: buildWebSetupCommandMock,
		resolveBrowserSetupCommandPlatform: resolveBrowserSetupCommandPlatformMock,
	};
});

vi.mock("#/lib/clipboard", () => ({
	beginTextClipboardWrite: beginTextClipboardWriteMock,
	copyTextToClipboard: copyTextToClipboardMock,
}));

describe("AgentInterfacePage", () => {
	beforeEach(() => {
		createPrepareSessionMock.mockReset().mockResolvedValue({
			opaqueToken: "preptok_demo",
			opaqueTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
			snapshot: {},
		});
		createComputerAuthorizationMutateAsyncMock.mockReset().mockResolvedValue({
			deviceCode: "device-secret",
			expiresIn: 300,
		});
		listStartProfilesMock.mockReset().mockResolvedValue([
			{
				openMeldProfileId: "human-1",
				profileName: "Felix",
				profileHandle: "felix",
				profileKind: "human",
				status: "active",
				ownerUserId: "user-1",
				isDefault: true,
				lastUsedAt: null,
			},
		]);
		buildWebSetupCommandMock
			.mockReset()
			.mockImplementation(
				(input: {
					deviceCode: string;
					localAgents: string;
					startSession: string;
					view: string;
				}) =>
					`curl -fsSL http://localhost:3000/setup | sh -s -- setup --start-session ${input.startSession} --local-agents ${input.localAgents} --device-code ${input.deviceCode} --view ${input.view}`
			);
		resolveBrowserSetupCommandPlatformMock.mockReset().mockReturnValue("posix");
		beginTextClipboardWriteMock.mockReset().mockReturnValue(null);
		copyTextToClipboardMock.mockReset().mockResolvedValue(true);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("keeps the public Skill visible before sign-in", () => {
		renderPage({ isAuthenticated: false });

		expect(screen.getByText("OpenMeld Agent Interface")).toBeTruthy();
		expect(
			document.querySelector('[data-slot="tabs-subtle-selected-indicator"]')
		).toBeTruthy();
		expect(
			screen.getByRole("tab", { name: "Generate agent prompt" })
		).toBeTruthy();
		expect(
			screen.getByRole("tab", { name: OPEN_OPENMELD_SKILL_RE })
		).toBeTruthy();
		expect(screen.getByText("Agent handoff")).toBeTruthy();
		const generationButton = screen.getByRole("button", {
			name: "generation",
		});
		expect(
			generationButton.closest('[data-slot="card-description"]')?.textContent
		).toBe("The private prompt will appear here after generation.");
		expect(screen.getByText(PRIVATE_PROMPT_SIGN_IN_RE)).toBeTruthy();

		fireEvent.mouseEnter(
			screen.getByRole("tab", { name: OPEN_OPENMELD_SKILL_RE })
		);

		expect(screen.getByText(PUBLIC_SKILL_DESCRIPTION_RE)).toBeTruthy();
	});

	it("generates an agent prompt with all-local-agent setup", async () => {
		renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});

		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));

		await waitFor(() => {
			expect(buildWebSetupCommandMock).toHaveBeenCalledWith(
				expect.objectContaining({
					localAgents: "all",
					deviceCode: "device-secret",
					startSession: "preptok_demo",
					view: "agent",
				})
			);
		});
		expect(createPrepareSessionMock).toHaveBeenCalledWith({
			deviceId: null,
			humanProfileId: "human-1",
			runtimeLane: null,
			targetSpaceId: null,
			selectedLocalAgentIds: [],
		});
		expect(await screen.findByText(LOCAL_AGENTS_ALL_RE)).toBeTruthy();
		expect(screen.getAllByText(OPENMELD_SKILL_PATH_RE).length).toBeGreaterThan(
			0
		);
		expect(
			screen.getByText("Copy this prompt into your AI agent")
		).toBeTruthy();
		expect(screen.queryByText("Agent handoff")).toBeNull();
		expect(
			screen.queryByText("Copy this prompt into your AI agent.")
		).toBeNull();
		expect(copyTextToClipboardMock).toHaveBeenCalledWith(
			expect.stringContaining("Read the official OpenMeld Skill")
		);
		expect(copyTextToClipboardMock).toHaveBeenCalledWith(
			expect.stringContaining("openmeld-dev whoami --view agent")
		);
		expect(copyTextToClipboardMock).toHaveBeenCalledWith(
			expect.stringContaining("setup.complete")
		);
		expect(copyTextToClipboardMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"If setup does not produce `setup.complete`, try the OpenMeld setup recovery path before stopping."
			)
		);
		expect(copyTextToClipboardMock).toHaveBeenCalledWith(
			expect.stringContaining("send a compact evidence report to the Space")
		);
		expect(copyTextToClipboardMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"Do not call setup fixed just because a Space member badge says `Available`"
			)
		);
		expect(copyTextToClipboardMock).toHaveBeenCalledWith(
			expect.stringContaining("did you use a foreground service probe")
		);
		expect(copyTextToClipboardMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"If setup succeeds but an older CLI does not print `setup.complete`"
			)
		);
		expect(
			screen.getByRole("tab", { name: "Refresh agent prompt" })
		).toBeTruthy();
		expect(screen.getByText(EXPIRES_IN_RE)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Copy again" })).toBeTruthy();
	});

	it("uses the ten-minute authorization fallback when the auth response omits expiry", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_demo",
			opaqueTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
			snapshot: {},
		});
		createComputerAuthorizationMutateAsyncMock.mockResolvedValueOnce({
			deviceCode: "device-secret",
		});

		renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});

		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));

		expect(await screen.findByText(TEN_MINUTE_EXPIRY_RE)).toBeTruthy();
	});

	it("lets the empty handoff text generate the agent prompt", async () => {
		renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});

		fireEvent.click(screen.getByRole("button", { name: "generation" }));

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalled();
		});
		expect(await screen.findByText(LOCAL_AGENTS_ALL_RE)).toBeTruthy();
	});

	it("supports manually copying the generated prompt again", async () => {
		renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});

		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));
		fireEvent.click(await screen.findByRole("button", { name: "Copy again" }));

		await waitFor(() => {
			expect(copyTextToClipboardMock).toHaveBeenCalledTimes(2);
			expect(copyTextToClipboardMock).toHaveBeenLastCalledWith(
				expect.stringContaining("Read the official OpenMeld Skill")
			);
		});
		expect(createPrepareSessionMock).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Copy again" })).toBeTruthy();
	});

	it("refreshes expired credentials before copying the prompt again", async () => {
		const initialNow = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(initialNow);
		createPrepareSessionMock
			.mockResolvedValueOnce({
				opaqueToken: "preptok_expired",
				opaqueTokenExpiresAt: new Date(Date.now() + 250).toISOString(),
				snapshot: {},
			})
			.mockResolvedValueOnce({
				opaqueToken: "preptok_fresh",
				opaqueTokenExpiresAt: new Date(
					Date.now() + 10 * 60 * 1000
				).toISOString(),
				snapshot: {},
			});
		createComputerAuthorizationMutateAsyncMock
			.mockResolvedValueOnce({
				deviceCode: "device-secret-expired",
				expiresIn: 300,
			})
			.mockResolvedValueOnce({
				deviceCode: "device-secret-fresh",
				expiresIn: 300,
			});
		renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});

		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));
		await waitFor(() => {
			expect(copyTextToClipboardMock).toHaveBeenCalledWith(
				expect.stringContaining("preptok_expired")
			);
		});
		const copyAgainButton = await screen.findByRole("button", {
			name: "Copy again",
		});
		clock.mockReturnValue(initialNow + 1000);
		await waitFor(
			() => {
				expect(
					screen.getByText("Expired. Refresh and copy to continue.")
				).toBeTruthy();
			},
			{ timeout: 2000 }
		);
		copyTextToClipboardMock.mockClear();

		fireEvent.click(copyAgainButton);

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledTimes(2);
			expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
			expect(copyTextToClipboardMock).toHaveBeenCalledWith(
				expect.stringContaining("preptok_fresh")
			);
			expect(copyTextToClipboardMock).toHaveBeenCalledWith(
				expect.stringContaining("device-secret-fresh")
			);
		});
		expect(copyTextToClipboardMock).not.toHaveBeenCalledWith(
			expect.stringContaining("preptok_expired")
		);
		expect(copyTextToClipboardMock).not.toHaveBeenCalledWith(
			expect.stringContaining("device-secret-expired")
		);
	});

	it("starts the clipboard write in the click that refreshes an expired prompt", async () => {
		const initialNow = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(initialNow);
		const refreshPrepareSession = createDeferred<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: object;
		}>();
		createPrepareSessionMock
			.mockResolvedValueOnce({
				opaqueToken: "preptok_expired",
				opaqueTokenExpiresAt: new Date(Date.now() + 250).toISOString(),
				snapshot: {},
			})
			.mockImplementationOnce(() => refreshPrepareSession.promise);
		createComputerAuthorizationMutateAsyncMock
			.mockResolvedValueOnce({
				deviceCode: "device-secret-expired",
				expiresIn: 300,
			})
			.mockResolvedValueOnce({
				deviceCode: "device-secret-fresh",
				expiresIn: 300,
			});
		renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});

		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));
		await screen.findByRole("button", { name: "Copy again" });
		clock.mockReturnValue(initialNow + 1000);
		await waitFor(
			() => {
				expect(
					screen.getByText("Expired. Refresh and copy to continue.")
				).toBeTruthy();
			},
			{ timeout: 2000 }
		);
		const completeClipboardWrite = vi.fn().mockResolvedValue(true);
		beginTextClipboardWriteMock.mockClear().mockReturnValue({
			cancel: vi.fn(),
			complete: completeClipboardWrite,
		});
		copyTextToClipboardMock.mockClear();

		fireEvent.click(screen.getByRole("button", { name: "Refresh and copy" }));

		expect(beginTextClipboardWriteMock).toHaveBeenCalledTimes(1);
		expect(completeClipboardWrite).not.toHaveBeenCalled();
		expect(copyTextToClipboardMock).not.toHaveBeenCalled();

		await act(async () => {
			refreshPrepareSession.resolve({
				opaqueToken: "preptok_fresh",
				opaqueTokenExpiresAt: new Date(
					Date.now() + 10 * 60 * 1000
				).toISOString(),
				snapshot: {},
			});
			await refreshPrepareSession.promise;
		});

		await waitFor(() => {
			expect(completeClipboardWrite).toHaveBeenCalledWith(
				expect.stringContaining("preptok_fresh")
			);
			expect(completeClipboardWrite).toHaveBeenCalledWith(
				expect.stringContaining("device-secret-fresh")
			);
		});
		expect(copyTextToClipboardMock).not.toHaveBeenCalled();
	});

	it("deduplicates repeated clicks while refreshing an expired prompt", async () => {
		const initialNow = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(initialNow);
		const refreshPrepareSession = createDeferred<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: object;
		}>();
		createPrepareSessionMock
			.mockResolvedValueOnce({
				opaqueToken: "preptok_expired",
				opaqueTokenExpiresAt: new Date(Date.now() + 250).toISOString(),
				snapshot: {},
			})
			.mockImplementationOnce(() => refreshPrepareSession.promise);

		renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));
		await screen.findByRole("button", { name: "Copy again" });
		clock.mockReturnValue(initialNow + 1000);
		await waitFor(
			() => {
				expect(
					screen.getByText("Expired. Refresh and copy to continue.")
				).toBeTruthy();
			},
			{ timeout: 2000 }
		);
		copyTextToClipboardMock.mockClear();

		const refreshAndCopyButton = screen.getByRole("button", {
			name: "Refresh and copy",
		});
		fireEvent.click(refreshAndCopyButton);
		fireEvent.click(refreshAndCopyButton);

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledTimes(2);
			const pendingButton = screen.getByRole("button", {
				name: "Refreshing and copying…",
			}) as HTMLButtonElement;
			expect(pendingButton.disabled).toBe(true);
			expect(pendingButton.getAttribute("aria-busy")).toBe("true");
		});
		expect(copyTextToClipboardMock).not.toHaveBeenCalled();

		await act(async () => {
			refreshPrepareSession.resolve({
				opaqueToken: "preptok_fresh",
				opaqueTokenExpiresAt: new Date(
					Date.now() + 10 * 60 * 1000
				).toISOString(),
				snapshot: {},
			});
			await refreshPrepareSession.promise;
		});

		await waitFor(() => {
			expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
			expect(copyTextToClipboardMock).toHaveBeenCalledWith(
				expect.stringContaining("preptok_fresh")
			);
		});
		expect(
			(screen.getByRole("button", { name: "Copy again" }) as HTMLButtonElement)
				.disabled
		).toBe(false);
	});

	it("keeps the expired prompt fenced when refresh fails and retries safely", async () => {
		const initialNow = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(initialNow);
		createPrepareSessionMock
			.mockResolvedValueOnce({
				opaqueToken: "preptok_expired",
				opaqueTokenExpiresAt: new Date(Date.now() + 250).toISOString(),
				snapshot: {},
			})
			.mockRejectedValueOnce(new Error("Could not refresh the setup prompt."))
			.mockResolvedValueOnce({
				opaqueToken: "preptok_retry_fresh",
				opaqueTokenExpiresAt: new Date(
					Date.now() + 10 * 60 * 1000
				).toISOString(),
				snapshot: {},
			});
		createComputerAuthorizationMutateAsyncMock
			.mockResolvedValueOnce({
				deviceCode: "device-secret-expired",
				expiresIn: 300,
			})
			.mockResolvedValueOnce({
				deviceCode: "device-secret-unused",
				expiresIn: 300,
			})
			.mockResolvedValueOnce({
				deviceCode: "device-secret-retry-fresh",
				expiresIn: 300,
			});

		renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));
		await screen.findByRole("button", { name: "Copy again" });
		clock.mockReturnValue(initialNow + 1000);
		await waitFor(
			() => {
				expect(
					screen.getByText("Expired. Refresh and copy to continue.")
				).toBeTruthy();
			},
			{ timeout: 2000 }
		);
		copyTextToClipboardMock.mockClear();

		fireEvent.click(screen.getByRole("button", { name: "Refresh and copy" }));

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledTimes(2);
			expect(
				screen.getByRole("button", { name: "Refresh and copy" })
			).toBeTruthy();
		});
		expect(copyTextToClipboardMock).not.toHaveBeenCalled();
		expect(
			screen.getByRole("region", { name: "Generated agent prompt" }).textContent
		).toContain("preptok_expired");

		fireEvent.click(screen.getByRole("button", { name: "Refresh and copy" }));

		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledTimes(3);
			expect(copyTextToClipboardMock).toHaveBeenCalledWith(
				expect.stringContaining("preptok_retry_fresh")
			);
			expect(copyTextToClipboardMock).toHaveBeenCalledWith(
				expect.stringContaining("device-secret-retry-fresh")
			);
		});
		expect(copyTextToClipboardMock).not.toHaveBeenCalledWith(
			expect.stringContaining("preptok_expired")
		);
	});

	it("ignores an older prompt response after authentication changes", async () => {
		const stalePrepareSession = createDeferred<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: object;
		}>();
		const freshPrepareSession = createDeferred<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: object;
		}>();
		createPrepareSessionMock
			.mockImplementationOnce(() => stalePrepareSession.promise)
			.mockImplementationOnce(() => freshPrepareSession.promise);
		createComputerAuthorizationMutateAsyncMock
			.mockResolvedValueOnce({
				deviceCode: "device-secret-stale",
				expiresIn: 300,
			})
			.mockResolvedValueOnce({
				deviceCode: "device-secret-fresh",
				expiresIn: 300,
			});

		const page = renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));
		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledTimes(1);
		});

		page.rerender(renderPageElement({ isAuthenticated: false }));
		page.rerender(renderPageElement({ isAuthenticated: true }));
		await waitFor(() => {
			expect(
				(
					screen.getByRole("tab", {
						name: "Generate agent prompt",
					}) as HTMLButtonElement
				).disabled
			).toBe(false);
		});
		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));
		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledTimes(2);
		});

		await act(async () => {
			freshPrepareSession.resolve({
				opaqueToken: "preptok_fresh",
				opaqueTokenExpiresAt: new Date(
					Date.now() + 10 * 60 * 1000
				).toISOString(),
				snapshot: {},
			});
			await freshPrepareSession.promise;
		});
		await waitFor(() => {
			expect(copyTextToClipboardMock).toHaveBeenCalledWith(
				expect.stringContaining("preptok_fresh")
			);
		});
		const freshPromptRegion = await screen.findByRole("region", {
			name: "Generated agent prompt",
		});

		await act(async () => {
			stalePrepareSession.resolve({
				opaqueToken: "preptok_stale",
				opaqueTokenExpiresAt: new Date(
					Date.now() + 10 * 60 * 1000
				).toISOString(),
				snapshot: {},
			});
			await stalePrepareSession.promise;
		});

		expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
		expect(copyTextToClipboardMock).not.toHaveBeenCalledWith(
			expect.stringContaining("preptok_stale")
		);
		expect(freshPromptRegion.textContent).toContain("preptok_fresh");
	});

	it("fences a prompt response synchronously when sign-out commits", async () => {
		const cancelClipboardWrite = vi.fn();
		beginTextClipboardWriteMock.mockReturnValue({
			cancel: cancelClipboardWrite,
			complete: vi.fn().mockResolvedValue(true),
		});
		const pendingPrepareSession = createDeferred<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: object;
		}>();
		createPrepareSessionMock.mockImplementationOnce(
			() => pendingPrepareSession.promise
		);
		const signOutReady = createDeferred<() => void>();
		const copiedBeforePassiveEffects = createDeferred<number>();
		const resolveAfterSignOutCommit = vi.fn(() => {
			pendingPrepareSession.resolve({
				opaqueToken: "preptok_after_sign_out",
				opaqueTokenExpiresAt: new Date(
					Date.now() + 10 * 60 * 1000
				).toISOString(),
				snapshot: {},
			});
		});
		const actEnvironment = globalThis as typeof globalThis & {
			IS_REACT_ACT_ENVIRONMENT?: boolean;
		};
		const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

		try {
			render(
				<AuthenticationTransitionHarness
					onBeforePassiveEffects={() => {
						copiedBeforePassiveEffects.resolve(
							copyTextToClipboardMock.mock.calls.length
						);
					}}
					onReady={signOutReady.resolve}
					onSignedOutCommit={resolveAfterSignOutCommit}
				/>
			);
			await waitFor(() => {
				expect(listStartProfilesMock).toHaveBeenCalled();
			});
			fireEvent.click(
				screen.getByRole("tab", { name: "Generate agent prompt" })
			);
			await waitFor(() => {
				expect(createPrepareSessionMock).toHaveBeenCalledTimes(1);
			});

			actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
			const signOut = await signOutReady.promise;
			signOut();
			const copyCountAtTheSignedOutCommit =
				await copiedBeforePassiveEffects.promise;

			expect(resolveAfterSignOutCommit).toHaveBeenCalledTimes(1);
			expect(cancelClipboardWrite).toHaveBeenCalled();
			expect(copyCountAtTheSignedOutCommit).toBe(0);
			expect(copyTextToClipboardMock).not.toHaveBeenCalled();
			expect(
				screen.queryByRole("region", { name: "Generated agent prompt" })
			).toBeNull();
		} finally {
			actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
		}
	});

	it("disables an existing Copy action after sign-out", async () => {
		const page = renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));
		await screen.findByRole("button", { name: "Copy again" });

		page.rerender(renderPageElement({ isAuthenticated: false }));

		expect(
			(screen.getByRole("button", { name: "Copy again" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
	});

	it("does not copy a prompt after the page unmounts", async () => {
		const pendingPrepareSession = createDeferred<{
			opaqueToken: string;
			opaqueTokenExpiresAt: string;
			snapshot: object;
		}>();
		createPrepareSessionMock.mockImplementationOnce(
			() => pendingPrepareSession.promise
		);

		const page = renderPage({ isAuthenticated: true });
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		fireEvent.click(screen.getByRole("tab", { name: "Generate agent prompt" }));
		await waitFor(() => {
			expect(createPrepareSessionMock).toHaveBeenCalledTimes(1);
		});
		page.unmount();

		await act(async () => {
			pendingPrepareSession.resolve({
				opaqueToken: "preptok_after_unmount",
				opaqueTokenExpiresAt: new Date(
					Date.now() + 10 * 60 * 1000
				).toISOString(),
				snapshot: {},
			});
			await pendingPrepareSession.promise;
		});

		expect(copyTextToClipboardMock).not.toHaveBeenCalled();
	});
});

function renderPage(input: { isAuthenticated: boolean }) {
	return render(renderPageElement(input));
}

function renderPageElement(input: { isAuthenticated: boolean }) {
	return (
		<TestQueryClientProvider>
			<AgentInterfacePage isAuthenticated={input.isAuthenticated} />
		</TestQueryClientProvider>
	);
}

function AuthenticationTransitionHarness(input: {
	onBeforePassiveEffects: () => void;
	onReady: (signOut: () => void) => void;
	onSignedOutCommit: () => void;
}) {
	const [isAuthenticated, setIsAuthenticated] = useState(true);
	useLayoutEffect(() => {
		input.onReady(() => setIsAuthenticated(false));
	}, [input.onReady]);
	useLayoutEffect(() => {
		if (!isAuthenticated) {
			input.onSignedOutCommit();
			observeAfterPendingPromptContinuations(input.onBeforePassiveEffects);
		}
	}, [input.onBeforePassiveEffects, input.onSignedOutCommit, isAuthenticated]);

	return renderPageElement({ isAuthenticated });
}

function observeAfterPendingPromptContinuations(observe: () => void) {
	let pendingContinuations = Promise.resolve();
	for (let index = 0; index < 12; index += 1) {
		pendingContinuations = pendingContinuations.then(() => undefined);
	}
	pendingContinuations.then(observe);
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return { promise, reject, resolve };
}
