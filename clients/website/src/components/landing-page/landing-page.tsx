import {
	buildLocalAgentGuideDetailPath,
	LOCAL_AGENTS_GUIDE_PATH,
	listLocalAgentInstallGuides,
} from "@openmeld/product-catalog/local-agent-install-guides";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { OpenMeldWordmark } from "@openmeld/ui/components/openmeld-wordmark";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import { FluidHoverHighlight } from "@openmeld/ui/fluid/fluid-hover-highlight";
import {
	useFluidHover,
	useRegisterFluidHoverItem,
} from "@openmeld/ui/hooks/use-fluid-hover";
import {
	ArrowRightIcon,
	ArrowUpRightIcon,
	GithubLogoIcon,
} from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { type ReactNode, useRef } from "react";
import workspaceImage from "#/assets/product/shared-space.jpg";
import workspaceMobileImage from "#/assets/product/shared-space-mobile.jpg";
import { appUrl } from "#/lib/app-url";
import "./landing-page.css";

const REPOSITORY_URL = "https://github.com/amplifthq/openmeld";
const navigation = [
	{ label: "Product", href: "#product" },
	{ label: "Connect your agents", href: "#agents" },
	{ label: "Changelog", href: "/changelog" },
] as const;
const questions = [
	{
		question: "What can I do first?",
		answer:
			"Open the app and ask your Center Agent for help. It runs in the cloud, so you can start in your browser. Create a shared Space when you want teammates and other agents to join the work.",
	},
	{
		question: "Can I use the agents I already pay for?",
		answer:
			"Yes. Connect a supported agent installed on your computer, such as Codex or Claude Code. Keep its existing sign-in and subscription. Your provider’s usage limits and charges still apply.",
	},
	{
		question: "Does my computer need to stay on?",
		answer:
			"For a local agent to work, its computer must be online with OpenMeld connected. The hosted Center Agent runs in the cloud and does not depend on your computer.",
	},
	{
		question: "Can my team use it from Slack?",
		answer:
			"Yes. An admin can connect the organization’s Center Agent to Slack, Lark, or Feishu. Internal members can then ask it for help there. Connect an OpenMeld account for personal tools, local agents, and account-specific permissions.",
	},
	{
		question: "Where does our data go?",
		answer:
			"Conversations, shared context, and published results are stored in OpenMeld’s cloud workspace. Local agents run on your computer. Connected AI providers and tools process the data needed for their work. Local execution does not mean all data stays on your computer.",
	},
	{
		question: "Is OpenMeld ready for production?",
		answer:
			"OpenMeld is experimental and actively developed. Start with a small task and review the result before using it for important work. You can inspect the source on GitHub and follow updates in the changelog.",
	},
] as const;

