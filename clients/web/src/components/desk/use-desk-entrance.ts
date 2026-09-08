import type { Node, ReactFlowInstance, Viewport } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";

export function useDeskEntrance<N extends Node>(input: {
	region: RefObject<HTMLElement | null>;
	flow: RefObject<ReactFlowInstance<N> | null>;
	width: number;
	savedViewport: Viewport | null;
	saveViewport: (viewport: Viewport) => void;
}) {
	const frame = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const active = useRef(false);
	const interrupt = useCallback(() => {
		cancelAnimationFrame(frame.current);
		if (timer.current) {
			clearTimeout(timer.current);
		}
		active.current = false;
	}, []);
	useEffect(() => interrupt, [interrupt]);
	const target = useCallback(
		() => ({
			x: Math.max(
				24,
				((input.region.current?.clientWidth ?? input.width + 64) -
					input.width) /
					2
			),
			y: 24,
			zoom: 1,
		}),
		[input.region, input.width]
	);
	const reset = useCallback(() => {
		interrupt();
		input.flow.current?.setViewport(target()).catch(console.error);
	}, [input.flow, target, interrupt]);
	const initialize = useCallback(
		(instance: ReactFlowInstance<N>) => {
			input.flow.current = instance;
			if (input.savedViewport) {
				return;
			}
			const end = target();
			const reduced = matchMedia("(prefers-reduced-motion: reduce)");
			if (reduced.matches) {
				instance.setViewport(end).catch(console.error);
				input.saveViewport(end);
				return;
			}
			const bounds = input.region.current?.getBoundingClientRect();
			const zoom = Math.max(
				0.2,
				Math.min(1, ((bounds?.height ?? 800) - 48) / 1100)
			);
			const start = {
				x: ((bounds?.width ?? input.width + 64) - input.width * zoom) / 2,
				y: 24,
				zoom,
			};
			instance.setViewport(start).catch(console.error);
			active.current = true;
			// Brief overview, then one explanatory transform. User input cancels it.
			timer.current = setTimeout(() => {
				const began = performance.now();
				const tick = (now: number) => {
					if (!active.current) {
						return;
					}
					if (reduced.matches) {
						instance.setViewport(end).catch(console.error);
						interrupt();
						return;
					}
					const progress = Math.min(1, (now - began) / 900);
					const eased = (1 - Math.cos(Math.PI * progress)) / 2;
					instance
						.setViewport({
							x: start.x + (end.x - start.x) * eased,
							y: start.y + (end.y - start.y) * eased,
							zoom: start.zoom + (end.zoom - start.zoom) * eased,
						})
						.catch(console.error);
					if (progress < 1) {
						frame.current = requestAnimationFrame(tick);
					} else {
						active.current = false;
						input.saveViewport(end);
					}
				};
				frame.current = requestAnimationFrame(tick);
			}, 350);
		},
		[
			input.flow,
			input.savedViewport,
			input.region,
			input.width,
			input.saveViewport,
			target,
			interrupt,
		]
	);
	const onMoveEnd = useCallback(
		(viewport: Viewport) => {
			if (!active.current) {
				input.saveViewport(viewport);
			}
		},
		[input.saveViewport]
	);
	return { initialize, reset, interrupt, onMoveEnd };
}
