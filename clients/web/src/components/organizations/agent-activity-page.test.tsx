import type {
	AgentActivityInventoryCoverage,
	AgentActivityInventorySession,
	AgentActivityPublicSession,
	AgentActivitySessionInventoryResponse,
	AgentActivitySnapshotResponse,
	AgentActivityStatsResponse,
	ListProjectsResponse,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentActivityChanges } from "./agent-activity-changes";
import { AgentActivityOverview } from "./agent-activity-overview";
import {
	AgentActivityContent,
	AgentActivitySidebar,
} from "./agent-activity-page";
import {
	AgentActivitySessions,
	type AgentActivitySessionsFilters,
} from "./agent-activity-sessions";

const PROVIDER_SESSION_ID_PATTERN = /providerSessionId/u;
const STALE_ACTIVITY_PATTERN = /Activity data may be stale/iu;
const PRIVACY_COPY_PATTERN =
	/What OpenMeld shares: session titles and reviewed metadata/iu;
const REFRESH_FAILURE_PATTERN = /could not refresh current agent activity/iu;
const TRUNCATED_ACTIVITY_PATTERN = /newest 500 matching records/iu;
const FELIX_LANE_PATTERN = /Felix · Codex · working 26m/iu;
const SINCE_DATE_PATTERN = /since Jan 2, 2026/iu;
const TILDE_VALUE_PATTERN = /^~/u;
const COPY_PATTERN = /Copy/iu;
const STARTED_A_SESSION_PATTERN = /started a session/iu;
const NO_PROJECTS_SETUP_PATTERN = /Create your first Project/iu;
const AWAITING_FIRST_SESSION_PATTERN =
	/Waiting for the first reported session/iu;

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		activeOptions: _activeOptions,
		children,
		search: _search,
		to,
		...props
	}: {
		activeOptions?: unknown;
		children: ReactNode;
		search?: unknown;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useNavigate: () => navigateToSessions,
}));

const {
	listProjects,
	navigateToSessions,
	organization,
	readDirectory,
	readSessions,
	readSnapshot,
	readStats,
} = vi.hoisted(() => ({
	organization: {
		id: "org-acme",
		isPersonal: false as boolean,
		name: "Acme",
		slug: "acme",
	},
	listProjects: vi.fn<
		(input: { organizationId: string }) => Promise<ListProjectsResponse>
	>(async (input) => ({
		organizationId: input.organizationId,
		projects: [],
	})),
	navigateToSessions: vi.fn(),
	readDirectory: vi.fn<() => Promise<OrganizationDirectoryResponse>>(),
	readSessions:
		vi.fn<
			(input: {
				organizationId: string;
				projectId?: string;
				provider?: string;
			}) => Promise<AgentActivitySessionInventoryResponse>
		>(),
	readSnapshot:
		vi.fn<
			(input: {
				includeProviderMetadata?: boolean;
				organizationId: string;
				projectId?: string;
			}) => Promise<AgentActivitySnapshotResponse>
		>(),
	readStats:
		vi.fn<
			(input: {
				organizationId: string;
				projectId?: string;
			}) => Promise<AgentActivityStatsResponse>
		>(),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: organization,
		currentUserId: "user-1",
	}),
}));
vi.mock("#/lib/organizations/agent-activity", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("#/lib/organizations/agent-activity")>();
	return {
		...original,
		readCurrentAgentActivitySessions: readSessions,
		readCurrentAgentActivitySnapshot: readSnapshot,
		readCurrentAgentActivityStats: readStats,
	};
});
vi.mock("#/lib/organizations/projects", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("#/lib/organizations/projects")>();
	return {
		...original,
		listCurrentProjects: listProjects,
	};
});
vi.mock(
	"#/lib/organizations/organization-directory",
	async (importOriginal) => {
		const original =
			await importOriginal<
				typeof import("#/lib/organizations/organization-directory")
			>();
		return {
			...original,
			readCurrentOrganizationDirectory: readDirectory,
		};
	}
);

beforeEach(() => {
	readDirectory.mockResolvedValue(directory());
	readSnapshot.mockImplementation(async (input) =>
		snapshot({ organizationId: input.organizationId })
	);
	readSessions.mockImplementation(async (input) =>
		sessionInventory({ organizationId: input.organizationId })
	);
	readStats.mockImplementation(async (input) =>
		stats({ organizationId: input.organizationId })
	);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	organization.id = "org-acme";
	organization.isPersonal = false;
	organization.name = "Acme";
	organization.slug = "acme";
});

