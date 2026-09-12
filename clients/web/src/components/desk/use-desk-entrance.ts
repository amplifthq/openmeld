import type { Node, ReactFlowInstance, Viewport } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";

function entrancePhase(elapsed: number) {
	if (elapsed < 180) {
		return "pending";
	}
	if (elapsed < 650) {
		return "greeting";
	}
	if (elapsed < 1500) {
		return "arrow";
	}
	return "space";
}

export function useDeskEntrance<N extends Node>(input: {
	region: RefObject<HTMLElement | null>;
	flow: RefObject<ReactFlowInstance<N> | null>;
	width: number;
	height: number;
	savedViewport: Viewport | null;
	greetingHidden?: boolean;
	saveViewport: (viewport: Viewport) => void;
}) {
	const frame = useRef(0);
	const active = useRef(false);
	const interrupt = useCallback(() => {
		cancelAnimationFrame(frame.current);
		active.current = false;
		if (input.region.current) {
			input.region.current.dataset.deskEntrance = "ready";
		}
	}, [input.region]);
	useEffect(() => interrupt, [interrupt]);
	const target = useCallback(() => {
		const w = input.region.current?.clientWidth || input.width + 64;
		const h = input.region.current?.clientHeight || input.height + 64;
		const zoom = Math.min(1, (w - 64) / input.width, (h - 64) / input.height);
		return {
			x: (w - input.width * zoom) / 2,
			y: (h - input.height * zoom) / 2 - 200 * zoom,
			zoom,
		};
	}, [input.region, input.width, input.height]);
	const reset = useCallback(() => {
		interrupt();
		input.flow.current?.setViewport(target()).catch(console.error);
	}, [input.flow, target, interrupt]);
	const initialize = useCallback(
		(instance: ReactFlowInstance<N>) => {
			input.flow.current = instance;
			if (input.savedViewport) {
				interrupt();
				return;
			}
			const end = target();
			const reduced = matchMedia("(prefers-reduced-motion: reduce)");
			if (reduced.matches || input.greetingHidden) {
				interrupt();
				instance.setViewport(end).catch(console.error);
				input.saveViewport(end);
				return;
			}

			const w = input.region.current?.clientWidth || input.width + 64;
			const h = input.region.current?.clientHeight || input.height + 64;
			const start = { x: (w - input.width) / 2, y: (h - 190) / 2, zoom: 1 };
			if (input.region.current) {
				input.region.current.dataset.deskEntrance = "pending";
			}
			instance.setViewport(start).catch(console.error);
			active.current = true;
			const began = performance.now();
			let phase = "pending";
			const tick = (now: number) => {
				if (!active.current) {
					return;
				}
				if (reduced.matches) {
					instance.setViewport(end).catch(console.error);
					interrupt();
					input.saveViewport(end);
					return;
				}
				const elapsed = now - began;
				const nextPhase = entrancePhase(elapsed);
				if (phase !== nextPhase) {
					phase = nextPhase;
					if (input.region.current) {
						input.region.current.dataset.deskEntrance = phase;
					}
				}
				if (elapsed >= 1700) {
					const progress = Math.min(1, (elapsed - 1700) / 1400);
					const eased = (1 - Math.cos(Math.PI * progress)) / 2;
					instance
						.setViewport({
							x: start.x + (end.x - start.x) * eased,
							y: start.y + (end.y - start.y) * eased,
							zoom: start.zoom + (end.zoom - start.zoom) * eased,
						})
						.catch(console.error);
					if (progress === 1) {
						interrupt();
						input.saveViewport(end);
						return;
					}
				}
				frame.current = requestAnimationFrame(tick);
			};
			frame.current = requestAnimationFrame(tick);
		},
		[
			input.flow,
			input.height,
			input.greetingHidden,
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
	return { initialize, reset, interrupt, onMoveEnd, isEntering: active };
}
