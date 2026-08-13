import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { cn } from "@openmeld/ui/lib/utils";
import { CalendarDotsIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { m, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { listLocalAgentInstallGuides } from "#/lib/local-agent-install-guides";
import { SlackMarkIcon } from "./landing-page-hero-copy";
import {
	LANDING_MOTION_CYCLE_SECONDS,
	LANDING_MOTION_EASE,
} from "./landing-page-motion";
import { LandingMotionProvider } from "./landing-page-motion-provider";

const CONTEXT_LAYERS = [
	{
		labelX: 32,
		labelY: 208,
		label: "Agent Profile",
		points: "20,224 340,118 760,204 440,310",
	},
	{
		labelX: 32,
		labelY: 148,
		label: "Shared memory",
		points: "20,164 340,58 760,144 440,250",
	},
	{
		labelX: 32,
		labelY: 88,
		label: "Space brief",
		points: "20,104 340,-2 760,84 440,190",
	},
] as const;

const OUTCOMES = [
	{ label: "Result", x: 165 },
	{ label: "Handoff", x: 450 },
	{ label: "Failure", x: 735 },
] as const;
const LOCAL_AGENT_GUIDES = listLocalAgentInstallGuides();

type LandingVisualProps = {
	className?: string;
};

export function LandingContextStackVisual({ className }: LandingVisualProps) {
	const { rootRef, shouldAnimate } = useLandingVisualMotion();

	return (
		<LandingMotionProvider>
			<div
				aria-hidden="true"
				className={cn("relative h-[19rem] overflow-hidden", className)}
				data-testid="landing-context-stack"
				ref={rootRef}
			>
				<svg
					aria-hidden="true"
					className="h-full w-full overflow-visible text-foreground"
					fill="none"
					viewBox="0 -18 820 366"
				>
					{CONTEXT_LAYERS.map((layer, index) => (
						<m.g
							animate={shouldAnimate ? { y: [0, -7, 0] } : { y: 0 }}
							key={layer.label}
							transition={{
								delay: index * 0.22,
								duration: LANDING_MOTION_CYCLE_SECONDS,
								ease: LANDING_MOTION_EASE,
								repeat: Number.POSITIVE_INFINITY,
							}}
						>
							<polygon
								fill="currentColor"
								fillOpacity={0.018 + index * 0.018}
								points={layer.points}
								stroke="currentColor"
								strokeOpacity={0.2 + index * 0.12}
								strokeWidth="1"
							/>
							<text
								className="font-geist-pixel-line text-[10px] uppercase tracking-[0.12em]"
								fill="currentColor"
								fillOpacity={0.46 + index * 0.12}
								x={layer.labelX}
								y={layer.labelY}
							>
								{layer.label}
							</text>
						</m.g>
					))}

					<path
						d="M806 78v174M796 78h20M796 252h20"
						stroke="currentColor"
						strokeOpacity="0.22"
					/>
					<text
						className="font-geist-pixel-line text-[10px] uppercase tracking-[0.12em]"
						fill="currentColor"
						fillOpacity="0.55"
						textAnchor="end"
						x="788"
						y="171"
					>
						Ready context
					</text>

					<m.circle
						animate={
							shouldAnimate
								? {
										cx: [440, 440, 440, 806],
										cy: [274, 214, 154, 154],
										opacity: [0, 0.85, 0.85, 0],
									}
								: { cx: 806, cy: 154, opacity: 0.65 }
						}
						fill="currentColor"
						r="3.5"
						transition={{
							duration: LANDING_MOTION_CYCLE_SECONDS,
							ease: LANDING_MOTION_EASE,
							repeat: Number.POSITIVE_INFINITY,
							times: [0, 0.32, 0.66, 1],
						}}
					/>
				</svg>
			</div>
		</LandingMotionProvider>
	);
}

export function LandingConnectedWorkVisual({ className }: LandingVisualProps) {
	const { rootRef, shouldAnimate } = useLandingVisualMotion();
	const packetAnimation = shouldAnimate
		? {
				cx: [80, 380, 380, 380, 680, 380, 80],
				cy: [180, 180, 310, 180, 180, 180, 180],
				opacity: [0, 0.9, 0.9, 0.9, 0.9, 0.55, 0],
			}
		: { cx: 380, cy: 180, opacity: 0.65 };

	return (
		<LandingMotionProvider>
			<div
				aria-hidden="true"
				className={cn(
					"relative h-[24rem] overflow-hidden sm:h-[27rem]",
					className
				)}
				data-testid="landing-connected-work-loop"
				ref={rootRef}
			>
				<svg
					aria-hidden="true"
					className="absolute inset-0 h-full w-full text-foreground"
					fill="none"
					preserveAspectRatio="none"
					viewBox="0 0 760 360"
				>
					<g stroke="currentColor" strokeOpacity="0.18">
						<path d="M80 180H680" />
						<path d="M380 42V318" />
					</g>
					<g fill="currentColor" fillOpacity="0.18">
						<circle cx="80" cy="180" r="3" />
						<circle cx="380" cy="42" r="3" />
						<circle cx="380" cy="180" r="4" />
						<circle cx="380" cy="318" r="3" />
						<circle cx="680" cy="180" r="3" />
					</g>
					<m.circle
						animate={packetAnimation}
						fill="currentColor"
						r="4"
						transition={{
							duration: LANDING_MOTION_CYCLE_SECONDS,
							ease: LANDING_MOTION_EASE,
							repeat: Number.POSITIVE_INFINITY,
							times: [0, 0.19, 0.36, 0.53, 0.72, 0.88, 1],
						}}
					/>
					<m.circle
						animate={
							shouldAnimate
								? {
										cx: [380, 380, 380],
										cy: [42, 180, 318],
										opacity: [0, 0.7, 0],
									}
								: { cx: 380, cy: 180, opacity: 0.4 }
						}
						fill="currentColor"
						r="2.5"
						transition={{
							delay: 1.1,
							duration: LANDING_MOTION_CYCLE_SECONDS,
							ease: LANDING_MOTION_EASE,
							repeat: Number.POSITIVE_INFINITY,
						}}
					/>
				</svg>

				<ConnectedWorkNode className="top-1/2 left-[4%] -translate-y-1/2 sm:left-[7%]">
					<SlackMarkIcon className="size-5 sm:size-6" />
					<span>Slack request</span>
				</ConnectedWorkNode>
				<ConnectedWorkNode className="top-1/2 right-[2%] -translate-y-1/2 sm:right-[6%]">
					<GithubLogoIcon className="size-5 sm:size-6" weight="fill" />
					<span>GitHub work</span>
				</ConnectedWorkNode>
				<ConnectedWorkNode className="top-[3%] left-1/2 -translate-x-1/2">
					<CalendarDotsIcon className="size-5 sm:size-6" />
					<span>Routines</span>
				</ConnectedWorkNode>
				<ConnectedWorkNode className="bottom-[1%] left-1/2 -translate-x-1/2">
					<span className="flex items-center gap-1.5">
						{LOCAL_AGENT_GUIDES.map((guide) => (
							<LocalAgentLogo
								agentId={`builtin:${guide.agentId}`}
								key={guide.agentId}
								size="sm"
							/>
						))}
					</span>
					<span>Local agents</span>
				</ConnectedWorkNode>
				<div className="absolute top-1/2 left-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center bg-background text-center ring-1 ring-foreground/15 ring-inset sm:size-24">
					<span className="font-geist-pixel-square text-2xl leading-none sm:text-3xl">
						CA
					</span>
					<span className="mt-2 font-geist-pixel-line text-[8px] text-muted-foreground uppercase tracking-[0.1em] sm:text-[9px]">
						Center Agent
					</span>
				</div>
			</div>
		</LandingMotionProvider>
	);
}

export function LandingVisibleOutcomesVisual({
	className,
}: LandingVisualProps) {
	const { rootRef, shouldAnimate } = useLandingVisualMotion();

	return (
		<LandingMotionProvider>
			<div
				aria-hidden="true"
				className={cn(
					"relative h-[17rem] overflow-hidden sm:h-[20rem]",
					className
				)}
				data-testid="landing-visible-outcomes"
				ref={rootRef}
			>
				<svg
					aria-hidden="true"
					className="h-full w-full text-foreground"
					fill="none"
					viewBox="0 0 900 300"
				>
					<text
						className="font-geist-pixel-line text-[10px] uppercase tracking-[0.12em]"
						fill="currentColor"
						fillOpacity="0.5"
						textAnchor="middle"
						x="450"
						y="22"
					>
						Wake
					</text>
					<g stroke="currentColor" strokeOpacity="0.2">
						<path d="M450 42V106L165 220" />
						<path d="M450 42V220" />
						<path d="M450 42V106L735 220" />
					</g>

					{OUTCOMES.map((outcome, index) => (
						<g key={outcome.label}>
							<rect
								fill="currentColor"
								fillOpacity={index === 0 ? 0.08 : 0.025}
								height="42"
								stroke="currentColor"
								strokeOpacity={index === 0 ? 0.42 : 0.24}
								width="174"
								x={outcome.x - 87}
								y="220"
							/>
							<text
								className="font-geist-pixel-line text-[11px] uppercase tracking-[0.12em]"
								fill="currentColor"
								fillOpacity={index === 0 ? 0.82 : 0.55}
								textAnchor="middle"
								x={outcome.x}
								y="246"
							>
								{outcome.label}
							</text>
							<m.circle
								animate={
									shouldAnimate
										? {
												cx: [450, 450, outcome.x, outcome.x],
												cy: [42, 106, 220, 220],
												opacity: [0, 0.8, 0.8, 0],
											}
										: { cx: outcome.x, cy: 220, opacity: 0.55 }
								}
								fill="currentColor"
								r="3.5"
								transition={{
									delay: index * 0.75,
									duration: LANDING_MOTION_CYCLE_SECONDS,
									ease: LANDING_MOTION_EASE,
									repeat: Number.POSITIVE_INFINITY,
									times: [0, 0.3, 0.72, 1],
								}}
							/>
						</g>
					))}
				</svg>
			</div>
		</LandingMotionProvider>
	);
}

function ConnectedWorkNode({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"absolute flex flex-col items-center gap-2 whitespace-nowrap bg-background px-2 py-2 font-geist-pixel-line text-[8px] text-muted-foreground uppercase tracking-[0.08em] sm:text-[10px]",
				className
			)}
		>
			{children}
		</div>
	);
}

function useLandingVisualMotion() {
	const rootRef = useRef<HTMLDivElement>(null);
	const isInView = useInView(rootRef, { amount: 0.2 });
	const shouldReduceMotion = useReducedMotion();

	return {
		rootRef,
		shouldAnimate: isInView && !shouldReduceMotion,
	};
}