describe("Agent Activity pages", () => {
	it("stacks the Project controls before they can clip a phone viewport", () => {
		renderPage("overview");

		const manageProjects = screen.getByRole("link", {
			name: "Manage Projects",
		});
		const controls = manageProjects.parentElement;
		const projectScope = screen.getByRole("combobox", { name: "Project scope" })
			.parentElement?.parentElement;

		expect(controls?.className).toContain("w-full");
		expect(controls?.className).toContain("flex-col");
		expect(controls?.className).toContain("sm:w-auto");
		expect(controls?.className).toContain("sm:flex-row");
		expect(projectScope?.className).toContain("w-full");
		expect(projectScope?.className).toContain("min-w-0");
		expect(projectScope?.className).toContain("sm:w-auto");
		expect(projectScope?.className).toContain("sm:min-w-44");
	});

	it("uses the shared grouped inner-sidebar scale and preserves Project scope across sections", () => {
		render(
			<AgentActivitySidebar
				activeSectionId="overview"
				routes={{
					changes: "/o/acme/agent-activity/changes",
					overview: "/o/acme/agent-activity",
					sessions: "/o/acme/agent-activity/sessions",
				}}
			/>
		);

		const sidebar = screen.getByRole("navigation", {
			name: "Agent Activity",
		});
		const overviewLink = screen.getByRole("link", { name: "Overview" });

		expect(sidebar.getAttribute("data-slot")).toBe("app-contextual-sidebar");
		expect(
			screen.getByRole("heading", { level: 2, name: "Monitor" })
		).toBeTruthy();
		expect(overviewLink.firstElementChild?.className).toContain("h-7");
		expect(overviewLink.firstElementChild?.className).toContain("text-[13px]");
		expect(overviewLink.getAttribute("href")).toBe("/o/acme/agent-activity");
	});

	it("replaces the Overview dashboard with first-Project setup guidance", async () => {
		renderPage("overview");

		expect(
			await screen.findByRole("heading", { name: NO_PROJECTS_SETUP_PATTERN })
		).toBeTruthy();
		expect(
			screen.getByText(
				"Create a Project before OpenMeld can organize and report agent sessions."
			)
		).toBeTruthy();
		const createProjectButton = screen.getByRole("button", {
			name: "Create Project",
		});
		expect(screen.queryByText("openmeld projects bind <slug>")).toBeNull();
		expect(screen.queryByText("Working now")).toBeNull();
		expect(screen.queryByText("Activity timeline")).toBeNull();
		expect(screen.queryByText("Recent sessions")).toBeNull();

		fireEvent.click(createProjectButton);
		expect(await screen.findByRole("dialog")).toBeTruthy();
		expect(screen.getByRole("textbox", { name: "Project name" })).toBeTruthy();
	});

	it("asks an administrator to create the first Project without exposing the action", async () => {
		renderPage("overview", { canManage: false });

		expect(
			await screen.findByRole("heading", { name: NO_PROJECTS_SETUP_PATTERN })
		).toBeTruthy();
		expect(
			screen.getByText(
				"Ask an organization administrator to create the first Project."
			)
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Create Project" })).toBeNull();
	});

	it("keeps the full dashboard while waiting for a Project's first session", async () => {
		const projects = [
			project({ id: "project-first", slug: "agent-router" }),
			project({ id: "project-second", slug: "openmeld" }),
		];
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValueOnce(snapshot({ projects }));

		renderPage("overview");

		expect(
			await screen.findByText(AWAITING_FIRST_SESSION_PATTERN)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Confirm a folder is connected in Manage Projects, then start or continue a coding-agent session in that folder."
			)
		).toBeTruthy();
		expect(
			screen.queryByText("openmeld projects bind agent-router")
		).toBeNull();
		expect(screen.queryByRole("button", { name: COPY_PATTERN })).toBeNull();
		expect(screen.getByText("Working now")).toBeTruthy();
		expect(await screen.findByText("Activity timeline")).toBeTruthy();
		expect(screen.getByText("Recent sessions")).toBeTruthy();
	});

	it("leaves an active Overview unchanged after the first session appears", async () => {
		const projects = [project({ id: "project-active" })];
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValueOnce(
			snapshot({ projects, sessions: [session()] })
		);

		renderPage("overview");

		expect(await screen.findByText("Working now")).toBeTruthy();
		expect(await screen.findByText("Activity timeline")).toBeTruthy();
		expect(screen.getByText("Recent sessions")).toBeTruthy();
		expect(screen.queryByText(NO_PROJECTS_SETUP_PATTERN)).toBeNull();
		expect(screen.queryByText(AWAITING_FIRST_SESSION_PATTERN)).toBeNull();
	});

	it("links empty Sessions and Changes to canonical Project setup when no Project exists", async () => {
		const sessionsPage = renderPage("sessions");
		const sessionsLink = await screen.findByRole("link", {
			name: "Create Project",
		});
		expect(sessionsLink.getAttribute("href")).toBe("/o/acme/projects");

		sessionsPage.unmount();
		renderPage("changes");
		const changesLink = await screen.findByRole("link", {
			name: "Create Project",
		});
		expect(changesLink.getAttribute("href")).toBe("/o/acme/projects");
	});

	it("sends Sessions and Changes to Manage Projects while waiting for the first report", async () => {
		const projects = [project({ id: "project-awaiting" })];
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValue(snapshot({ projects }));

		const sessionsPage = renderPage("sessions");
		expect(
			await screen.findByText(AWAITING_FIRST_SESSION_PATTERN)
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Create Project" })).toBeNull();
		expect(
			screen
				.getAllByRole("link", { name: "Manage Projects" })
				.every((link) => link.getAttribute("href") === "/o/acme/projects")
		).toBe(true);
		expect(
			screen.getAllByRole("link", { name: "Manage Projects" })
		).toHaveLength(2);

		sessionsPage.unmount();
		renderPage("changes");
		expect(
			await screen.findByText(AWAITING_FIRST_SESSION_PATTERN)
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Create Project" })).toBeNull();
		expect(
			screen
				.getAllByRole("link", { name: "Manage Projects" })
				.every((link) => link.getAttribute("href") === "/o/acme/projects")
		).toBe(true);
		expect(
			screen.getAllByRole("link", { name: "Manage Projects" })
		).toHaveLength(2);
	});

	it("offers to clear Session filters when recorded sessions do not match", async () => {
		const projects = [project({ id: "project-active" })];
		const onSessionFiltersChange = vi.fn();
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValue(
			snapshot({ projects, sessions: [session({ provider: "codex" })] })
		);
		renderPage("sessions", {
			onSessionFiltersChange,
			sessionFilters: {
				cursor: null,
				memberUserId: null,
				origin: null,
				provider: "claude-code",
				query: null,
				status: null,
			},
		});

		expect(
			await screen.findByText("No Sessions match these filters.")
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
		expect(onSessionFiltersChange).toHaveBeenCalledWith({
			cursor: null,
			memberUserId: null,
			origin: null,
			provider: null,
			query: null,
			status: null,
		});
	});

	it("explains an empty Changes window after session reporting is active", async () => {
		const projects = [project({ id: "project-active" })];
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValue(
			snapshot({ projects, sessions: [session()] })
		);

		renderPage("changes");

		expect(
			await screen.findByText("No state changes in the last 4 hours.")
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Create Project" })).toBeNull();
		expect(
			screen.getAllByRole("link", { name: "Manage Projects" })
		).toHaveLength(1);
	});

	it("uses one URL-backed Project scope across Monitor pages and aggregate stats", async () => {
		const onUrlUpdate = vi.fn();
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects: [
				project({ id: "project-active" }),
				project({ id: "project-two", slug: "agent-router" }),
			],
		});
		readSnapshot.mockImplementation(async (input) =>
			snapshot({
				organizationId: input.organizationId,
				projects: [
					project({ id: "project-active" }),
					project({ id: "project-two", slug: "agent-router" }),
				],
				sessions:
					input.projectId === "project-two"
						? [
								session({
									id: "project-two-session",
									projectId: "project-two",
									title: "Project Two work",
								}),
							]
						: [],
			})
		);
		readSessions.mockImplementation(async (input) =>
			sessionInventory({
				organizationId: input.organizationId,
				sessions:
					input.projectId === "project-two"
						? [
								inventorySession({
									nativeSessionTitle: "Project Two work",
									project: {
										id: "project-two",
										name: "Agent Router",
										slug: "agent-router",
									},
								}),
							]
						: [],
			})
		);

		const overview = renderPage("overview", {
			onUrlUpdate,
			searchParams: "?project=project-two",
		});

		const scope = await screen.findByRole("combobox", {
			name: "Project scope",
		});
		await waitFor(() => {
			expect(scope.textContent).toContain("Agent Router");
			expect(readSnapshot).toHaveBeenCalledWith(
				expect.objectContaining({ projectId: "project-two" })
			);
			expect(readStats).toHaveBeenCalledWith(
				expect.objectContaining({ projectId: "project-two" })
			);
		});

		fireEvent.click(scope);
		fireEvent.click(
			await screen.findByRole("option", { name: "All Projects" })
		);
		await waitFor(() => {
			expect(onUrlUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ queryString: "" })
			);
		});

		overview.unmount();
		renderPage("sessions", { searchParams: "?project=project-two" });
		expect(await screen.findByText("Project Two work")).toBeTruthy();
		expect(
			screen.queryByRole("combobox", { name: "Filter by Project" })
		).toBeNull();
	});

	it("uses the shared card frame for the Activity timeline without stacking an extra border", async () => {
		const projects = [project({ id: "project-active" })];
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValueOnce(snapshot({ projects }));
		renderPage("overview");

		const rhythmCard = (await screen.findByText("Activity timeline")).closest(
			'[data-slot="card"]'
		);
		expect(rhythmCard).toBeTruthy();
		expect(rhythmCard?.classList.contains("border")).toBe(false);
	});

	it("keeps the compact privacy boundary and hands Project management to Projects", async () => {
		const projects = [project({ id: "project-active" })];
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValueOnce(
			snapshot({ projects, sessions: [session()] })
		);
		renderPage("overview");

		expect(
			await screen.findByRole("heading", { name: "Agent Activity" })
		).toBeTruthy();
		expect(screen.getByText(PRIVACY_COPY_PATTERN)).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Manage Projects" }).getAttribute("href")
		).toBe("/o/acme/projects");
		expect(screen.queryByRole("button", { name: "Create Project" })).toBeNull();
	});

	it("works in a personal Organization and remounts window state on Organization change", async () => {
		organization.id = "personal-felix";
		organization.isPersonal = true;
		organization.name = "Felix";
		listProjects.mockImplementation(async (input) => ({
			organizationId: input.organizationId,
			projects: [project({ id: "project-active" })],
		}));
		readSnapshot.mockImplementation(async (input) =>
			snapshot({
				organizationId: input.organizationId,
				projects: [project({ id: "project-active" })],
				sessions: [session({ projectId: "project-active" })],
			})
		);

		const overviewPage = renderPage("overview");
		expect(await screen.findByText("Personal workspace")).toBeTruthy();
		fireEvent.click(await screen.findByRole("button", { name: "Show 1h" }));
		expect(
			screen
				.getByRole("button", { name: "Show 1h" })
				.getAttribute("aria-pressed")
		).toBe("true");
		organization.id = "org-acme";
		organization.isPersonal = false;
		overviewPage.rerender(renderPageTree(overviewPage.queryClient, "overview"));
		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Show 4h" })
					.getAttribute("aria-pressed")
			).toBe("true");
		});
	});

	it("keeps Project references read-only regardless of management authority", async () => {
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects: [
				project({ canArchive: false, canManage: false, id: "project-read" }),
				project({
					canArchive: true,
					canManage: true,
					id: "project-manage",
					slug: "agent-router",
				}),
			],
		});
		renderPage("overview");

		expect(
			await screen.findByRole("link", { name: "Manage Projects" })
		).toBeTruthy();
		expect(
			screen.queryByText("openmeld projects bind agent-router")
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
	});

	it("routes Activity timeline rows to member-filtered Sessions and renders public provider metadata without private identity", async () => {
		const nowMs = Date.now();
		const sessions = [
			session({
				gitCommit: "abc123def456",
				id: "public-session-1",
				model: "gpt-5.6-sol",
				projectId: "project-active",
				providerMetadata: {
					approvalPolicy: "never",
					cliVersion: "0.144.1",
					contextWindow: 272_000,
					modelProvider: "openai",
					originator: "desktop",
					reasoningEffort: "xhigh",
					sandboxMode: "danger-full-access",
					source: "rollout",
				},
				startedAtMs: nowMs - 26 * 60_000,
				title: "Build Agent Activity",
			}),
			session({
				clientKind: "unknown",
				gitBranch: null,
				id: "public-session-unknown-client",
				memberName: "Mira",
				memberUserId: "user-2",
				model: null,
				projectId: "project-active",
				startedAtMs: nowMs - 5 * 60_000,
			}),
		];
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects: [project({ id: "project-active" })],
		});
		readSnapshot.mockResolvedValue(
			snapshot({
				asOfMs: nowMs,
				projects: [project({ id: "project-active" })],
				sessions,
			})
		);
		readSessions.mockResolvedValue(
			sessionInventory({
				asOfMs: nowMs,
				sessions: [
					inventorySession({
						lastActiveAtMs: nowMs,
						nativeSessionId: "native-codex-thread-1",
						nativeSessionTitle: "Build Agent Activity",
					}),
				],
			})
		);

		const overview = renderPage("overview");
		await waitFor(() => {
			expect(readSnapshot).toHaveBeenCalledWith(
				expect.objectContaining({ includeProviderMetadata: true })
			);
		});
		expect(readSnapshot.mock.calls[0]?.[0]).not.toHaveProperty("projectId");
		expect(readSnapshot.mock.calls[0]?.[0]).not.toHaveProperty("provider");
		expect(readSnapshot.mock.calls[0]?.[0]).not.toHaveProperty("status");
		fireEvent.click(
			await screen.findByRole("button", {
				name: FELIX_LANE_PATTERN,
			})
		);
		expect(navigateToSessions).toHaveBeenCalledWith({ member: "user-1" });

		overview.unmount();
		const sessionsPage = renderPage("sessions");
		expect(await screen.findByText("Build Agent Activity")).toBeTruthy();
		expect(screen.getByText("native-codex-thread-1")).toBeTruthy();
		expect(screen.getByText("Felix’s Mac")).toBeTruthy();
		expect(screen.getAllByText("Created locally").length).toBeGreaterThan(0);
		expect(
			screen.getByRole("button", { name: "Copy Native Session ID" })
		).toBeTruthy();
		expect(
			screen
				.getByText("Session inventory")
				.closest('[data-slot="card"]')
				?.className.includes("rounded-md")
		).toBe(true);
		expect(screen.queryByText(PROVIDER_SESSION_ID_PATTERN)).toBeNull();
		expect(sessionsPage.container.textContent).not.toContain(
			"danger-full-access"
		);
	});

	it("shows dashboard stats from snapshot and STATS1 without blocking on aggregate failure", async () => {
		const nowMs = Date.now();
		const projects = [project({ id: "project-active" })];
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValueOnce(
			snapshot({
				asOfMs: nowMs,
				projects,
				sessions: [session({ startedAtMs: nowMs - 90 * 60_000 })],
				sessionsTruncated: true,
			})
		);
		readStats.mockResolvedValueOnce(
			stats({
				sinceMs: new Date("2026-01-02T00:00:00.000Z").getTime(),
				totalActiveDurationMs: 1247 * 60 * 60_000,
			})
		);
		renderPage("overview");

		expect(await screen.findByText("1,247h")).toBeTruthy();
		expect(screen.getByText(SINCE_DATE_PATTERN)).toBeTruthy();
		expect(screen.queryByText(TILDE_VALUE_PATTERN)).toBeNull();
		expect(
			screen.getByText("Totals reflect the newest 500 sessions.")
		).toBeTruthy();
		expect(screen.queryByText(TRUNCATED_ACTIVITY_PATTERN)).toBeNull();
	});

	it("does not offer Resume for a stale Session", async () => {
		const nowMs = Date.now();
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects: [project({ id: "project-active" })],
		});
		readSessions.mockResolvedValue(
			sessionInventory({
				asOfMs: nowMs,
				sessions: [
					inventorySession({
						dataState: "stale",
						inventoryUpdatedAtMs: nowMs - 10 * 60_000,
					}),
				],
			})
		);

		renderPage("sessions");

		expect(await screen.findByText("Data may be stale")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Resume as Agent Profile" })
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "Create Agent Profile" })
		).toBeTruthy();
	});

	it("offers native Fork when the Session reports that capability", async () => {
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects: [project({ id: "project-active" })],
		});
		readSessions.mockResolvedValue(
			sessionInventory({
				sessions: [inventorySession({ canFork: true })],
			})
		);

		renderPage("sessions");

		expect(
			await screen.findByRole("button", { name: "Fork as Agent Profile" })
		).toBeTruthy();
	});

	it("keeps teammate Agent requests hidden during the launch hold", async () => {
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects: [project({ id: "project-active" })],
		});
		readSessions.mockResolvedValue(
			sessionInventory({
				sessions: [
					inventorySession({
						canFork: true,
						owner: { name: "Ashley", userId: "user-2" },
					}),
				],
			})
		);

		renderPage("sessions");

		expect(await screen.findByText("Ashley")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Request Resume Profile" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Request Fork Profile" })
		).toBeNull();
	});

	it.each([
		{
			message:
				"OpenMeld couldn't establish the current Session Inventory. No Sessions are shown until the connected computer reports a complete inventory.",
			state: "error" as const,
		},
		{
			message:
				"Session Inventory is stale, so OpenMeld isn't claiming there are no Sessions. Wait for a fresh sync from the connected computer.",
			state: "stale" as const,
		},
	])("keeps $state empty inventory coverage explicit", async ({
		message,
		state,
	}) => {
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects: [project({ id: "project-active" })],
		});
		readSessions.mockResolvedValue(
			sessionInventory({ coverage: [inventoryCoverage(state)] })
		);

		renderPage("sessions");

		expect(await screen.findByText(message)).toBeTruthy();
		expect(
			screen.queryByText(
				"No Sessions are currently available from connected Projects."
			)
		).toBeNull();
	});

	it.each([
		{
			message:
				"OpenMeld couldn't establish the current Session Inventory. No Sessions are shown until the connected computer reports a complete inventory.",
			state: "error" as const,
		},
		{
			message:
				"Session Inventory is stale, so OpenMeld isn't claiming there are no Sessions. Wait for a fresh sync from the connected computer.",
			state: "stale" as const,
		},
	])("shows $state coverage before a filtered-empty explanation", async ({
		message,
		state,
	}) => {
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects: [project({ id: "project-active" })],
		});
		readSessions.mockResolvedValue(
			sessionInventory({ coverage: [inventoryCoverage(state)] })
		);

		renderPage("sessions", {
			sessionFilters: {
				cursor: null,
				memberUserId: null,
				origin: null,
				provider: "codex",
				query: null,
				status: null,
			},
		});

		expect(await screen.findByText(message)).toBeTruthy();
		expect(screen.queryByText("No Sessions match these filters.")).toBeNull();
		expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
	});

	it("does not offer Agent Profile actions for a Session with conflicting connections", async () => {
		listProjects.mockResolvedValue({
			organizationId: "org-acme",
			projects: [project({ id: "project-active" })],
		});
		readSessions.mockResolvedValue(
			sessionInventory({
				sessions: [inventorySession({ bindingState: "conflict" })],
			})
		);

		renderPage("sessions");

		expect(
			await screen.findByText(
				"This Session has conflicting Agent Profile connections."
			)
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Resume as Agent Profile" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Create Agent Profile" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Fork as Agent Profile" })
		).toBeNull();
	});

	it("uses the Core cursor for stable Session Inventory pagination", async () => {
		const onSessionFiltersChange = vi.fn();
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects: [project({ id: "project-active" })],
		});
		readSessions.mockResolvedValueOnce(
			sessionInventory({
				nextCursor: "cursor-page-2",
				sessions: [inventorySession()],
			})
		);
		renderPage("sessions", { onSessionFiltersChange });

		fireEvent.click(await screen.findByRole("button", { name: "Next page" }));

		expect(onSessionFiltersChange).toHaveBeenCalledWith({
			cursor: "cursor-page-2",
			memberUserId: null,
			origin: null,
			provider: null,
			query: null,
			status: null,
		});
	});

	it("distinguishes earlier daily aggregates from today's live agent time", async () => {
		const nowMs = Date.now();
		const projects = [project({ id: "project-active" })];
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValueOnce(
			snapshot({
				asOfMs: nowMs,
				projects,
				sessions: [session({ startedAtMs: nowMs - 90 * 60_000 })],
			})
		);
		readStats.mockResolvedValueOnce(stats());
		renderPage("overview");

		const earlierAgentTime = await screen.findByText("Earlier agent time");
		await waitFor(() => {
			expect(
				earlierAgentTime.closest('[data-slot="card"]')?.textContent
			).toContain("0h");
		});
		expect(
			earlierAgentTime.closest('[data-slot="card"]')?.textContent
		).toContain("updated daily");
		expect(screen.queryByText("Total agent time")).toBeNull();
	});

	it("keeps all state changes, folds started-to-active noise, and preserves heartbeat disclosure", async () => {
		const nowMs = Date.now();
		readSnapshot.mockResolvedValueOnce(
			snapshot({
				asOfMs: nowMs - 400_000,
				digestsTruncated: true,
				recentEvents: [
					event({ eventId: "heartbeat", eventType: "heartbeat" }),
					event({
						eventId: "active",
						eventType: "session_active",
						observedAtMs: nowMs - 10_000,
					}),
					event({
						eventId: "started",
						eventType: "session_started",
						observedAtMs: nowMs - 40_000,
					}),
					event({
						eventId: "idle",
						eventType: "session_idle",
						memberName: "Mira",
						memberUserId: "user-2",
						projectId: "project-two",
						provider: "claude-code",
						status: "idle",
					}),
				],
				sessionsTruncated: true,
				stalenessThresholdMs: 300_000,
			})
		);
		renderPage("changes");

		expect(
			await screen.findByText("Felix · Codex started working")
		).toBeTruthy();
		expect(screen.queryByText(STARTED_A_SESSION_PATTERN)).toBeNull();
		expect(screen.getByText("Mira · Claude Code went idle")).toBeTruthy();
		expect(
			screen.getByText(
				"1 heartbeat is folded into the activity bands — only state changes appear here."
			)
		).toBeTruthy();
		expect(screen.getByText(STALE_ACTIVITY_PATTERN)).toBeTruthy();
		expect(screen.queryByText(TRUNCATED_ACTIVITY_PATTERN)).toBeNull();
	});

	it("keeps the Projects handoff available when the activity snapshot fails", async () => {
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects: [project({ id: "project-active", slug: "openmeld" })],
		});
		readSnapshot.mockRejectedValueOnce(
			Object.assign(new Error("snapshot unavailable"), {
				code: "gateway.invalid_response",
			})
		);
		renderPage("overview");

		expect(
			await screen.findByRole("link", { name: "Manage Projects" })
		).toBeTruthy();
		expect(screen.queryByText("openmeld projects bind openmeld")).toBeNull();
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
		expect(await screen.findByText(REFRESH_FAILURE_PATTERN)).toBeTruthy();
		expect(screen.queryByText(NO_PROJECTS_SETUP_PATTERN)).toBeNull();
		expect(screen.queryByText(AWAITING_FIRST_SESSION_PATTERN)).toBeNull();
	});

	it("removes expired activity on the next refresh while retaining stale failure evidence", async () => {
		vi.useFakeTimers();
		const nowMs = new Date("2026-07-13T00:00:00.000Z").getTime();
		vi.setSystemTime(nowMs);
		const projects = [project({ id: "project-active" })];
		listProjects.mockResolvedValueOnce({
			organizationId: "org-acme",
			projects,
		});
		readSnapshot.mockResolvedValueOnce(
			snapshot({
				asOfMs: nowMs,
				projects,
				sessions: [
					session({
						expiresAtMs: nowMs + 5000,
						lastObservedAtMs: nowMs,
						startedAtMs: nowMs - 1000,
					}),
				],
				stalenessThresholdMs: 10_000,
			})
		);
		renderPage("overview");
		await vi.waitFor(() => {
			expect(
				screen.getByText("Working now").closest('[data-slot="card"]')
					?.textContent
			).toContain("1");
		});

		readSnapshot.mockRejectedValueOnce(
			Object.assign(new Error("snapshot unavailable"), {
				code: "gateway.invalid_response",
			})
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000);
		});
		expect(readSnapshot).toHaveBeenCalledTimes(2);
		expect(
			screen.getByText("Working now").closest('[data-slot="card"]')?.textContent
		).toContain("0");
		expect(screen.getByText(STALE_ACTIVITY_PATTERN)).toBeTruthy();
		expect(screen.getByText(REFRESH_FAILURE_PATTERN)).toBeTruthy();
	});
});

