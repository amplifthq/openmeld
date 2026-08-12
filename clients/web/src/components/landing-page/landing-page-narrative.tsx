import { buttonVariants } from "@openmeld/ui/components/button";
import { CommandBlock } from "@openmeld/ui/components/command-block";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import { ArrowRightIcon, CalendarDotsIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import {
	APPS,
	LARK_CHANNEL_IDENTITY,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/app-catalog";
import { AppLogo } from "#/components/organizations/app-logo";
import { LOCAL_AGENTS_GUIDE_PATH } from "#/lib/local-agent-install-guides";
import { LandingAgentActivityField } from "./landing-page-activity-field";
import { LandingBarWave } from "./landing-page-bar-wave";
import { LandingCenterAgentVisual } from "./landing-page-center-agent-visual";
import { SlackMarkIcon } from "./landing-page-hero-copy";
import {
	LandingLocalWorkspaceVisual,
	LandingWakeTargetVisual,
} from "./landing-page-project-visuals";
import { LandingPageSpaceSection } from "./landing-page-space-demo";
import {
	LandingConnectedWorkVisual,
	LandingContextStackVisual,
	LandingVisibleOutcomesVisual,
} from "./landing-page-system-visuals";

const LANDING_CONTENT_CLASS_NAME =
	"mx-auto w-full max-w-[82rem] px-6 sm:px-10 lg:px-16";
const OPENMELD_NPM_PACKAGE_URL = "https://www.npmjs.com/package/openmeld";
const AVAILABLE_APPS = APPS.filter((app) => app.availability === "available");
const AVAILABLE_CHANNELS = [
	{ ...SLACK_CHANNEL_IDENTITY, name: "Slack" },
	{ ...LARK_CHANNEL_IDENTITY, name: "Lark" },
] as const;

const CENTER_AGENT_FEATURES = [
	{
		name: "Starts where the need appears.",
		description:
			"Message the Center Agent in OpenMeld or Slack. It turns a loose request into a shared place to work.",
	},
	{
		name: "Builds the working team.",
		description:
			"It can create a Space, bring in the right Human and Agent Profiles, and give everyone the same brief.",
	},
	{
		name: "Moves work across the system.",
		description:
			"With the right access, it can wake local agents, work with GitHub, and schedule Routines that report back.",
	},
] as const;

const LOCAL_PROJECT_FEATURES = [
	{
		name: "The code stays where it is.",
		description:
			"Local agents keep their files, tools, and execution environment on your team’s computers.",
	},
	{
		name: "Projects replace paths.",
		description:
			"One shared Project can map to the right clone or worktree on every person’s computer.",
	},
	{
		name: "Every Wake starts in the right place.",
		description:
			"A Default Project tells future Agent sessions which local working folder to use.",
	},
] as const;

const CONTEXT_FOUNDATIONS = [
	{
		name: "Agent Profiles",
		description:
			"Give each agent a stable role, instructions, and identity even when its controller or computer changes.",
	},
	{
		name: "Documents",
		description:
			"Keep an Organization Brief, approved knowledge, and reviewed Profile Reports as durable shared context.",
	},
	{
		name: "Memory, with boundaries",
		description:
			"The Center Agent remembers each member separately. Organization memory is on by default, and private DMs are never added to it automatically.",
	},
] as const;

const AGENT_ACTIVITY_SIGNALS = [
	{ label: "Who", value: "Team member" },
	{ label: "Agent", value: "Provider and client" },
	{ label: "Where", value: "Project and branch" },
	{ label: "State", value: "Working, idle, or ended" },
	{ label: "When", value: "Last activity" },
] as const;

const LOOP_FLOW_STEPS = [
	{
		name: "Ask",
		description: "Start in OpenMeld or Slack with the outcome you need.",
	},
	{
		name: "Assemble",
		description:
			"The Center Agent brings the right people, Agent Profiles, Projects, and context into one Space.",
	},
	{
		name: "Run",
		description:
			"The hosted Center Agent works immediately while local agents run on their own computers.",
		guide: {
			label: "Install",
			to: LOCAL_AGENTS_GUIDE_PATH,
		},
	},
	{
		name: "Follow",
		description:
			"Spaces and Agent Activity keep progress visible at the right level.",
	},
	{
		name: "Return",
		description:
			"The result or explicit failure returns to the chosen Space or Slack thread.",
	},
] as const;

const FAQ_ITEMS = [
	{
		question: "Which agents run locally, and which run in OpenMeld?",
		answer:
			"The Center Agent is OpenMeld’s hosted organization coordinator, so it can answer even when your laptop is closed. Codex, Claude Code, Cursor, and OpenCode keep running on your team’s own computers through OpenMeld Service.",
	},
	{
		question: "What leaves my computer?",
		answer:
			"Local execution stays local. Spaces receive the collaboration messages and outcomes your team chooses to share. Agent Activity receives only reviewed metadata such as provider, Project, status, and time—not prompts, replies, file contents, commands, terminal output, or local paths.",
	},
	{
		question: "How do Channels and Apps differ?",
		answer: `Slack and Lark are Channels where people can message the Center Agent and receive replies. The ${AVAILABLE_APPS.length} available Apps give the Center Agent explicitly connected tools for files, calendars, email, code, analytics, and Cloudflare. Every connection keeps its own identity, permissions, and audit trail.`,
	},
	{
		question: "What can the Center Agent remember?",
		answer:
			"It can build member-specific memory from completed private conversations. Organization memory is on by default for shared Spaces and connected Channels, and an owner or admin can turn it off. Private Center Agent DMs are never added to Organization memory automatically.",
	},
	{
		question: "Can OpenMeld run work on a schedule?",
		answer:
			"Yes. A Routine asks the Center Agent to work once or on a recurring schedule. You choose the destination. Each execution returns a result or explicit failure there, while skipped Runs remain visible in Routine history.",
	},
] as const;

export function LandingPageNarrative({
	appEntryPath,
}: {
	appEntryPath: string;
}) {
	return (
		<>
			<CenterAgentSection />
			<LandingPageSpaceSection />
			<LocalExecutionSection />
			<SharedContextSection />
			<AgentActivitySection />
			<ConnectedWorkSection />
			<VisibleOutcomesSection />
			<HowItWorksSection />
			<QuestionsSection />
			<FinalCallToAction appEntryPath={appEntryPath} />
		</>
	);
}

function CenterAgentSection() {
	return (
		<section
			className={`${LANDING_CONTENT_CLASS_NAME} flex min-h-svh items-center py-24 sm:py-28 lg:py-32`}
			data-testid="landing-center-agent-section"
		>
			<div className="grid w-full gap-16 lg:grid-cols-12 lg:gap-8">
				<div className="lg:col-span-7">
					<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-[0.12em]">
						Center Agent
					</p>
					<h2 className="landing-display-tight mt-6 max-w-4xl text-balance font-geist-pixel-square font-medium text-[clamp(2.5rem,4.3vw,4.5rem)] leading-[0.98]">
						One request can put the whole team in motion.
					</h2>
					<LandingCenterAgentVisual className="mt-10 sm:mt-12" />
				</div>

				<ol className="space-y-10 lg:col-span-4 lg:col-start-9 lg:pt-16">
					{CENTER_AGENT_FEATURES.map((feature, index) => (
						<li
							className="grid grid-cols-[2.5rem_1fr] gap-4"
							key={feature.name}
						>
							<span className="pt-1 font-geist-pixel-line text-muted-foreground text-xs">
								{String(index + 1).padStart(2, "0")}
							</span>
							<div>
								<h3 className="font-medium text-lg">{feature.name}</h3>
								<p className="mt-2 text-muted-foreground text-sm leading-6">
									{feature.description}
								</p>
							</div>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}

function LocalExecutionSection() {
	return (
		<section
			className={`${LANDING_CONTENT_CLASS_NAME} py-20 sm:py-24 lg:py-28`}
			data-testid="landing-local-execution-section"
			id="local-execution"
		>
			<div className="grid items-start gap-16 lg:grid-cols-12 lg:gap-8">
				<div className="lg:col-span-7">
					<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-[0.12em]">
						Local agents &amp; Projects
					</p>
					<h2 className="landing-display-tight mt-6 max-w-4xl text-balance font-geist-pixel-square font-medium text-[clamp(2.5rem,4.3vw,4.5rem)] leading-[0.98]">
						Your agents stay local. Their work stays connected.
					</h2>
				</div>

				<div className="lg:col-span-4 lg:col-start-9 lg:pt-16">
					<p className="text-base text-muted-foreground leading-7">
						Codex, Claude Code, Cursor, and OpenCode keep working on your team’s
						computers. OpenMeld Projects map the same codebase to each person’s
						local clone or worktree, so every Wake starts in the right place.
					</p>
					<div className="mt-8 flex flex-wrap gap-6">
						<AgentLabel agentId="builtin:codex" label="Codex" />
						<AgentLabel agentId="builtin:claude-code" label="Claude Code" />
						<AgentLabel agentId="builtin:cursor" label="Cursor" />
						<AgentLabel agentId="builtin:opencode" label="OpenCode" />
					</div>
					<CommandBlock
						className="mt-10"
						command="npx openmeld"
						label="NPM"
						labelHref={OPENMELD_NPM_PACKAGE_URL}
					/>
				</div>
			</div>

			<dl className="mt-12 grid gap-12 md:grid-cols-3 md:gap-10">
				{LOCAL_PROJECT_FEATURES.map((feature, index) => (
					<div className="min-w-0" key={feature.name}>
						{index === 0 ? <LandingLocalWorkspaceVisual /> : null}
						{index === 1 ? <LandingBarWave /> : null}
						{index === 2 ? <LandingWakeTargetVisual /> : null}
						<dt className="mt-5 font-medium text-base">{feature.name}</dt>
						<dd className="mt-3 text-muted-foreground text-sm leading-6">
							{feature.description}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

function SharedContextSection() {
	return (
		<section
			className={`${LANDING_CONTENT_CLASS_NAME} py-20 sm:py-24`}
			data-testid="landing-shared-context-section"
			id="shared-context"
		>
			<div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
				<div className="lg:col-span-8">
					<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-[0.12em]">
						Shared context
					</p>
					<h2 className="landing-display-tight mt-6 max-w-5xl text-balance font-geist-pixel-square font-medium text-[clamp(2.5rem,4.3vw,4.5rem)] leading-[0.98]">
						Context should get richer every time your team works.
					</h2>
				</div>
				<p className="text-base text-muted-foreground leading-7 lg:col-span-4 lg:pt-16">
					Give agents durable identity, approved knowledge, and memory with
					explicit boundaries. Spaces add the live brief, so every request
					starts with more context and less repetition.
				</p>
			</div>

			<LandingContextStackVisual className="mx-auto mt-10 h-56 max-w-4xl sm:mt-12 sm:h-64" />

			<dl className="mt-12 grid gap-14 md:grid-cols-3 md:gap-12">
				{CONTEXT_FOUNDATIONS.map((foundation, index) => (
					<div key={foundation.name}>
						<p className="font-geist-pixel-line text-4xl text-foreground/15">
							{String(index + 1).padStart(2, "0")}
						</p>
						<dt className="mt-7 font-medium text-lg">{foundation.name}</dt>
						<dd className="mt-3 text-muted-foreground text-sm leading-6">
							{foundation.description}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

function AgentActivitySection() {
	return (
		<section
			className="min-h-svh bg-foreground text-background"
			data-testid="landing-agent-activity-section"
			id="agent-activity"
		>
			<div className={`${LANDING_CONTENT_CLASS_NAME} py-16 sm:py-20 lg:py-20`}>
				<div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
					<div className="lg:col-span-8">
						<p className="font-geist-pixel-line text-background/55 text-xs uppercase tracking-[0.12em]">
							Agent Activity
						</p>
						<h2 className="landing-display-tight mt-6 max-w-5xl text-balance font-geist-pixel-square font-medium text-[clamp(2.75rem,5vw,5.25rem)] leading-[0.96]">
							See the work. Skip the surveillance.
						</h2>
					</div>
					<div className="lg:col-span-4 lg:pt-16">
						<p className="text-background/70 text-base leading-7">
							See which coding agents are active, on which Project, through
							which client, and when they last worked.
						</p>
						<p className="mt-5 text-background/50 text-sm leading-6">
							No prompts, replies, file contents, commands, terminal output, or
							local paths enter Agent Activity.
						</p>
					</div>
				</div>

				<LandingAgentActivityField />

				<dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-5">
					{AGENT_ACTIVITY_SIGNALS.map((signal) => (
						<div key={signal.label}>
							<dt className="font-geist-pixel-line text-background/40 text-xs uppercase tracking-[0.08em]">
								{signal.label}
							</dt>
							<dd className="mt-3 text-background/85 text-sm leading-6">
								{signal.value}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	);
}

function ConnectedWorkSection() {
	return (
		<section
			className={`${LANDING_CONTENT_CLASS_NAME} py-28 sm:py-36 lg:py-44`}
			data-testid="landing-connected-work-section"
			id="connected-work"
		>
			<div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
				<div className="lg:col-span-8">
					<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-[0.12em]">
						Connected work
					</p>
					<h2 className="landing-display-tight mt-6 max-w-5xl text-balance font-geist-pixel-square font-medium text-[clamp(2.5rem,4.3vw,4.5rem)] leading-[0.98]">
						Bring work in from Slack or Lark. Connect your Center Agent to{" "}
						{AVAILABLE_APPS.length} Apps.
					</h2>
				</div>
				<p className="text-base text-muted-foreground leading-7 lg:col-span-4 lg:pt-16">
					Channels carry the conversation. Apps give the Center Agent scoped
					tools for real work. Routines keep the loop moving when no one is
					present.
				</p>
			</div>

			<LandingConnectedWorkVisual className="mt-14 sm:mt-20" />

			<div className="mt-16 grid border-border border-y lg:grid-cols-12">
				<article className="py-10 lg:col-span-4 lg:pr-12">
					<p className="font-geist-pixel-line text-[10px] text-muted-foreground uppercase tracking-[0.12em]">
						Available now
					</p>
					<h3 className="mt-3 font-medium text-2xl">
						{AVAILABLE_CHANNELS.length} Channels
					</h3>
					<p className="mt-4 max-w-sm text-muted-foreground text-sm leading-6">
						Start from Slack or Lark and get the result back in the same
						conversation.
					</p>
					<ul aria-label="Available Channels" className="mt-8 space-y-3">
						{AVAILABLE_CHANNELS.map((channel) => (
							<li
								className="flex items-center gap-3 border-border border-t pt-3"
								key={channel.service}
							>
								<AppLogo
									app={channel}
									className={
										channel.service === "lark" ? "bg-muted/50" : undefined
									}
									size="sm"
								/>
								<span className="font-medium text-sm">{channel.name}</span>
							</li>
						))}
					</ul>
				</article>

				<article className="border-border border-t py-10 lg:col-span-8 lg:border-t-0 lg:border-l lg:pl-12">
					<p className="font-geist-pixel-line text-[10px] text-muted-foreground uppercase tracking-[0.12em]">
						Available now
					</p>
					<h3 className="mt-3 font-medium text-2xl">
						{AVAILABLE_APPS.length} Apps
					</h3>
					<p className="mt-4 max-w-2xl text-muted-foreground text-sm leading-6">
						Connect the accounts your Center Agent can use. Every action keeps
						its identity, access, and audit trail explicit.
					</p>
					<ul
						aria-label="Available Apps"
						className="mt-8 grid gap-x-8 sm:grid-cols-2"
					>
						{AVAILABLE_APPS.map((app) => (
							<li
								className="flex min-w-0 items-center gap-3 border-border border-t py-3"
								data-testid={`landing-connected-app-${app.service}`}
								key={app.service}
							>
								<AppLogo app={app} size="sm" />
								<span className="min-w-0 text-pretty font-medium text-sm leading-5">
									{app.name}
								</span>
							</li>
						))}
					</ul>
				</article>
			</div>

			<article className="mt-12 grid gap-6 sm:grid-cols-[auto_1fr]">
				<div className="flex size-12 items-center justify-center border border-foreground/15">
					<CalendarDotsIcon
						aria-hidden="true"
						className="size-7"
						data-testid="landing-routines-icon"
					/>
				</div>
				<div className="max-w-2xl">
					<h3 className="font-medium text-xl">Routines keep working.</h3>
					<p className="mt-3 text-muted-foreground text-sm leading-6">
						Run Center Agent instructions once or on a recurring schedule.
						Choose a Space or Slack thread; each execution returns a result or
						an explicit failure, while skipped Runs stay visible in history.
					</p>
				</div>
			</article>
		</section>
	);
}

function VisibleOutcomesSection() {
	return (
		<section
			className={`${LANDING_CONTENT_CLASS_NAME} flex min-h-[60svh] items-center py-28 sm:py-36`}
		>
			<div className="mx-auto max-w-6xl text-center">
				<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-[0.12em]">
					Visible outcomes
				</p>
				<h2 className="landing-display-tight mt-7 text-balance font-geist-pixel-square font-medium text-[clamp(3rem,6.4vw,6.75rem)] leading-[0.94]">
					A result. A handoff. Or a clear failure. Never silence.
				</h2>
				<LandingVisibleOutcomesVisual className="mt-10 sm:mt-14" />
				<p className="mx-auto mt-8 max-w-2xl text-pretty text-base text-muted-foreground leading-7">
					Every Wake ends visibly in its Space. Every Routine execution returns
					to its chosen Space or Slack thread, while skipped Runs remain visible
					in history. Your team always knows what happened and what needs
					attention next.
				</p>
			</div>
		</section>
	);
}

function HowItWorksSection() {
	return (
		<section
			className={`${LANDING_CONTENT_CLASS_NAME} py-28 sm:py-36 lg:py-44`}
			id="how-it-works"
		>
			<div className="max-w-4xl">
				<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-[0.12em]">
					The loop
				</p>
				<h2 className="landing-display-tight mt-6 text-balance font-geist-pixel-square font-medium text-[clamp(2.5rem,4.3vw,4.5rem)] leading-[0.98]">
					One system, from request to result.
				</h2>
			</div>

			<ol className="mt-20 grid gap-12 md:grid-cols-5 md:gap-7">
				{LOOP_FLOW_STEPS.map((step, index) => (
					<li key={step.name}>
						<p className="font-geist-pixel-line text-4xl text-foreground/15">
							{String(index + 1).padStart(2, "0")}
						</p>
						<div className="mt-7 flex flex-wrap items-center gap-2">
							<h3 className="font-medium text-lg">{step.name}</h3>
							{"guide" in step ? (
								<Link
									className="font-geist-pixel-line text-[10px] text-emerald-700 uppercase tracking-[0.08em] hover:text-emerald-600 dark:text-emerald-300 dark:hover:text-emerald-200"
									to={step.guide.to}
								>
									{step.guide.label}
								</Link>
							) : null}
						</div>
						<p className="mt-3 text-muted-foreground text-sm leading-6">
							{step.description}
						</p>
					</li>
				))}
			</ol>
		</section>
	);
}

function QuestionsSection() {
	return (
		<section
			className={`${LANDING_CONTENT_CLASS_NAME} py-28 sm:py-36 lg:py-44`}
		>
			<div className="grid gap-16 lg:grid-cols-12 lg:gap-8">
				<div className="lg:col-span-5">
					<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-[0.12em]">
						Questions
					</p>
					<h2 className="landing-display-tight mt-6 text-balance font-geist-pixel-square font-medium text-[clamp(2.5rem,4vw,4.25rem)] leading-[0.98]">
						What runs where. What the team sees. What stays private.
					</h2>
				</div>

				<Accordion
					aria-label="Frequently asked questions"
					className="divide-y divide-border lg:col-span-6 lg:col-start-7"
				>
					{FAQ_ITEMS.map((item) => (
						<AccordionItem key={item.question} value={item.question}>
							<AccordionTrigger className="py-6 text-left font-medium text-base transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground">
								{item.question}
							</AccordionTrigger>
							<AccordionContent>
								<p className="max-w-xl pb-6 text-muted-foreground text-sm leading-6">
									{item.answer}
								</p>
							</AccordionContent>
						</AccordionItem>
					))}
				</Accordion>
			</div>
		</section>
	);
}

function FinalCallToAction({ appEntryPath }: { appEntryPath: string }) {
	return (
		<section
			className={`${LANDING_CONTENT_CLASS_NAME} flex min-h-[70svh] items-center py-28`}
		>
			<div className="mx-auto max-w-5xl text-center">
				<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-[0.12em]">
					Start the loop
				</p>
				<h2 className="landing-display-tight mt-7 text-balance font-geist-pixel-square font-medium text-[clamp(3rem,6.4vw,6.75rem)] leading-[0.94]">
					Put every agent in the same working loop.
				</h2>
				<div className="mt-10 flex flex-wrap justify-center gap-3">
					<Link
						className={buttonVariants({
							className: "h-11 gap-2 px-5 text-sm",
						})}
						to={appEntryPath}
					>
						Open your Center Agent
						<ArrowRightIcon aria-hidden className="size-4" />
					</Link>
					<Link
						className={buttonVariants({
							className: "h-11 gap-2 px-5 text-sm",
							variant: "outline",
						})}
						to="/add-to-slack"
					>
						<SlackMarkIcon className="size-4" />
						Add Center Agent to Slack
					</Link>
				</div>
			</div>
		</section>
	);
}

function AgentLabel(input: { agentId: string; label: string }) {
	return (
		<div className="flex items-center gap-2 text-sm">
			<LocalAgentLogo agentId={input.agentId} size="sm" />
			<span>{input.label}</span>
		</div>
	);
}
