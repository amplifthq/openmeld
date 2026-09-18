import type { OrganizationSkill } from "@openmeld/schemas/types";
import {
	type AnyRoute,
	createBrowserHistory,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	useParams,
} from "@tanstack/react-router";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { resolveAppOuterRailDestinationFromMatches } from "#/components/app/shell-layout";
import type { SpaceWindowHeader } from "#/components/spaces/space-header";
import { resolveOrganizationSwitchPath } from "#/lib/organizations/organization-routes";
import { organizationSkillQueryKeys } from "#/query/organizations/organization-skills";
import { createOrganizationSkillFixture } from "#/test-support/organization-skill";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { Route as OrganizationRoute } from "../$orgSlug";
import { Route as LegacyRoute } from "./center-agent.skills";
import { Route as LegacyDetailRoute } from "./center-agent.skills.$skillId";
import { Route as LegacyIndexRoute } from "./center-agent.skills.index";
import { Route as SkillsRoute } from "./skills";
import { Route as DetailRoute } from "./skills.$skillId";
import { Route as IndexRoute } from "./skills.index";

const { getSkill, listSkills, readSidebar, updateSkill, deleteSkill } =
	vi.hoisted(() => ({
		getSkill: vi.fn(),
		listSkills: vi.fn(),
		readSidebar: vi.fn(),
		updateSkill: vi.fn(),
		deleteSkill: vi.fn(),
	}));
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
	Element.prototype,
	"scrollIntoView"
);

vi.mock("#/lib/organizations/organization-skills", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("#/lib/organizations/organization-skills")
	>()),
	getCurrentOrganizationSkill: getSkill,
	listCurrentOrganizationSkills: listSkills,
	updateCurrentOrganizationSkill: updateSkill,
	deleteCurrentOrganizationSkill: deleteSkill,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => {
		const { orgSlug } = useParams({ strict: false });
		return {
			currentOrganization: {
				id: `org-${orgSlug}`,
				slug: orgSlug,
				name: orgSlug,
			},
		};
	},
}));
vi.mock("#/lib/sidebar-width-cookie", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/sidebar-width-cookie")>()),
	getAppSidebarStatesForRoute: readSidebar,
}));
// Keep real route options, page content, TeamHeader and Router. Only the outer
// platform chrome/account services are substituted; this is not visual smoke.
vi.mock("#/components/app/app-shell", () => ({ AppShell: Outlet }));
vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({
		children,
		mainHeader,
		mainSidebarContent,
	}: ComponentProps<typeof AppFullWidthLayout>) => (
		<>
			{mainHeader}
			{mainSidebarContent}
			<main>{children}</main>
		</>
	),
}));
vi.mock("#/components/spaces/space-header", () => ({
	SpaceWindowHeader: ({
		navigation,
	}: ComponentProps<typeof SpaceWindowHeader>) => <header>{navigation}</header>,
}));
vi.mock("#/components/directory/team-people-sidebar", () => ({
	TeamPeopleSidebar: () => (
		<aside aria-label="Team people">People sidebar</aside>
	),
}));

beforeEach(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
	updateSkill.mockReset().mockRejectedValue(new Error("Save failed"));
	deleteSkill.mockReset().mockResolvedValue({});
	readSidebar
		.mockReset()
		.mockResolvedValue({ outer: { tier: "expanded", width: "19.25rem" } });
	listSkills.mockReset().mockImplementation(async ({ organizationId }) => ({
		organizationId,
		canManage: false,
		skills: [],
	}));
	getSkill
		.mockReset()
		.mockImplementation(async ({ organizationId, skillId }) => ({
			skill: {
				...createOrganizationSkillFixture({ id: skillId }),
				organizationId,
				permissions: { canEdit: false, canManage: false },
			},
		}));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	if (originalScrollIntoView) {
		Object.defineProperty(
			Element.prototype,
			"scrollIntoView",
			originalScrollIntoView
		);
	} else {
		Reflect.deleteProperty(Element.prototype, "scrollIntoView");
	}
});