type ActivityTestSection = "changes" | "overview" | "sessions";

function renderPage(
	section: ActivityTestSection,
	options: {
		canManage?: boolean;
		onSessionFiltersChange?: (filters: AgentActivitySessionsFilters) => void;
		onUrlUpdate?: (event: { queryString: string }) => void;
		searchParams?: string;
		sessionFilters?: AgentActivitySessionsFilters;
	} = {}
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return {
		...render(renderPageTree(queryClient, section, options)),
		queryClient,
	};
}

function renderPageTree(
	queryClient: QueryClient,
	section: ActivityTestSection,
	options: {
		canManage?: boolean;
		onSessionFiltersChange?: (filters: AgentActivitySessionsFilters) => void;
		onUrlUpdate?: (event: { queryString: string }) => void;
		searchParams?: string;
		sessionFilters?: AgentActivitySessionsFilters;
	} = {}
) {
	return (
		<NuqsTestingAdapter
			hasMemory
			onUrlUpdate={options.onUrlUpdate}
			searchParams={options.searchParams}
		>
			<QueryClientProvider client={queryClient}>
				<AgentActivityContent>
					{renderSection(section, options.canManage ?? true, options)}
				</AgentActivityContent>
			</QueryClientProvider>
		</NuqsTestingAdapter>
	);
}

