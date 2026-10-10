import { ShapeProvider } from "@openmeld/ui/lib/shape-context";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSection } from "./appearance-section";

const themeState = vi.hoisted(() => ({
	setTheme: vi.fn(),
	theme: "system" as string | undefined,
}));
const mediaQueryState = vi.hoisted(() => ({ matches: false }));

vi.mock("next-themes", () => ({
	useTheme: () => themeState,
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

	it.each([
		"Original",
		"Balanced",
		"Soft",
		"Slate",
		"Sand",
	])("keeps %s Bot colors when Appearance is reopened", (palette) => {
		renderAppearance();
		fireEvent.click(screen.getByRole("radio", { name: palette }));
		cleanup();
		renderAppearance();
		expect(
			screen.getByRole("radio", { name: palette }).getAttribute("aria-checked")
		).toBe("true");
	});

	it("changes Bot colors with the keyboard", () => {
		renderAppearance();
		fireEvent.click(screen.getByRole("radio", { name: "Slate" }));
		fireEvent.keyDown(screen.getByRole("radio", { name: "Slate" }), {
			key: "ArrowRight",
		});
		expect(
			screen.getByRole("radio", { name: "Sand" }).getAttribute("aria-checked")
		).toBe("true");
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
});

function renderAppearance() {
	return render(
		<ShapeProvider>
			<AppearanceSection />
		</ShapeProvider>
	);
}
