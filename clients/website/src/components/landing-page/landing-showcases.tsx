import { listLocalAgentInstallGuides } from "@openmeld/product-catalog/local-agent-install-guides";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import {
	ArrowUpRightIcon,
	CheckIcon,
	CloudIcon,
	CodeIcon,
	FileTextIcon,
	HashIcon,
	XIcon,
} from "@phosphor-icons/react";
import {
	motion,
	useMotionValue,
	useReducedMotion,
	useSpring,
	useTransform,
} from "motion/react";
import {
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useRef,
	useState,
} from "react";
import { appUrl } from "#/lib/app-url";

const MetalFx = lazy(() =>
	import("metal-fx").then((module) => ({ default: module.MetalFx }))
);

function badgeMask(
	context: CanvasRenderingContext2D,
	width: number,
	height: number
) {
	context.beginPath();
	context.roundRect(0, 0, width, height, height / 2);
	context.fill();
}

export function PlatformMetalBadge({ children }: { children: string }) {
	const [mounted, setMounted] = useState(false);
	const reduced = useReducedMotion();
	useEffect(() => setMounted(true), []);
	const badge = <span className="meld-platform-badge">{children}</span>;
	if (!mounted || reduced) {
		return badge;
	}
	return (
		<Suspense fallback={badge}>
			<MetalFx
				borderRadius={999}
				className="meld-metal-badge"
				glowGain={0.45}
				glowMode="ring"
				mask={badgeMask}
				normalizeHostStyles={false}
				preset="chromatic"
				shaderScale={1.6}
				strength={0.8}
				style={{ background: "#ffffff", borderRadius: 999 }}
				theme="light"
			>
				{badge}
			</MetalFx>
		</Suspense>
	);
}

const agents = listLocalAgentInstallGuides();
export function HeroAgents() {
	const ref = useRef<HTMLDivElement>(null);
	const reduced = useReducedMotion();
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
			<LocalAgentLogo agentId={`builtin:${agentId}`} />
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
				className={`meld-chat-preview meld-chat-${channel}`}
			>
				<div className="meld-chat-chrome">
					<span className="meld-window-dots">
						<i />
						<i />
						<i />
					</span>
					<ChannelMark channel={channel} />
					<span>Amplift</span>
					<span className="meld-chat-search">Search {selected.name}</span>
				</div>
				<div className="meld-chat-body">
					<aside className="meld-chat-sidebar">
						<strong>Amplift</strong>
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
				{initials}
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
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<article className={`meld-bento-card ${className}`}>{children}</article>
	);
}
export function ComputerBento() {
	return (
		<div className="meld-computer-bento">
			<BentoCard className="meld-bento-machine">
				<div aria-hidden className="meld-machine-art">
					<svg aria-hidden="true" fill="none" viewBox="0 0 480 300">
						<g className="meld-machine-layer">
							<path
								d="m100 163 140-68 140 68-140 69Z"
								fill="#25272a"
								stroke="#62656a"
							/>
							<path
								d="m100 163 140 69v40l-140-68Z"
								fill="#17191c"
								stroke="#43464b"
							/>
							<path
								d="m240 232 140-69v41l-140 68Z"
								fill="#202226"
								stroke="#43464b"
							/>
							<path
								d="m136 164 104-50 104 50-104 50Z"
								fill="#121416"
								stroke="#70747b"
							/>
							<path d="m158 164 82-39 82 39-82 39Z" stroke="#9ea4ae" />
							<path
								d="M160 220v10m12-4v10m12-4v10"
								stroke="#555b65"
								strokeWidth="3"
							/>
							<circle cx="339" cy="208" fill="#72deba" r="3" />
						</g>
						<g className="meld-machine-cloud">
							<path
								d="m148 103 92-44 92 44-92 45Z"
								fill="#202529"
								fillOpacity=".8"
								stroke="#7c9ba4"
							/>
							<path
								d="M240 147v51M148 103v47m184-47v47"
								stroke="#6697a4"
								strokeDasharray="3 5"
							/>
							<path
								d="m202 103 38-19 38 19-38 19Z"
								fill="#bad7dd"
								fillOpacity=".16"
								stroke="#a7cbd3"
							/>
						</g>
					</svg>
				</div>
				<div>
					<CloudIcon aria-hidden size={22} />
					<h3>
						A cloud workspace.
						<br />
						Ready for real work.
					</h3>
					<p>
						Files, a terminal, and browser tools for your agent’s next task.
					</p>
				</div>
			</BentoCard>
			<BentoCard className="meld-bento-specs">
				<span className="meld-bento-eyebrow">Cloud computer</span>
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
			<BentoCard className="meld-bento-terminal">
				<div className="meld-bento-eyebrow">
					<CodeIcon aria-hidden size={18} /> A real terminal
				</div>
				<div className="meld-terminal-lines">
					<span>
						<b>❯</b> python3 analyze.py
					</span>
					<span className="meld-terminal-result">Read 24 interview notes</span>
					<span className="meld-terminal-result">Saved findings.md</span>
					<span className="meld-terminal-last">
						<CheckIcon aria-hidden size={14} /> Ready for review
					</span>
				</div>
				<p>Python · Node.js · Git · FFmpeg</p>
			</BentoCard>
			<BentoCard className="meld-bento-files">
				<FileTextIcon aria-hidden size={28} />
				<h3>Keep the result with the work.</h3>
				<p>
					Prepare documents and publish them back to your team’s conversation.
				</p>
				<div className="meld-result-file">
					<FileTextIcon aria-hidden size={20} />
					<span>findings.md</span>
					<CheckIcon aria-hidden size={16} />
				</div>
			</BentoCard>
		</div>
	);
}