function renderSection(
	section: ActivityTestSection,
	canManage: boolean,
	options: {
		onSessionFiltersChange?: (filters: AgentActivitySessionsFilters) => void;
		sessionFilters?: AgentActivitySessionsFilters;
	} = {}
) {
	if (section === "overview") {
		return (
			<AgentActivityOverview
				canManage={canManage}
				onNavigateToSessions={navigateToSessions}
			/>
		);
	}
	if (section === "changes") {
		return <AgentActivityChanges />;
	}
	const filters: AgentActivitySessionsFilters = options.sessionFilters ?? {
		cursor: null,
		memberUserId: null,
		origin: null,
		provider: null,
		query: null,
		status: null,
	};
	return (
		<AgentActivitySessions
			filters={filters}
			onFiltersChange={options.onSessionFiltersChange ?? vi.fn()}
		/>
	);
}

function snapshot(
	overrides: Partial<AgentActivitySnapshotResponse> = {}
): AgentActivitySnapshotResponse {
	return {
		asOfMs: Date.now(),
		digests: [],
		digestsTruncated: false,
		organizationId: "org-acme",
		projects: [],
		recentEvents: [],
		sessions: [],
		sessionsTruncated: false,
		stalenessThresholdMs: 300_000,
		...overrides,
	};
}

