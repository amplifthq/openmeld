import { PlatformBadge } from "@openmeld/ui/components/platform-badge";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { lazy, Suspense, useEffect, useState } from "react";
import "./platform-metal-badge.css";

const MetalFx = lazy(() =>
	import("metal-fx").then((module) => ({ default: module.MetalFx }))
);

function badgeMask(
	context: CanvasRenderingContext2D,
	width: number,
	height: number
) {
	context.beginPath();
	context.roundRect(0, 0, width, height, height / 2);
	context.fill();
}

export function PlatformMetalBadge({
	children,
	appearance = "fill",
}: {
	children: string;
	appearance?: "fill" | "ring";
}) {
	const [mounted, setMounted] = useState(false);
	const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
	useEffect(() => setMounted(true), []);
	const filled = appearance === "fill";
	const badge = (
		<PlatformBadge appearance={appearance}>{children}</PlatformBadge>
	);
	if (!mounted || reduced) {
		return badge;
	}
	return (
		<Suspense fallback={badge}>
			<MetalFx
				borderRadius={filled ? 999 : undefined}
				className="meld-metal-badge"
				glowGain={filled ? 0.45 : 0.35}
				glowMode={filled ? "ring" : undefined}
				mask={filled ? badgeMask : undefined}
				normalizeHostStyles={!filled}
				preset="chromatic"
				shaderScale={filled ? 1.6 : undefined}
				strength={0.8}
				style={
					filled ? { background: "#ffffff", borderRadius: 999 } : undefined
				}
				theme="light"
			>
				{badge}
			</MetalFx>
		</Suspense>
	);
}
