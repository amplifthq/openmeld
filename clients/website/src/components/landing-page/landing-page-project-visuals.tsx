"use client";

import { cn } from "@openmeld/ui/lib/utils";
import { m, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import {
	LANDING_MOTION_CYCLE_SECONDS,
	LANDING_MOTION_EASE,
} from "./landing-page-motion";
import { LandingMotionProvider } from "./landing-page-motion-provider";

type LandingProjectVisualProps = {
	className?: string;
};

const LOCAL_CONNECTIONS = [
	{ label: "Clone 01", y: 52 },
	{ label: "Default", y: 105 },
	{ label: "Worktree", y: 158 },
] as const;

export function LandingLocalWorkspaceVisual({
	className,
}: LandingProjectVisualProps) {
	const { rootRef, shouldAnimate } = useProjectVisualMotion();

	return (
		<LandingMotionProvider>
			<div
				aria-hidden="true"
				className={cn("relative h-44 overflow-hidden sm:h-52", className)}
				data-testid="landing-local-workspace-visual"
				ref={rootRef}
			>
				<svg
					aria-hidden="true"
					className="h-full w-full text-foreground"
					fill="none"
					viewBox="0 0 360 210"
				>
					<rect
						fill="currentColor"
						fillOpacity="0.018"
						height="142"
						stroke="currentColor"
						strokeOpacity="0.38"
						width="254"
						x="53"
						y="24"
					/>
					<path
						d="M118 190H242M155 166V190M205 166V190"
						stroke="currentColor"
						strokeOpacity="0.25"
					/>

					{[0, 1, 2].map((index) => (
						<g key={index}>
							<rect
								fill="currentColor"
								fillOpacity={0.018 + index * 0.015}
								height="70"
								stroke="currentColor"
								strokeOpacity={0.2 + index * 0.11}
								width="136"
								x={91 + index * 16}
								y={48 + index * 13}
							/>
							<path
								d={`M${105 + index * 16} ${67 + index * 13}H${
									174 + index * 16
								}M${105 + index * 16} ${81 + index * 13}H${197 + index * 16}`}
								stroke="currentColor"
								strokeOpacity={0.25 + index * 0.12}
							/>
						</g>
					))}

					<m.rect
						animate={
							shouldAnimate
								? { opacity: [0, 0.65, 0], x: [86, 188, 188] }
								: { opacity: 0.45, x: 142 }
						}
						fill="currentColor"
						height="88"
						transition={{
							duration: LANDING_MOTION_CYCLE_SECONDS,
							ease: LANDING_MOTION_EASE,
							repeat: Number.POSITIVE_INFINITY,
							times: [0, 0.68, 1],
						}}
						width="1.5"
						y="43"
					/>
					<text
						className="font-geist-pixel-line text-[8px] uppercase tracking-[0.12em]"
						fill="currentColor"
						fillOpacity="0.52"
						x="69"
						y="151"
					>
						Files · tools · runtime
					</text>
					<text
						className="font-geist-pixel-line text-[8px] uppercase tracking-[0.12em]"
						fill="currentColor"
						fillOpacity="0.66"
						textAnchor="end"
						x="291"
						y="39"
					>
						Local only
					</text>
				</svg>
			</div>
		</LandingMotionProvider>
	);
}

export function LandingWakeTargetVisual({
	className,
}: LandingProjectVisualProps) {
	const { rootRef, shouldAnimate } = useProjectVisualMotion();

	return (
		<LandingMotionProvider>
			<div
				aria-hidden="true"
				className={cn("relative h-44 overflow-hidden sm:h-52", className)}
				data-testid="landing-wake-target-visual"
				ref={rootRef}
			>
				<svg
					aria-hidden="true"
					className="h-full w-full text-foreground"
					fill="none"
					viewBox="0 0 360 210"
				>
					<g stroke="currentColor" strokeOpacity="0.23">
						<path d="M84 52H116V88H146" />
						<path d="M84 105H146" />
						<path d="M84 158H116V122H146" />
						<path d="M214 105H279" />
					</g>

					{LOCAL_CONNECTIONS.map((connection, index) => (
						<g key={connection.label}>
							<rect
								fill="currentColor"
								fillOpacity={index === 1 ? 0.05 : 0.018}
								height="30"
								stroke="currentColor"
								strokeOpacity={index === 1 ? 0.44 : 0.24}
								width="64"
								x="20"
								y={connection.y - 15}
							/>
							<text
								className="font-geist-pixel-line text-[7px] uppercase tracking-[0.08em]"
								fill="currentColor"
								fillOpacity="0.52"
								textAnchor="middle"
								x="52"
								y={connection.y + 3}
							>
								{connection.label}
							</text>
						</g>
					))}

					<rect
						fill="currentColor"
						fillOpacity="0.065"
						height="66"
						stroke="currentColor"
						strokeOpacity="0.5"
						width="68"
						x="146"
						y="72"
					/>
					<text
						className="font-geist-pixel-square text-[18px]"
						fill="currentColor"
						fillOpacity="0.82"
						textAnchor="middle"
						x="180"
						y="102"
					>
						P
					</text>
					<text
						className="font-geist-pixel-line text-[7px] uppercase tracking-[0.1em]"
						fill="currentColor"
						fillOpacity="0.52"
						textAnchor="middle"
						x="180"
						y="121"
					>
						Project
					</text>

					<path
						d="M292 70v-18h18M328 70v-18h-18M292 140v18h18M328 140v18h-18"
						stroke="currentColor"
						strokeOpacity="0.44"
					/>
					<rect
						fill="currentColor"
						fillOpacity="0.035"
						height="52"
						stroke="currentColor"
						strokeOpacity="0.3"
						width="62"
						x="279"
						y="79"
					/>
					<path
						d="M289 94h18l6 7h18v19h-42z"
						stroke="currentColor"
						strokeOpacity="0.5"
					/>

					<m.circle
						animate={
							shouldAnimate
								? {
										cx: [84, 146, 214, 279],
										cy: [105, 105, 105, 105],
										opacity: [0, 0.82, 0.82, 0],
									}
								: { cx: 290, cy: 105, opacity: 0.64 }
						}
						fill="currentColor"
						r="3"
						transition={{
							duration: LANDING_MOTION_CYCLE_SECONDS,
							ease: LANDING_MOTION_EASE,
							repeat: Number.POSITIVE_INFINITY,
							times: [0, 0.34, 0.7, 1],
						}}
					/>
					<text
						className="font-geist-pixel-line text-[8px] uppercase tracking-[0.1em]"
						fill="currentColor"
						fillOpacity="0.56"
						textAnchor="middle"
						x="310"
						y="180"
					>
						Right folder
					</text>
				</svg>
			</div>
		</LandingMotionProvider>
	);
}

function useProjectVisualMotion() {
	const rootRef = useRef<HTMLDivElement>(null);
	const isInView = useInView(rootRef, { amount: 0.25 });
	const shouldReduceMotion = useReducedMotion();

	return {
		rootRef,
		shouldAnimate: isInView && !shouldReduceMotion,
	};
}