function sessionInventory(
	overrides: Partial<AgentActivitySessionInventoryResponse> & {
		organizationId?: string;
	} = {}
): AgentActivitySessionInventoryResponse {
	const organizationId = overrides.organizationId ?? "org-acme";
	return {
		asOfMs: Date.now(),
		coverage: [],
		nextCursor: null,
		organization: { id: organizationId, name: "Acme" },
		sessions: [],
		...overrides,
	};
}

function inventoryCoverage(
	state: AgentActivityInventoryCoverage["state"]
): AgentActivityInventoryCoverage {
	const nowMs = Date.now();
	return {
		agentControllerRef: "builtin:codex",
		computerId: "computer-public-1",
		lastAttemptAtMs: nowMs,
		lastCompleteAtMs: state === "stale" ? nowMs - 60_000 : null,
		problemCode: state === "error" ? "provider_error" : "inventory_stale",
		projectId: "project-active",
		provider: "codex",
		state,
	};
}

function inventorySession(
	overrides: Partial<AgentActivityInventorySession> = {}
): AgentActivityInventorySession {
	const nowMs = Date.now();
	return {
		boundAgentProfileId: null,
		bindingState: "unbound",
		canFork: false,
		canResume: true,
		computer: {
			id: "computer-public-1",
			lastSeenAtMs: nowMs,
			name: "Felix’s Mac",
			state: "online",
		},
		dataState: "current",
		inventoryUpdatedAtMs: nowMs,
		lastActiveAtMs: nowMs,
		localAgent: {
			agentControllerRef: "builtin:codex",
			name: "Codex",
			provider: "codex",
		},
		nativeSessionId: "native-thread-1",
		nativeSessionTitle: "Build Agent Activity",
		organization: { id: "org-acme", name: "Acme" },
		origin: "local",
		owner: { name: "Felix", userId: "user-1" },
		project: { id: "project-active", name: "OpenMeld", slug: "openmeld" },
		startedAtMs: nowMs - 60_000,
		status: "working",
		...overrides,
	};
}

