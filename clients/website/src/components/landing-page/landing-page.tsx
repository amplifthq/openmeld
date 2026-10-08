import { LOCAL_AGENTS_GUIDE_PATH } from "@openmeld/product-catalog/local-agent-install-guides";
import { homePageCopy } from "@openmeld/product-catalog/site";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { OpenMeldLogoStrong } from "@openmeld/ui/components/openmeld-logo-strong";
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
import { Surface } from "@openmeld/ui/fluid/surface";
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
	GithubLogoIcon,
	WindowsLogoIcon,
} from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { type ReactNode, useRef } from "react";
import { appUrl } from "#/lib/app-url";
import { CliShowcase } from "./cli-showcase";
import { ConnectorShowcase } from "./connector-showcase";
import { HeroDescription } from "./hero-copy";
import { LandingFooter } from "./landing-footer";
import { LandingAsciiCanvas } from "./landing-page-ascii-canvas";
import {
	ChannelShowcase,
	ComputerBento,
	PlatformMetalBadge,
} from "./landing-showcases";
import {
	AgentShowcase,
	CenterAgentShowcase,
	KnowledgeShowcase,
	RoutineShowcase,
	UsageShowcase,
} from "./product-showcases";
import "./landing-page.css";

const REPOSITORY_URL = "https://github.com/amplifthq/openmeld";
function OpenAppButton({ compact = false }: { compact?: boolean }) {
	return (
		<a
			className={`meld-button meld-button-web ${compact ? "meld-button-compact" : ""}`}
			href={appUrl("/")}
		>
			Open App <PlatformMetalBadge appearance="ring">Web</PlatformMetalBadge>
		</a>
	);
}
function DownloadButton() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="meld-button">
				<DownloadSimpleIcon aria-hidden size={18} />
				Download
				<PlatformMetalBadge>Desktop</PlatformMetalBadge>
				<CaretDownIcon aria-hidden size={14} />
			</DropdownMenuTrigger>
			<FluidDropdownMenuContent
				align="start"
				className="dark meld-download-menu"
				gapClick={false}
				sideOffset={12}
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
	const demo = (
		<div
			className={`meld-demo meld-demo-${scene.toLowerCase()} ${hero ? "meld-demo-hero" : ""}`}
		>
			<iframe
				loading={hero ? "eager" : "lazy"}
				referrerPolicy="no-referrer"
				sandbox="allow-scripts allow-same-origin"
				src={`/product-demo/index.html?scene=${scene}`}
				title={title}
			/>
		</div>
	);
	return hero ? <Surface className="meld-demo-surface">{demo}</Surface> : demo;
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
					</div>
				</header>
				<main id="main-content">
					<section aria-labelledby="hero-title" className="meld-hero meld-wrap">
						<h1 className="meld-hero-title" id="hero-title">
							{homePageCopy.tagline}
						</h1>
						<HeroDescription />
						<AppActions />
						<div className="meld-open-source">
							<a href={REPOSITORY_URL}>
								<GithubLogoIcon aria-hidden size={18} />
								Steal our code (legally){" "}
								<ArrowUpRightIcon aria-hidden size={14} />
							</a>
							<span>100% open source. MIT licensed.</span>
						</div>
						<div id="product">
							<ProductDemo
								hero
								scene="Conversation"
								title="Interactive OpenMeld Space demo"
							/>
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
										Keep your subscriptions, files, and local tools. Bring the
										agents you use into your team’s conversation.
									</p>
									<a className="meld-link" href={LOCAL_AGENTS_GUIDE_PATH}>
										Connect your first agent{" "}
										<ArrowRightIcon aria-hidden size={16} />
									</a>
								</div>
							</div>
							<AgentShowcase />
							<p className="meld-footnote">
								Local agents work while their computer is connected. Your Center
								Agent runs in the cloud.
							</p>
						</div>
					</section>
					<section
						aria-labelledby="center-agent-title"
						className="meld-section meld-wrap"
						id="center-agent"
					>
						<div className="meld-section-heading">
							<h2 id="center-agent-title">
								Your 24/7 SI team lead.
								<br />
								<span>Assigns work. Reports back.</span>
							</h2>
							<p>
								Tell your Center Agent what needs to happen. It finds the right
								people and agents, delegates tasks, and brings you the results.
								Coordinate work across Spaces and connected apps from the
								channels you already use—without chasing every update.
							</p>
						</div>
						<CenterAgentShowcase />
					</section>
					<section
						aria-labelledby="channel-title"
						className="meld-section meld-channel-section"
					>
						<div className="meld-wrap">
							<ChannelShowcase />
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
								Shared files for context. Shared Skills for how to work. Your
								agents start with what your team already knows.
							</p>
						</div>
						<KnowledgeShowcase />
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
								Set the task and the schedule. Your agent brings the result back
								to the conversation.
							</p>
						</div>
						<RoutineShowcase />
					</section>
					<section
						aria-labelledby="connectors-title"
						className="meld-section meld-wrap meld-connectors-section"
						id="integrations"
					>
						<ConnectorShowcase />
					</section>
					<CliShowcase />
					<section
						aria-labelledby="computer-title"
						className="meld-section meld-wrap meld-computer-section"
					>
						<div className="meld-section-heading">
							<h2 id="computer-title">
								A free cloud computer.
								<br />
								<span>For you and all your agents.</span>
							</h2>
							<p>
								Everyone gets a free cloud computer. Your local and cloud agents
								share it to work with files, run code, and get things done.
							</p>
						</div>
						<ComputerBento />
						<a className="meld-link" href="https://docs.openmeld.ai">
							Explore the docs <ArrowUpRightIcon aria-hidden size={16} />
						</a>
					</section>
					<section
						aria-labelledby="usage-title"
						className="meld-section meld-wrap"
						id="usage"
					>
						<div className="meld-section-heading">
							<h2 id="usage-title">
								The whole team’s usage.
								<br />
								<span>In one clear view.</span>
							</h2>
							<p>
								See cloud model costs and recorded local-agent tokens across
								your organization. Switch to your own agents. Open the details
								when you need them.
							</p>
						</div>
						<UsageShowcase />
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
					<section className="meld-start meld-wrap" id="start">
						<div aria-hidden="true" className="meld-start-loop">
							<LandingAsciiCanvas scene="collaboration-loop" />
						</div>
						<h2>
							Your team. Your agents.
							<br />
							<span>Meld into one.</span>
						</h2>
						<AppActions />
					</section>
				</main>
				<LandingFooter repositoryUrl={REPOSITORY_URL} />
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
