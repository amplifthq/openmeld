import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	resolveStatusToneIndicatorClassName,
	resolveStatusToneStrongTextClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { m, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { LandingMotionProvider } from "./landing-page-motion-provider";

const SPACE_DEMO_EASE = [0.22, 1, 0.36, 1] as const;
const SPACE_DEMO_GRID_STYLE = {
	backgroundImage:
		"linear-gradient(color-mix(in oklab, var(--foreground) 7.5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
};

type SpaceDemoMessage = {
	agentId?: string;
	body: string;
	label: string;
	source: string;
};

type SpaceDemoContextItem = {
	agentId?: string;
	description: string;
	name: string;
};

type SpaceDemo = {
	context: readonly SpaceDemoContextItem[];
	eyebrow: string;
	messages: readonly SpaceDemoMessage[];
	title: string;
};

const SECTION_SPACE_DEMO = {
	context: [
		{
			description: "Ship the billing meter rewrite safely.",
			name: "Human request",
		},
		{
			agentId: "builtin:codex",
			description: "Codex · GPT-5",
			name: "Code review",
		},
		{
			agentId: "builtin:claude-code",
			description: "Claude Code · Claude Sonnet",
			name: "Patch plan",
		},
		{
			agentId: "builtin:opencode",
			description: "OpenCode · Qwen Coder",
			name: "Validation",
		},
		{
			agentId: "builtin:cursor",
			description: "Cursor · Auto",
			name: "Implementation",
		},
	],
	eyebrow: "Production release Space",
	messages: [
		{
			body: "Can we ship the billing meter rewrite today? I need a release call, risk check, and validation plan.",
			label: "Felix",
			source: "Human",
		},
		{
			agentId: "builtin:codex",
			body: "I’ll inspect the diff and migration path. First risk: usage writes need a rollback plan.",
			label: "Codex",
			source: "GPT-5",
		},
		{
			agentId: "builtin:claude-code",
			body: "I’ll turn that into a patch plan and update the release notes once the risk is confirmed.",
			label: "Claude Code",
			source: "Claude Sonnet",
		},
		{
			agentId: "builtin:opencode",
			body: "I’ll run the smoke checklist and keep validation notes in this Space.",
			label: "OpenCode",
			source: "Qwen Coder",
		},
		{
			agentId: "builtin:cursor",
			body: "I’ll prepare the smallest safe implementation after the release risks are clear.",
			label: "Cursor",
			source: "Auto",
		},
		{
			body: "Good. Block the release if billing totals drift or the canary install fails.",
			label: "Felix",
			source: "Human",
		},
		{
			agentId: "builtin:codex",
			body: "Release call: hold until usage totals and canary smoke are both green.",
			label: "Codex",
			source: "GPT-5",
		},
	],
	title: "Human request to four agents",
} as const satisfies SpaceDemo;

const SPACE_FEATURES = [
	{
		name: "Built around the goal.",
		description:
			"Start a Space yourself, or let the Center Agent create one and bring in the people and Agent Profiles the work needs.",
	},
	{
		name: "One brief, many agents.",
		description:
			"Codex, Claude Code, Cursor, and OpenCode can share the same goal, decisions, and handoffs while still running locally.",
	},
	{
		name: "Progress people can join.",
		description:
			"Agents can leave notes, ask for missing context, and return work where the rest of the team can respond.",
	},
] as const;

export function LandingPageSpaceSection() {
	return (
		<section
			className="mx-auto w-full max-w-[82rem] px-6 py-28 sm:px-10 sm:py-36 lg:px-16 lg:py-44"
			id="spaces"
		>
			<div className="grid gap-10 lg:grid-cols-12 lg:items-end lg:gap-8">
				<div className="lg:col-span-7">
					<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-[0.12em]">
						Spaces
					</p>
					<h2 className="landing-display-tight mt-6 text-balance font-geist-pixel-square font-medium text-[clamp(2.5rem,4.3vw,4.5rem)] leading-[0.98]">
						Every request becomes a shared work loop.
					</h2>
				</div>
				<p className="text-base text-muted-foreground leading-7 lg:col-span-4 lg:col-start-9">
					A Space is the working record for one goal: the request, shared
					context, progress, decisions, and final outcome. People and agents can
					join the same loop without making one person the message router.
				</p>
			</div>

			<div className="mt-16 sm:mt-20">
				<LandingMotionProvider>
					<SpaceLoopPanel demo={SECTION_SPACE_DEMO} />
				</LandingMotionProvider>
			</div>

			<dl className="mt-14 grid gap-10 md:grid-cols-3 md:gap-12">
				{SPACE_FEATURES.map((feature) => (
					<div key={feature.name}>
						<dt className="font-medium text-base">{feature.name}</dt>
						<dd className="mt-3 text-muted-foreground text-sm leading-6">
							{feature.description}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

function SpaceLoopPanel(input: { demo: SpaceDemo }) {
	const panelRef = useRef<HTMLDivElement | null>(null);
	const hasEntered = useInView(panelRef, {
		amount: 0.28,
		initial: true,
		once: true,
	});
	const isInView = useInView(panelRef, { amount: 0.28, initial: true });
	const shouldReduceMotion = useReducedMotion();
	const isShown = Boolean(shouldReduceMotion || hasEntered);
	const shouldPlayIdle = Boolean(isInView && !shouldReduceMotion);
	const timelineClassName = "relative grid gap-0 lg:grid-cols-[1fr_13rem]";

	return (
		<m.div
			animate={isShown ? "shown" : "hidden"}
			className={cn(
				"relative overflow-hidden border border-border bg-background/90 shadow-2xl shadow-foreground/15 dark:shadow-black/30"
			)}
			initial={false}
			ref={panelRef}
			transition={{ duration: 0.4, ease: SPACE_DEMO_EASE }}
			variants={{
				hidden: { opacity: 0, scale: 0.985, y: 24 },
				shown: { opacity: 1, scale: 1, y: 0 },
			}}
		>
			<div
				aria-hidden
				className="absolute inset-0 bg-[size:28px_28px] opacity-35 [mask-image:linear-gradient(to_bottom,var(--background),transparent_85%)]"
				data-testid="landing-space-demo-grid"
				style={SPACE_DEMO_GRID_STYLE}
			/>
			<div className="relative border-border border-b px-5 py-4">
				<div className="flex items-start justify-between gap-4">
					<div>
						<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase leading-none">
							{input.demo.eyebrow}
						</p>
						<h3 className="mt-2 font-medium text-lg">{input.demo.title}</h3>
					</div>
					<div
						className={cn(
							"flex items-center gap-2 text-xs",
							resolveStatusToneStrongTextClassName("ready")
						)}
					>
						<m.span
							animate={
								shouldPlayIdle
									? { opacity: [0.45, 1, 0.45], scale: [1, 1.55, 1] }
									: { opacity: 1, scale: 1 }
							}
							aria-hidden
							className={cn(
								"size-1.5 rounded-full",
								resolveStatusToneIndicatorClassName("ready", "prominent")
							)}
							transition={
								shouldPlayIdle
									? {
											duration: 1.8,
											ease: "easeInOut",
											repeat: Number.POSITIVE_INFINITY,
										}
									: { duration: 0.15 }
							}
						/>
						Live
					</div>
				</div>
			</div>

			<m.div
				animate={isShown ? "shown" : "hidden"}
				className={timelineClassName}
				transition={{
					delayChildren: 0.18,
					staggerChildren: 0.08,
				}}
				variants={{
					hidden: {},
					shown: {},
				}}
			>
				<div className="space-y-3 p-5">
					{input.demo.messages.map((message, index) => (
						<SpaceMessage
							index={index}
							key={`${message.label}-${message.body}`}
							message={message}
							shouldPlayIdle={shouldPlayIdle}
						/>
					))}
				</div>

				<aside className="border-border border-t p-5 lg:border-t-0 lg:border-l">
					<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase leading-none">
						Shared context
					</p>
					<ul className="mt-5 space-y-4 text-sm">
						{input.demo.context.map((item) => (
							<li key={`${item.name}-${item.description}`}>
								<p className="font-medium">{item.name}</p>
								<p className="mt-1 flex items-center gap-2 text-muted-foreground leading-5">
									{item.agentId ? (
										<LocalAgentLogo agentId={item.agentId} size="xs" />
									) : null}
									{item.description}
								</p>
							</li>
						))}
					</ul>
				</aside>
			</m.div>
		</m.div>
	);
}

function SpaceMessage(input: {
	index: number;
	message: SpaceDemoMessage;
	shouldPlayIdle: boolean;
}) {
	const isHuman = input.message.source === "Human";

	return (
		<m.div
			className={cn("flex gap-3", isHuman && "justify-end")}
			transition={{ duration: 0.5, ease: SPACE_DEMO_EASE }}
			variants={{
				hidden: { opacity: 0, y: 12 },
				shown: { opacity: 1, y: 0 },
			}}
		>
			{isHuman ? null : <MessageAvatar message={input.message} />}
			<m.div
				animate={
					input.shouldPlayIdle
						? { opacity: [0.7, 1, 0.74], y: [0, -2, 0] }
						: { opacity: 1, y: 0 }
				}
				className={cn(
					"max-w-[18rem] border bg-background px-3.5 py-3 text-foreground text-sm leading-5",
					isHuman ? "border-foreground/20" : "border-border"
				)}
				transition={
					input.shouldPlayIdle
						? {
								delay: input.index * 1.15,
								duration: 7.4,
								ease: "easeInOut",
								repeat: Number.POSITIVE_INFINITY,
								times: [0, 0.16, 1],
							}
						: { duration: 0.18 }
				}
			>
				<div className="mb-2 flex items-center gap-2 font-geist-pixel-line text-[10px] text-muted-foreground uppercase leading-none">
					<span>{input.message.label}</span>
					<span aria-hidden>·</span>
					<span>{input.message.source}</span>
				</div>
				<p>{input.message.body}</p>
			</m.div>
		</m.div>
	);
}

function MessageAvatar(input: { message: SpaceDemoMessage }) {
	const agentId = input.message.agentId;

	if (typeof agentId === "string") {
		return <LocalAgentLogo agentId={agentId} className="mt-1 size-7" />;
	}

	return (
		<div
			className="mt-1 flex size-7 shrink-0 items-center justify-center border border-border bg-background font-geist-pixel-line text-[10px] text-muted-foreground"
			data-testid="space-demo-center-agent-avatar"
		>
			CA
		</div>
	);
}