function stats(
	overrides: Partial<AgentActivityStatsResponse> = {}
): AgentActivityStatsResponse {
	return {
		daily: [],
		dailyTruncated: false,
		organizationId: "org-acme",
		sinceMs: null,
		totalActiveDurationMs: 0,
		totalSessions: 0,
		...overrides,
	};
}

function session(
	overrides: Partial<AgentActivityPublicSession> = {}
): AgentActivityPublicSession {
	const nowMs = Date.now();
	return {
		clientKind: "codex-app",
		expiresAtMs: nowMs + 60_000,
		gitBranch: "main",
		gitCommit: null,
		id: "public-session-default",
		isActive: true,
		lastObservedAtMs: nowMs,
		memberName: "Felix",
		memberUserId: "user-1",
		model: "gpt-5.6-sol",
		projectId: "project-active",
		provider: "codex",
		startedAtMs: nowMs - 60_000,
		status: "active",
		title: null,
		...overrides,
	} as AgentActivityPublicSession;
}

function event(
	overrides: Partial<AgentActivitySnapshotResponse["recentEvents"][number]> = {}
) {
	return {
		clientKind: "codex-app",
		eventId: "event-default",
		eventType: "session_active",
		memberName: "Felix",
		memberUserId: "user-1",
		observedAtMs: Date.now(),
		projectId: "project-active",
		provider: "codex",
		status: "active",
		title: "Build Agent Activity",
		...overrides,
	} as AgentActivitySnapshotResponse["recentEvents"][number];
}

