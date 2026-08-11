import type { Project } from "@openmeld/schemas/types";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listCurrentProjects } from "#/lib/organizations/projects";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { ProjectsPage } from "./projects-page";

const ADD_PROJECT_PATTERN = /Add a Project/;
const NO_PROJECTS_PATTERN = /No Projects/i;
const VIEW_DETAILS_PATTERN = /View details/;

const discoveryController = vi.hoisted(() => ({
	isRefreshing: false,
	refresh: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		},
	}),
}));

vi.mock("#/lib/organizations/projects", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("#/lib/organizations/projects")>();
	return {
		...original,
		listCurrentProjects: vi.fn(),
	};
});

vi.mock("./use-project-discovery", () => ({
	useProjectDiscovery: () => ({
		...discoveryController,
		projectView: (projectId: string) => ({
			connections:
				projectId === "project-one"
					? [
							{
								bindingGeneration: "binding-one",
								isDefault: true,
								path: "/work/openmeld",
								status: "available",
							},
						]
					: [],
			discovery: {
				candidates: [],
				connections: [],
				projectId,
				status: projectId === "project-one" ? "connected" : "not_found",
			},
			status: "ready",
		}),
	}),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ProjectsPage", () => {
	it("uses the Add a Project card as the complete empty state", async () => {
		vi.mocked(listCurrentProjects).mockResolvedValueOnce({
			organizationId: "org-acme",
			projects: [],
		});
		renderPage();

		const list = await screen.findByRole("list", { name: "Projects" });
		expect(within(list).getAllByRole("listitem")).toHaveLength(1);
		const addProject = within(list).getByRole("button", {
			name: ADD_PROJECT_PATTERN,
		});
		expect(addProject.className).toContain("rounded-md");
		expect(addProject.querySelector(".rounded-md")).toBeTruthy();
		expect(screen.queryByText(NO_PROJECTS_PATTERN)).toBeNull();
	});

	it("shows identity, repository, local connection, and immutable detail links", async () => {
		vi.mocked(listCurrentProjects).mockResolvedValueOnce({
			organizationId: "org-acme",
			projects: [
				project({
					id: "project-one",
					repositoryFingerprint: `sha256:${"a".repeat(64)}`,
					slug: "openmeld",
				}),
				project({ id: "project-two", slug: "openmeld-docs" }),
			],
		});
		renderPage();

		expect(
			await screen.findAllByRole("heading", { name: "OpenMeld" })
		).toHaveLength(2);
		expect(screen.getByText("/openmeld")).toBeTruthy();
		expect(screen.getByText("/openmeld-docs")).toBeTruthy();
		expect(screen.getByText("/work/openmeld")).toBeTruthy();
		expect(screen.getByText("Configured")).toBeTruthy();
		expect(screen.getByText("Not configured")).toBeTruthy();
		const links = screen.getAllByRole("link", { name: VIEW_DETAILS_PATTERN });
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"/o/acme/projects/project-one",
			"/o/acme/projects/project-two",
		]);
		expect(
			screen.getAllByRole("button", { name: ADD_PROJECT_PATTERN })
		).toHaveLength(1);
	});

	it("opens the selected Project detail route through the real router", async () => {
		vi.mocked(listCurrentProjects).mockResolvedValueOnce({
			organizationId: "org-acme",
			projects: [project({ id: "project-one", slug: "openmeld" })],
		});
		const router = renderPage();

		fireEvent.click(await screen.findByRole("link", { name: "View details" }));

		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				"/o/acme/projects/project-one"
			)
		);
		expect(
			screen.getByRole("heading", { name: "Project details" })
		).toBeTruthy();
	});

	it("lets the user explicitly check this computer again", async () => {
		vi.mocked(listCurrentProjects).mockResolvedValueOnce({
			organizationId: "org-acme",
			projects: [project({ id: "project-one", slug: "openmeld" })],
		});
		renderPage();

		fireEvent.click(await screen.findByRole("button", { name: "Check again" }));

		expect(discoveryController.refresh).toHaveBeenCalledOnce();
	});
});

function project(overrides: Partial<Project>): Project {
	return {
		archivedAtMs: null,
		canArchive: true,
		canManage: true,
		createdAtMs: 1,
		createdByUserId: "user-1",
		id: "project-one",
		name: "OpenMeld",
		organizationId: "org-acme",
		repositoryFingerprint: null,
		slug: "openmeld",
		updatedAtMs: 1,
		...overrides,
	};
}

function renderPage() {
	const rootRoute = createRootRoute({
		component: () => <Outlet />,
	});
	const projectsRoute = createRoute({
		component: () => <Outlet />,
		getParentRoute: () => rootRoute,
		path: "/o/$orgSlug/projects",
	});
	const projectsIndexRoute = createRoute({
		component: ProjectsPage,
		getParentRoute: () => projectsRoute,
		path: "/",
	});
	const projectDetailRoute = createRoute({
		component: () => <h1>Project details</h1>,
		getParentRoute: () => projectsRoute,
		path: "/$projectId",
	});
	const router = createRouter({
		history: createMemoryHistory({
			initialEntries: ["/o/acme/projects"],
		}),
		routeTree: rootRoute.addChildren([
			projectsRoute.addChildren([projectsIndexRoute, projectDetailRoute]),
		]),
	});
	render(
		<TestQueryClientProvider>
			<RouterProvider router={router} />
		</TestQueryClientProvider>
	);
	return router;
}
