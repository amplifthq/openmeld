import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	OUTER_SIDEBAR_DEFAULT_STATE,
	rememberClientSidebarState,
} from "#/lib/sidebar-width-cookie";
import {
	AppModuleSidebar,
	AppModuleSidebarProvider,
	AppModuleSidebarToggle,
} from "./app-module-sidebar";
import { AppNavigationPresentationProvider } from "./app-navigation-presentation";

beforeEach(() => {
	rememberClientSidebarState("outer", { tier: "expanded", width: "308px" });
	vi.stubGlobal(
		"matchMedia",
		vi.fn((media: string) => ({
			media,
			matches: true,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: () => true,
		}))
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
function mount(
	scope = "org:profile:conversations",
	onMount = vi.fn(),
	defaultOpen = false
) {
	function Conversation() {
		useEffect(onMount, []);
		return <textarea aria-label="Draft" defaultValue="Keep my draft" />;
	}
	return render(
		<TooltipProvider>
			<AppModuleSidebarProvider
				available
				defaultOpen={defaultOpen}
				preferenceKey="conversations"
			>
				<aside aria-label="Applications">Spaces · Team</aside>
				<AppModuleSidebar label="Spaces" scrollKey={scope}>
					<AppModuleSidebarToggle placement="sidebar" />
					<a href="/conversation">Existing conversation</a>
				</AppModuleSidebar>
				<main>
					<AppModuleSidebarToggle />
					<Conversation />
				</main>
			</AppModuleSidebarProvider>
		</TooltipProvider>
	);
}
it("uses route defaults until an explicit choice, then keeps that choice across surfaces", () => {
	rememberClientSidebarState("outer", OUTER_SIDEBAR_DEFAULT_STATE);
	let view = mount();
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("hidden");
	view.unmount();
	view = mount(undefined, undefined, true);
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("expanded");
	view.unmount();
	view = mount();
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("hidden");
	fireEvent.click(
		within(screen.getByRole("main")).getByRole("button", {
			name: "Show sidebar",
		})
	);
	view.unmount();
	view = mount();
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("expanded");
	fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
	view.unmount();
	mount(undefined, undefined, true);
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("hidden");
});
it("collapses only the middle list, retaining application navigation and the mounted conversation draft", () => {
	const mounted = vi.fn();
	mount(undefined, mounted);
	const draft = screen.getByRole("textbox", { name: "Draft" });
	fireEvent.change(draft, { target: { value: "Unsent work" } });
	const sidebar = screen.getByTestId("app-module-sidebar");
	expect(
		within(sidebar).getByRole("button", { name: "Hide sidebar" })
	).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
	fireEvent.click(
		within(sidebar).getByRole("button", { name: "Hide sidebar" })
	);
	expect(sidebar.getAttribute("data-state")).toBe("hidden");
	expect(
		within(screen.getByRole("main")).getByRole("button", {
			name: "Show sidebar",
		})
	).toBeTruthy();
	expect(
		screen.getByRole("complementary", { name: "Applications" })
	).toBeTruthy();
	expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
	expect(draft).toHaveProperty("value", "Unsent work");
	fireEvent.click(screen.getByRole("button", { name: "Peek sidebar" }));
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("hidden");
	fireEvent.click(
		within(
			sidebar.querySelector('[data-sidebar="panel"]') as HTMLElement
		).getByRole("button", { name: "Show sidebar" })
	);
	expect(sidebar.getAttribute("data-state")).toBe("expanded");
	expect(
		screen.getByRole("link", { name: "Existing conversation" })
	).toBeTruthy();
	expect(mounted).toHaveBeenCalledOnce();
});
it("restores list scroll after collapsing and reopening, while keeping other scopes separate", () => {
	const view = mount();
	const viewport = screen
		.getByTestId("app-module-sidebar")
		.querySelector('[data-slot="scroll-area-viewport"]');
	if (!viewport) {
		throw new Error("Missing sidebar scroll viewport");
	}
	fireEvent.scroll(viewport, { target: { scrollTop: 180 } });
	fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
	fireEvent.click(screen.getAllByRole("button", { name: "Show sidebar" })[0]);
	expect(
		screen
			.getByTestId("app-module-sidebar")
			.querySelector('[data-slot="scroll-area-viewport"]')?.scrollTop
	).toBe(180);
	view.unmount();
	mount("other-org:profile:conversations");
	expect(
		screen
			.getByTestId("app-module-sidebar")
			.querySelector('[data-slot="scroll-area-viewport"]')?.scrollTop
	).toBe(0);
});
it("retains saved width and collapse state across remounts and responds to the existing keyboard shortcut", () => {
	const view = mount();
	fireEvent.keyDown(window, { key: "b", metaKey: true });
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("hidden");
	view.unmount();
	mount();
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("hidden");
	fireEvent.keyDown(window, { key: "B", ctrlKey: true });
	expect(screen.getByTestId("app-module-sidebar").style.width).toBe("308px");
});
it("persists keyboard resizing without changing the current draft", () => {
	const rendered = mount();
	fireEvent.keyDown(
		screen.getByRole("separator", { name: "Resize app sidebar" }),
		{ key: "ArrowRight" }
	);
	const width = screen.getByTestId("app-module-sidebar").style.width;
	expect(Number.parseFloat(width)).toBeGreaterThan(308);
	expect(screen.getByRole("textbox", { name: "Draft" })).toHaveProperty(
		"value",
		"Keep my draft"
	);
	rendered.unmount();
	mount();
	expect(screen.getByTestId("app-module-sidebar").style.width).toBe(width);
});
it("restores an older narrow preference at the readable minimum", () => {
	rememberClientSidebarState("outer", { tier: "expanded", width: "160px" });
	mount();
	expect(screen.getByTestId("app-module-sidebar").style.width).toBe("176px");
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("expanded");
});
it.each([
	176, 308,
])("buffers collapse when dragging the %ipx middle list and restores its readable width", (initialWidth) => {
	rememberClientSidebarState("outer", {
		tier: "expanded",
		width: `${initialWidth}px`,
	});
	const view = mount();
	const sidebar = screen.getByTestId("app-module-sidebar");
	const draft = screen.getByRole("textbox", { name: "Draft" });
	const rail = sidebar.querySelector<HTMLElement>('[data-sidebar="rail"]');
	if (!rail) {
		throw new Error("Missing sidebar rail");
	}
	rail.setPointerCapture = vi.fn();
	rail.releasePointerCapture = vi.fn();
	rail.hasPointerCapture = () => true;
	function pointer(type: string, clientX: number) {
		fireEvent(
			rail as HTMLElement,
			new PointerEvent(type, {
				bubbles: true,
				pointerId: 1,
				pointerType: "mouse",
				button: 0,
				clientX,
			})
		);
	}
	pointer("pointerdown", initialWidth);
	pointer("pointermove", 176);
	expect(sidebar.getAttribute("data-state")).toBe("expanded");
	expect(sidebar.style.width).toBe("176px");
	pointer("pointermove", 175);
	expect(sidebar.getAttribute("data-state")).toBe("expanded");
	expect(sidebar.style.width).toBe("176px");
	pointer("pointermove", 102);
	expect(sidebar.getAttribute("data-state")).toBe("expanded");
	expect(sidebar.style.width).toBe("176px");
	pointer("pointermove", 101);
	expect(sidebar.getAttribute("data-state")).toBe("hidden");
	pointer("pointermove", 100);
	expect(sidebar.getAttribute("data-state")).toBe("hidden");
	pointer("pointermove", 125);
	expect(sidebar.getAttribute("data-state")).toBe("hidden");
	pointer("pointermove", 126);
	expect(sidebar.getAttribute("data-state")).toBe("expanded");
	pointer("pointermove", 125);
	expect(sidebar.getAttribute("data-state")).toBe("expanded");
	pointer("pointermove", 176);
	expect(sidebar.style.width).toBe("176px");
	pointer("pointermove", 100);
	pointer("pointerup", 100);
	expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
	view.unmount();
	mount();
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("hidden");
	fireEvent.click(
		within(screen.getByRole("main")).getByRole("button", {
			name: "Show sidebar",
		})
	);
	expect(screen.getByTestId("app-module-sidebar").style.width).toBe("176px");
	const restoredRail = screen
		.getByTestId("app-module-sidebar")
		.querySelector('[data-sidebar="rail"]') as HTMLElement;
	fireEvent.keyDown(restoredRail, { key: "ArrowLeft" });
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("hidden");
	fireEvent.keyDown(restoredRail, { key: "ArrowRight" });
	expect(
		screen.getByTestId("app-module-sidebar").getAttribute("data-state")
	).toBe("expanded");
	expect(screen.getByTestId("app-module-sidebar").style.width).toBe("176px");
});
it("renders the mobile list despite a saved collapsed desktop preference", () => {
	rememberClientSidebarState("outer", { tier: "hidden", width: "308px" });
	render(
		<TooltipProvider>
			<AppModuleSidebarProvider available preferenceKey="conversations">
				<AppNavigationPresentationProvider presentation="drawer">
					<AppModuleSidebar label="Spaces" scrollKey="mobile">
						<a href="/conversation">Existing conversation</a>
					</AppModuleSidebar>
				</AppNavigationPresentationProvider>
			</AppModuleSidebarProvider>
		</TooltipProvider>
	);
	expect(
		screen.getByRole("link", { name: "Existing conversation" })
	).toBeTruthy();
	expect(screen.queryByRole("separator")).toBeNull();
});
