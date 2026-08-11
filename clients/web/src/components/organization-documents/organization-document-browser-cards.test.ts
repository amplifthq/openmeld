import { afterEach, describe, expect, it, vi } from "vitest";
import { setBrowserItemDragPreview } from "./organization-document-drag-preview";

describe("setBrowserItemDragPreview", () => {
	afterEach(() => {
		vi.useRealTimers();
		document.body.replaceChildren();
	});

	it("gives native drag-and-drop a fully opaque card preview", () => {
		vi.useFakeTimers();
		const source = document.createElement("a");
		source.style.borderRadius = "8px";
		source.getBoundingClientRect = () =>
			({
				bottom: 180,
				height: 160,
				left: 10,
				right: 310,
				top: 20,
				width: 300,
				x: 10,
				y: 20,
				toJSON: () => undefined,
			}) as DOMRect;
		document.body.appendChild(source);
		const setDragImage = vi.fn();

		setBrowserItemDragPreview({
			currentTarget: source,
			dataTransfer: { setDragImage } as unknown as DataTransfer,
		});

		const preview = document.querySelector<HTMLElement>(
			'[data-openmeld-drag-preview="true"]'
		);
		expect(preview).not.toBeNull();
		expect(preview?.style.backgroundColor).toBe("var(--card)");
		expect(preview?.style.opacity).toBe("1");
		expect(preview?.style.width).toBe("300px");
		expect(preview?.style.height).toBe("160px");
		expect(setDragImage).toHaveBeenCalledWith(preview, 28, 28);

		vi.runAllTimers();
		expect(
			document.querySelector('[data-openmeld-drag-preview="true"]')
		).toBeNull();
	});
});
