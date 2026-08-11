import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceInlineSidePanel } from "./space-inline-side-panel";

afterEach(() => {
	cleanup();
});

function ResizablePanelHarness(input: {
	onWidthChange?: (width: string) => void;
}) {
	const [width, setWidth] = useState("28rem");

	return (
		<SpaceInlineSidePanel
			ariaLabel="Thread"
			id="space-thread-panel"
			maxWidth="40rem"
			minWidth="22rem"
			onWidthChange={(nextWidth) => {
				setWidth(nextWidth);
				input.onWidthChange?.(nextWidth);
			}}
			open={true}
			resizeHandleLabel="Resize Thread panel"
			width={width}
		>
			<div>Thread content</div>
		</SpaceInlineSidePanel>
	);
}

describe("SpaceInlineSidePanel", () => {
	it("reuses the right-side rail direction and grows when its left edge moves left", () => {
		const onWidthChange = vi.fn();
		const { container } = render(
			<ResizablePanelHarness onWidthChange={onWidthChange} />
		);
		const rail = screen.getByRole("separator", {
			name: "Resize Thread panel",
		});
		const wrapper = container.querySelector<HTMLElement>(
			'[data-slot="sidebar-wrapper"]'
		);

		expect(rail.getAttribute("data-resize-direction")).toBe("left");
		expect(wrapper).not.toBeNull();

		fireEvent.pointerDown(rail, { clientX: 500, pointerId: 1 });
		act(() => {
			document.dispatchEvent(
				new PointerEvent("pointermove", { clientX: 468, pointerId: 1 })
			);
		});

		expect(wrapper?.style.getPropertyValue("--sidebar-width")).toBe("30.0rem");

		act(() => {
			document.dispatchEvent(
				new PointerEvent("pointerup", { clientX: 468, pointerId: 1 })
			);
		});
		expect(onWidthChange).toHaveBeenLastCalledWith("30.0rem");
	});

	it("uses accessible right-side keyboard resize semantics without toggling", () => {
		const onWidthChange = vi.fn();
		render(<ResizablePanelHarness onWidthChange={onWidthChange} />);
		const rail = screen.getByRole("separator", {
			name: "Resize Thread panel",
		});

		fireEvent.keyDown(rail, { key: "ArrowLeft" });
		expect(onWidthChange).toHaveBeenLastCalledWith("29.0rem");

		fireEvent.keyDown(rail, { key: "ArrowRight" });
		expect(onWidthChange).toHaveBeenLastCalledWith("28.0rem");

		fireEvent.pointerDown(rail, { clientX: 500, pointerId: 1 });
		act(() => {
			document.dispatchEvent(
				new PointerEvent("pointerup", { clientX: 500, pointerId: 1 })
			);
		});

		expect(screen.getByRole("complementary", { name: "Thread" })).toBeTruthy();
	});

	it("removes content and the resize rail from focus order while closed", () => {
		render(
			<SpaceInlineSidePanel
				ariaLabel="Members"
				id="space-members-panel"
				maxWidth="32rem"
				minWidth="20rem"
				onWidthChange={() => undefined}
				open={false}
				resizeHandleLabel="Resize Members panel"
				width="22rem"
			>
				<button type="button">Member action</button>
			</SpaceInlineSidePanel>
		);

		expect(
			screen.queryByRole("separator", { name: "Resize Members panel" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Member action" })).toBeNull();
	});

	it("lays out content at its final width before the transform-only entrance", () => {
		render(<ResizablePanelHarness />);

		const panel = screen.getByRole("complementary", { name: "Thread" });
		const content = screen.getByText("Thread content").parentElement;

		expect(panel.className).toContain("transition-none");
		expect(panel.className).not.toContain("transition-[width]");
		expect(content?.className).toContain("motion-safe:animate-in");
		expect(content?.className).toContain("motion-safe:slide-in-from-right-4");
		expect(content?.className).toContain("motion-reduce:animate-none");
	});
});
