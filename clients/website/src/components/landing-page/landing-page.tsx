import {
	buildLocalAgentGuideDetailPath,
	LOCAL_AGENTS_GUIDE_PATH,
	listLocalAgentInstallGuides,
} from "@openmeld/product-catalog/local-agent-install-guides";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { OpenMeldLogoStrong } from "@openmeld/ui/components/openmeld-logo-strong";
import { OpenMeldWordmark } from "@openmeld/ui/components/openmeld-wordmark";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { FluidHoverHighlight } from "@openmeld/ui/fluid/fluid-hover-highlight";
import {
	useFluidHover,
	useRegisterFluidHoverItem,
} from "@openmeld/ui/hooks/use-fluid-hover";
import {
	AppleLogoIcon,
	ArrowRightIcon,
	ArrowUpRightIcon,
	CaretDownIcon,
	DownloadSimpleIcon,
	WindowsLogoIcon,
} from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { type ReactNode, useRef } from "react";
import { appUrl } from "#/lib/app-url";
import "./landing-page.css";

const REPOSITORY_URL = "https://github.com/amplifthq/openmeld";
function OpenAppButton({ compact = false }: { compact?: boolean }) {
	return (
		<a
			className={`meld-button meld-button-web ${compact ? "meld-button-compact" : ""}`}
			href={appUrl("/")}
		>
			Open App <span className="meld-web-badge">Web</span>
		</a>
	);
}
function DownloadButton() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="meld-button">
				<DownloadSimpleIcon aria-hidden size={18} />
				Download
				<CaretDownIcon aria-hidden size={14} />
			</DropdownMenuTrigger>
			<FluidDropdownMenuContent
				align="start"
				className="dark meld-download-menu"
				gapClick={false}
			>
				<FluidDropdownMenuItem
					index={0}
					onClick={() =>
						window.location.assign(appUrl("/desktop?platform=macos-arm64"))
					}
				>
					<AppleLogoIcon aria-hidden />
					<span>macOS</span>
					<span className="ml-auto text-muted-foreground text-xs">
						Apple silicon
					</span>
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem
					index={1}
					onClick={() =>
						window.location.assign(appUrl("/desktop?platform=windows-x64"))
					}
				>
					<WindowsLogoIcon aria-hidden />
					<span>Windows</span>
					<span className="ml-auto text-muted-foreground text-xs">x64</span>
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem
					index={2}
					onClick={() => window.location.assign(appUrl("/desktop"))}
				>
					<DownloadSimpleIcon aria-hidden />
					<span>All downloads</span>
					<ArrowUpRightIcon aria-hidden className="ml-auto" />
				</FluidDropdownMenuItem>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}
function AppActions() {
	return (
		<div className="meld-actions">
			<DownloadButton />
			<OpenAppButton />
		</div>
	);
}
const questions = [
	{
		question: "What can I try first?",
		answer:
			"Open the app and ask your Center Agent to research a topic or work on a file. It runs in the cloud. When you want teammates and other agents involved, create a shared Space.",
	},
	{
		question: "Can I keep my existing agent subscriptions?",
		answer:
			"Yes. Connect a supported agent installed on your computer, such as Codex or Claude Code. It keeps its existing sign-in and subscription. Your provider’s usage limits and charges still apply.",
	},
	{
		question: "Does my computer need to stay on?",
		answer:
			"Your computer must be online and connected for its local agents to work. The hosted Center Agent runs in the cloud and does not depend on your computer.",
	},
	{
		question: "What happens to our files and conversations?",
		answer:
			"Shared conversations, context, and published results are stored in OpenMeld’s cloud workspace. Local agents run on your computer. Connected AI providers and tools process the data needed for their work. Local execution does not mean all data stays on your computer.",
	},
	{
		question: "Is the workspace on this page live?",
		answer:
			"It uses OpenMeld’s product components with fictional data. You can explore, open files, and try the message editor. The demo does not contact an agent, connect an account, or save your changes. Reload it to start over.",
	},
];

