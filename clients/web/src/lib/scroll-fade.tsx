"use client";

import { type CSSProperties, type RefObject, useEffect, useState } from "react";
import { useSurface } from "#/lib/surface-context.tsx";

// ---------------------------------------------------------------------------
// Scroll-edge primitives
//
// useScrollEdges tracks which edges of a scroll container have more content
// beyond them; ScrollEdgeCue renders the affordance for one edge — a
// surface-colour gradient fading the content out toward the edge, with a
// small chevron hinting at the scroll direction. Together they give any
// scrolling surface the same "there's more" cue the Select menu uses.
// ---------------------------------------------------------------------------

export type ScrollEdges = {
	top: boolean;
	bottom: boolean;
	left: boolean;
	right: boolean;
};

const NO_EDGES: ScrollEdges = {
	top: false,
	bottom: false,
	left: false,
	right: false,
};

export type UseScrollEdgesOptions = {
	/** Attach/detach tracking. While false all edges read false. Callers whose
	 *  scroller mounts late (portals) must fold that into `enabled` so the
	 *  hook re-attaches once the element exists. Defaults to `true`. */
	enabled?: boolean;
	/** Which axes to measure. Defaults to `"vertical"`. */
	axis?: "vertical" | "horizontal" | "both";
};

export function useScrollEdges(
	ref: RefObject<HTMLElement | null>,
	{ enabled = true, axis = "vertical" }: UseScrollEdgesOptions = {}
): ScrollEdges {
	const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);

	useEffect(() => {
		if (!enabled) {
			setEdges(NO_EDGES);
			return;
		}
		const el = ref.current;
		if (!el) {
			return;
		}

		const update = () => {
			const next = { ...NO_EDGES };
			if (axis !== "horizontal") {
				const { scrollTop, scrollHeight, clientHeight } = el;
				const overflowing = scrollHeight - clientHeight > 1;
				next.top = overflowing && scrollTop > 1;
				next.bottom =
					overflowing && scrollTop + clientHeight < scrollHeight - 1;
			}
			if (axis !== "vertical") {
				const { scrollLeft, scrollWidth, clientWidth } = el;
				const overflowing = scrollWidth - clientWidth > 1;
				next.left = overflowing && scrollLeft > 1;
				next.right = overflowing && scrollLeft + clientWidth < scrollWidth - 1;
			}
			// Bail out on no-op updates so observer churn doesn't re-render.
			setEdges((prev) =>
				prev.top === next.top &&
				prev.bottom === next.bottom &&
				prev.left === next.left &&
				prev.right === next.right
					? prev
					: next
			);
		};

		update();
		// Recompute once layout settles after enter animations.
		const raf = requestAnimationFrame(update);
		el.addEventListener("scroll", update, { passive: true });
		const ro = new ResizeObserver(update);
		ro.observe(el);
		// Async content (items loading in, streamed text) changes scrollHeight
		// without resizing the container itself. Coalesce to one update per
		// frame: update() reads layout, and doing that synchronously after
		// every mutation forces a reflow per insertion in streaming content.
		let moRaf = 0;
		const scheduleUpdate = () => {
			if (moRaf) {
				return;
			}
			moRaf = requestAnimationFrame(() => {
				moRaf = 0;
				update();
			});
		};
		const mo = new MutationObserver(scheduleUpdate);
		mo.observe(el, { childList: true, subtree: true, characterData: true });
		return () => {
			cancelAnimationFrame(raf);
			if (moRaf) {
				cancelAnimationFrame(moRaf);
			}
			el.removeEventListener("scroll", update);
			ro.disconnect();
			mo.disconnect();
		};
	}, [ref, enabled, axis]);

	return edges;
}

// ---------------------------------------------------------------------------
// ScrollEdgeCue
// ---------------------------------------------------------------------------

const CHEVRON_PATHS: Record<string, string> = {
	top: "M6 15l6-6 6 6",
	bottom: "M6 9l6 6 6-6",
	left: "M15 6l-6 6 6 6",
	right: "M9 6l6 6-6 6",
};

// Band size presets along the scroll axis. The chevron stays 16px in both.
const CUE_SIZES = { tight: 32, comfortable: 60 } as const;

export type ScrollEdgeCueSize = keyof typeof CUE_SIZES;

