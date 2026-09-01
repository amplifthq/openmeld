import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import type { OpenMeldLogoStrongProps } from "@openmeld/ui/components/openmeld-logo-strong";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";

const {
	openMeldLogoStrongMock,
	createWebSpaceApiMock,
	listStartProfilesMock,
	recordProfileSpaceHistoryMock,
	rememberProtectedSpaceAccessMock,
	resolveActiveOrganizationHumanProfilesPathMock,
	resolveActiveOrganizationSpacePathMock,
	useNavigateMock,
} = vi.hoisted(() => ({
	openMeldLogoStrongMock: vi.fn(
		({ className, colors, scale }: OpenMeldLogoStrongProps) => (
			<img
				alt="OpenMeld logo"
				data-class-name={className}
				data-colors={colors ? "custom" : "default"}
				data-scale={scale}
				height={1}
				src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
				width={1}
			/>
		)
	),
	createWebSpaceApiMock: vi.fn(),
	listStartProfilesMock: vi.fn(),
	recordProfileSpaceHistoryMock: vi.fn(),
	rememberProtectedSpaceAccessMock: vi.fn(),
	resolveActiveOrganizationHumanProfilesPathMock: vi.fn(() => {
		return "/o/acme/people";
	}),
	resolveActiveOrganizationSpacePathMock: vi.fn(
		(input: { data: { profileId?: string; spaceId: string } }) => {
			const url = new URL(
				`/o/acme/spaces/${encodeURIComponent(input.data.spaceId)}`,
				"http://localhost"
			);
			if (input.data.profileId) {
				url.searchParams.set("profileId", input.data.profileId);
			}
			return `${url.pathname}${url.search}`;
		}
	),
	useNavigateMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	const buildLinkHref = (
		path: string,
		search?: Record<string, string | null | undefined>
	): string => {
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(search ?? {})) {
			if (typeof value !== "string" || value.length === 0) {
				continue;
			}
			query.set(key, value);
		}

		const queryText = query.toString();
		return queryText ? `${path}?${queryText}` : path;
	};

	return {
		...actual,
		Link: ({
			children,
			search,
			to,
			...props
		}: {
			children: ReactNode;
			search?: Record<string, string | null | undefined>;
			to: string;
		} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
			<a href={buildLinkHref(to, search)} {...props}>
				{children}
			</a>
		),
		useNavigate: () => useNavigateMock,
		useRouterState: (input: {
			select: (state: { location: { pathname: string } }) => string;
		}) => input.select({ location: { pathname: "/spaces/space-123" } }),
	};
});

vi.mock("#/lib/auth-session", () => ({
	getSession: vi.fn(async () => null),
}));

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: createWebSpaceApiMock,
}));

vi.mock("#/lib/spaces/protected-space-access", () => ({
	rememberProtectedSpaceAccess: (
		...args: Parameters<typeof rememberProtectedSpaceAccessMock>
	) => rememberProtectedSpaceAccessMock(...args),
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: (...args: unknown[]) => listStartProfilesMock(...args),
}));

vi.mock("#/lib/onboarding/record-profile-space-history", () => ({
	recordProfileSpaceHistory: (
		...args: Parameters<typeof recordProfileSpaceHistoryMock>
	) => recordProfileSpaceHistoryMock(...args),
}));

vi.mock("#/lib/organizations/organization-scope", () => ({
	resolveActiveOrganizationHumanProfilesPath: (
		...args: Parameters<typeof resolveActiveOrganizationHumanProfilesPathMock>
	) => resolveActiveOrganizationHumanProfilesPathMock(...args),
	resolveActiveOrganizationSpacePath: (
		...args: Parameters<typeof resolveActiveOrganizationSpacePathMock>
	) => resolveActiveOrganizationSpacePathMock(...args),
}));

vi.mock("@openmeld/ui/components/openmeld-logo-strong", () => ({
	OpenMeldLogoStrong: openMeldLogoStrongMock,
}));

import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";
import { PublicSpacePage } from "./$spaceId";

