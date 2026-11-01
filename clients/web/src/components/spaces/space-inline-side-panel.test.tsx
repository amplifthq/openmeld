import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { cloneElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyResizeObservers } from "#/test-support/dom-observers.setup";
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
	it("reserves reading space during drag and preserves the saved width through narrow layouts", () => {
		const onWidthChange = vi.fn();
		const { container } = render(
			<>
				<SpaceInlineSidePanel
					ariaLabel="Thread"
					id="space-thread-panel"
					maxWidth="60rem"
					minRemainingWidth={512}
					minWidth="22rem"
					onWidthChange={onWidthChange}
					open
					resizeHandleLabel="Resize Thread panel"
					width="60rem"
				>
					Thread content
				</SpaceInlineSidePanel>
				<SpaceInlineSidePanel
					ariaLabel="Members"
					id="space-members-panel"
					maxWidth="32rem"
					minWidth="20rem"
					onWidthChange={() => undefined}
					open
					resizeHandleLabel="Resize Members panel"
					width="20rem"
				>
					Members content
				</SpaceInlineSidePanel>
			</>
		);
		const wrapper = container.querySelector<HTMLElement>(
			'[data-slot="sidebar-wrapper"]'
		);
		let containerWidth = 1200;
		let membersWidth = 0;
		const membersWrapper = screen
			.getByLabelText("Members")
			.closest('[data-slot="sidebar-wrapper"]');
		if (!membersWrapper) {
			throw new Error("Members panel must be mounted");
		}
		vi.spyOn(membersWrapper, "getBoundingClientRect").mockImplementation(
			() => ({ width: membersWidth }) as DOMRect
		);
		Object.defineProperty(container, "clientWidth", {
			get: () => containerWidth,
		});
		act(() => notifyResizeObservers(container));
		const rail = screen.getByRole("separator", { name: "Resize Thread panel" });
		fireEvent.pointerDown(rail, { clientX: 500, pointerId: 1 });
		fireEvent.pointerMove(document, { clientX: 0, pointerId: 1 });
		expect(wrapper?.style.getPropertyValue("--sidebar-width")).toBe("688px");
		fireEvent.pointerUp(document, { clientX: 0, pointerId: 1 });
		onWidthChange.mockClear();
		containerWidth = 800;
		act(() => notifyResizeObservers(container));
		expect(wrapper?.getAttribute("data-space-panel-overlay")).toBe("true");
		expect(wrapper?.style.getPropertyValue("--sidebar-width")).toBe("800px");
		expect(
			screen.queryByRole("separator", { name: "Resize Thread panel" })
		).toBeNull();
		membersWidth = 320;
		act(() => notifyResizeObservers(membersWrapper));
		expect(wrapper?.style.getPropertyValue("--sidebar-width")).toBe("480px");
		expect(
			screen.getByRole("separator", { name: "Resize Members panel" })
		).toBeTruthy();
		membersWidth = 0;
		containerWidth = 1600;
		act(() => notifyResizeObservers(container));
		expect(wrapper?.hasAttribute("data-space-panel-overlay")).toBe(false);
		expect(wrapper?.style.getPropertyValue("--sidebar-width")).toBe("960px");
		expect(onWidthChange).not.toHaveBeenCalled();
	});
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

	it("preserves child state while hiding closed content and its resize rail", () => {
		const panel = (
			<SpaceInlineSidePanel
				ariaLabel="Members"
				id="space-members-panel"
				maxWidth="32rem"
				minWidth="20rem"
				onWidthChange={() => undefined}
				open
				resizeHandleLabel="Resize Members panel"
				width="22rem"
			>
				<input aria-label="Member note" defaultValue="" />
				<button type="button">Member action</button>
			</SpaceInlineSidePanel>
		);
		const view = render(panel);
		const note = screen.getByRole("textbox", { name: "Member note" });
		fireEvent.change(note, { target: { value: "Keep this note." } });
		expect(
			screen.getByRole("separator", { name: "Resize Members panel" })
		).toBeTruthy();

		view.rerender(cloneElement(panel, { open: false }));

		expect(
			screen.queryByRole("separator", { name: "Resize Members panel" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Member action" })).toBeNull();
		expect(screen.queryByRole("textbox", { name: "Member note" })).toBeNull();
		expect(note.isConnected).toBe(true);

		view.rerender(panel);
		expect(screen.getByRole("textbox", { name: "Member note" })).toBe(note);
		expect((note as HTMLInputElement).value).toBe("Keep this note.");
		expect(screen.getByRole("button", { name: "Member action" })).toBeTruthy();
		expect(
			screen.getByRole("separator", { name: "Resize Members panel" })
		).toBeTruthy();
	});
});