function project(input: {
	canArchive?: boolean;
	canManage?: boolean;
	id: string;
	slug?: string;
}) {
	return {
		archivedAtMs: null,
		canArchive: input.canArchive ?? true,
		canManage: input.canManage ?? true,
		createdAtMs: 1,
		createdByUserId: "user-1",
		id: input.id,
		name: input.slug === "agent-router" ? "Agent Router" : "OpenMeld",
		organizationId: "org-acme",
		repositoryFingerprint: null,
		slug: input.slug ?? "openmeld",
		updatedAtMs: 1,
	};
}

function directory(): OrganizationDirectoryResponse {
	return {
		agentProfiles: [],
		generatedAt: "2026-07-14T00:00:00.000Z",
		members: [
			{
				humanProfile: null,
				joinedAt: "2026-07-01T00:00:00.000Z",
				memberId: "member-1",
				organizationId: "org-acme",
				role: "owner",
				user: {
					email: "felix@example.test",
					id: "user-1",
					image: "https://example.test/felix.png",
					name: "Felix",
				},
				userId: "user-1",
			},
			{
				humanProfile: null,
				joinedAt: "2026-07-02T00:00:00.000Z",
				memberId: "member-2",
				organizationId: "org-acme",
				role: "member",
				user: {
					email: "mira@example.test",
					id: "user-2",
					image: null,
					name: "Mira",
				},
				userId: "user-2",
			},
		],
		organizationId: "org-acme",
	};
}
