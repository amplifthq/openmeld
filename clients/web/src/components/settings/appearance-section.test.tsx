import { ShapeProvider } from "@openmeld/ui/lib/shape-context";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSection } from "./appearance-section";

const themeState = vi.hoisted(() => ({
	setTheme: vi.fn(),
	theme: "system" as string | undefined,
}));
const conversationLayoutState = vi.hoisted(() => ({
	read: vi.fn(() => "full-width" as const),
	write: vi.fn(),
}));
const selfMessageAlignmentState = vi.hoisted(() => ({
	read: vi.fn(() => "right" as const),
	write: vi.fn(),
}));
const mediaQueryState = vi.hoisted(() => ({ matches: false }));

vi.mock("next-themes", () => ({
	useTheme: () => themeState,
}));

vi.mock("#/lib/spaces/conversation-layout-preference", () => ({
	DEFAULT_SPACE_CONVERSATION_LAYOUT: "full-width",
	readSpaceConversationLayoutPreference: conversationLayoutState.read,
	writeSpaceConversationLayoutPreference: conversationLayoutState.write,
}));

vi.mock("#/lib/spaces/self-message-alignment-preference", () => ({
	DEFAULT_SPACE_SELF_MESSAGE_ALIGNMENT: "right",
	readSpaceSelfMessageAlignmentPreference: selfMessageAlignmentState.read,
	writeSpaceSelfMessageAlignmentPreference: selfMessageAlignmentState.write,
}));

