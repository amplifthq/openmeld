import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("TanStackDevtoolsSlot", () => {
	afterEach(() => {
		cleanup();
		vi.resetModules();
		vi.unmock("./app-devtools");
		window.history.replaceState({}, "", "/");
	});

	it("renders nothing when the opt-in query flag is missing", async () => {
		const { TanStackDevtoolsSlot } = await import("./devtools-slot");
		const { container } = render(<TanStackDevtoolsSlot />);

		expect(container.firstChild).toBeNull();
	});

	it("lazy-loads devtools when the opt-in query flag is present", async () => {
		vi.doMock("./app-devtools", () => ({
			default: () => <div>Loaded TanStack devtools</div>,
		}));
		window.history.replaceState({}, "", "/app/new-space?devtools=1");

		const { TanStackDevtoolsSlot } = await import("./devtools-slot");

		render(<TanStackDevtoolsSlot />);

		expect(await screen.findByText("Loaded TanStack devtools")).toBeTruthy();
	});
});