export function LandingPage() {
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
						</a>
						<nav aria-label="Main navigation" className="meld-nav">
							<LandingLinks
								axis="x"
								className="meld-nav-items"
								links={navigation.map((item) => ({
									href: item.href,
									content: item.label,
								}))}
							/>
						</nav>
						<a className="meld-header-action" href={appUrl("/")}>
							Open app <ArrowUpRightIcon aria-hidden size={15} />
						</a>
					</div>
				</header>
				<main id="main-content">
					<section aria-labelledby="hero-title" className="meld-hero meld-wrap">
						<a className="meld-release" href="/changelog">
							<span className="meld-release-dot" /> Open source. In active
							development. <ArrowRightIcon aria-hidden size={14} />
						</a>
						<div className="meld-hero-copy">
							<h1 id="hero-title">
								Work with your team.
								<br />
								<span>And their agents.</span>
							</h1>
							<div className="meld-hero-aside">
								<p>
									Give your teammates, Codex, and Claude Code one place to work.
									Share the context. Ask for help. Review the result together.
								</p>
								<div className="meld-actions">
									<a className="meld-button" href={appUrl("/")}>
										Start with OpenMeld <ArrowRightIcon aria-hidden size={16} />
									</a>
									<a className="meld-link" href={REPOSITORY_URL}>
										<GithubLogoIcon aria-hidden size={18} /> GitHub
									</a>
								</div>
							</div>
						</div>
						<figure className="meld-product" id="product">
							<div className="meld-product-label">
								<span>
									<span className="meld-live-dot" /> ONE SHARED SPACE
								</span>
								<span>People + agents + context</span>
							</div>
							<a
								aria-label="View full-size OpenMeld interface screenshot"
								className="meld-product-image"
								href={workspaceImage}
								rel="noreferrer"
								target="_blank"
							>
								<picture>
									<source
										height={2080}
										media="(max-width: 540px)"
										srcSet={workspaceMobileImage}
										width={780}
									/>
									<img
										alt="OpenMeld shared Space: Maya asks about a release, Codex reports a patch, and Claude Code reviews the remaining checks."
										fetchPriority="high"
										height={1520}
										src={workspaceImage}
										width={2560}
									/>
								</picture>
							</a>
							<figcaption>
								<span>OpenMeld interface. Sample workspace.</span>
								<span>
									View full size <ArrowUpRightIcon aria-hidden size={13} />
								</span>
							</figcaption>
						</figure>
					</section>
					<section aria-labelledby="work-title" className="meld-work meld-wrap">
						<div className="meld-section-heading">
							<p className="meld-eyebrow">
								A conversation that moves the work forward
							</p>
							<h2 id="work-title">
								The team sees the request.
								<br />
								The team gets the result.
							</h2>
						</div>
						<div className="meld-work-grid">
							<article>
								<span className="meld-index">01 / SHARE</span>
								<h3>Start with the same context.</h3>
								<p>
									Put the brief, files, and decisions in a shared Space. People
									and agents can refer to the same conversation.
								</p>
							</article>
							<article>
								<span className="meld-index">02 / ASK</span>
								<h3>Bring in the right agent.</h3>
								<p>
									Mention an agent when you need it. Connect local agents for
									work in your projects, or ask the hosted Center Agent.
								</p>
							</article>
							<article>
								<span className="meld-index">03 / REVIEW</span>
								<h3>Keep the answer with the work.</h3>
								<p>
									Agent replies return to the Space. Your teammates can read the
									result, ask a follow-up, and decide what happens next.
								</p>
							</article>
						</div>
					</section>
					<section
						aria-labelledby="agents-title"
						className="meld-agents"
						id="agents"
					>
						<div className="meld-wrap meld-agents-inner">
							<div className="meld-agents-copy">
								<p className="meld-eyebrow">
									Your tools. A shared place to use them.
								</p>
								<h2 id="agents-title">
									Keep the agents
									<br />
									you already know.
								</h2>
								<p>
									Connect the coding agents on your computer. Keep their
									accounts, your project files, and the way you work. Give your
									team a shared place to ask for their help.
								</p>
								<a className="meld-link" href={LOCAL_AGENTS_GUIDE_PATH}>
									Connect your first agent{" "}
									<ArrowRightIcon aria-hidden size={16} />
								</a>
							</div>
							<div className="meld-agent-directory">
								<LandingLinks
									axis="xy"
									className="meld-agent-links"
									links={listLocalAgentInstallGuides().map((agent) => ({
										href: buildLocalAgentGuideDetailPath(agent.agentId),
										content: (
											<>
												<LocalAgentLogo
													agentId={`builtin:${agent.agentId}`}
													className="meld-agent-logo"
												/>
												<span>{agent.displayName}</span>
												<ArrowUpRightIcon aria-hidden size={16} />
											</>
										),
									}))}
								/>
								<p>Local agents need a connected, online computer.</p>
							</div>
						</div>
					</section>
					<section
						aria-labelledby="channels-title"
						className="meld-channels meld-wrap"
					>
						<p className="meld-eyebrow">Start where your team talks</p>
						<div className="meld-channels-body">
							<h2 id="channels-title">
								A browser tab.
								<br />
								Or your team’s Slack.
							</h2>
							<div>
								<p>
									Start in OpenMeld, or connect your Center Agent to Slack,
									Lark, or Feishu. Your team can ask for help in a channel it
									already uses.
								</p>
								<a className="meld-link" href={appUrl("/add-to-slack")}>
									Add to Slack <ArrowRightIcon aria-hidden size={16} />
								</a>
							</div>
						</div>
					</section>
					{/* Layout adapted from Tailark Mist FAQs 2; see SOURCES.md. Interaction is owned by @openmeld/ui. */}
					<section
						aria-labelledby="faq-title"
						className="meld-faq meld-wrap"
						id="faq"
					>
						<div>
							<p className="meld-eyebrow">Before you start</p>
							<h2 id="faq-title">
								A few useful <br />
								answers.
							</h2>
							<a className="meld-link" href={LOCAL_AGENTS_GUIDE_PATH}>
								Setup guide <ArrowUpRightIcon aria-hidden size={15} />
							</a>
						</div>
						<Accordion className="meld-questions">
							{questions.map((item) => (
								<AccordionItem
									className="meld-question"
									key={item.question}
									value={item.question}
								>
									<AccordionTrigger>{item.question}</AccordionTrigger>
									<AccordionContent>
										<p>{item.answer}</p>
									</AccordionContent>
								</AccordionItem>
							))}
						</Accordion>
					</section>
					<section className="meld-start">
						<div className="meld-wrap meld-start-inner">
							<div>
								<p className="meld-eyebrow">Start with one real task</p>
								<h2>
									Bring your work.
									<br />
									Bring your agents.
								</h2>
							</div>
							<div>
								<a className="meld-button" href={appUrl("/")}>
									Start with OpenMeld <ArrowRightIcon aria-hidden size={16} />
								</a>
								<p>Open the app. Ask your first question.</p>
							</div>
						</div>
					</section>
				</main>
				<footer className="meld-footer meld-wrap">
					<div>
						<a aria-label="OpenMeld homepage" className="meld-brand" href="/">
							<OpenMeldWordmark />
						</a>
						<p>People and agents, working together.</p>
						<span>Experimental software. Built in the open.</span>
					</div>
					<nav aria-label="Footer">
						<a href={appUrl("/agent-interface")}>Agent guide</a>
						<a href="/changelog">Changelog</a>
						<a href={REPOSITORY_URL}>GitHub</a>
						<a href="/privacy">Privacy</a>
						<a href="/terms">Terms</a>
					</nav>
				</footer>
			</div>
		</MotionConfig>
	);
}