describe("AppearanceSection", () => {
	beforeEach(() => {
		mediaQueryState.matches = false;
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn((query: string) => ({
				addEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
				matches: mediaQueryState.matches,
				media: query,
				onchange: null,
				removeEventListener: vi.fn(),
			})),
		});
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
		document.documentElement.removeAttribute("data-space-history-slider");
		document.documentElement.removeAttribute("data-hidden-toolbar-shortcuts");
		themeState.setTheme.mockReset();
		themeState.theme = "system";
		conversationLayoutState.read.mockReset().mockReturnValue("full-width");
		conversationLayoutState.write.mockReset();
		selfMessageAlignmentState.read.mockReset().mockReturnValue("right");
		selfMessageAlignmentState.write.mockReset();
	});

	it("defaults toolbar shortcuts to off and saves individually enabled choices", () => {
		renderAppearance();
		const toolbarSettingsRow = screen
			.getByText("Toolbar shortcuts")
			.closest('[data-slot="settings-row"]');
		expect(toolbarSettingsRow?.className).toContain("hidden");
		expect(toolbarSettingsRow?.className).toContain("lg:flex");
		// jsdom does not apply the desktop media query. This test verifies
		// persistence; browser smoke covers the responsive visibility.
		const shortcut = (label: string) =>
			screen.getByLabelText(`Show ${label} in toolbar`);
		for (const label of ["Computer", "Center Agent", "Inbox"]) {
			expect(shortcut(label).getAttribute("aria-checked")).toBe("false");
			fireEvent.click(shortcut(label));
		}
		cleanup();
		renderAppearance();
		for (const label of ["Computer", "Center Agent", "Inbox"]) {
			expect(shortcut(label).getAttribute("aria-checked")).toBe("true");
		}
		fireEvent.click(shortcut("Computer"));
		expect(shortcut("Computer").getAttribute("aria-checked")).toBe("false");
		expect(shortcut("Inbox").getAttribute("aria-checked")).toBe("true");
	});

	it("keeps the history slider setting across Appearance mounts", () => {
		renderAppearance();
		expect(
			screen.getByRole("radio", { name: "Show" }).getAttribute("aria-checked")
		).toBe("true");
		fireEvent.click(screen.getByRole("radio", { name: "Hide" }));
		expect(
			document.documentElement.getAttribute("data-space-history-slider")
		).toBe("off");
		cleanup();
		renderAppearance();
		expect(
			screen.getByRole("radio", { name: "Hide" }).getAttribute("aria-checked")
		).toBe("true");
		fireEvent.click(screen.getByRole("radio", { name: "Show" }));
		expect(
			document.documentElement.getAttribute("data-space-history-slider")
		).toBe("on");
	});

	it("shows the saved theme and changes it from the theme cards", () => {
		const view = renderAppearance();

		expect(
			screen.getByRole("heading", { level: 1, name: "Appearance" })
		).toBeTruthy();
		expect(screen.getByText("Personal")).toBeTruthy();
		expect(
			screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")
		).toBe("true");

		fireEvent.click(screen.getByRole("radio", { name: "Light" }));
		fireEvent.keyDown(screen.getByRole("radio", { name: "Light" }), {
			key: "ArrowRight",
		});
		themeState.theme = "dark";
		view.rerender(
			<ShapeProvider>
				<AppearanceSection />
			</ShapeProvider>
		);
		fireEvent.click(screen.getByRole("radio", { name: "System" }));

		expect(themeState.setTheme.mock.calls).toEqual([
			["light"],
			["dark"],
			["system"],
		]);
	});

	it("stacks every appearance choice group on a phone", () => {
		mediaQueryState.matches = true;
		renderAppearance();

		for (const group of screen.getAllByRole("radiogroup")) {
			expect(group.getAttribute("aria-orientation")).toBe("vertical");
			expect(group.className).toContain("flex-col");
		}
	});

	it("defaults to rounded corners and changes the shared shape context", () => {
		renderAppearance();

		const shapeGroup = screen.getByRole("radiogroup", {
			name: "Corner style",
		});
		expect(shapeGroup.getAttribute("aria-orientation")).toBe("horizontal");
		expect(
			screen
				.getByRole("radio", { name: "Rounded" })
				.getAttribute("aria-checked")
		).toBe("true");
		expect(
			shapeGroup.querySelectorAll("[data-corner-style-preview]")
		).toHaveLength(2);

		fireEvent.click(screen.getByRole("radio", { name: "Square" }));

		expect(
			screen.getByRole("radio", { name: "Square" }).getAttribute("aria-checked")
		).toBe("true");
	});

	it("shows static conversation layout previews and saves a centered layout", () => {
		renderAppearance();

		const layoutGroup = screen.getByRole("radiogroup", {
			name: "Conversation layout",
		});
		expect(layoutGroup.getAttribute("aria-orientation")).toBe("horizontal");
		expect(
			screen
				.getByRole("radio", { name: "Full width" })
				.getAttribute("aria-checked")
		).toBe("true");
		expect(
			layoutGroup.querySelectorAll("[data-conversation-layout-preview]")
		).toHaveLength(2);
		expect(
			Array.from(
				layoutGroup.querySelectorAll("[data-conversation-layout-preview]")
			).every((preview) => preview.getAttribute("aria-hidden") === "true")
		).toBe(true);

		fireEvent.click(screen.getByRole("radio", { name: "Centered" }));

		expect(conversationLayoutState.write).toHaveBeenCalledWith("centered");
	});

	it("shows static message alignment previews and saves left alignment", () => {
		renderAppearance();

		const alignmentGroup = screen.getByRole("radiogroup", {
			name: "Your messages",
		});
		expect(alignmentGroup.getAttribute("aria-orientation")).toBe("horizontal");
		expect(
			screen.getByRole("radio", { name: "Right" }).getAttribute("aria-checked")
		).toBe("true");
		expect(
			alignmentGroup.querySelectorAll("[data-self-message-alignment-preview]")
		).toHaveLength(2);
		const leftPreview = alignmentGroup.querySelector(
			'[data-self-message-alignment-preview="left"]'
		);
		const rightPreview = alignmentGroup.querySelector(
			'[data-self-message-alignment-preview="right"]'
		);
		expect(
			leftPreview
				?.querySelector('[data-slot="self-message-preview-bubble"]')
				?.classList.contains("w-full")
		).toBe(true);
		expect(
			rightPreview
				?.querySelector('[data-slot="self-message-preview-bubble"]')
				?.classList.contains("w-2/3")
		).toBe(true);

		fireEvent.click(screen.getByRole("radio", { name: "Left" }));

		expect(selfMessageAlignmentState.write).toHaveBeenCalledWith("left");
	});
});

function renderAppearance() {
	return render(
		<ShapeProvider>
			<AppearanceSection />
		</ShapeProvider>
	);
}
