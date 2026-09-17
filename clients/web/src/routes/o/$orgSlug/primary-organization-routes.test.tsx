import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as CenterAgentChannelsRoute } from "./_center-agent/center-agent.channels";
import { Route as CenterAgentMemoryRoute } from "./_center-agent/center-agent.memory";
import { Route as CenterAgentRoutinesRoute } from "./_center-agent/center-agent.routines";
import { Route as CenterAgentSkillDetailRoute } from "./_center-agent/center-agent.skills.$skillId";
import { Route as CenterAgentSkillsRoute } from "./_center-agent/center-agent.skills.index";
import { Route as AgentActivityRoute } from "./agent-activity";
import { Route as AgentsRoute } from "./agents";
import { Route as NewOrganizationRoute } from "./new-organization";
import { Route as OrganizationsRoute } from "./organizations";
import { Route as PeopleRoute } from "./people";
import { Route as PersonAgentsRoute } from "./people_.$personId_.agents";
import { Route as ProjectsRoute } from "./projects";
import { Route as ProjectDetailRoute } from "./projects.$projectId";
import { Route as ProjectsIndexRoute } from "./projects.index";
import { Route as SettingsAppearanceRoute } from "./settings/appearance";
import { Route as SettingsGeneralRoute } from "./settings/general";

const ORGANIZATION_HEADING_NAME = /organization/i;
const getAppSidebarStatesForRouteMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/sidebar-width-cookie", () => ({
	getAppSidebarStatesForRoute: getAppSidebarStatesForRouteMock,
}));

vi.mock("#/components/agents/person-agents-page", () => ({
	PersonAgentsPage: ({ personId }: { personId: string }) => (
		<h1 data-person-id={personId}>Person Agents</h1>
	),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Outlet: () => (
			<h1 data-section-id="projects-outlet">Project child route</h1>
		),
		useNavigate: () => vi.fn(),
		useParams: () => ({}),
		useRouterState: <T,>({
			select,
		}: {
			select: (state: { location: { pathname: string } }) => T;
		}) =>
			select({
				location: { pathname: "/o/acme/agent-activity" },
			}),
	};
});

vi.mock("#/components/organizations/agent-activity-page", () => ({
	AgentActivityPage: () => (
		<h1 data-section-id="agent-activity">Agent Activity</h1>
	),
}));

vi.mock("#/components/organizations/center-agent-routines-page", () => ({
	CenterAgentRoutinesPage: () => <h1 data-section-id="routines">Routines</h1>,
}));

vi.mock("#/components/organizations/center-agent-section-frame", () => ({
	CenterAgentSectionFrame: ({ children }: { children: ReactNode }) => (
		<main data-slot="center-agent-section-frame">{children}</main>
	),
}));

vi.mock(
	"#/components/organization-skills/organization-skill-detail-page",
	() => ({
		OrganizationSkillDetailPage: ({ skillId }: { skillId: string }) => (
			<h1 data-section-id="skill-detail" data-skill-id={skillId}>
				Skill detail
			</h1>
		),
	})
);

vi.mock(
	"#/components/organization-skills/organization-skills-list-page",
	() => ({
		OrganizationSkillsListPage: () => <h1 data-section-id="skills">Skills</h1>,
	})
);

vi.mock("#/components/organizations/organization-memory-page", () => ({
	OrganizationMemoryPage: () => <h1 data-section-id="memory">Memory</h1>,
}));

vi.mock(
	"#/components/organizations/organization-message-channels-page",
	() => ({
		OrganizationMessageChannelsPage: () => (
			<h1 data-section-id="channels">Channels</h1>
		),
	})
);

vi.mock("#/components/profiles/people-and-agents-page", () => ({
	PeopleAndAgentsPage: ({ activeSectionId }: { activeSectionId: string }) => (
		<h1 data-section-id={activeSectionId}>{activeSectionId}</h1>
	),
}));

vi.mock("#/components/organizations/organization-entry-page", () => ({
	NewOrganizationPage: ({ intent }: { intent?: string }) => (
		<h1 data-intent={intent} data-section-id="new-organization">
			New organization
		</h1>
	),
	OrganizationEntryPage: ({ intent }: { intent?: string }) => (
		<h1 data-intent={intent} data-section-id="organizations">
			Organizations
		</h1>
	),
}));

vi.mock("#/components/projects/project-detail-page", () => ({
	ProjectDetailPage: ({ projectId }: { projectId: string }) => (
		<h1 data-project-id={projectId} data-section-id="project-detail">
			Project detail
		</h1>
	),
}));