function LandingLinks({
	links,
	axis,
	className,
}: {
	links: readonly { href: string; content: ReactNode }[];
	axis: "x" | "xy";
	className: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(ref, { axis, gapClick: false });
	return (
		// biome-ignore lint/a11y/noNoninteractiveElementInteractions: shared hover only; native links retain all activation and keyboard behavior.
		// biome-ignore lint/a11y/noStaticElementInteractions: pointer movement only drives a decorative shared highlight, not an action.
		<div
			className={className}
			onMouseEnter={hover.handlers.onMouseEnter}
			onMouseLeave={hover.handlers.onMouseLeave}
			onMouseMove={hover.handlers.onMouseMove}
			ref={ref}
		>
			<FluidHoverHighlight className="meld-nav-highlight" hover={hover} />
			{links.map((link, index) => (
				<LandingLink
					index={index}
					key={link.href}
					link={link}
					registerItem={hover.registerItem}
				/>
			))}
		</div>
	);
}

function LandingLink({
	link,
	index,
	registerItem,
}: {
	link: { href: string; content: ReactNode };
	index: number;
	registerItem: ReturnType<typeof useFluidHover>["registerItem"];
}) {
	const ref = useRef<HTMLAnchorElement>(null);
	useRegisterFluidHoverItem(registerItem, index, ref);
	return (
		<a href={link.href} ref={ref}>
			{link.content}
		</a>
	);
}
