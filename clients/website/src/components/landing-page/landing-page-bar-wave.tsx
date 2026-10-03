"use client";

import { cn } from "@openmeld/ui/lib/utils";
import { m, useInView, useReducedMotion } from "motion/react";
import {
	type PointerEvent as ReactPointerEvent,
	useRef,
	useState,
} from "react";
import {
	LANDING_MOTION_CYCLE_SECONDS,
	LANDING_MOTION_EASE,
	LANDING_MOTION_SPRING,
} from "./landing-page-motion";
import { LandingMotionProvider } from "./landing-page-motion-provider";

const PLANE_COUNT = 14;
const IDLE_FOCUS_INDEX = 7;
const PLANE_INFLUENCE_FALLOFF = 0.23;
const PLANE_IDS = Array.from(
	{ length: PLANE_COUNT },
	(_, index) => `project-lane-${index + 1}`
);

type LandingBarWaveProps = {
	className?: string;
};

export function LandingBarWave({ className }: LandingBarWaveProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const isInView = useInView(rootRef, { amount: 0.25 });
	const shouldReduceMotion = useReducedMotion();
	const [hoveredPlaneIndex, setHoveredPlaneIndex] = useState<number | null>(
		null
	);
	const focusIndex = hoveredPlaneIndex ?? IDLE_FOCUS_INDEX;
	const shouldAnimate = isInView && !shouldReduceMotion;

	const handlePointerEnter = (
		event: ReactPointerEvent<SVGGElement>,
		index: number
	) => {
		if (event.pointerType === "mouse") {
			setHoveredPlaneIndex(index);
		}
	};

	const handlePointerLeave = (event: ReactPointerEvent<SVGGElement>) => {
		if (event.pointerType === "mouse") {
			setHoveredPlaneIndex(null);
		}
	};

	return (
		<LandingMotionProvider>
			<div
				className={cn(
					"relative isolate h-44 overflow-hidden sm:h-52",
					className
				)}
				data-testid="landing-bar-wave"
				ref={rootRef}
			>
				<svg
					aria-hidden="true"
					className="absolute top-1/2 left-1/2 h-[14rem] w-[27rem] max-w-[118%] -translate-x-1/2 -translate-y-1/2 overflow-visible text-foreground sm:h-[17rem] sm:w-[34rem]"
					data-testid="landing-bar-wave-svg"
					fill="none"
					viewBox="0 -72 390 260"
					xmlns="http://www.w3.org/2000/svg"
				>
					<g transform="rotate(180, 180, 72)">
						{PLANE_IDS.map((planeId, index) => {
							const distance = Math.abs(focusIndex - index);
							const influence = Math.max(
								0,
								1 - distance * PLANE_INFLUENCE_FALLOFF
							);
							const lift = influence * 72;
							const restingOpacity = 0.18 + influence * 0.58;
							const isHovering = hoveredPlaneIndex !== null;
							let animation: {
								opacity: number | number[];
								y: number | number[];
							} = {
								opacity: 0.42,
								y: 0,
							};

							if (shouldAnimate && isHovering) {
								animation = {
									opacity: restingOpacity,
									y: lift,
								};
							} else if (shouldAnimate) {
								animation = {
									opacity: [
										0.28,
										0.28,
										restingOpacity,
										restingOpacity * 0.78,
										0.28,
									],
									y: [0, 0, lift, lift * 0.32, 0],
								};
							}

							return (
								<m.g
									animate={animation}
									data-plane-index={index}
									key={planeId}
									onPointerEnter={(event) => handlePointerEnter(event, index)}
									onPointerLeave={handlePointerLeave}
									transition={
										isHovering
											? LANDING_MOTION_SPRING
											: {
													delay: index * 0.045,
													duration: LANDING_MOTION_CYCLE_SECONDS,
													ease: LANDING_MOTION_EASE,
													repeat: Number.POSITIVE_INFINITY,
													times: [0, 0.24, 0.4, 0.67, 1],
												}
									}
								>
									<rect
										fill="currentColor"
										fillOpacity="0.055"
										height="36"
										rx="1.5"
										stroke="currentColor"
										strokeOpacity="0.55"
										strokeWidth="0.85"
										transform="matrix(0.866025 0.5 0 1 0 -2.6)"
										width="194"
										x={0.5 + index * 16}
										y={0.75 + index * -16}
									/>
								</m.g>
							);
						})}
					</g>
				</svg>
			</div>
		</LandingMotionProvider>
	);
}