function ProductDemo({
	scene,
	title,
	hero = false,
}: {
	scene: string;
	title: string;
	hero?: boolean;
}) {
	return (
		<div className={`meld-demo ${hero ? "meld-demo-hero" : ""}`}>
			<iframe
				loading={hero ? "eager" : "lazy"}
				referrerPolicy="no-referrer"
				sandbox="allow-scripts allow-same-origin"
				src={`/product-demo/index.html?scene=${scene}`}
				title={title}
			/>
			<a
				className="meld-demo-expand"
				href={`/product-demo/index.html?scene=${scene}`}
				rel="noreferrer"
				target="_blank"
			>
				Open demo <ArrowUpRightIcon aria-hidden size={14} />
			</a>
		</div>
	);
}

export function LandingPage() {
	return (
		<MotionConfig reducedMotion="user">
			<div className="dark meld-site">
				<a className="meld-skip" href="#main-content">
					Skip to content
				</a>
				<header className="meld-header">
					<div className="meld-wrap meld-header-inner">
						<a
							aria-label="OpenMeld homepage"
							className="meld-brand meld-brand-motion"
							href="/"
						>
							<OpenMeldLogoStrong
								ariaLabel={null}
								pointerTracking="viewport"
								size={4}
							/>
						</a>
						<nav aria-label="Main navigation">
							<LandingLinks
								axis="x"
								className="meld-nav-items"
								links={[
									{ href: "#product", content: "Product" },
									{ href: "#agents", content: "Agents" },
									{ href: appUrl("/desktop"), content: "Downloads" },
									{ href: "https://docs.openmeld.ai", content: "Docs" },
									{ href: "/changelog", content: "Changelog" },
								]}
							/>
						</nav>
						<OpenAppButton compact />
					</div>
				</header>
				<main id="main-content">
					<section aria-labelledby="hero-title" className="meld-hero meld-wrap">
						<h1 id="hero-title">
							Your team. Your agents.
							<br />
							<span>One shared workspace.</span>
						</h1>
						<p className="meld-hero-description">
							Bring Codex, Claude Code, and your cloud agents into the same
							conversation. Turn a brief into work your whole team can review.
						</p>
						<AppActions />
						<div id="product">
							<ProductDemo
								hero
								scene="Conversation"
								title="Interactive OpenMeld Space demo"
							/>
						</div>
						<p className="meld-demo-note">
							Demo workspace. Open the release notes, explore a Space, or try
							the editor.
						</p>
					</section>
					<section
						aria-labelledby="together-title"
						className="meld-section meld-wrap"
					>
						<div className="meld-section-heading">
							<h2 id="together-title">
								The whole team.
								<br />
								<span>In on the work.</span>
							</h2>
							<p>
								A teammate adds the brief. An agent prepares the draft. You open
								the file and ask for a change. Everyone can follow the work in
								the same Space.
							</p>
						</div>
						<ProductDemo scene="Spaces" title="Explore OpenMeld Spaces" />
						<div className="meld-details">
							<article>
								<h3>One conversation to build on.</h3>
								<p>
									People and agents share the thread. The next question starts
									with the work already there.
								</p>
							</article>
							<article>
								<h3>Results you can use.</h3>
								<p>
									Open the document. Review the changes. Give the next
									instruction where the result arrived.
								</p>
							</article>
							<article>
								<h3>A place for every project.</h3>
								<p>
									Keep the launch, customer research, and website work in their
									own Spaces.
								</p>
							</article>
						</div>
					</section>
					<section
						aria-labelledby="agents-title"
						className="meld-section meld-agents"
						id="agents"
					>
						<div className="meld-wrap">
							<div className="meld-section-heading">
								<h2 id="agents-title">
									Already your agents.
									<br />
									<span>Now part of the team.</span>
								</h2>
								<div>
									<p>
										Connect the agents on your computer. Keep your
										subscriptions, project files, and local tools. Give your
										team a shared place to work with them.
									</p>
									<a className="meld-link" href={LOCAL_AGENTS_GUIDE_PATH}>
										Connect your first agent{" "}
										<ArrowRightIcon aria-hidden size={16} />
									</a>
								</div>
							</div>
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
											<ArrowUpRightIcon aria-hidden size={15} />
										</>
									),
								}))}
							/>
							<p className="meld-footnote">
								Local agents work while their computer is connected. Your Center
								Agent runs in the cloud.
							</p>
						</div>
					</section>
					<section
						aria-labelledby="knowledge-title"
						className="meld-section meld-wrap"
					>
						<div className="meld-section-heading">
							<h2 id="knowledge-title">
								Your team’s knowledge.
								<br />
								<span>Ready for the next task.</span>
							</h2>
							<p>
								Give agents the product brief, customer notes, and decisions
								behind the work. Keep useful instructions in shared Skills,
								ready to use again.
							</p>
						</div>
						<ProductDemo scene="Files" title="Explore team files and Skills" />
						<div className="meld-details meld-details-two">
							<article>
								<h3>The context is already here.</h3>
								<p>
									Organize shared documents in Team Knowledge. Keep personal
									files separate. Bring the right material into each task.
								</p>
							</article>
							<article>
								<h3>Teach it once. Use it again.</h3>
								<p>
									Turn your release-writing rules or research method into a
									Skill. Share the instructions and reference files with the
									team.
								</p>
							</article>
						</div>
					</section>
					<section
						aria-labelledby="routine-title"
						className="meld-section meld-wrap"
					>
						<div className="meld-section-heading">
							<h2 id="routine-title">
								Friday’s review.
								<br />
								<span>Already on the calendar.</span>
							</h2>
							<p>
								Set a Routine to review project updates every week. Choose the
								instructions, schedule, and destination. Read each result in the
								conversation where your team works.
							</p>
						</div>
						<ProductDemo
							scene="Routines"
							title="Explore a scheduled project review"
						/>
					</section>
					<section
						aria-labelledby="channel-title"
						className="meld-section meld-channel-section"
					>
						<div className="meld-wrap meld-section-heading">
							<h2 id="channel-title">
								The next task starts
								<br />
								<span>in your team’s Slack.</span>
							</h2>
							<div>
								<p>
									Ask your Center Agent for help without leaving the channel.
									Connect the tools it needs for the job. Slack, Lark, and
									Feishu are supported.
								</p>
								<a className="meld-button" href={appUrl("/add-to-slack")}>
									Add to Slack <ArrowUpRightIcon aria-hidden size={16} />
								</a>
							</div>
						</div>
					</section>
					<section
						aria-labelledby="computer-title"
						className="meld-section meld-wrap meld-computer-section"
					>
						<div className="meld-section-heading">
							<h2 id="computer-title">
								Give the work
								<br />
								<span>a computer of its own.</span>
							</h2>
							<p>
								Your cloud agent can work with files, run code, and use a
								browser. It has an environment to prepare the work, check it,
								and bring back the result.
							</p>
						</div>
						<div className="meld-details">
							<article>
								<h3>Files it can work on.</h3>
								<p>Prepare documents and process data in a cloud workspace.</p>
							</article>
							<article>
								<h3>Code it can run.</h3>
								<p>Use a terminal, install dependencies, and test changes.</p>
							</article>
							<article>
								<h3>Tools for the task.</h3>
								<p>
									Use connected apps and Skills within the access you grant.
								</p>
							</article>
						</div>
						<a className="meld-link" href="https://docs.openmeld.ai">
							Explore the docs <ArrowUpRightIcon aria-hidden size={16} />
						</a>
					</section>
					<section
						aria-labelledby="faq-title"
						className="meld-section meld-faq meld-wrap"
					>
						<div>
							<h2 id="faq-title">A few useful answers.</h2>
							<a className="meld-link" href={LOCAL_AGENTS_GUIDE_PATH}>
								Setup guide <ArrowUpRightIcon aria-hidden size={15} />
							</a>
						</div>
						<Accordion>
							{questions.map((item) => (
								<AccordionItem key={item.question} value={item.question}>
									<AccordionTrigger>{item.question}</AccordionTrigger>
									<AccordionContent>
										<p>{item.answer}</p>
									</AccordionContent>
								</AccordionItem>
							))}
						</Accordion>
					</section>
					<section className="meld-start meld-wrap">
						<h2>
							Bring a real task.
							<br />
							<span>See where it goes.</span>
						</h2>
						<AppActions />
					</section>
				</main>
				<footer className="meld-footer meld-wrap">
					<div>
						<a aria-label="OpenMeld homepage" className="meld-brand" href="/">
							<OpenMeldWordmark />
						</a>
						<p>Experimental software. Built in the open.</p>
					</div>
					<nav aria-label="Footer">
						<a href="https://docs.openmeld.ai">Docs</a>
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
		// biome-ignore lint/a11y/noNoninteractiveElementInteractions: Pointer motion controls only the shared decorative highlight.
		// biome-ignore lint/a11y/noStaticElementInteractions: Native links own activation and keyboard focus.
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