describe("Team Skills routes", () => {
	it.each([
		"/o/acme/skills",
		"/o/acme/skills/skill-one",
	])("renders %s in Team without a Center Agent session", async (url) => {
		const { router } = renderRoutes(url);
		await screen.findByRole("tab", { name: "Skills", selected: true });
		expect(screen.getAllByRole("tab")).toEqual(
			["People", "Agents", "Plugins", "Skills"].map((name) =>
				screen.getByRole("tab", { name })
			)
		);
		expect(
			screen.getByRole("complementary", { name: "Team people" })
		).toBeTruthy();
		expect(
			resolveAppOuterRailDestinationFromMatches(router.state.matches)
		).toBe("people");
		expect(
			router.state.matches.some((match) =>
				match.routeId.includes("_center-agent")
			)
		).toBe(false);
		if (url.endsWith("skill-one")) {
			expect(
				((await screen.findByLabelText("Name")) as HTMLInputElement).disabled
			).toBe(true);
			expect(
				screen.getByRole("link", { name: "All Skills" }).getAttribute("href")
			).toBe("/o/acme/skills");
			expect(screen.queryByRole("heading", { name: "Skills" })).toBeNull();
		} else {
			await screen.findByText("No Skills yet");
			expect(screen.queryByRole("button", { name: "Create skill" })).toBeNull();
			expect(
				screen.queryByRole("button", { name: "Install from GitHub" })
			).toBeNull();
		}
	});

	it("retains Team ownership during data loading and a data error", async () => {
		listSkills.mockRejectedValue(new Error("Offline"));
		renderRoutes("/o/acme/skills");
		await screen.findByRole("tab", { name: "Skills", selected: true });
		await screen.findByText("Could not load Skills");
		expect(
			screen.getByRole("tab", { name: "Skills", selected: true })
		).toBeTruthy();
		expect(
			screen.getByRole("complementary", { name: "Team people" })
		).toBeTruthy();
	});

	it("keeps a route-loader failure inside the Team shell and can retry", async () => {
		readSidebar.mockRejectedValueOnce(new Error("Sidebar read failed"));
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		renderRoutes("/o/acme/skills");
		await screen.findByText("Could not open Skills");
		expect(
			screen.getByRole("tab", { name: "Skills", selected: true })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("No Skills yet");
	});

	it("renders the Team shell while the route loader is pending", async () => {
		vi.useFakeTimers();
		try {
			readSidebar.mockReturnValue(new Promise(() => undefined));
			renderRoutes("/o/acme/skills");
			await act(async () => {
				await vi.advanceTimersByTimeAsync(
					(SkillsRoute.options.pendingMs ?? 0) + 1
				);
			});
			expect(
				screen.getByRole("status", { name: "Loading Skills" })
			).toBeTruthy();
			expect(
				screen.getByRole("tab", { name: "Skills", selected: true })
			).toBeTruthy();
			expect(
				screen.getByRole("complementary", { name: "Team people" })
			).toBeTruthy();
		} finally {
			cleanup();
			vi.useRealTimers();
		}
	});

	it("does not carry session, plugin scope, query or anchor context through Team tabs", async () => {
		const { router } = renderRoutes(
			"/o/acme/skills?draft=new&group=g&session=s&scope=personal#skill-history-heading"
		);
		fireEvent.click(await screen.findByRole("tab", { name: "People" }));
		await waitFor(() =>
			expect(router.state.location.href).toBe("/o/acme/people")
		);
	});
});

describe("legacy Skills compatibility", () => {
	it.each([
		["", ""],
		["/", ""],
		["/skill-one", "/skill-one"],
		["/skill-one/", "/skill-one"],
		["/skill%2Fone", "/skill%2Fone"],
		["/skill%252Fone", "/skill%252Fone"],
		["/skill%20%25%23%3F", "/skill%20%25%23%3F"],
	])("redirects %s without losing identity or adding a history entry", async (legacySuffix, canonicalSuffix) => {
		const { router } = renderRoutes(
			`/o/acme/center-agent/skills${legacySuffix}?draft=new&group=g&session=s&scope=personal&unknown=x&appSettings=appearance#skill-history-heading`
		);
		await waitFor(() =>
			expect(
				new URL(router.state.location.href, "http://localhost").pathname
			).toBe(`/o/acme/skills${canonicalSuffix}`)
		);
		expect(router.state.location.searchStr).toBe("?appSettings=appearance");
		expect(router.state.location.hash).toBe("skill-history-heading");
		expect(router.history.length).toBe(2);
		if (canonicalSuffix) {
			await waitFor(() =>
				expect(getSkill).toHaveBeenCalledWith(
					expect.objectContaining({
						skillId: decodeURIComponent(canonicalSuffix.slice(1)),
						organizationId: "org-acme",
					})
				)
			);
		}
		act(() => router.history.back());
		await waitFor(() => expect(router.state.location.pathname).toBe("/before"));
		act(() => router.history.forward());
		await waitFor(() =>
			expect(
				new URL(router.state.location.href, "http://localhost").pathname
			).toBe(`/o/acme/skills${canonicalSuffix}`)
		);
		expect(router.history.length).toBe(2);
	});

	it("encodes the decoded Organization slug once and drops invalid settings state", async () => {
		const { router } = renderRoutes(
			"/o/team%20one/center-agent/skills/skill-one?appSettings=INVALID&draft=new"
		);
		await waitFor(() =>
			expect(router.state.location.href).toBe("/o/team%20one/skills/skill-one")
		);
		await waitFor(() =>
			expect(getSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org-team one",
					skillId: "skill-one",
				})
			)
		);
	});
});

