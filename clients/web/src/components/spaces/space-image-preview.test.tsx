import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { MotionConfig } from "framer-motion";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearSpaceFileMediaResources,
	spaceFileMediaResources,
} from "#/query/spaces/space-file-media-resource";
import { SpaceImagePreview } from "./space-image-preview";

vi.mock("./space-image-loading-effect", () => ({
	default: () => <div data-testid="img-fx-loading-effect" />,
}));
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function preview(
	source: string | null,
	input: Partial<Parameters<typeof SpaceImagePreview>[0]> = {}
) {
	return (
		<SpaceImagePreview
			altText="Screenshot"
			imageSource={source}
			isSingle
			{...input}
		/>
	);
}
function frame(container: HTMLElement) {
	const element = container.querySelector<HTMLElement>("[data-image-frame]");
	if (!element) {
		throw new Error("Expected an image frame.");
	}
	return element;
}

describe("stable image rendering", () => {
	it("revokes an already decoded composer thumbnail and its open viewer without waiting for a parent render", () => {
		vi.stubGlobal(
			"URL",
			class extends URL {
				static createObjectURL = () => "blob:private-composer";
				static revokeObjectURL = vi.fn();
			}
		);
		const client = new QueryClient();
		const resource = spaceFileMediaResources(client).create(
			new Blob(["private"]),
			"space-1",
			"composer-file:private"
		);
		const view = render(
			<QueryClientProvider client={client}>
				{preview(resource.getSnapshot())}
			</QueryClientProvider>
		);
		fireEvent.load(screen.getByRole("img", { name: "Screenshot" }));
		fireEvent.click(screen.getByRole("button", { name: "Open Screenshot" }));
		expect(document.querySelectorAll('img[alt="Screenshot"]')).toHaveLength(2);
		act(() => clearSpaceFileMediaResources(client));
		expect(document.querySelectorAll('img[alt="Screenshot"]')).toHaveLength(0);
		expect(screen.queryByTestId("img-fx-loading-effect")).toBeNull();
		view.unmount();
		resource.release();
		client.clear();
	});

	it("runs the actual loading-adapter path only during active cold loading, not a local or cached mount", async () => {
		const view = render(
			preview(null, { active: false, width: 600, height: 1200 })
		);
		const element = frame(view.container);
		const geometry = element.getAttribute("style");
		expect(geometry).toContain("256px");
		expect(screen.queryByTestId("img-fx-loading-effect")).toBeNull();
		view.rerender(preview(null, { active: true, width: 600, height: 1200 }));
		await screen.findByTestId("img-fx-loading-effect");
		view.rerender(
			preview("blob:original", { active: true, width: 600, height: 1200 })
		);
		expect(frame(view.container)).toBe(element);
		expect(element.getAttribute("style")).toBe(geometry);
		fireEvent.load(screen.getByRole("img", { name: "Screenshot" }));
		await waitFor(() =>
			expect(screen.queryByLabelText("Loading Screenshot")).toBeNull()
		);
		expect(screen.queryByTestId("img-fx-loading-effect")).toBeNull();
		view.unmount();
		render(preview("blob:original", { active: true }));
		expect(screen.queryByLabelText("Loading Screenshot")).toBeNull();
		expect(screen.queryByTestId("img-fx-loading-effect")).toBeNull();
	});

	it("does not allocate the effect for reduced motion, and uses an unchanged fallback for unknown geometry", () => {
		const view = render(
			<MotionConfig reducedMotion="always">
				{preview(null, { active: true })}
			</MotionConfig>
		);
		const element = frame(view.container);
		expect(element.style.width).toBe("288px");
		expect(element.style.aspectRatio).toBe("288 / 192");
		expect(screen.queryByTestId("img-fx-loading-effect")).toBeNull();
		view.rerender(
			<MotionConfig reducedMotion="always">
				{preview("blob:later-metadata", {
					active: true,
					width: 100,
					height: 2000,
				})}
			</MotionConfig>
		);
		fireEvent.load(screen.getByRole("img", { name: "Screenshot" }));
		expect(element.style.width).toBe("288px");
		expect(element.style.aspectRatio).toBe("288 / 192");
	});

	it("keeps geometry on decode failure, retries explicitly, and does not let an old decode replace a new source", async () => {
		const retry = vi.fn();
		const view = render(
			preview("blob:old", { width: 400, height: 300, onRetry: retry })
		);
		const element = frame(view.container);
		const style = element.getAttribute("style");
		const oldImage = screen.getByRole("img", { name: "Screenshot" });
		let rejectOld: (error: Error) => void = () => {
			throw new Error("No old decode.");
		};
		Object.defineProperty(oldImage, "decode", {
			configurable: true,
			value: () =>
				new Promise<void>((_resolve, reject) => {
					rejectOld = reject;
				}),
		});
		fireEvent.load(oldImage);
		view.rerender(
			preview("blob:new", { width: 400, height: 300, onRetry: retry })
		);
		await act(async () => {
			rejectOld(new Error("Stale decode"));
			await Promise.resolve();
		});
		expect(screen.queryByText("Image unavailable")).toBeNull();
		fireEvent.error(screen.getByRole("img", { name: "Screenshot" }));
		expect(screen.getByText("Image unavailable")).toBeTruthy();
		expect(element.getAttribute("style")).toBe(style);
		fireEvent.click(screen.getByRole("button", { name: "Retry image" }));
		expect(retry).toHaveBeenCalledTimes(1);
		const retried = screen.getByRole("img", { name: "Screenshot" });
		expect(retried).not.toBe(oldImage);
		fireEvent.load(retried);
		expect(screen.queryByText("Image unavailable")).toBeNull();
		expect(element.getAttribute("style")).toBe(style);
	});

	it("keeps the open viewer and exact original on acknowledgement, then removes all pixels on revocation", () => {
		const view = render(
			preview("blob:shared-original", { width: 320, height: 640 })
		);
		const thumbnail = screen.getByRole("img", { name: "Screenshot" });
		fireEvent.click(screen.getByRole("button", { name: "Open Screenshot" }));
		const dialog = screen.getByRole("dialog", { name: "Screenshot" });
		const image = within(dialog).getByRole("img", { name: "Screenshot" });
		const openFile = vi.fn();
		view.rerender(
			preview("blob:shared-original", {
				width: 320,
				height: 640,
				focusedAction: { label: "Open in Files", onSelect: openFile },
			})
		);
		expect(screen.getByRole("dialog", { name: "Screenshot" })).toBe(dialog);
		expect(within(dialog).getByRole("img", { name: "Screenshot" })).toBe(image);
		expect(thumbnail.getAttribute("src")).toBe("blob:shared-original");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Open in Files" })
		);
		expect(openFile).toHaveBeenCalledTimes(1);
		view.rerender(preview(null, { error: true }));
		expect(screen.queryAllByRole("img")).toHaveLength(0);
	});

	it.each([
		[400, 12_000],
		[12_000, 400],
		[16, 16],
	])("crops a %s by %s attachment without changing its original viewer", (width, height) => {
		const view = render(
			preview("blob:original", { attachmentThumbnail: true, width, height })
		);
		expect(frame(view.container).style.width).toBe("");
		expect(screen.getByRole("img", { name: "Screenshot" }).className).toContain(
			"object-cover"
		);
		fireEvent.click(screen.getByRole("button", { name: "Open Screenshot" }));
		const original = within(
			screen.getByRole("dialog", { name: "Screenshot" })
		).getByRole("img");
		expect(original.className).toContain("object-contain");
		expect(original.getAttribute("src")).toBe("blob:original");
	});
});