const MESSAGE_TEXTBOX_NAME = "Message this space";
const SIGN_IN_LINK_NAME = "Sign in";
const JOIN_SPACE_BUTTON_PATTERN = /Join as My Human/;
const CLASS_NAME_SEPARATOR_PATTERN = /\s+/;
const CENTER_AGENT_PROFILE_ID = "agt_99999999-9999-4999-8999-999999999999";
const PUBLIC_AGENT_PROFILE_ID = "agt_88888888-8888-4888-8888-888888888888";

type PublicSpaceApiTestDouble = {
	addMembers: ReturnType<typeof vi.fn>;
	getStatus: ReturnType<typeof vi.fn>;
	getViewerMembership: ReturnType<typeof vi.fn>;
	listSignalEnvelopes: ReturnType<typeof vi.fn>;
	listThreadSignals: ReturnType<typeof vi.fn>;
	listThreads: ReturnType<typeof vi.fn>;
};

describe("PublicSpacePage", () => {
	beforeEach(() => {
		createWebSpaceApiMock.mockReset();
		listStartProfilesMock.mockReset().mockResolvedValue([]);
		recordProfileSpaceHistoryMock.mockReset().mockResolvedValue(undefined);
		rememberProtectedSpaceAccessMock.mockReset().mockResolvedValue(undefined);
		resolveActiveOrganizationHumanProfilesPathMock
			.mockReset()
			.mockResolvedValue("/o/acme/people");
		resolveActiveOrganizationSpacePathMock
			.mockReset()
			.mockImplementation(
				(input: { data: { profileId?: string; spaceId: string } }) => {
					const url = new URL(
						`/o/acme/spaces/${encodeURIComponent(input.data.spaceId)}`,
						"http://localhost"
					);
					if (input.data.profileId) {
						url.searchParams.set("profileId", input.data.profileId);
					}
					return `${url.pathname}${url.search}`;
				}
			);
		useNavigateMock.mockReset().mockResolvedValue(undefined);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders anonymous public Space content without participant controls", async () => {
		createWebSpaceApiMock.mockReturnValue(createPublicSpaceApi());

		renderPublicSpace({ isAuthenticated: false });

		expect(
			await screen.findByText("Shared Roadmap", {}, { timeout: 3000 })
		).not.toBeNull();
		expect(await screen.findByText("Hello public viewer.")).not.toBeNull();
		const publicSpaceHeading = screen.getByRole("heading", {
			level: 1,
			name: "Shared Roadmap",
		});
		const publicSpaceTitleRow = publicSpaceHeading.closest(
			'[data-slot="space-window-header-title"]'
		);
		const publicSpaceNavigation = screen
			.getByRole("tablist", { name: "Space view" })
			.closest('[data-slot="space-window-header-navigation"]');
		expect(publicSpaceTitleRow).not.toBeNull();
		expect(
			within(publicSpaceTitleRow as HTMLElement).getByText("Public")
		).not.toBeNull();
		expect(publicSpaceNavigation).not.toBeNull();
		expect(
			screen.getByRole("log", { name: "Conversation history" })
		).not.toBeNull();
		const globalHeader = screen.getAllByRole("banner").find((banner) =>
			within(banner).queryByRole("link", {
				name: "Go to OpenMeld homepage",
			})
		);
		expect(globalHeader).toBeDefined();
		expect(
			within(globalHeader as HTMLElement).getByRole("link", {
				name: "Go to OpenMeld homepage",
			})
		).not.toBeNull();
		expect(
			within(globalHeader as HTMLElement).queryByRole("tablist")
		).toBeNull();
		const conversationBody = screen.getByRole("region", {
			name: "Space conversation",
		}).parentElement;
		const conversationFrame = conversationBody?.parentElement;
		const conversationFrameClassNames =
			conversationFrame?.className.split(CLASS_NAME_SEPARATOR_PATTERN) ?? [];
		expect(conversationFrameClassNames).toContain("mx-auto");
		expect(conversationFrameClassNames).toContain(APP_PAGE_FRAME_CLASS_NAME);
		expect(conversationFrameClassNames).toContain("border-x");
		for (const className of APP_PAGE_FRAME_PADDING_CLASS_NAME.split(" ")) {
			expect(conversationFrameClassNames).toContain(className);
		}
		expect(
			document
				.getElementById("space-thread-panel")
				?.className.split(CLASS_NAME_SEPARATOR_PATTERN)
		).toContain("border-l-0");
		expect(
			screen.getByRole("link", { name: SIGN_IN_LINK_NAME }).getAttribute("href")
		).toBe("/login?redirect=%2Fspaces%2Fspace-123");
		expect(screen.getByRole("link", { name: "OpenMeld home" })).not.toBeNull();
		expect(screen.queryByText("Wake")).toBeNull();
		expect(screen.queryByText("Joined as")).toBeNull();
		expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Members" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Space information" })
		).toBeNull();
		expect(
			screen.queryByRole("textbox", { name: MESSAGE_TEXTBOX_NAME })
		).toBeNull();
	});

	it("renders the shared strong OpenMeld logo in the public Space header", async () => {
		createWebSpaceApiMock.mockReturnValue(createPublicSpaceApi());

		renderPublicSpace({ isAuthenticated: false });

		expect(
			await screen.findByText("Shared Roadmap", {}, { timeout: 3000 })
		).not.toBeNull();
		const publicSpaceHomeLink = screen.getByRole("link", {
			name: "OpenMeld home",
		});
		const publicSpaceLogo = within(publicSpaceHomeLink).getByRole("img", {
			name: "OpenMeld logo",
		});
		expect(publicSpaceLogo.getAttribute("data-class-name")).toContain(
			"text-foreground"
		);
		expect(publicSpaceLogo.getAttribute("data-colors")).toBe("default");
		expect(publicSpaceLogo.getAttribute("data-scale")).toBe("0.32");
	});

	it("uses the projected Center Agent Dither identity in public messages and threads", async () => {
		const rootSignal = createCenterAgentSignalEnvelope({
			id: "signal-center-root",
			text: "Public Center Agent update.",
		});
		const threadSignal = createCenterAgentSignalEnvelope({
			id: "signal-center-thread",
			text: "Public Center Agent thread reply.",
		});
		createWebSpaceApiMock.mockReturnValue(
			createPublicSpaceApi({
				getStatus: vi.fn(async () => ({
					spaceId: "space-123",
					generatedAt: "2026-05-13T00:00:00.000Z",
					name: "Shared Roadmap",
					centerAgentProfileId: CENTER_AGENT_PROFILE_ID,
					accessMode: "public",
					passwordProtected: false,
					dispatchPolicy: { mode: "mention_only" },
					publicationMode: "collaboration",
					allowedActions: ["post_message", "post_status", "stay_silent"],
					resultArchivePolicy: { mode: "all_final_results" },
					entryBrief: "default",
					dispatchBrief: "default",
					members: {
						totalCount: 1,
						humanCount: 0,
						agentCount: 1,
						liveNowCount: 0,
						liveHumanCount: 0,
						liveAgentCount: 0,
					},
				})),
				listSignalEnvelopes: vi.fn(async () => ({
					envelopes: [rootSignal],
					nextCursor: null,
				})),
				listThreads: vi.fn(async () => ({
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: rootSignal.id,
							createdByProfileId: CENTER_AGENT_PROFILE_ID,
							createdAt: "2026-05-13T00:00:00.000Z",
							updatedAt: "2026-05-13T00:00:01.000Z",
						},
					],
					previews: [],
				})),
				listThreadSignals: vi.fn(async () => ({
					signals: [threadSignal],
					placements: [],
				})),
			})
		);

		renderPublicSpace({ isAuthenticated: false });

		const rootMessage = await screen.findByText("Public Center Agent update.");
		expect(
			screen.getByTestId(
				`space-center-agent-profile-avatar-${CENTER_AGENT_PROFILE_ID}`
			)
		).not.toBeNull();
		fireEvent.mouseEnter(
			rootMessage.closest("[data-signal-id]") as HTMLElement
		);
		fireEvent.click(screen.getByRole("button", { name: "Open thread" }));

		const threadPanel = await screen.findByLabelText("Thread");
		expect(
			await within(threadPanel).findByText("Public Center Agent thread reply.")
		).not.toBeNull();
		expect(
			within(threadPanel).getByTestId(
				`space-center-agent-profile-avatar-${CENTER_AGENT_PROFILE_ID}`
			)
		).not.toBeNull();
	});

	it("keeps completed root Wakes terminal in public threads when the thread query omits the top-level reply", async () => {
		const rootText = "Review the public release notes.";
		const rootSignal = createPublicWakeSignalEnvelope({
			id: "signal-public-wake-root",
			text: rootText,
			ts: Date.now() - 2 * 60 * 1000,
		});
		const replySignal = createPublicAgentWakeReplyEnvelope({
			id: "signal-public-wake-reply",
			replyToSignalId: rootSignal.id,
			text: "The public release notes are ready.",
			ts: rootSignal.ts + 60_000,
		});
		createWebSpaceApiMock.mockReturnValue(
			createPublicSpaceApi({
				listSignalEnvelopes: vi.fn(async () => ({
					envelopes: [rootSignal, replySignal],
					nextCursor: null,
				})),
				listThreads: vi.fn(async () => ({
					threads: [
						{
							threadId: "thread-public-wake",
							spaceId: "space-123",
							rootSignalId: rootSignal.id,
							createdByProfileId: "human-1",
							createdAt: new Date(rootSignal.ts).toISOString(),
							updatedAt: new Date(replySignal.ts).toISOString(),
						},
					],
					previews: [],
				})),
				listThreadSignals: vi.fn(async () => ({
					signals: [rootSignal],
					placements: [],
				})),
			})
		);

		renderPublicSpace({ isAuthenticated: false });

		const rootMessage = (await screen.findAllByText(rootText)).find((element) =>
			element.closest("[data-signal-id]")
		);
		expect(rootMessage).toBeDefined();
		fireEvent.mouseEnter(
			rootMessage?.closest("[data-signal-id]") as HTMLElement
		);
		fireEvent.click(screen.getByRole("button", { name: "Open thread" }));

		const threadPanel = await screen.findByLabelText("Thread");
		expect(await within(threadPanel).findByText(rootText)).not.toBeNull();
		expect(within(threadPanel).queryByText("Starting Wake")).toBeNull();
	});

	it("recovers from a transient initial public Space status failure", async () => {
		const getStatus = vi
			.fn()
			.mockRejectedValueOnce(new Error("temporary upstream restart"))
			.mockResolvedValue({
				spaceId: "space-123",
				generatedAt: "2026-05-13T00:00:00.000Z",
				name: "Shared Roadmap",
				accessMode: "public",
				passwordProtected: false,
				dispatchPolicy: { mode: "mention_only" },
				publicationMode: "collaboration",
				allowedActions: ["post_message", "post_status", "stay_silent"],
				resultArchivePolicy: { mode: "all_final_results" },
				entryBrief: "default",
				dispatchBrief: "default",
				members: {
					totalCount: 1,
					humanCount: 1,
					agentCount: 0,
					liveNowCount: 1,
					liveHumanCount: 1,
					liveAgentCount: 0,
				},
			});
		createWebSpaceApiMock.mockReturnValue(createPublicSpaceApi({ getStatus }));

		renderPublicSpace({ isAuthenticated: false });

		expect(
			await screen.findByText("Shared Roadmap", {}, { timeout: 3000 })
		).not.toBeNull();
		expect(getStatus).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't Load This Space")).toBeNull();
	});

	it("shows the protected Space form and stores the normalized password text", async () => {
		createWebSpaceApiMock.mockReturnValue(
			createPublicSpaceApi({
				getStatus: vi.fn(() => {
					throw createProtectedSpaceError("space.password_required");
				}),
				listSignalEnvelopes: vi.fn(() => {
					throw createProtectedSpaceError("space.password_required");
				}),
				listThreads: vi.fn(() => {
					throw createProtectedSpaceError("space.password_required");
				}),
			})
		);

		renderPublicSpace({ isAuthenticated: false });

		expect(await screen.findByText("View This Protected Space")).not.toBeNull();
		fireEvent.change(screen.getByLabelText("Space password"), {
			target: { value: "  secret-pass  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "View Space" }));

		await waitFor(() => {
			expect(rememberProtectedSpaceAccessMock).toHaveBeenCalledWith({
				data: {
					spaceId: "space-123",
					password: "secret-pass",
				},
			});
		});
	});

	it("keeps the protected Space form visible when password attempts are rate limited", async () => {
		createWebSpaceApiMock.mockReturnValue(
			createPublicSpaceApi({
				getStatus: vi.fn(() => {
					throw createProtectedSpaceError("space.password_rate_limited");
				}),
				listSignalEnvelopes: vi.fn(() => {
					throw createProtectedSpaceError("space.password_rate_limited");
				}),
				listThreads: vi.fn(() => {
					throw createProtectedSpaceError("space.password_rate_limited");
				}),
			})
		);

		renderPublicSpace({ isAuthenticated: false });

		expect(await screen.findByText("View This Protected Space")).not.toBeNull();
		expect(
			screen.getByText("Too many password attempts. Try again in a minute.")
		).not.toBeNull();
		expect(screen.getByRole("button", { name: "View Space" })).not.toBeNull();
	});

	it("opens one active human membership through the canonical Web viewer entry", async () => {
		createWebSpaceApiMock.mockReturnValue(
			createPublicSpaceApi({
				getViewerMembership: vi.fn(async () => ({
					spaceId: "space-123",
					activeMemberProfiles: [
						{
							profileId: "human-1",
							profileKind: "human",
							profileName: "Mira",
							lastEnteredAt: null,
						},
					],
					preferredOpenProfileId: "human-1",
				})),
			})
		);

		renderPublicSpace({ isAuthenticated: true });

		await waitFor(() => {
			expect(useNavigateMock).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/spaces/space-123",
			});
		});
		expect(resolveActiveOrganizationSpacePathMock).toHaveBeenCalledWith({
			data: {
				routeFamily: "/spaces/space-123",
				spaceId: "space-123",
			},
		});
	});

	it("opens an agent-only membership through the canonical Human viewer without joining the Human", async () => {
		const spaceApi = createPublicSpaceApi({
			getViewerMembership: vi.fn(async () => ({
				spaceId: "space-123",
				activeMemberProfiles: [
					{
						profileId: "agt_11111111-1111-4111-8111-111111111111",
						profileKind: "agent",
						profileName: "Mira Agent",
						lastEnteredAt: null,
					},
				],
				preferredOpenProfileId: "agt_11111111-1111-4111-8111-111111111111",
			})),
		});
		createWebSpaceApiMock.mockReturnValue(spaceApi);

		renderPublicSpace({ isAuthenticated: true });

		await waitFor(() => {
			expect(useNavigateMock).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/spaces/space-123",
			});
		});
		expect(spaceApi.addMembers).not.toHaveBeenCalled();
	});

	it("does not expose Agent members as Web viewer choices when multiple account profiles are members", async () => {
		createWebSpaceApiMock.mockReturnValue(
			createPublicSpaceApi({
				getViewerMembership: vi.fn(async () => ({
					spaceId: "space-123",
					activeMemberProfiles: [
						{
							profileId: "agt_22222222-2222-4222-8222-222222222222",
							profileKind: "agent",
							profileName: "Quinn Agent",
							lastEnteredAt: "2026-05-13T00:00:00.000Z",
						},
						{
							profileId: "human-1",
							profileKind: "human",
							profileName: "Mira",
							lastEnteredAt: null,
						},
						{
							profileId: "human-2",
							profileKind: "human",
							profileName: "Casey",
							lastEnteredAt: null,
						},
					],
					preferredOpenProfileId: null,
				})),
			})
		);

		renderPublicSpace({ isAuthenticated: true });

		await waitFor(() => {
			expect(useNavigateMock).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/spaces/space-123",
			});
		});
		expect(
			screen.queryByRole("combobox", { name: "Join Space as" })
		).toBeNull();
	});

	it("lets an authenticated non-member join in place as their human profile", async () => {
		const spaceApi = createPublicSpaceApi({
			getViewerMembership: vi.fn(async () => ({
				spaceId: "space-123",
				activeMemberProfiles: [],
				preferredOpenProfileId: null,
			})),
		});
		createWebSpaceApiMock.mockReturnValue(spaceApi);
		listStartProfilesMock.mockResolvedValue([
			createHumanProfile({
				openMeldProfileId: "human-self",
				profileName: "My Human",
			}),
		]);

		renderPublicSpace({ isAuthenticated: true });

		// The button renders disabled while profiles load, then enables once the
		// viewer's human profile resolves — wait for the enabled state before
		// clicking so we exercise the real join, not the loading placeholder.
		await waitFor(() => {
			const button = screen.getByRole("button", {
				name: JOIN_SPACE_BUTTON_PATTERN,
			}) as HTMLButtonElement;
			expect(button.disabled).toBe(false);
		});
		expect(useNavigateMock).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole("button", { name: JOIN_SPACE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(spaceApi.addMembers).toHaveBeenCalledWith(
				expect.objectContaining({
					memberProfileIds: ["human-self"],
					spaceId: "space-123",
				})
			);
		});
		await waitFor(() => {
			expect(useNavigateMock).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/spaces/space-123?profileId=human-self",
			});
		});
	});

	it("requires the Space password before an authenticated non-member can join a public-view Space", async () => {
		const spaceApi = createPublicSpaceApi({
			getStatus: vi.fn(async () => ({
				spaceId: "space-123",
				generatedAt: "2026-05-13T00:00:00.000Z",
				name: "Shared Roadmap",
				accessMode: "public_view_join_password",
				passwordProtected: false,
				dispatchPolicy: { mode: "mention_only" },
				publicationMode: "collaboration",
				allowedActions: ["post_message", "post_status", "stay_silent"],
				resultArchivePolicy: { mode: "all_final_results" },
				entryBrief: "default",
				dispatchBrief: "default",
				members: {
					totalCount: 1,
					humanCount: 1,
					agentCount: 0,
					liveNowCount: 1,
					liveHumanCount: 1,
					liveAgentCount: 0,
				},
			})),
			getViewerMembership: vi.fn(async () => ({
				spaceId: "space-123",
				activeMemberProfiles: [],
				preferredOpenProfileId: null,
			})),
		});
		createWebSpaceApiMock.mockReturnValue(spaceApi);
		listStartProfilesMock.mockResolvedValue([
			createHumanProfile({
				openMeldProfileId: "human-self",
				profileName: "My Human",
			}),
		]);

		renderPublicSpace({ isAuthenticated: true });

		expect(await screen.findByText("Password to join")).not.toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: JOIN_SPACE_BUTTON_PATTERN })
		);
		expect(
			await screen.findByText("Enter the Space password to join.")
		).not.toBeNull();
		expect(spaceApi.addMembers).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Space password"), {
			target: { value: "  secret-pass  " },
		});
		fireEvent.click(
			screen.getByRole("button", { name: JOIN_SPACE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(spaceApi.addMembers).toHaveBeenCalledWith(
				expect.objectContaining({
					memberProfileIds: ["human-self"],
					spaceId: "space-123",
					spacePassword: "secret-pass",
				})
			);
		});
	});

	it("sends an authenticated non-member with no human profile to Human Profiles", async () => {
		createWebSpaceApiMock.mockReturnValue(
			createPublicSpaceApi({
				getViewerMembership: vi.fn(async () => ({
					spaceId: "space-123",
					activeMemberProfiles: [],
					preferredOpenProfileId: null,
				})),
			})
		);
		listStartProfilesMock.mockResolvedValue([]);

		renderPublicSpace({ isAuthenticated: true });

		expect(await screen.findByText("Shared Roadmap")).not.toBeNull();
		expect(screen.getByRole("tab", { name: "Messages" })).not.toBeNull();
		expect(screen.getByRole("tab", { name: "Graph" })).not.toBeNull();
		fireEvent.click(
			await screen.findByRole("button", { name: "Create a Profile" })
		);
		await waitFor(() => {
			expect(useNavigateMock).toHaveBeenCalledWith({
				to: "/o/acme/people",
			});
		});
		expect(
			screen.queryByRole("combobox", { name: "Join Space as" })
		).toBeNull();
		expect(screen.queryByRole("link", { name: SIGN_IN_LINK_NAME })).toBeNull();
	});
});