describe("Skill navigation with the real UnsavedChangesGuard", () => {
	it.each([
		["People", "/o/acme/people"],
		["Agents", "/o/acme/agents"],
		["Plugins", "/o/acme/plugins"],
		["Skills", "/o/acme/skills"],
		["All Skills", "/o/acme/skills"],
		["Switch Organization", "/o/beta/skills"],
	])("can cancel or discard when leaving via %s", async (exit, destination) => {
		const { router } = renderRoutes("/o/acme/skills/skill-one", {
			skills: [createOrganizationSkillFixture()],
		});
		fireEvent.change(await screen.findByLabelText("Name"), {
			target: { value: "unsaved-work" },
		});
		const leave = () =>
			act(() => {
				if (exit === "Switch Organization") {
					router.navigate({
						to: resolveOrganizationSwitchPath({
							currentPathname: router.state.location.pathname,
							nextOrgSlug: "beta",
						}),
					});
				} else {
					fireEvent.click(
						screen.getByRole(exit === "All Skills" ? "link" : "tab", {
							name: exit,
						})
					);
				}
			});
		leave();
		await screen.findByRole("heading", {
			name: "Save changes before leaving?",
		});
		expect(router.state.location.pathname).toBe("/o/acme/skills/skill-one");
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"unsaved-work"
		);
		leave();
		fireEvent.click(
			await screen.findByRole("button", { name: "Discard changes" })
		);
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(destination)
		);
		expect(updateSkill).not.toHaveBeenCalled();
		if (exit === "Switch Organization") {
			await waitFor(() =>
				expect(listSkills).toHaveBeenCalledWith(
					expect.objectContaining({ organizationId: "org-beta" })
				)
			);
			expect(getSkill).not.toHaveBeenCalled();
		}
	});

	it.each([
		"back",
		"forward",
	] as const)("protects drafts during browser history %s, including cancellation and discard", async (direction) => {
		const previousUrl = window.location.href;
		window.history.replaceState(null, "", "/o/acme/people");
		const history = createBrowserHistory();
		try {
			const { router } = renderRoutes("/o/acme/people", {
				history,
				skills: [createOrganizationSkillFixture()],
			});
			await screen.findByRole("heading", { name: "People" });
			await act(() =>
				router.navigate({
					to: "/o/$orgSlug/skills/$skillId",
					params: { orgSlug: "acme", skillId: "skill-one" },
				})
			);
			await screen.findByLabelText("Name");
			if (direction === "forward") {
				await act(() =>
					router.navigate({
						to: "/o/$orgSlug/agents",
						params: { orgSlug: "acme" },
					})
				);
				act(() => history.back());
				await screen.findByLabelText("Name");
			}
			fireEvent.change(screen.getByLabelText("Name"), {
				target: { value: "history-draft" },
			});
			act(() => history[direction]());
			await screen.findByRole("heading", {
				name: "Save changes before leaving?",
			});
			fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
			await waitFor(() =>
				expect(window.location.pathname).toBe("/o/acme/skills/skill-one")
			);
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
				"history-draft"
			);
			act(() => history[direction]());
			fireEvent.click(
				await screen.findByRole("button", { name: "Discard changes" })
			);
			const destination =
				direction === "back" ? "/o/acme/people" : "/o/acme/agents";
			await waitFor(() =>
				expect(router.state.location.pathname).toBe(destination)
			);
			expect(updateSkill).not.toHaveBeenCalled();
		} finally {
			cleanup();
			history.destroy();
			window.history.replaceState(null, "", previousUrl);
		}
	});

	it("stays on the detail after a failed Save and leaves only after a successful Save", async () => {
		const { router } = renderRoutes("/o/acme/skills/skill-one", {
			skills: [createOrganizationSkillFixture()],
		});
		fireEvent.change(await screen.findByLabelText("Name"), {
			target: { value: "saved-work" },
		});
		fireEvent.click(screen.getByRole("link", { name: "All Skills" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Save and leave" })
		);
		await screen.findByText(
			"OpenMeld couldn't save your changes. Fix the error and try again."
		);
		expect(router.state.location.pathname).toBe("/o/acme/skills/skill-one");
		updateSkill.mockResolvedValue({
			skill: createOrganizationSkillFixture({ version: 2, name: "saved-work" }),
		});
		fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/o/acme/skills")
		);
		expect(updateSkill).toHaveBeenCalledTimes(2);
		expect(updateSkill.mock.calls[1]?.[0]).toMatchObject({
			expectedVersion: 1,
			expectedActiveReleaseId: "skill-one-release-1",
			bundle: { portable: { name: "saved-work" } },
		});
	});

	it("reports a saved submission with newer edits and leaves after saving those edits", async () => {
		let completeSave: (value: { skill: OrganizationSkill }) => void = () => {
			throw new Error("Save promise has not been initialized.");
		};
		const pending = new Promise<{ skill: OrganizationSkill }>((resolve) => {
			completeSave = resolve;
		});
		updateSkill.mockReturnValueOnce(pending);
		const { router } = renderRoutes("/o/acme/skills/skill-one", {
			skills: [createOrganizationSkillFixture()],
		});
		fireEvent.change(await screen.findByLabelText("Name"), {
			target: { value: "submitted-work" },
		});
		fireEvent.click(screen.getByRole("link", { name: "All Skills" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Save and leave" })
		);
		await waitFor(() => expect(updateSkill).toHaveBeenCalledTimes(1));
		// Simulate an editor callback queued before the modal disabled its controls.
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "newer-work" },
		});
		await act(() =>
			completeSave({
				skill: createOrganizationSkillFixture({
					version: 2,
					name: "submitted-work",
				}),
			})
		);
		await screen.findByText(
			"Your previous changes were saved, but you have newer unsaved changes. Save again before leaving."
		);
		expect(
			screen.queryByText(
				"OpenMeld couldn't save your changes. Fix the error and try again."
			)
		).toBeNull();
		expect(router.state.location.pathname).toBe("/o/acme/skills/skill-one");
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"newer-work"
		);
		updateSkill.mockResolvedValueOnce({
			skill: createOrganizationSkillFixture({ version: 3, name: "newer-work" }),
		});
		fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/o/acme/skills")
		);
		expect(updateSkill).toHaveBeenCalledTimes(2);
		expect(updateSkill.mock.calls[1]?.[0]).toMatchObject({
			expectedVersion: 2,
			expectedActiveReleaseId: "skill-one-release-2",
			bundle: { portable: { name: "newer-work" } },
		});
	});

	it("blocks a cached Skill switch before changing editor identity", async () => {
		const { router } = renderRoutes("/o/acme/skills/skill-one", {
			skills: [
				createOrganizationSkillFixture(),
				createOrganizationSkillFixture({
					id: "skill-two",
					name: "second-skill",
				}),
			],
		});
		fireEvent.change(await screen.findByLabelText("Name"), {
			target: { value: "first-draft" },
		});
		act(() => {
			router.navigate({
				to: "/o/$orgSlug/skills/$skillId",
				params: { orgSlug: "acme", skillId: "skill-two" },
			});
		});
		await screen.findByRole("dialog");
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"first-draft"
		);
		fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
				"second-skill"
			)
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Save",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});

	it("returns to the canonical catalog after a manager confirms deletion", async () => {
		const skill = createOrganizationSkillFixture();
		skill.permissions = { canManage: true, canEdit: true };
		const { router } = renderRoutes("/o/acme/skills/skill-one", {
			skills: [skill],
		});
		fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Remove Skill" })
		);
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/o/acme/skills")
		);
		expect(deleteSkill).toHaveBeenCalledWith({
			expectedOrganizationId: "org-acme",
			expectedVersion: 1,
			skillId: "skill-one",
		});
	});

	it("uses the browser beforeunload blocker only while changes are unsaved", async () => {
		const previousUrl = window.location.href;
		window.history.replaceState(null, "", "/o/acme/skills/skill-one");
		const history = createBrowserHistory();
		try {
			renderRoutes("/o/acme/skills/skill-one", {
				skills: [createOrganizationSkillFixture()],
				history,
			});
			const field = await screen.findByLabelText("Name");
			const clean = new Event("beforeunload", { cancelable: true });
			window.dispatchEvent(clean);
			expect(clean.defaultPrevented).toBe(false);
			fireEvent.change(field, { target: { value: "unsaved-browser-work" } });
			const dirty = new Event("beforeunload", { cancelable: true });
			window.dispatchEvent(dirty);
			expect(dirty.defaultPrevented).toBe(true);
		} finally {
			cleanup();
			history.destroy();
			window.history.replaceState(null, "", previousUrl);
		}
	});
});

