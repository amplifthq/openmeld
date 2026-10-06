import {
	LOCAL_AGENTS_GUIDE_PATH,
	listLocalAgentInstallGuides,
} from "@openmeld/product-catalog/local-agent-install-guides";
import { buttonVariants } from "@openmeld/ui/components/button";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { OpenMeldWordmark } from "@openmeld/ui/components/openmeld-wordmark";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import {
	ArrowRightIcon,
	ChatCircleIcon,
	CheckIcon,
	ClockIcon,
	FileTextIcon,
	GithubLogoIcon,
	GlobeIcon,
	ShieldCheckIcon,
} from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { appUrl } from "#/lib/app-url";
import { LandingWorkDemo } from "./landing-work-demo";
import "./landing-page.css";

const REPOSITORY_URL = "https://github.com/amplifthq/openmeld";
const navigation = [
	{ label: "Product", href: "#product" },
	{ label: "Use cases", href: "#use-cases" },
	{ label: "Integrations", href: "#integrations" },
	{ label: "FAQ", href: "#faq" },
] as const;
const questions = [
	{
		question: "What is OpenMeld?",
		answer:
			"OpenMeld is an open-source workspace where people and AI agents work together. Ask your Center Agent for help, bring teammates into a shared Space, and connect local agents when a task needs your code or computer. The conversation and results stay together.",
	},
	{
		question: "Do I need to install anything to start?",
		answer:
			"Start in your browser with the hosted Center Agent. To use a local coding agent, connect your computer through OpenMeld’s setup flow. Your computer needs to be online while that local agent works.",
	},
	{
		question: "Can I keep using my existing agents?",
		answer:
			"Yes. OpenMeld connects to supported agents installed on your computer, including Codex, Claude Code, Cursor, OpenCode, Antigravity, and Grok Build. Keep the agent’s own sign-in and account. Provider limits and charges still apply.",
	},
	{
		question: "Does my whole team need an OpenMeld account?",
		answer:
			"Not for ordinary team requests in a connected Slack, Lark, or Feishu workspace. An admin connects your organization’s Center Agent, and internal members can ask it for help there. Connect an OpenMeld account when you need personal tools, local agents, or account-specific permissions.",
	},
	{
		question: "Where does the work run?",
		answer:
			"Center Agent runs in the cloud. Connected local agents run on your computer. Conversations, shared context, and published results are stored in OpenMeld’s cloud workspace. Connected AI providers and tools process the data needed for their work; local execution does not mean that no data leaves your computer.",
	},
	{
		question: "Is OpenMeld ready for my team?",
		answer:
			"OpenMeld is experimental and actively developed. Start with a small, reviewable task. Check the result before using it for important work, and read the changelog to see what is changing. The source is public on GitHub.",
	},
] as const;

