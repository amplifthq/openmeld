import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@openmeld/ui/components/sheet";
import { FluidHoverHighlight } from "@openmeld/ui/fluid/fluid-hover-highlight";
import {
	useFluidHover,
	useRegisterFluidHoverItem,
} from "@openmeld/ui/hooks/use-fluid-hover";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { PlusIcon } from "@phosphor-icons/react";
import { motion, useInView } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import "./product-showcases.css";

function ShowcaseStage({
	className,
	children,
}: {
	className: string;
	children: ReactNode;
}) {
	const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
	return (
		<motion.div
			className={`meld-showcase-stage ${className}`}
			initial={{ opacity: 0, transform: "translateY(20px)" }}
			transition={{ duration: reduced ? 0 : 0.6, ease: [0.23, 1, 0.32, 1] }}
			viewport={{ once: true, amount: 0.15 }}
			whileInView={{ opacity: 1, transform: "translateY(0px)" }}
		>
			{children}
		</motion.div>
	);
}

const surfaces = {
	files: {
		scene: "ShowcaseFiles",
		width: 1100,
		height: 438,
		responsive: false,
		label: "OpenMeld Team files",
	},
	skill: {
		scene: "ShowcaseSkill",
		width: 640,
		height: 620,
		responsive: true,
		label: "Shared release-writing Skill",
	},
	routines: {
		scene: "ShowcaseRoutines",
		width: 1200,
		height: 380,
		responsive: false,
		label: "Three scheduled team Routines",
	},
	result: {
		scene: "ShowcaseRoutineResult",
		width: 540,
		height: 450,
		responsive: true,
		label: "Weekly review delivered to Checkout fix",
	},
};
type Surface = (typeof surfaces)[keyof typeof surfaces];

function useDemoFrameHeight(initialHeight: number) {
	const frame = useRef<HTMLIFrameElement>(null);
	// Native iframe lazy loading starts several viewports ahead. Keep expensive
	// frozen App initialization out of the hero's entrance, then load nearby.
	const inView = useInView(frame, { once: true, margin: "300px 0px" });
	const [height, setHeight] = useState(initialHeight);
	useEffect(() => {
		const element = frame.current;
		const requestHeight = () =>
			element?.contentWindow?.postMessage(
				{ type: "openmeld:demo-measure" },
				window.location.origin
			);
		const resize = (event: MessageEvent) => {
			if (
				event.origin !== window.location.origin ||
				event.source !== frame.current?.contentWindow ||
				event.data?.type !== "openmeld:demo-height"
			) {
				return;
			}
			const measured = event.data.height;
			if (
				typeof measured === "number" &&
				Number.isFinite(measured) &&
				measured >= 200 &&
				measured <= 3600
			) {
				setHeight(measured + 2);
			}
		};
		window.addEventListener("message", resize);
		element?.addEventListener("load", requestHeight);
		requestHeight();
		return () => {
			window.removeEventListener("message", resize);
			element?.removeEventListener("load", requestHeight);
		};
	}, []);
	return { frame, height, inView };
}

