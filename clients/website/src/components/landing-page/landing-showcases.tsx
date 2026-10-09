import { listLocalAgentInstallGuides } from "@openmeld/product-catalog/local-agent-install-guides";
import { BotAvatar } from "@openmeld/ui/components/bot-avatar";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import {
	ArrowUpRightIcon,
	CheckIcon,
	CloudIcon,
	CodeIcon,
	CpuIcon,
	FileTextIcon,
	HashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { appUrl } from "#/lib/app-url";
import { LandingFigure } from "./landing-figure";

const heroAgentOrder = [
	"antigravity",
	"claude-code",
	"grok-build",
	"opencode",
	"codex",
	"cursor",
];
const agents = [...listLocalAgentInstallGuides()].sort(
	(a, b) =>
		heroAgentOrder.indexOf(a.agentId) - heroAgentOrder.indexOf(b.agentId)
);
export function HeroAgents() {
	const ref = useRef<HTMLDivElement>(null);
	const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
	const x = useMotionValue(0);
	const y = useMotionValue(0);
	useEffect(() => {
		const hero = ref.current?.parentElement;
		if (!hero || reduced || !window.matchMedia("(pointer: fine)").matches) {
			return;
		}
		const move = (event: PointerEvent) => {
			const rect = hero.getBoundingClientRect();
			x.set((event.clientX - rect.left) / rect.width - 0.5);
			y.set(Math.min((event.clientY - rect.top) / 500, 1) - 0.5);
		};
		const reset = () => {
			x.set(0);
			y.set(0);
		};
		hero.addEventListener("pointermove", move, { passive: true });
		hero.addEventListener("pointerleave", reset);
		return () => {
			hero.removeEventListener("pointermove", move);
			hero.removeEventListener("pointerleave", reset);
		};
	}, [reduced, x, y]);
	return (
		<div aria-hidden="true" className="meld-hero-agents" ref={ref}>
			{agents.map((agent, index) => (
				<FloatingAgent
					agentId={agent.agentId}
					index={index}
					key={agent.agentId}
					x={x}
					y={y}
				/>
			))}
		</div>
	);
}
function FloatingAgent({
	agentId,
	index,
	x,
	y,
}: {
	agentId: string;
	index: number;
	x: ReturnType<typeof useMotionValue<number>>;
	y: ReturnType<typeof useMotionValue<number>>;
}) {
	const offsetX = useTransform(x, (value) => value * (index % 2 ? 28 : -24));
	const offsetY = useTransform(y, (value) => value * (index % 2 ? -18 : 24));
	const springX = useSpring(offsetX, { stiffness: 100, damping: 24 });
	const springY = useSpring(offsetY, { stiffness: 100, damping: 24 });
	return (
		<motion.div
			className={`meld-floating-agent meld-floating-agent-${index}`}
			style={{
				x: springX,
				y: springY,
				rotate: [-12, 10, -7, 14, 8, -12][index],
			}}
		>
			<LocalAgentLogo
				agentId={`builtin:${agentId}`}
				className="meld-floating-agent-mark"
				codexLogo="openai"
				variant="plain"
			/>
		</motion.div>
	);
}

const channels = [
	{
		id: "slack",
		name: "Slack",
		description: "Ask in a channel. Keep the answer in the thread.",
	},
	{
		id: "lark",
		name: "Lark",
		description: "Bring your Center Agent into the team conversation.",
	},
	{
		id: "feishu",
		name: "Feishu",
		description: "Work with your team in Feishu, too.",
	},
];
function ChannelMark({ channel }: { channel: string }) {
	return (
		<img
			alt=""
			height={25}
			src={
				channel === "slack" ? "/app-logos/slack.svg" : "/app-logos/feishu.svg"
			}
			width={25}
		/>
	);
}
export function ChannelShowcase() {
	const [channel, setChannel] = useState("slack");
	const [thread, setThread] = useState(false);
	const selected = channels.find((item) => item.id === channel) ?? channels[0];
	return (
		<div className="meld-channel-showcase">
			<div className="meld-channel-controls">
				<h2 id="channel-title">
					Meet your team.
					<br />
					<span>Where they work.</span>
				</h2>
				<p>
					Ask your Center Agent for help in the conversation your team already
					uses.
				</p>
				<Tabs
					onValueChange={(value) => {
						setChannel(value);
						setThread(false);
					}}
					orientation="vertical"
					value={channel}
				>
					<TabsList
						aria-label="Messaging app"
						background={false}
						className="meld-channel-options"
					>
						{channels.map((item) => (
							<TabItem
								className="meld-channel-option"
								key={item.id}
								label={item.name}
								value={item.id}
							>
								<ChannelMark channel={item.id} />
								<span>
									<strong>{item.name}</strong>
									<small>{item.description}</small>
								</span>
							</TabItem>
						))}
					</TabsList>
				</Tabs>
				<a
					className="meld-link"
					href={
						channel === "slack"
							? appUrl("/add-to-slack")
							: "https://docs.openmeld.ai"
					}
				>
					{" "}
					{channel === "slack" ? "Add to Slack" : `Connect ${selected.name}`}{" "}
					<ArrowUpRightIcon aria-hidden size={16} />
				</a>
			</div>
			<section
				aria-label={`${selected.name} conversation preview`}
				className={`meld-chat-preview meld-demo-blend meld-chat-${channel}`}
			>
				<div className="meld-chat-chrome">
					<span className="meld-window-dots">
						<i />
						<i />
						<i />
					</span>
					<ChannelMark channel={channel} />
					<span>OpenMeld</span>
					<span className="meld-chat-search">Search {selected.name}</span>
				</div>
				<div className="meld-chat-body">
					<aside className="meld-chat-sidebar">
						<strong>OpenMeld</strong>
						<span>Conversations</span>
						<span className="meld-chat-active">
							<HashIcon aria-hidden size={15} /> launch-room
						</span>
						<span>
							<HashIcon aria-hidden size={15} /> product
						</span>
						<span>
							<HashIcon aria-hidden size={15} /> customer-research
						</span>
					</aside>
					<div className="meld-chat-conversation">
						<header>
							<HashIcon aria-hidden size={19} />
							<strong>launch-room</strong>
						</header>
						<div className="meld-chat-messages">
							<ChatMessage initials="MC" name="Maya Chen" time="9:00 AM">
								{" "}
								<mark>@Center Agent</mark> What changed since our last project
								review?
							</ChatMessage>
							<ChatMessage initials="✦" name="Center Agent" time="9:01 AM">
								I found three updates in the launch Space. The setup guide is
								ready, the install checks pass, and the brief needs your review.
							</ChatMessage>
							<button
								aria-expanded={thread}
								className="meld-thread-toggle"
								onClick={() => setThread(!thread)}
								type="button"
							>
								<span className="meld-mini-avatar">JL</span> 2 replies{" "}
								<span>Last reply at 9:04 AM</span>
							</button>
							<ChatMessage initials="JL" name="James Lee" time="9:05 AM">
								Great. Let’s keep the final review in the launch Space.
							</ChatMessage>
						</div>
						<div className="meld-chat-composer">
							Message launch-room{" "}
							<span>
								＋ <span>＠</span>
							</span>
						</div>
					</div>
					{thread ? (
						<aside className="meld-chat-thread">
							<header>
								<strong>Thread</strong>
								<button
									aria-label="Close thread"
									onClick={() => setThread(false)}
									type="button"
								>
									<XIcon size={18} />
								</button>
							</header>
							<ChatMessage initials="JL" name="James Lee" time="9:03 AM">
								Anything still blocked?
							</ChatMessage>
							<ChatMessage initials="✦" name="Center Agent" time="9:04 AM">
								Only the final review. Maya owns it.
							</ChatMessage>
						</aside>
					) : null}
				</div>
			</section>
		</div>
	);
}
function ChatMessage({
	name,
	initials,
	time,
	children,
}: {
	name: string;
	initials: string;
	time: string;
	children: ReactNode;
}) {
	return (
		<div className="meld-chat-message">
			<span
				className={`meld-chat-avatar ${initials === "✦" ? "meld-chat-agent" : ""}`}
			>
				{initials === "✦" ? (
					<BotAvatar palette="original" size={27} type="clover" />
				) : (
					initials
				)}
			</span>
			<div>
				<div className="meld-chat-author">
					<strong>{name}</strong>
					<time>{time}</time>
				</div>
				<p>{children}</p>
			</div>
		</div>
	);
}

// Layout adapted from Animata Bento Grid Three (MIT). See SOURCES.md.
function BentoCard({
	className = "",
	icon,
	title,
	children,
}: {
	className?: string;
	icon: ReactNode;
	title: ReactNode;
	children: ReactNode;
}) {
	return (
		<article className={`meld-bento-card ${className}`}>
			<div className="meld-bento-heading">
				{icon}
				<h3>{title}</h3>
			</div>
			<div className="meld-bento-body">{children}</div>
		</article>
	);
}
export function ComputerBento() {
	return (
		<div className="meld-computer-bento">
			<BentoCard
				className="meld-bento-machine"
				icon={<CloudIcon aria-hidden size={20} />}
				title="One computer. All your agents."
			>
				<p>Your files, terminal, and browser. Ready for the next task.</p>
				<div className="meld-machine-art">
					<LandingFigure
						figure="turntable"
						label="Computer components on a turntable. Brush across to rotate."
					/>
				</div>
			</BentoCard>
			<BentoCard
				className="meld-bento-specs"
				icon={<CpuIcon aria-hidden size={20} />}
				title="Your cloud computer"
			>
				<div className="meld-computer-specs">
					<div>
						<strong>1</strong>
						<span>vCPU</span>
					</div>
					<div>
						<strong>
							6<span> GiB</span>
						</strong>
						<span>memory</span>
					</div>
					<div>
						<strong>
							12<span> GB</span>
						</strong>
						<span>working disk</span>
					</div>
				</div>
			</BentoCard>
			<BentoCard
				className="meld-bento-terminal"
				icon={<CodeIcon aria-hidden size={20} />}
				title="A real terminal"
			>
				<p>
					Analyze data, build apps, and create videos with Python, Node.js, Git,
					and FFmpeg.
				</p>
				<div className="meld-terminal-lines">
					<span>
						<b>❯</b> ffmpeg -i demo.mov demo.mp4
					</span>
					<span className="meld-terminal-result">Saved demo.mp4</span>
					<span className="meld-terminal-last">
						<CheckIcon aria-hidden size={14} /> Ready to share
					</span>
				</div>
				<div className="meld-terminal-figure">
					<LandingFigure
						figure="terminal"
						label="A terminal window. Move up or down to browse its history."
					/>
				</div>
			</BentoCard>
			<BentoCard
				className="meld-bento-files"
				icon={<FileTextIcon aria-hidden size={20} />}
				title="From file to finished work."
			>
				<p>Bring the result back to your team’s conversation.</p>
				<div className="meld-result-figure">
					<LandingFigure
						figure="riffle"
						label="A tray of files. Hover or use the arrow keys to pull a file."
					/>
				</div>
			</BentoCard>
		</div>
	);
}
