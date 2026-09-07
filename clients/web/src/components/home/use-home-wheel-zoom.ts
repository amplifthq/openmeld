import type { Node, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useEffect } from "react";

/** Normalize modifier-wheel zoom without the Mac-specific 10x pinch multiplier. */
export function useHomeWheelZoom<N extends Node>(
	region: RefObject<HTMLElement | null>,
	flow: RefObject<ReactFlowInstance<N> | null>
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
			if (!((event.ctrlKey || event.metaKey) && flow.current)) {
				return;
			}
			// An embedded Space Graph owns its own viewport.
			const target = event.target instanceof Element ? event.target : null;
			if (
				target?.closest(".react-flow") !== element.querySelector(".react-flow")
			) {
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
				const instance = flow.current;
				if (!instance) {
					return;
				}
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
		element.addEventListener("wheel", wheel, { passive: false, capture: true });
		return () => {
			element.removeEventListener("wheel", wheel, true);
			cancelAnimationFrame(frame);
		};
	}, [region, flow]);
}