// The frozen demo renders real App DOM in its own CSS boundary. Scale the
// viewport, never a bitmap, and fit its measured content without inner scrolling.
function ProductSurface({
	surface,
	className = "",
}: {
	surface: Surface;
	className?: string;
}) {
	const host = useRef<HTMLElement>(null);
	const [width, setWidth] = useState(surface.width);
	const { frame, height, inView } = useDemoFrameHeight(surface.height);
	useEffect(() => {
		const element = host.current;
		if (!element) {
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			// A hidden Sheet has no viewport to scale. Keep its last visible size.
			if (entry.contentRect.width > 0) {
				setWidth(entry.contentRect.width);
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const viewportWidth = surface.responsive
		? Math.min(width, surface.width)
		: surface.width;
	const scale = width / viewportWidth;
	return (
		<figure
			aria-label={surface.label}
			className={`meld-scene-panel meld-demo-blend ${className}`}
			ref={host}
			style={{ height: height * scale }}
		>
			<iframe
				aria-hidden="true"
				loading="lazy"
				ref={frame}
				referrerPolicy="no-referrer"
				sandbox="allow-scripts allow-same-origin"
				src={
					inView ? `/product-demo/index.html?scene=${surface.scene}` : undefined
				}
				style={{
					width: viewportWidth,
					height,
					transform: `scale(${scale})`,
				}}
				tabIndex={-1}
				title={surface.label}
			/>
		</figure>
	);
}

export function AgentShowcase() {
	const { frame, height, inView } = useDemoFrameHeight(560);
	return (
		<ShowcaseStage className="meld-agent-stage">
			<div className="meld-agent-canvas meld-demo-blend">
				<iframe
					loading="lazy"
					ref={frame}
					referrerPolicy="no-referrer"
					sandbox="allow-scripts allow-same-origin"
					src={
						inView ? "/product-demo/index.html?scene=CreateAgent" : undefined
					}
					style={{ height }}
					title="Choose a local or remote agent"
				/>
			</div>
		</ShowcaseStage>
	);
}

function InteractiveShowcase({
	scene,
	title,
	height: initialHeight,
}: {
	scene: string;
	title: string;
	height: number;
}) {
	const { frame, height, inView } = useDemoFrameHeight(initialHeight);
	return (
		<ShowcaseStage
			className={`meld-${scene.toLowerCase()}-stage meld-demo-blend`}
		>
			<iframe
				className="meld-interactive-showcase"
				loading="lazy"
				ref={frame}
				referrerPolicy="no-referrer"
				sandbox="allow-scripts allow-same-origin"
				src={inView ? `/product-demo/index.html?scene=${scene}` : undefined}
				style={{ height }}
				title={title}
			/>
		</ShowcaseStage>
	);
}

export function CenterAgentShowcase() {
	return (
		<InteractiveShowcase
			height={520}
			scene="CenterAgent"
			title="Explore Center Agent settings"
		/>
	);
}

export function UsageShowcase() {
	return (
		<InteractiveShowcase
			height={840}
			scene="Usage"
			title="Explore organization and personal AI usage"
		/>
	);
}

export function KnowledgeShowcase() {
	return (
		<>
			<ShowcaseStage className="meld-knowledge-stage">
				<ProductSurface className="meld-files-plane" surface={surfaces.files} />
				<ProductSurface className="meld-skill-plane" surface={surfaces.skill} />
			</ShowcaseStage>
			<FeatureDetails
				features={[
					{
						title: "Team Knowledge",
						description:
							"Give your agents the same product brief, research, and decisions your team works from.",
						surface: surfaces.files,
						points: [
							"Team files stay with the team.",
							"Personal files keep their own audience.",
							"Open a document where the work happens.",
						],
					},
					{
						title: "Shared Skills",
						description: "Save a way of working. Use it again across the team.",
						surface: surfaces.skill,
						points: [
							"Instructions and reference files in one portable Skill.",
							"A release your team can review.",
							"One shared method for the next task.",
						],
					},
				]}
			/>
		</>
	);
}

export function RoutineShowcase() {
	return (
		<>
			<ShowcaseStage className="meld-routine-stage">
				<ProductSurface
					className="meld-routines-plane"
					surface={surfaces.routines}
				/>
				<ProductSurface
					className="meld-report-plane"
					surface={surfaces.result}
				/>
			</ShowcaseStage>
			<FeatureDetails
				features={[
					{
						title: "Routines",
						description:
							"Set the instructions, a schedule, and where the result should arrive.",
						surface: surfaces.routines,
						points: [
							"A daily digest or a weekly review.",
							"Pause or change the schedule.",
							"Check the history of each run.",
						],
					},
					{
						title: "Results in your Space",
						description:
							"The report arrives in the conversation, ready for your team’s next decision.",
						surface: surfaces.result,
						points: [
							"Keep the report beside the discussion.",
							"Open the attached document.",
							"Continue with the people and agents already in the Space.",
						],
					},
				]}
			/>
		</>
	);
}

type Feature = {
	title: string;
	description: string;
	surface: Surface;
	points: string[];
};
function FeatureDetails({ features }: { features: Feature[] }) {
	const ref = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(ref, { axis: "xy", gapClick: false });
	return (
		<div className="meld-feature-footer">
			<span>Explore</span>
			{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Shared decorative hover; native buttons own activation. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: No focus or selection is derived from pointer motion. */}
			<div
				className="meld-feature-links"
				onMouseEnter={hover.handlers.onMouseEnter}
				onMouseLeave={hover.handlers.onMouseLeave}
				onMouseMove={hover.handlers.onMouseMove}
				ref={ref}
			>
				<FluidHoverHighlight className="meld-nav-highlight" hover={hover} />
				{features.map((feature, index) => (
					<FeatureDisclosure
						feature={feature}
						index={index}
						key={feature.title}
						registerItem={hover.registerItem}
					/>
				))}
			</div>
		</div>
	);
}
function FeatureDisclosure({
	feature,
	index,
	registerItem,
}: {
	feature: Feature;
	index: number;
	registerItem: ReturnType<typeof useFluidHover>["registerItem"];
}) {
	const ref = useRef<HTMLButtonElement>(null);
	useRegisterFluidHoverItem(registerItem, index, ref);
	return (
		<Sheet>
			<SheetTrigger className="meld-feature-trigger" ref={ref}>
				{feature.title}
				<PlusIcon aria-hidden size={14} />
			</SheetTrigger>
			<SheetContent className="dark meld-feature-sheet">
				<SheetHeader>
					<SheetTitle>{feature.title}</SheetTitle>
					<SheetDescription>{feature.description}</SheetDescription>
				</SheetHeader>
				<div className="meld-feature-sheet-body">
					<ProductSurface surface={feature.surface} />
					<ul>
						{feature.points.map((point) => (
							<li key={point}>{point}</li>
						))}
					</ul>
				</div>
			</SheetContent>
		</Sheet>
	);
}