export function LandingPage() {
	const appEntryPath = appUrl("/");
	return (
		<MotionConfig reducedMotion="user">
			<div className="meld-site">
				<a className="meld-skip" href="#main-content">
					Skip to content
				</a>
				<header className="meld-header">
					<div className="meld-wrap meld-header-inner">
						<a aria-label="OpenMeld homepage" className="meld-brand" href="/">
							<OpenMeldWordmark />
							<span className="meld-beta">Preview</span>
						</a>
						<nav aria-label="Main navigation" className="meld-nav">
							<SharedLayoutGroup className="meld-nav-items">
								{navigation.map((item) => (
									<SharedLayoutItem
										className="rounded-md"
										indicatorClassName="rounded-md bg-interaction-hover"
										itemId={item.href}
										key={item.href}
									>
										<a href={item.href}>{item.label}</a>
									</SharedLayoutItem>
								))}
							</SharedLayoutGroup>
						</nav>
						<a
							className={buttonVariants({
								className: "meld-header-cta",
								variant: "outline",
							})}
							href={appEntryPath}
						>
							Open app
							<ArrowRightIcon aria-hidden size={15} />
						</a>
					</div>
				</header>
				<main id="main-content">
					<section aria-labelledby="hero-title" className="meld-hero meld-wrap">
						<div className="meld-hero-copy">
							<div>
								<a className="meld-source-link" href={REPOSITORY_URL}>
									<GithubLogoIcon aria-hidden size={17} />
									Open source. Built in the open.
									<ArrowRightIcon aria-hidden size={14} />
								</a>
								<h1 id="hero-title">
									Your agents.
									<br />
									Working as one.
								</h1>
							</div>
							<div className="meld-hero-intro">
								<p>
									Connect Codex, Claude Code, and the tools your team uses. Give
									them a task, share the context, and get the result back in one
									place.
								</p>
								<div className="meld-actions">
									<a
										className={buttonVariants({ className: "meld-primary" })}
										href={appEntryPath}
									>
										Start with OpenMeld
										<ArrowRightIcon aria-hidden size={17} />
									</a>
									<a className="meld-text-link" href="#use-cases">
										See how it works
									</a>
								</div>
								<span className="meld-caption">
									Start in your browser. Connect local agents when you need
									them.
								</span>
							</div>
						</div>
						<LandingWorkDemo />
						<div className="meld-agents">
							<p>For the agents you already work with</p>
							<div>
								{listLocalAgentInstallGuides().map((guide) => (
									<a href={LOCAL_AGENTS_GUIDE_PATH} key={guide.agentId}>
										<LocalAgentLogo
											agentId={`builtin:${guide.agentId}`}
											className="size-6"
											variant="plain"
										/>
										<span>{guide.displayName}</span>
									</a>
								))}
							</div>
						</div>
					</section>
					<section
						aria-labelledby="product-title"
						className="meld-section meld-wrap"
						id="product"
					>
						<div className="meld-section-heading">
							<h2 id="product-title">
								Good agents.
								<br />
								Better together.
							</h2>
							<p>
								One agent knows the code. Another has the research. Your team
								knows the goal. OpenMeld gives them a shared place to move the
								work forward.
							</p>
						</div>
						<div className="meld-context-layout">
							<div className="meld-context-copy">
								<h3>
									Keep the work.
									<br />
									Not just the chat.
								</h3>
								<p>
									A Space holds the brief, the people, the agent replies, and
									the decisions. Bring someone in without rebuilding the story
									from scattered chats.
								</p>
								<ul className="meld-checks">
									<li>
										<CheckIcon aria-hidden />
										Give people and agents the same brief
									</li>
									<li>
										<CheckIcon aria-hidden />
										Keep follow-up questions beside the result
									</li>
									<li>
										<CheckIcon aria-hidden />
										Reuse team instructions and Skills
									</li>
								</ul>
								<a className="meld-text-link" href="#use-cases">
									Explore an example
									<ArrowRightIcon aria-hidden size={16} />
								</a>
							</div>
							<ContextExample />
						</div>
					</section>
					<section
						aria-labelledby="channel-title"
						className="meld-channel-section"
					>
						<div className="meld-wrap meld-channel-layout">
							<div className="meld-channel-copy">
								<span className="meld-section-label">
									Meet your Center Agent
								</span>
								<h2 id="channel-title">
									One request.
									<br />
									The right help.
								</h2>
								<p>
									Tell your Center Agent what you need. It can use connected
									tools, work with your team’s context, and delegate to
									available agents.
								</p>
								<p>
									Start in OpenMeld. Or bring it into Slack, Lark, or Feishu,
									where your team already talks.
								</p>
								<a
									className={buttonVariants({
										className: "meld-channel-cta",
										variant: "outline",
									})}
									href={appUrl("/add-to-slack")}
								>
									<ChatCircleIcon aria-hidden size={18} />
									Add to Slack
									<ArrowRightIcon aria-hidden size={16} />
								</a>
							</div>
							<div className="meld-channel-example">
								<div className="meld-channel-heading">
									<span># product-team</span>
									<span>Example conversation</span>
								</div>
								<div className="meld-message">
									<span className="meld-person">J</span>
									<div>
										<strong>
											Jamie<span>9:12 AM</span>
										</strong>
										<p>
											What’s blocking the release? Check the open issues and ask
											our coding agent to investigate the login bug.
										</p>
									</div>
								</div>
								<div className="meld-message">
									<span className="meld-agent-symbol">O</span>
									<div>
										<strong>
											Center Agent<span>9:12 AM</span>
										</strong>
										<p>
											I’ll check GitHub and ask Codex to investigate. I’ll bring
											back the findings before we decide what to ship.
										</p>
										<div className="meld-tool-receipt">
											<GithubLogoIcon aria-hidden />
											GitHub issues
											<ArrowRightIcon aria-hidden />
											<LocalAgentLogo agentId="builtin:codex" />
											Codex
										</div>
									</div>
								</div>
								<div className="meld-channel-footnote">
									<ShieldCheckIcon aria-hidden size={16} />
									Uses the tools and agents your team has connected.
								</div>
							</div>
						</div>
					</section>
					<section
						aria-labelledby="agents-title"
						className="meld-section meld-wrap"
					>
						<div className="meld-section-heading">
							<h2 id="agents-title">
								Keep your setup.
								<br />
								Expand your team.
							</h2>
							<p>
								Your local agents keep working with your code and environment.
								OpenMeld connects their work to the people who need it.
							</p>
						</div>
						<div className="meld-execution-layout">
							<div className="meld-execution-card">
								<GlobeIcon aria-hidden className="meld-large-icon" />
								<h3>Shared in the cloud</h3>
								<p>
									Center Agent, conversations, team context, and published
									results. A place your team can return to from any browser.
								</p>
								<div className="meld-execution-tags">
									<span>Center Agent</span>
									<span>Spaces</span>
									<span>Routines</span>
								</div>
							</div>
							<div aria-hidden className="meld-execution-bridge">
								<ArrowRightIcon size={24} />
							</div>
							<div className="meld-execution-card">
								<div className="meld-local-logos">
									<LocalAgentLogo agentId="builtin:codex" className="size-7" />
									<LocalAgentLogo
										agentId="builtin:claude-code"
										className="size-7"
									/>
									<LocalAgentLogo agentId="builtin:cursor" className="size-7" />
								</div>
								<h3>Executed on your computer</h3>
								<p>
									Connected local agents use your existing tools and project
									environment. Keep the agent accounts you already use.
								</p>
								<a className="meld-text-link" href={LOCAL_AGENTS_GUIDE_PATH}>
									Connect a local agent
									<ArrowRightIcon aria-hidden size={16} />
								</a>
							</div>
						</div>
						<p className="meld-boundary-note">
							Your computer must be online for local work. Shared conversations
							and results live in the cloud; connected providers process the
							data needed for a task.
						</p>
					</section>
					<section
						aria-labelledby="integrations-title"
						className="meld-integrations-section"
						id="integrations"
					>
						<div className="meld-wrap">
							<div className="meld-section-heading">
								<h2 id="integrations-title">
									Put your tools
									<br />
									in the conversation.
								</h2>
								<p>
									Give agents access to the systems the work depends on. Connect
									only what you need, with explicit access for each agent.
								</p>
							</div>
							<div className="meld-integrations-grid">
								<IntegrationGroup
									description="Read issues, inspect pull requests, and turn a team question into a concrete next step."
									icon={<GithubLogoIcon />}
									title="Follow the work"
									tools="GitHub · Linear"
								/>
								<IntegrationGroup
									description="Use the docs and decisions your team already has, instead of starting from a blank prompt."
									icon={<FileTextIcon />}
									title="Bring the background"
									tools="Google Drive · Notion"
								/>
								<IntegrationGroup
									description="Ask your Center Agent for help in a connected team channel. Bring the result back to the conversation."
									icon={<ChatCircleIcon />}
									title="Start where you talk"
									tools="Slack · Lark · Feishu"
								/>
							</div>
							<div className="meld-routine">
								<ClockIcon aria-hidden size={24} />
								<div>
									<h3>Make useful work repeat.</h3>
									<p>
										Set up a Routine for recurring work, such as a weekly
										project update. Choose its schedule and the Space where
										results belong.
									</p>
								</div>
								<a className="meld-text-link" href="#use-cases">
									Explore the examples
									<ArrowRightIcon aria-hidden size={16} />
								</a>
							</div>
						</div>
					</section>
					<section
						aria-labelledby="faq-title"
						className="meld-section meld-wrap meld-faq"
						id="faq"
					>
						<div>
							<h2 id="faq-title">
								A few things
								<br />
								before you start.
							</h2>
							<p>
								Real capabilities.
								<br />
								Clear boundaries.
							</p>
							<a className="meld-text-link" href={REPOSITORY_URL}>
								Explore the source
								<ArrowRightIcon aria-hidden size={16} />
							</a>
						</div>
						<Accordion className="meld-faq-items">
							{questions.map((item) => (
								<AccordionItem
									className="meld-faq-item"
									key={item.question}
									value={item.question}
								>
									<AccordionTrigger className="meld-faq-question">
										{item.question}
									</AccordionTrigger>
									<AccordionContent className="meld-faq-answer">
										<p>{item.answer}</p>
									</AccordionContent>
								</AccordionItem>
							))}
						</Accordion>
					</section>
					<section aria-labelledby="final-title" className="meld-final">
						<div className="meld-wrap">
							<span className="meld-section-label">
								Less passing context. More moving work.
							</span>
							<h2 id="final-title">
								Give your next task
								<br />a team.
							</h2>
							<p>
								Start with one request. Bring your agents when you’re ready.
							</p>
							<div className="meld-actions">
								<a
									className={buttonVariants({ className: "meld-primary" })}
									href={appEntryPath}
								>
									Start with OpenMeld
									<ArrowRightIcon aria-hidden size={17} />
								</a>
								<a className="meld-text-link" href={appUrl("/add-to-slack")}>
									Add to Slack
									<ArrowRightIcon aria-hidden size={16} />
								</a>
							</div>
						</div>
					</section>
				</main>
				<footer className="meld-footer meld-wrap">
					<div className="meld-footer-top">
						<div>
							<a className="meld-brand" href="/">
								<OpenMeldWordmark />
							</a>
							<p>People and agents, working as one.</p>
							<span className="meld-caption">
								Experimental software. Built in the open.
							</span>
						</div>
						<nav aria-label="Footer">
							<a href={LOCAL_AGENTS_GUIDE_PATH}>Setup guide</a>
							<a href={appUrl("/agent-interface")}>Agent guide</a>
							<a href="/changelog">Changelog</a>
							<a href={REPOSITORY_URL}>GitHub</a>
							<a href="/privacy">Privacy</a>
							<a href="/terms">Terms</a>
						</nav>
					</div>
					<div aria-hidden className="meld-footer-wordmark">
						OpenMeld
					</div>
				</footer>
			</div>
		</MotionConfig>
	);
}

