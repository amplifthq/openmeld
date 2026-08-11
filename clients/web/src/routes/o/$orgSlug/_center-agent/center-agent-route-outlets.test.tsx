import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CenterAgentRouteOutlet } from "./center-agent";
import { OrganizationSkillsRouteOutlet } from "./center-agent.skills";
import { CenterAgentTasksRouteOutlet } from "./center-agent.tasks";

afterEach(cleanup);

describe("Center Agent nested routes", () => {
	it("renders the matched Skill detail without leaving Chat or the list mounted", async () => {
		const rootRoute = createRootRoute();
		const centerAgentRoute = createRoute({
			component: CenterAgentRouteOutlet,
			getParentRoute: () => rootRoute,
			path: "center-agent",
		});
		const chatRoute = createRoute({
			component: () => <div>Center Agent Chat</div>,
			getParentRoute: () => centerAgentRoute,
			path: "/",
		});
		const skillsRoute = createRoute({
			component: OrganizationSkillsRouteOutlet,
			getParentRoute: () => centerAgentRoute,
			path: "skills",
		});
		const skillsIndexRoute = createRoute({
			component: () => <div>Organization Skills list</div>,
			getParentRoute: () => skillsRoute,
			path: "/",
		});
		const skillDetailRoute = createRoute({
			component: () => <div>release-review detail</div>,
			getParentRoute: () => skillsRoute,
			path: "$skillId",
		});
		const router = createRouter({
			history: createMemoryHistory({
				initialEntries: ["/center-agent/skills/release-review"],
			}),
			routeTree: rootRoute.addChildren([
				centerAgentRoute.addChildren([
					chatRoute,
					skillsRoute.addChildren([skillsIndexRoute, skillDetailRoute]),
				]),
			]),
		});

		render(<RouterProvider router={router} />);

		expect(await screen.findByText("release-review detail")).toBeTruthy();
		expect(screen.queryByText("Center Agent Chat")).toBeNull();
		expect(screen.queryByText("Organization Skills list")).toBeNull();
	});

	it("renders a Task conversation without leaving Chat or the board mounted", async () => {
		const rootRoute = createRootRoute();
		const centerAgentRoute = createRoute({
			component: CenterAgentRouteOutlet,
			getParentRoute: () => rootRoute,
			path: "center-agent",
		});
		const chatRoute = createRoute({
			component: () => <div>Center Agent Chat</div>,
			getParentRoute: () => centerAgentRoute,
			path: "/",
		});
		const tasksRoute = createRoute({
			component: CenterAgentTasksRouteOutlet,
			getParentRoute: () => centerAgentRoute,
			path: "tasks",
		});
		const tasksIndexRoute = createRoute({
			component: () => <div>Task board</div>,
			getParentRoute: () => tasksRoute,
			path: "/",
		});
		const taskDetailRoute = createRoute({
			component: () => <div>Research onboarding conversation</div>,
			getParentRoute: () => tasksRoute,
			path: "$taskId",
		});
		const router = createRouter({
			history: createMemoryHistory({
				initialEntries: ["/center-agent/tasks/research-onboarding"],
			}),
			routeTree: rootRoute.addChildren([
				centerAgentRoute.addChildren([
					chatRoute,
					tasksRoute.addChildren([tasksIndexRoute, taskDetailRoute]),
				]),
			]),
		});

		render(<RouterProvider router={router} />);

		expect(
			await screen.findByText("Research onboarding conversation")
		).toBeTruthy();
		expect(screen.queryByText("Center Agent Chat")).toBeNull();
		expect(screen.queryByText("Task board")).toBeNull();
	});
});