function renderPublicSpace(input: { isAuthenticated: boolean }) {
	return render(
		<TestQueryClientProvider>
			<PublicSpacePage
				isAuthenticated={input.isAuthenticated}
				spaceId="space-123"
			/>
		</TestQueryClientProvider>
	);
}

function createPublicSpaceApi(
	overrides: Partial<PublicSpaceApiTestDouble> = {}
): PublicSpaceApiTestDouble {
	return {
		addMembers: vi.fn(async () => ({
			addedMemberIds: ["human-self"],
			alreadyMemberIds: [],
		})),
		getStatus: vi.fn(async () => ({
			spaceId: "space-123",
			generatedAt: "2026-05-13T00:00:00.000Z",
			name: "Shared Roadmap",
			accessMode: "public",
			passwordProtected: false,
			dispatchPolicy: { mode: "mention_only" },
			publicationMode: "collaboration",
			allowedActions: ["post_message", "post_status", "stay_silent"],
			resultArchivePolicy: { mode: "all_final_results" },
			entryBrief: "default",
			dispatchBrief: "default",
			members: {
				totalCount: 1,
				humanCount: 1,
				agentCount: 0,
				liveNowCount: 1,
				liveHumanCount: 1,
				liveAgentCount: 0,
			},
		})),
		listSignalEnvelopes: vi.fn(async () => ({
			envelopes: [createSignalEnvelope()],
			nextCursor: null,
		})),
		listThreads: vi.fn(async () => ({
			threads: [],
			previews: [],
		})),
		listThreadSignals: vi.fn(async () => ({
			signals: [],
			placements: [],
		})),
		getViewerMembership: vi.fn(async () => ({
			spaceId: "space-123",
			activeMemberProfiles: [],
			preferredOpenProfileId: null,
		})),
		...overrides,
	};
}