vi.mock("#/components/projects/projects-page", () => ({
	ProjectsPage: () => <h1 data-section-id="projects">Projects</h1>,
}));

vi.mock("#/components/settings/settings-page", () => ({
	SettingsPage: ({ activeSectionId }: { activeSectionId: string }) => (
		<h1 data-section-id={activeSectionId}>{activeSectionId}</h1>
	),
}));

vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({ children }: { children: ReactNode }) => (
		<main>{children}</main>
	),
}));

beforeEach(() => {
	getAppSidebarStatesForRouteMock.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("primary organization routes", () => {
	it("loads shared sidebar state for the person's Agent list during SSR", async () => {
		const loader = PersonAgentsRoute.options.loader;
		if (typeof loader !== "function") {
			throw new Error("Expected the person's Agent list route loader.");
		}

		await loader({
			context: { queryClient: {}, queryPersistence: {} },
			location: { href: "/o/acme/people/human-1/agents" },
			params: { orgSlug: "acme", personId: "human-1" },
		} as never);

		expect(getAppSidebarStatesForRouteMock).toHaveBeenCalledWith();
		expect(PersonAgentsRoute.options.staticData).toEqual({
			appShellSection: "people",
		});
		vi.spyOn(PersonAgentsRoute, "useParams").mockReturnValue({
			orgSlug: "acme",
			personId: "human-1",
		});
		vi.spyOn(PersonAgentsRoute, "useLoaderData").mockReturnValue({
			sidebarStates: undefined,
		});
		const Component = PersonAgentsRoute.options.component as ComponentType;
		render(<Component />);
		expect(
			screen
				.getByRole("heading", { name: "Person Agents" })
				.getAttribute("data-person-id")
		).toBe("human-1");
	});

	it.each([
		[{ view: "create" }, "/o/acme/new-agent"],
		[
			{ view: "requests", requestId: "request-1" },
			"/o/acme/people/agent-requests?requestId=request-1",
		],
	])("redirects the legacy Agents entry %j to its current destination", (search, to) => {
		expect(() =>
			AgentsRoute.options.beforeLoad?.({
				params: { orgSlug: "acme" },
				search,
			} as never)
		).toThrow(
			expect.objectContaining({
				options: expect.objectContaining({ to, replace: true }),
			})
		);
	});

	it("renders Project child routes through the Projects layout", () => {
		const Component = ProjectsRoute.options.component as ComponentType;
		render(<Component />);

		expect(
			screen
				.getByRole("heading", { name: "Project child route" })
				.getAttribute("data-section-id")
		).toBe("projects-outlet");
	});

	it.each([
		{
			expectedSectionId: "agent-activity",
			expectedTitle: "Agent Activity",
			route: AgentActivityRoute,
		},
		{
			expectedSectionId: "projects",
			expectedTitle: "Projects",
			route: ProjectsIndexRoute,
		},
	])("renders the $expectedTitle page", ({
		expectedSectionId,
		expectedTitle,
		route,
	}) => {
		if (route === AgentActivityRoute) {
			vi.spyOn(AgentActivityRoute, "useLoaderData").mockReturnValue({
				sidebarStates: undefined,
			});
			vi.spyOn(AgentActivityRoute, "useParams").mockReturnValue({
				orgSlug: "acme",
			});
		}
		const Component = route.options.component as ComponentType;
		render(<Component />);

		expect(
			screen
				.getByRole("heading", { name: expectedTitle })
				.getAttribute("data-section-id")
		).toBe(expectedSectionId);
	});

	it("mounts the immutable Project detail route in the full-width layout", () => {
		vi.spyOn(ProjectDetailRoute, "useParams").mockReturnValue({
			orgSlug: "acme",
			projectId: "project-123",
		});
		const Component = ProjectDetailRoute.options.component as ComponentType;
		render(<Component />);

		const heading = screen.getByRole("heading", { name: "Project detail" });
		expect(heading.getAttribute("data-project-id")).toBe("project-123");
		expect(heading.closest("main")).toBeTruthy();
	});

	it.each([
		{
			expectedSectionId: "people",
			route: PeopleRoute,
		},
	])("mounts the first-level $expectedSectionId home", ({
		expectedSectionId,
		route,
	}) => {
		vi.spyOn(route, "useLoaderData").mockReturnValue({
			sidebarStates: undefined,
		});
		vi.spyOn(route, "useParams").mockReturnValue({ orgSlug: "acme" });
		vi.spyOn(route, "useSearch").mockReturnValue({});
		const Component = route.options.component as ComponentType;
		render(<Component />);

		expect(
			screen
				.getByRole("heading", {
					name: new RegExp(`^${expectedSectionId}$`, "i"),
				})
				.getAttribute("data-section-id")
		).toBe(expectedSectionId);
	});

	it("mounts the full-page organization manager", () => {
		vi.spyOn(OrganizationsRoute, "useSearch").mockReturnValue({});
		const Component = OrganizationsRoute.options.component as ComponentType;
		render(<Component />);

		expect(
			screen
				.getByRole("heading", { name: "Organizations" })
				.getAttribute("data-section-id")
		).toBe("organizations");
	});

	it.each([
		OrganizationsRoute,
		NewOrganizationRoute,
	])("accepts only the Slack install intent on organization entry routes", (route) => {
		const validateSearch = route.options.validateSearch as (
			search: Record<string, unknown>
		) => Record<string, unknown>;
		expect(validateSearch({ intent: "slack-install" })).toEqual({
			intent: "slack-install",
		});
		expect(validateSearch({ intent: "unsupported" })).toEqual({});
	});

	it.each([
		{
			expectedSectionId: "organizations",
			route: OrganizationsRoute,
		},
		{
			expectedSectionId: "new-organization",
			route: NewOrganizationRoute,
		},
	])("passes Slack install intent to $expectedSectionId", ({
		expectedSectionId,
		route,
	}) => {
		vi.spyOn(route, "useSearch").mockReturnValue({
			intent: "slack-install",
		});
		const Component = route.options.component as ComponentType;
		render(<Component />);

		expect(
			screen
				.getByRole("heading", { name: ORGANIZATION_HEADING_NAME })
				.getAttribute("data-section-id")
		).toBe(expectedSectionId);
		expect(
			screen
				.getByRole("heading", { name: ORGANIZATION_HEADING_NAME })
				.getAttribute("data-intent")
		).toBe("slack-install");
	});

	it.each([
		{
			expectedSectionId: "appearance",
			route: SettingsAppearanceRoute,
		},
		{
			expectedSectionId: "general",
			route: SettingsGeneralRoute,
		},
	])("mounts the $expectedSectionId page in Settings", ({
		expectedSectionId,
		route,
	}) => {
		vi.spyOn(route, "useLoaderData").mockReturnValue({
			sidebarStates: undefined,
		});
		const Component = route.options.component as ComponentType;
		render(<Component />);

		expect(
			screen
				.getByRole("heading", { name: expectedSectionId })
				.getAttribute("data-section-id")
		).toBe(expectedSectionId);
	});

	it.each([
		{
			expectedSectionId: "channels",
			route: CenterAgentChannelsRoute,
		},
		{
			expectedSectionId: "memory",
			route: CenterAgentMemoryRoute,
		},
		{
			expectedSectionId: "routines",
			route: CenterAgentRoutinesRoute,
		},
		{
			expectedSectionId: "skills",
			route: CenterAgentSkillsRoute,
		},
	])("mounts the $expectedSectionId page in Center Agent", ({
		expectedSectionId,
		route,
	}) => {
		if (route === CenterAgentChannelsRoute) {
			vi.spyOn(CenterAgentChannelsRoute, "useSearch").mockReturnValue({});
		}
		const Component = route.options.component as ComponentType;
		render(<Component />);

		const heading = screen.getByRole("heading", {
			name: new RegExp(`^${expectedSectionId}$`, "i"),
		});
		expect(heading.getAttribute("data-section-id")).toBe(expectedSectionId);
		expect(
			heading.closest('[data-slot="center-agent-section-frame"]')
		).toBeTruthy();
	});

	it("mounts Skill details in the same Center Agent section frame", () => {
		vi.spyOn(CenterAgentSkillDetailRoute, "useParams").mockReturnValue({
			orgSlug: "acme",
			skillId: "release-review",
		});
		const Component = CenterAgentSkillDetailRoute.options
			.component as ComponentType;
		render(<Component />);

		const heading = screen.getByRole("heading", { name: "Skill detail" });
		expect(heading.getAttribute("data-skill-id")).toBe("release-review");
		expect(
			heading.closest('[data-slot="center-agent-section-frame"]')
		).toBeTruthy();
	});
});
