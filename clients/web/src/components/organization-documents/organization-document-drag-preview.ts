import type { DragEvent } from "react";

const DOCUMENT_DRAG_PREVIEW_ATTRIBUTE = "data-openmeld-drag-preview";

/**
 * Native drag-and-drop otherwise snapshots the transparent card pixels and
 * lets the page show through while the item moves. Give the browser a separate,
 * fully opaque representation without changing the source card or its layout.
 */
export function setBrowserItemDragPreview(
	event: Pick<DragEvent<HTMLElement>, "currentTarget" | "dataTransfer">
): void {
	if (typeof document === "undefined") {
		return;
	}
	const source = event.currentTarget;
	const bounds = source.getBoundingClientRect();
	const preview = source.cloneNode(true) as HTMLElement;
	preview.setAttribute(DOCUMENT_DRAG_PREVIEW_ATTRIBUTE, "true");
	Object.assign(preview.style, {
		backgroundColor: "var(--card)",
		borderColor: "var(--border)",
		borderRadius: getComputedStyle(source).borderRadius,
		borderStyle: "solid",
		borderWidth: "1px",
		boxShadow: "0 18px 50px -20px rgb(0 0 0 / 55%)",
		color: "var(--card-foreground)",
		contain: "layout paint",
		height: `${bounds.height}px`,
		left: "-10000px",
		opacity: "1",
		pointerEvents: "none",
		position: "fixed",
		top: "-10000px",
		width: `${bounds.width}px`,
		zIndex: "2147483647",
	});
	document.body.appendChild(preview);
	event.dataTransfer.setDragImage(
		preview,
		Math.min(28, Math.max(0, bounds.width / 2)),
		Math.min(28, Math.max(0, bounds.height / 2))
	);
	window.setTimeout(() => preview.remove(), 0);
}