function createHumanProfile(input: {
	openMeldProfileId: string;
	profileName: string;
	isDefault?: boolean;
}) {
	return {
		openMeldProfileId: input.openMeldProfileId,
		createdAt: "2026-01-01T00:00:00.000Z",
		isDefault: input.isDefault ?? true,
		lastUsedAt: null,
		ownerName: "Viewer",
		ownerUserId: "user-123",
		profileHandle: input.openMeldProfileId,
		profileKind: "human" as const,
		profileName: input.profileName,
		status: "active" as const,
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

function createSignalEnvelope(): SignalEnvelope {
	return {
		v: 1,
		id: "signal-1",
		spaceId: "space-123",
		ts: Date.parse("2026-05-13T00:00:00.000Z"),
		profile: {
			kind: "human",
			profileId: "human-1",
			profileName: "Mira",
		},
		type: "signal.text",
		data: {
			text: "Hello public viewer.",
		},
	};
}

function createCenterAgentSignalEnvelope(input: {
	id: string;
	text: string;
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: Date.parse("2026-05-13T00:00:00.000Z"),
		profile: {
			kind: "agent",
			profileId: CENTER_AGENT_PROFILE_ID,
			profileName: "Center Agent",
		},
		type: "signal.text",
		data: {
			text: input.text,
		},
	};
}

function createPublicWakeSignalEnvelope(input: {
	id: string;
	text: string;
	ts: number;
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts,
		profile: {
			kind: "human",
			profileId: "human-1",
			profileName: "Mira",
		},
		type: "signal.text",
		data: {
			messageEnvelope: {
				activationTargets: [PUBLIC_AGENT_PROFILE_ID],
				referenceTargets: [],
				text: input.text,
			},
			meta: {
				clientMessageId: "client-public-wake",
			},
			text: input.text,
		},
	};
}

function createPublicAgentWakeReplyEnvelope(input: {
	id: string;
	replyToSignalId: string;
	text: string;
	ts: number;
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts,
		profile: {
			kind: "agent",
			profileId: PUBLIC_AGENT_PROFILE_ID,
			profileName: "Runner",
		},
		type: "signal.text",
		data: {
			messageEnvelope: {
				activationTargets: [],
				referenceTargets: [],
				replyToSignalId: input.replyToSignalId,
				text: input.text,
			},
			text: input.text,
		},
	};
}

function createProtectedSpaceError(
	code:
		| "space.password_required"
		| "space.password_invalid"
		| "space.password_rate_limited"
) {
	return new OpenMeldApiClientHttpError({
		code,
		message:
			code === "space.password_rate_limited"
				? "Too many password attempts. Try again in a minute."
				: "Space password required.",
		rawBody: "",
		requestId: "req-protected",
		status: code === "space.password_rate_limited" ? 429 : 401,
	});
}
