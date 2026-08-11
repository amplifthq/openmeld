import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { AgentInterfacePage } from "./agent-interface-page";

const createPrepareSessionMock = vi.hoisted(() => vi.fn());
const generateOneTimeTokenMutateAsyncMock = vi.hoisted(() => vi.fn());
const listStartProfilesMock = vi.hoisted(() => vi.fn());
const buildWebSetupCommandMock = vi.hoisted(() => vi.fn());
const resolveBrowserSetupCommandPlatformMock = vi.hoisted(() => vi.fn());
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

vi.mock("#/hooks/account.hooks", () => ({
	useGenerateOneTimeToken: () => ({
		mutateAsync: generateOneTimeTokenMutateAsyncMock,
	}),
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
	copyTextToClipboard: copyTextToClipboardMock,
}));

describe("AgentInterfacePage", () => {
	beforeEach(() => {
		createPrepareSessionMock.mockReset().mockResolvedValue({
			opaqueToken: "preptok_demo",
			opaqueTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
			snapshot: {},
		});
		generateOneTimeTokenMutateAsyncMock.mockReset().mockResolvedValue({
			token: "ott_demo",
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
			.mockReturnValue(
				"curl -fsSL http://localhost:3000/setup | sh -s -- setup --start-session preptok_demo --local-agents all --ott ott_demo --view agent"
			);
		resolveBrowserSetupCommandPlatformMock.mockReset().mockReturnValue("posix");
		copyTextToClipboardMock.mockReset().mockResolvedValue(true);
	});

	afterEach(() => {
		cleanup();
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
					oneTimeToken: "ott_demo",
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

	it("uses the ten-minute one-time-token fallback when the auth response omits expiry", async () => {
		createPrepareSessionMock.mockResolvedValueOnce({
			opaqueToken: "preptok_demo",
			opaqueTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
			snapshot: {},
		});
		generateOneTimeTokenMutateAsyncMock.mockResolvedValueOnce({
			token: "ott_demo",
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
		expect(screen.getByRole("button", { name: "Copy again" })).toBeTruthy();
	});
});

function renderPage(input: { isAuthenticated: boolean }) {
	return render(
		<TestQueryClientProvider>
			<AgentInterfacePage isAuthenticated={input.isAuthenticated} />
		</TestQueryClientProvider>
	);
}