function ContextExample() {
	return (
		<div className="meld-context-example">
			<div className="meld-context-top">
				<span className="meld-space-mark">#</span>
				<strong>Next release</strong>
				<span className="meld-caption">Shared Space · Example</span>
			</div>
			<div className="meld-context-document">
				<FileTextIcon aria-hidden size={22} />
				<span>Space brief</span>
				<h4>Make sign-in reliable.</h4>
				<p>
					Keep existing sessions working. Reproduce the expired-link issue.
					Bring back a patch and a test plan.
				</p>
				<div className="meld-context-rule" />
				<span className="meld-caption">Team instructions</span>
				<p>
					Open a draft PR. Explain the tradeoffs.
					<br />
					Ask before deploying.
				</p>
			</div>
			<div className="meld-context-members">
				<span className="meld-person">J</span>
				<span className="meld-person meld-person-alt">S</span>
				<LocalAgentLogo agentId="builtin:codex" className="size-8" />
				<LocalAgentLogo agentId="builtin:claude-code" className="size-8" />
				<span>
					Same brief.
					<br />
					<strong>Different strengths.</strong>
				</span>
			</div>
		</div>
	);
}

function IntegrationGroup({
	icon,
	title,
	tools,
	description,
}: {
	icon: ReactNode;
	title: string;
	tools: string;
	description: string;
}) {
	return (
		<div className="meld-integration-group">
			<div aria-hidden className="meld-integration-icon">
				{icon}
			</div>
			<h3>{title}</h3>
			<p>{description}</p>
			<span>{tools}</span>
		</div>
	);
}
