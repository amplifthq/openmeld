import { ShapeProvider } from "@openmeld/ui/lib/shape-context";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceSection } from "./appearance-section";

const themeState = vi.hoisted(() => ({
	setTheme: vi.fn(),
	theme: "system" as string | undefined,
}));
const conversationLayoutState = vi.hoisted(() => ({
	read: vi.fn(() => "centered" as const),
	write: vi.fn(),
}));
const selfMessageAlignmentState = vi.hoisted(() => ({
	read: vi.fn(() => "right" as const),
	write: vi.fn(),
}));

vi.mock("next-themes", () => ({
	useTheme: () => themeState,
}));

vi.mock("#/lib/spaces/conversation-layout-preference", () => ({
	DEFAULT_SPACE_CONVERSATION_LAYOUT: "centered",
	readSpaceConversationLayoutPreference: conversationLayoutState.read,
	writeSpaceConversationLayoutPreference: conversationLayoutState.write,
}));

vi.mock("#/lib/spaces/self-message-alignment-preference", () => ({
	DEFAULT_SPACE_SELF_MESSAGE_ALIGNMENT: "right",
	readSpaceSelfMessageAlignmentPreference: selfMessageAlignmentState.read,
	writeSpaceSelfMessageAlignmentPreference: selfMessageAlignmentState.write,
}));

describe("AppearanceSection", () => {
	afterEach(() => {
		cleanup();
		themeState.setTheme.mockReset();
		themeState.theme = "system";
		conversationLayoutState.read.mockReset().mockReturnValue("centered");
		conversationLayoutState.write.mockReset();
		selfMessageAlignmentState.read.mockReset().mockReturnValue("right");
		selfMessageAlignmentState.write.mockReset();
	});

	it("shows the mounted theme and changes it from the radio group", () => {
		renderAppearance();

		expect(
			screen.getByRole("heading", { level: 1, name: "Appearance" })
		).toBeTruthy();
		expect(screen.getByText("Personal")).toBeTruthy();
		const themeGroup = screen.getByRole("radiogroup", { name: "Theme" });
		expect(themeGroup.getAttribute("aria-orientation")).toBe("horizontal");
		expect(themeGroup.className).toContain("w-full");
		expect(themeGroup.className).toContain("flex-row");
		expect(
			themeGroup
				.closest('[data-slot="settings-row"]')
				?.getAttribute("data-layout")
		).toBe("stacked");
		expect(
			screen
				.getAllByRole("radio")
				.every((radio) => radio.className.includes("flex-1"))
		).toBe(true);
		expect(
			screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")
		).toBe("true");

		fireEvent.click(screen.getByRole("radio", { name: "Light" }));
		fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
		fireEvent.click(screen.getByRole("radio", { name: "System" }));

		expect(themeState.setTheme.mock.calls).toEqual([
			["light"],
			["dark"],
			["system"],
		]);
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
				.getByRole("radio", { name: "Centered" })
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
