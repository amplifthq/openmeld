import { cn } from "@openmeld/ui/lib/utils";
import { useEffect, useRef } from "react";
import {
	drawAgentActivityField,
	drawCollaborationLoop,
} from "./landing-page-ascii-scenes";

const MAX_DEVICE_PIXEL_RATIO = 1.5;
const FRAME_INTERVAL_MS = 1000 / 28;
const STATIC_TIME_SECONDS = 4.2;
const POINTER_SMOOTHING = 0.075;

type LandingAsciiScene = "activity-field" | "collaboration-loop";

type LandingAsciiCanvasProps = {
	className?: string;
	scene: LandingAsciiScene;
	testId?: string;
};

export function LandingAsciiCanvas({
	className,
	scene,
	testId,
}: LandingAsciiCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const context = getCanvasContext(canvas);
		if (!(canvas && context)) {
			return;
		}

		const reducedMotionQuery =
			typeof window.matchMedia === "function"
				? window.matchMedia("(prefers-reduced-motion: reduce)")
				: null;
		const shouldReduceMotion = () => reducedMotionQuery?.matches ?? false;
		const state = {
			color: "currentColor",
			currentPointerX: 0,
			currentPointerY: 0,
			disposed: false,
			fontFamily: "monospace",
			frameId: null as number | null,
			height: 1,
			isInView: true,
			lastFrameAtMs: 0,
			startedAtMs: 0,
			targetPointerX: 0,
			targetPointerY: 0,
			width: 1,
		};
		const drawScene =
			scene === "collaboration-loop"
				? drawCollaborationLoop
				: drawAgentActivityField;

		const draw = (timeSeconds: number) => {
			drawScene({
				color: state.color,
				context,
				fontFamily: state.fontFamily,
				height: state.height,
				pointerX: state.currentPointerX,
				pointerY: state.currentPointerY,
				timeSeconds,
				width: state.width,
			});
		};

		const drawStaticFrame = () => {
			state.currentPointerX = 0;
			state.currentPointerY = 0;
			draw(STATIC_TIME_SECONDS);
		};

		const stopAnimation = () => {
			if (state.frameId !== null) {
				window.cancelAnimationFrame(state.frameId);
				state.frameId = null;
			}
		};

		const renderFrame = (now: number) => {
			if (state.disposed || !state.isInView || shouldReduceMotion()) {
				state.frameId = null;
				return;
			}

			if (now - state.lastFrameAtMs >= FRAME_INTERVAL_MS) {
				if (state.startedAtMs === 0) {
					state.startedAtMs = now;
				}
				state.lastFrameAtMs = now;
				state.currentPointerX +=
					(state.targetPointerX - state.currentPointerX) * POINTER_SMOOTHING;
				state.currentPointerY +=
					(state.targetPointerY - state.currentPointerY) * POINTER_SMOOTHING;
				draw((now - state.startedAtMs) / 1000);
			}

			state.frameId = window.requestAnimationFrame(renderFrame);
		};

		const startAnimation = () => {
			if (state.frameId === null && state.isInView && !shouldReduceMotion()) {
				state.frameId = window.requestAnimationFrame(renderFrame);
			}
		};

		const resize = () => {
			const rectangle = canvas.getBoundingClientRect();
			const width = Math.max(1, Math.floor(rectangle.width));
			const height = Math.max(1, Math.floor(rectangle.height));
			const pixelRatio = Math.min(
				window.devicePixelRatio || 1,
				MAX_DEVICE_PIXEL_RATIO
			);
			const computedStyle = window.getComputedStyle(canvas);

			canvas.width = Math.floor(width * pixelRatio);
			canvas.height = Math.floor(height * pixelRatio);
			context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
			state.color = computedStyle.color;
			state.fontFamily = computedStyle.fontFamily;
			state.height = height;
			state.width = width;
			drawStaticFrame();
		};

		const handlePointerMove = (event: PointerEvent) => {
			if (event.pointerType !== "mouse" || scene !== "collaboration-loop") {
				return;
			}

			const rectangle = canvas.getBoundingClientRect();
			const isInside =
				event.clientX >= rectangle.left &&
				event.clientX <= rectangle.right &&
				event.clientY >= rectangle.top &&
				event.clientY <= rectangle.bottom;

			if (!isInside) {
				state.targetPointerX = 0;
				state.targetPointerY = 0;
				return;
			}

			state.targetPointerX = clamp(
				((event.clientX - rectangle.left) / rectangle.width) * 2 - 1,
				-1,
				1
			);
			state.targetPointerY = clamp(
				((event.clientY - rectangle.top) / rectangle.height) * 2 - 1,
				-1,
				1
			);
		};

		const handleReducedMotionChange = () => {
			if (shouldReduceMotion()) {
				stopAnimation();
				drawStaticFrame();
				return;
			}
			startAnimation();
		};

		resize();
		const resizeObserver =
			"ResizeObserver" in window ? new ResizeObserver(resize) : null;
		resizeObserver?.observe(canvas);
		if (!resizeObserver) {
			window.addEventListener("resize", resize);
		}

		const intersectionObserver =
			"IntersectionObserver" in window
				? new IntersectionObserver(
						(entries) => {
							state.isInView = entries.some((entry) => entry.isIntersecting);
							if (state.isInView) {
								startAnimation();
							} else {
								stopAnimation();
							}
						},
						{ rootMargin: "160px 0px" }
					)
				: null;
		intersectionObserver?.observe(canvas);

		const themeObserver =
			"MutationObserver" in window
				? new MutationObserver(() => {
						const computedStyle = window.getComputedStyle(canvas);
						state.color = computedStyle.color;
						state.fontFamily = computedStyle.fontFamily;
						if (shouldReduceMotion() || !state.isInView) {
							drawStaticFrame();
						}
					})
				: null;
		themeObserver?.observe(document.documentElement, {
			attributeFilter: ["class", "style"],
			attributes: true,
		});

		window.addEventListener("pointermove", handlePointerMove, {
			passive: true,
		});
		reducedMotionQuery?.addEventListener?.("change", handleReducedMotionChange);
		startAnimation();

		return () => {
			state.disposed = true;
			stopAnimation();
			resizeObserver?.disconnect();
			intersectionObserver?.disconnect();
			themeObserver?.disconnect();
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("resize", resize);
			reducedMotionQuery?.removeEventListener?.(
				"change",
				handleReducedMotionChange
			);
		};
	}, [scene]);

	return (
		<canvas
			className={cn("block h-full w-full font-geist-pixel-square", className)}
			data-testid={testId}
			ref={canvasRef}
		/>
	);
}

function getCanvasContext(canvas: HTMLCanvasElement | null) {
	if (!canvas) {
		return null;
	}

	try {
		return canvas.getContext("2d");
	} catch {
		return null;
	}
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
