import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { createMemoryHistory } from "@tanstack/react-router";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppModuleSidebarToggle } from "#/components/app/app-module-sidebar";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import { rememberClientSidebarState } from "#/lib/sidebar-width-cookie";
import { createDesktopNavigation } from "./navigation";
import { DesktopTitlebarContext } from "./titlebar-context";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it.each([
	true,
	false,
])("moves the live sidebar control into the titlebar and handles each shortcut once (wide: %s)", (wide) => {
	vi.stubGlobal("matchMedia", (media: string) => ({
		matches: media === "(min-width: 64rem)" ? wide : false,
		media,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}));
	rememberClientSidebarState("outer", { tier: "expanded", width: "308px" });
	const target = document.createElement("div");
	document.body.appendChild(target);
	const history = createMemoryHistory({ initialEntries: ["/o/team/spaces"] });
	const navigation = createDesktopNavigation(history);
	const disconnect = navigation.connect();
	const organization = { id: "team", name: "Team", slug: "team" };
	render(
		<TooltipProvider>
			<DesktopTitlebarContext.Provider value={{ target, navigation }}>
				<AppOrganizationProvider
					scope={{
						access: "authorized",
						account: { name: "Member" },
						currentUserId: "account-a",
						currentOrganization: organization,
						activeOrganization: organization,
						organizations: [organization],
						storageScope: "account-a",
					}}
				>
					<AppSurfaceLayout
						globalControls={null}
						moduleNavigation={<p>Contextual list</p>}
						outerRail={<aside>Application rail</aside>}
					>
						<main>
							<AppModuleSidebarToggle />
							<textarea aria-label="Draft" defaultValue="Unsent work" />
						</main>
					</AppSurfaceLayout>
				</AppOrganizationProvider>
			</DesktopTitlebarContext.Provider>
		</TooltipProvider>
	);
	const controls = within(target);
	expect(
		controls
			.getAllByRole("button")
			.map((button) => button.getAttribute("aria-label"))
	).toEqual(["Toggle sidebar", "Back", "Forward"]);
	expect(screen.queryByRole("button", { name: "Hide sidebar" })).toBeNull();
	const toggle = controls.getByRole("button", { name: "Toggle sidebar" });
	const draft = screen.getByRole("textbox", { name: "Draft" });
	fireEvent.keyDown(window, { key: "b", metaKey: true });
	expect(toggle.getAttribute("aria-expanded")).toBe(wide ? "false" : "true");
	if (!wide) {
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(draft).toHaveProperty("isConnected", true);
		expect(draft).toHaveProperty("value", "Unsent work");
		fireEvent.click(
			screen.getByRole("button", { name: "Close Spaces navigation" })
		);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		disconnect();
		cleanup();
		target.remove();
		return;
	}
	const expanded = toggle.getAttribute("aria-expanded");
	fireEvent.keyDown(draft, { key: "b", metaKey: true });
	fireEvent.keyDown(window, { key: "b", metaKey: true, repeat: true });
	expect(toggle.getAttribute("aria-expanded")).toBe(expanded);
	expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
	expect(draft).toHaveProperty("value", "Unsent work");
	act(() => {
		history.push("/o/team/people");
		history.push("/o/team/inbox");
	});
	fireEvent.keyDown(window, { key: "[", metaKey: true });
	expect(history.location.href).toBe("/o/team/people");
	expect(controls.getByRole("button", { name: "Forward" })).toHaveProperty(
		"disabled",
		false
	);
	fireEvent.keyDown(draft, { key: "]", metaKey: true });
	expect(history.location.href).toBe("/o/team/people");
	fireEvent.keyDown(window, { key: "]", metaKey: true });
	expect(history.location.href).toBe("/o/team/inbox");
	expect(controls.getByRole("button", { name: "Forward" })).toHaveProperty(
		"disabled",
		true
	);
	act(() => navigation.reset());
	fireEvent.keyDown(window, { key: "[", metaKey: true });
	expect(history.location.href).toBe("/o/team/inbox");
	expect(controls.getByRole("button", { name: "Back" })).toHaveProperty(
		"disabled",
		true
	);
	disconnect();
	cleanup();
	target.remove();
});
