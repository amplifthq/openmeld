"use client";

import { cn } from "@openmeld/ui/lib/utils";
import { m, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import {
	LANDING_MOTION_CYCLE_SECONDS,
	LANDING_MOTION_EASE,
} from "./landing-page-motion";
import { LandingMotionProvider } from "./landing-page-motion-provider";

type LandingCenterAgentVisualProps = {
	className?: string;
};

const REQUEST_SOURCES = [
	{ label: "OpenMeld", y: 58 },
	{ label: "Slack", y: 126 },
] as const;

const WORK_DESTINATIONS = [
	{
		label: "Space",
		route: { cx: [374, 430, 430, 494], cy: [92, 92, 40, 40] },
		y: 40,
	},
	{
		label: "Local agents",
		route: { cx: [374, 414, 454, 494], cy: [114, 114, 114, 114] },
		y: 108,
	},
	{
		label: "Routine",
		route: { cx: [374, 430, 430, 494], cy: [136, 136, 176, 176] },
		y: 176,
	},
] as const;
const RESULT_RETURN_LINE_END_X = 148;
const RESULT_RETURN_Y = 218;

export function LandingCenterAgentVisual({
	className,
}: LandingCenterAgentVisualProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const isInView = useInView(rootRef, { amount: 0.25 });
	const shouldReduceMotion = useReducedMotion();
	const shouldAnimate = isInView && !shouldReduceMotion;

	return (
		<LandingMotionProvider>
			<div
				aria-hidden="true"
				className={cn("relative h-[15rem] overflow-hidden", className)}
				data-testid="landing-center-agent-visual"
				ref={rootRef}
			>
				<svg
					aria-hidden="true"
					className="h-full w-full text-foreground"
					fill="none"
					viewBox="0 0 640 250"
				>
					<g stroke="currentColor" strokeOpacity="0.2" strokeWidth="1">
						<path d="M122 58H206V92H266" />
						<path d="M122 126H224V136H266" />
						<path d="M374 92H430V40H494" />
						<path d="M374 114H494" />
						<path d="M374 136H430V176H494" />
						<path
							d={`M612 40H626V${RESULT_RETURN_Y}H${RESULT_RETURN_LINE_END_X}`}
						/>
						<path d="M612 108H626" />
						<path d="M612 176H626" />
					</g>

					{REQUEST_SOURCES.map((source) => (
						<g key={source.label}>
							<rect
								fill="currentColor"
								fillOpacity="0.025"
								height="38"
								stroke="currentColor"
								strokeOpacity="0.26"
								width="92"
								x="30"
								y={source.y - 19}
							/>
							<text
								className="font-geist-pixel-line text-[9px] uppercase tracking-[0.1em]"
								fill="currentColor"
								fillOpacity="0.62"
								textAnchor="middle"
								x="76"
								y={source.y + 3}
							>
								{source.label}
							</text>
						</g>
					))}

					<g>
						<rect
							fill="currentColor"
							fillOpacity="0.06"
							height="92"
							stroke="currentColor"
							strokeOpacity="0.58"
							width="108"
							x="266"
							y="68"
						/>
						<text
							className="font-geist-pixel-square text-[25px]"
							fill="currentColor"
							fillOpacity="0.9"
							textAnchor="middle"
							x="320"
							y="110"
						>
							CA
						</text>
						<text
							className="font-geist-pixel-line text-[8px] uppercase tracking-[0.1em]"
							fill="currentColor"
							fillOpacity="0.56"
							textAnchor="middle"
							x="320"
							y="135"
						>
							Center Agent
						</text>
					</g>

					{WORK_DESTINATIONS.map((destination, index) => (
						<g key={destination.label}>
							<rect
								fill="currentColor"
								fillOpacity={index === 0 ? 0.05 : 0.025}
								height="40"
								stroke="currentColor"
								strokeOpacity={index === 0 ? 0.48 : 0.3}
								width="118"
								x="494"
								y={destination.y - 20}
							/>
							<text
								className="font-geist-pixel-line text-[9px] uppercase tracking-[0.1em]"
								fill="currentColor"
								fillOpacity="0.68"
								textAnchor="middle"
								x="553"
								y={destination.y + 3}
							>
								{destination.label}
							</text>
							<m.circle
								animate={
									shouldAnimate
										? {
												cx: [...destination.route.cx],
												cy: [...destination.route.cy],
												opacity: [0, 0.9, 0.9, 0],
											}
										: {
												cx: 494,
												cy: destination.y,
												opacity: 0.65,
											}
								}
								fill="currentColor"
								r="3"
								transition={{
									delay: index * 0.65,
									duration: LANDING_MOTION_CYCLE_SECONDS,
									ease: LANDING_MOTION_EASE,
									repeat: Number.POSITIVE_INFINITY,
									times: [0, 0.32, 0.68, 1],
								}}
							/>
						</g>
					))}

					<m.circle
						animate={
							shouldAnimate
								? {
										cx: [612, 626, 626, 452, 320, RESULT_RETURN_LINE_END_X],
										cy: [
											176,
											176,
											RESULT_RETURN_Y,
											RESULT_RETURN_Y,
											RESULT_RETURN_Y,
											RESULT_RETURN_Y,
										],
										opacity: [0, 0.84, 0.84, 0.84, 0.84, 0],
									}
								: { cx: 270, cy: RESULT_RETURN_Y, opacity: 0.64 }
						}
						fill="currentColor"
						r="3.5"
						transition={{
							delay: 1.7,
							duration: LANDING_MOTION_CYCLE_SECONDS,
							ease: LANDING_MOTION_EASE,
							repeat: Number.POSITIVE_INFINITY,
							times: [0, 0.16, 0.32, 0.56, 0.78, 1],
						}}
					/>
					<text
						className="font-geist-pixel-line text-[8px] uppercase tracking-[0.12em]"
						dominantBaseline="middle"
						fill="currentColor"
						fillOpacity="0.48"
						x="30"
						y={RESULT_RETURN_Y}
					>
						Every result returns
					</text>
				</svg>
			</div>
		</LandingMotionProvider>
	);
}