export type ScrollEdgeCueProps = {
	edge: "top" | "bottom" | "left" | "right";
	visible: boolean;
	/** `"sticky"` renders a zero-size sticky element placed inside the scroller
	 *  itself (before/after the scrolling content); `"absolute"` renders a plain
	 *  positioned band for an `absolute inset-0 pointer-events-none` overlay
	 *  sitting over the viewport. Defaults to `"sticky"`. */
	mode?: "sticky" | "absolute";
	/** Surface ladder level the gradient fades toward. Defaults to the level
	 *  provided by the nearest SurfaceProvider/Elevated — override only when
	 *  the scroller sits on a background outside the ladder. */
	surfaceLevel?: number;
	/** Band size along the scroll axis: `"tight"` (32px) or `"comfortable"`
	 *  (60px). The chevron is 16px in either. Defaults to `"comfortable"`. */
	size?: ScrollEdgeCueSize;
	/** Sticky-mode bleed in px so the band covers the scroller's padding
	 *  (e.g. 4 for `p-1`, 16 for `p-4`). Defaults to 4. */
	inset?: number;
	/** Show the directional chevron in the band. The gradient fade always
	 *  renders; set to `false` for a fade-only cue. Defaults to `true`. */
	chevron?: boolean;
};

function getCueBandPosition({
	edge,
	inset,
	mode,
	sizePx,
	vertical,
}: {
	edge: ScrollEdgeCueProps["edge"];
	inset: number;
	mode: NonNullable<ScrollEdgeCueProps["mode"]>;
	sizePx: number;
	vertical: boolean;
}): CSSProperties {
	if (mode === "sticky") {
		return vertical
			? ({
					left: -inset,
					right: -inset,
					[edge]: -inset,
					height: sizePx,
				} as CSSProperties)
			: ({
					top: -inset,
					bottom: -inset,
					[edge]: -inset,
					width: sizePx,
				} as CSSProperties);
	}

	return vertical
		? ({ left: 0, right: 0, [edge]: 0, height: sizePx } as CSSProperties)
		: ({ top: 0, bottom: 0, [edge]: 0, width: sizePx } as CSSProperties);
}

export function ScrollEdgeCue({
	edge,
	visible,
	mode = "sticky",
	surfaceLevel,
	size = "comfortable",
	inset = 4,
	chevron = true,
}: ScrollEdgeCueProps) {
	const contextLevel = useSurface();
	// Clamp to the ladder (1–8), mirroring SurfaceProvider — an out-of-range
	// override would interpolate an invalid var and silently kill the gradient.
	const level = Math.max(1, Math.min(8, surfaceLevel ?? contextLevel));
	const surface = `var(--surface-${level})`;
	const vertical = edge === "top" || edge === "bottom";
	const sizePx = CUE_SIZES[size];
	// Gradient direction where 100% == the hard outer edge.
	const dir = `to ${edge}`;
	const bandPosition = getCueBandPosition({
		edge,
		inset,
		mode,
		sizePx,
		vertical,
	});

	const band = (
		<div
			style={
				{
					position: "absolute",
					opacity: visible ? 1 : 0,
					// Exit slightly faster than enter, per the animation guidelines.
					transition: `opacity ${visible ? 160 : 120}ms ease`,
					...bandPosition,
				} as CSSProperties
			}
		>
			<div
				style={{
					position: "absolute",
					inset: 0,
					background: `linear-gradient(${dir}, transparent 0%, color-mix(in srgb, ${surface} 75%, transparent) 65%, ${surface} 100%)`,
				}}
			/>
			{chevron && (
				<svg
					aria-hidden="true"
					className="text-muted-foreground"
					fill="none"
					focusable="false"
					height={16}
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={2}
					style={
						{
							position: "absolute",
							...(vertical
								? { left: "50%", transform: "translateX(-50%)" }
								: { top: "50%", transform: "translateY(-50%)" }),
							[edge]: 8,
						} as CSSProperties
					}
					viewBox="0 0 24 24"
					width={16}
				>
					<path d={CHEVRON_PATHS[edge]} />
				</svg>
			)}
		</div>
	);

	if (mode === "absolute") {
		return <div aria-hidden>{band}</div>;
	}

	// Sticky: a zero-size sticky anchor so the cue adds no layout extent.
	return (
		<div
			aria-hidden
			style={
				{
					position: "sticky",
					[edge]: 0,
					...(vertical ? { height: 0 } : { width: 0 }),
					zIndex: 30,
					pointerEvents: "none",
				} as CSSProperties
			}
		>
			{band}
		</div>
	);
}