// File-route parent/context generics belong to the production tree. Widen only
// that registration boundary when attaching the same options to the test root;
// loaders, components, redirects, the Router, and blockers still run unchanged.
function reparentedOptions(route: AnyRoute) {
	return route.options;
}

function renderRoutes(
	url: string,
	input: {
		skills?: OrganizationSkill[];
		history?: ReturnType<typeof createBrowserHistory>;
	} = {}
) {
	const queryClient = createTestQueryClient();
	for (const skill of input.skills ?? []) {
		queryClient.setQueryData(
			organizationSkillQueryKeys.detail(skill.organizationId, skill.id),
			{ skill }
		);
	}
	const root = createRootRoute();
	const org = createRoute({
		getParentRoute: () => root,
		path: "/o/$orgSlug",
		validateSearch: OrganizationRoute.options.validateSearch,
	});
	const skills = createRoute({
		...reparentedOptions(SkillsRoute),
		getParentRoute: () => org,
		path: "skills",
	});
	const index = createRoute({
		...reparentedOptions(IndexRoute),
		getParentRoute: () => skills,
		path: "/",
	});
	const detail = createRoute({
		...reparentedOptions(DetailRoute),
		getParentRoute: () => skills,
		path: "$skillId",
	});
	const legacy = createRoute({
		...reparentedOptions(LegacyRoute),
		getParentRoute: () => org,
		path: "center-agent/skills",
	});
	const legacyIndex = createRoute({
		...reparentedOptions(LegacyIndexRoute),
		getParentRoute: () => legacy,
		path: "/",
	});
	const legacyDetail = createRoute({
		...reparentedOptions(LegacyDetailRoute),
		getParentRoute: () => legacy,
		path: "$skillId",
	});
	const people = createRoute({
		getParentRoute: () => org,
		path: "people",
		component: () => <h1>People</h1>,
	});
	const agents = createRoute({
		getParentRoute: () => org,
		path: "agents",
		component: () => <h1>Agents</h1>,
	});
	const plugins = createRoute({
		getParentRoute: () => org,
		path: "plugins",
		component: () => <h1>Plugins</h1>,
	});
	const before = createRoute({
		getParentRoute: () => root,
		path: "/before",
		component: () => <h1>Previous page</h1>,
	});
	const router = createRouter({
		history:
			input.history ??
			createMemoryHistory({ initialEntries: ["/before", url] }),
		routeTree: root.addChildren([
			before,
			org.addChildren([
				skills.addChildren([index, detail]),
				legacy.addChildren([legacyIndex, legacyDetail]),
				people,
				agents,
				plugins,
			]),
		]),
	});
	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<RouterProvider router={router} />
		</TestQueryClientProvider>
	);
	return { router, queryClient };
}
