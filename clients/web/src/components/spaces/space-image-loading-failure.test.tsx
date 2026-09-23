import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { installClientVersionRecovery } from "#/client-version-recovery";
import { SpaceImagePreview } from "./space-image-preview";

// Simulate a failed module fetch, not a failed image or a missing WebGL context.
vi.mock("./space-image-loading-effect", () => {
	throw new TypeError("Failed to fetch dynamically imported module");
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("keeps the chat and image frame usable when the optional effect module fails", async () => {
	const reload = vi.fn();
	const dispose = installClientVersionRecovery({
		window,
		reload,
		now: () => 1000,
	});
	const warning = vi.spyOn(console, "warn").mockImplementation(() => {
		/* Expected decoration fallback. */
	});
	try {
		const preview = (source: string | null) => (
			<>
				<p>Existing conversation</p>
				<SpaceImagePreview
					active
					altText="Photo"
					height={400}
					imageSource={source}
					isSingle
					width={800}
				/>
			</>
		);
		const view = render(preview(null));
		const frame = view.container.querySelector("[data-image-frame]");
		const style = frame?.getAttribute("style");
		await waitFor(() =>
			expect(warning).toHaveBeenCalledWith(
				"Image loading effect unavailable; using the static placeholder."
			)
		);
		expect(screen.getByText("Existing conversation")).toBeTruthy();
		expect(screen.getByLabelText("Loading Photo")).toBeTruthy();
		expect(screen.queryByText("Image unavailable")).toBeNull();
		expect(reload).not.toHaveBeenCalled();
		view.rerender(preview("blob:available-original"));
		fireEvent.load(screen.getByRole("img", { name: "Photo" }));
		await waitFor(() =>
			expect(screen.queryByLabelText("Loading Photo")).toBeNull()
		);
		expect(view.container.querySelector("[data-image-frame]")).toBe(frame);
		expect(frame?.getAttribute("style")).toBe(style);
		fireEvent.click(screen.getByRole("button", { name: "Open Photo" }));
		expect(screen.getByRole("dialog", { name: "Photo" })).toBeTruthy();
		expect(reload).not.toHaveBeenCalled();
	} finally {
		dispose();
	}
});
