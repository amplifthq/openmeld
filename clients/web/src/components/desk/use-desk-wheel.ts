import type { Node, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useEffect } from "react";

/** Normalize modifier-wheel zoom without the Mac-specific 10x pinch multiplier. */
export function useDeskWheel<N extends Node>(
	region: RefObject<HTMLElement | null>,
	flow: RefObject<ReactFlowInstance<N> | null>,
	isEntering?: RefObject<boolean>
) {
	useEffect(() => {
		const element = region.current;
		if (!element) {
			return;
		}
		let frame = 0;
		let delta = 0;
		let pointer = { x: 0, y: 0 };
		const wheel = (event: WheelEvent) => {
			const instance = flow.current;
			if (!instance) {
				return;
			}
			// An embedded Space Graph owns its own viewport.
			const target = event.target instanceof Element ? event.target : null;
			if (
				target?.closest(".react-flow") !== element.querySelector(".react-flow")
			) {
				return;
			}
			if (!isZoomGesture(event)) {
				const movement = revealWindowMovement(event, target, element);
				if (movement) {
					event.preventDefault();
					event.stopPropagation();
					const viewport = instance.getViewport();
					instance
						.setViewport({ ...viewport, y: viewport.y - movement })
						.catch(console.error);
				}
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const bounds = element.getBoundingClientRect();
			pointer = {
				x: event.clientX - bounds.left,
				y: event.clientY - bounds.top,
			};
			const unit = [1, 16, bounds.height][event.deltaMode] ?? 1;
			const pixels = event.deltaY * unit;
			delta += Math.max(-60, Math.min(60, pixels));
			if (frame) {
				return;
			}
			frame = requestAnimationFrame(() => {
				frame = 0;
				const current = instance.getViewport();
				const zoom = Math.max(
					0.2,
					Math.min(1.8, current.zoom * Math.exp(-delta * 0.003))
				);
				delta = 0;
				const ratio = zoom / current.zoom;
				instance
					.setViewport({
						x: pointer.x - (pointer.x - current.x) * ratio,
						y: pointer.y - (pointer.y - current.y) * ratio,
						zoom,
					})
					.catch(console.error);
			});
		};
		const onWheel = (event: WheelEvent) => {
			if (isEntering?.current) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			wheel(event);
		};
		element.addEventListener("wheel", onWheel, {
			passive: false,
			capture: true,
		});
		return () => {
			element.removeEventListener("wheel", onWheel, true);
			cancelAnimationFrame(frame);
		};
	}, [region, flow, isEntering]);
}

function isZoomGesture(event: WheelEvent) {
	return event.ctrlKey || event.metaKey;
}

/** Scroll a clipped window into view; then its ordinary Space owns scrolling. */
function revealWindowMovement(
	event: WheelEvent,
	target: Element | null,
	region: HTMLElement
) {
	const window = target?.closest('[aria-label="Desk Space"]');
	if (!window) {
		return 0;
	}
	const bounds = region.getBoundingClientRect();
	const card = window.getBoundingClientRect();
	const pixels = event.deltaY * ([1, 16, bounds.height][event.deltaMode] ?? 1);
	if (pixels > 0) {
		return Math.min(pixels, Math.max(0, card.bottom - bounds.bottom + 24));
	}
	if (pixels >= 0 || card.top >= bounds.top + 24) {
		return 0;
	}
	let parent = target;
	while (parent && parent !== window) {
		if (parent.scrollTop > 0 && parent.scrollHeight > parent.clientHeight) {
			return 0;
		}
		parent = parent.parentElement;
	}
	return Math.max(pixels, card.top - bounds.top - 24);
}
