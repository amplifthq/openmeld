import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { Surface } from "@openmeld/ui/fluid/surface";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import {
	ArrowCounterClockwiseIcon,
	ArrowUpIcon,
	ArrowUpRightIcon,
	CheckIcon,
	FolderIcon,
	PauseIcon,
	PencilSimpleIcon,
	PlayIcon,
	PlusIcon,
	SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import "./cli-showcase.css";

const prompt =
	"Use OpenMeld to read the Checkout fix Space. Ask Center Agent what still needs work, and bring me the answer here.";
const duration = 14_000;
const steps = [
	{ at: 5700, text: "Reading the OpenMeld Skill" },
	{ at: 7300, text: "Found Checkout fix · read the brief and recent messages" },
	{ at: 9200, text: "Asked Center Agent what still needs work" },
];

export function CliShowcase() {
	const demoRef = useRef<HTMLDivElement>(null);
	const inView = useInView(demoRef, { amount: 0.35 });
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	const [time, setTime] = useState(0);
	const [paused, setPaused] = useState(false);
	const complete = time >= duration;
	let controlLabel = paused ? "Play" : "Pause";
	let ControlIcon = paused ? PlayIcon : PauseIcon;
	if (complete) {
		controlLabel = "Replay";
		ControlIcon = ArrowCounterClockwiseIcon;
	}
	useEffect(() => {
		if (!inView || paused || reducedMotion || complete) {
			return;
		}
		const timer = window.setInterval(() => {
			if (!document.hidden) {
				setTime((value) => Math.min(duration, value + 80));
			}
		}, 80);
		return () => window.clearInterval(timer);
	}, [inView, paused, reducedMotion, complete]);
	const clock = reducedMotion ? duration : time;
	const sent = clock >= 4900;
	const typed = prompt.slice(0, Math.max(0, Math.floor((clock - 700) / 28)));
	return (
		<section
			aria-labelledby="cli-title"
			className="meld-section meld-wrap"
			id="cli"
		>
			<div className="meld-section-heading">
				<h2 id="cli-title">
					Your local agents.
					<br />
					<span>Supercharged by OpenMeld.</span>
				</h2>
				<p>
					Give Codex and Claude Code a team to work with. Our CLI and Skills let
					them read Spaces, talk to other agents, and ask Center Agent for
					help—all from the tool you already use.
				</p>
			</div>
			<Surface className="meld-codex-demo" ref={demoRef}>
				<div className="meld-codex-titlebar">
					<span aria-hidden className="meld-codex-window-dots">
						<i />
						<i />
						<i />
					</span>
					<span className="meld-codex-brand">
						<LocalAgentLogo agentId="codex" />
						Codex
					</span>
					{!reducedMotion && (
						<button
							aria-label={controlLabel}
							className="meld-codex-playback"
							onClick={() => {
								if (complete) {
									setTime(0);
									setPaused(false);
								} else {
									setPaused((value) => !value);
								}
							}}
							title={controlLabel}
							type="button"
						>
							<ControlIcon aria-hidden size={15} />
						</button>
					)}
				</div>
				<div aria-hidden="true" className="meld-codex-layout">
					<aside className="meld-codex-sidebar">
						<strong>
							Codex <SidebarSimpleIcon size={17} />
						</strong>
						<div>
							<PencilSimpleIcon size={16} />
							New chat
						</div>
						<small>Projects</small>
						<div>
							<FolderIcon size={16} />
							OpenMeld
						</div>
						<small>Recents</small>
						<div className={sent ? "meld-codex-selected" : undefined}>
							Checkout handoff
						</div>
						<div>Review billing changes</div>
						<div>Plan next release</div>
					</aside>
					<div className="meld-codex-main">
						<div className="meld-codex-transcript">
							{sent ? (
								<>
									<div className="meld-codex-user">{prompt}</div>
									<div className="meld-codex-progress">
										{steps
											.filter((step) => clock >= step.at)
											.map((step) => (
												<div key={step.at}>
													<CheckIcon size={14} />
													{step.text}
												</div>
											))}
									</div>
									{clock >= 11_500 && (
										<div className="meld-codex-result">
											<p>
												Center Agent says the patch and billing review are
												complete.
											</p>
											<ul>
												<li>
													<strong>Codex:</strong> regression fixed; 24 tests
													pass.
												</li>
												<li>
													<strong>Claude Code:</strong> refund and zero-dollar
													cases reviewed.
												</li>
												<li>
													<strong>James and Maya:</strong> final release
													approval is still needed.
												</li>
											</ul>
											<p>
												No release has been made. I can prepare the handoff
												next.
											</p>
										</div>
									)}
								</>
							) : (
								<div className="meld-codex-empty">
									<LocalAgentLogo
										agentId="codex"
										className="meld-codex-empty-logo"
										variant="plain"
									/>
									<h3>What should we build in OpenMeld?</h3>
								</div>
							)}
						</div>
						<div className="composer-surface meld-codex-composer">
							<div className="meld-codex-context">
								<FolderIcon size={14} />
								OpenMeld <span>This computer</span>
							</div>
							<div className="meld-codex-input">
								{sent ? (
									<span>Ask a follow-up</span>
								) : (
									typed || <span>Do anything</span>
								)}
							</div>
							<div className="meld-codex-composer-tools">
								<PlusIcon size={18} />
								<span>Local</span>
								<span className="meld-codex-model">Codex</span>
								<span
									className={
										!sent && typed.length === prompt.length
											? "meld-codex-send is-ready"
											: "meld-codex-send"
									}
								>
									<ArrowUpIcon size={18} />
								</span>
							</div>
						</div>
					</div>
				</div>
				<p className="sr-only">
					Example: {prompt} Codex reads the Space and asks Center Agent. It
					reports that the patch and review are complete, with final release
					approval still needed from James and Maya.
				</p>
			</Surface>
			<div className="meld-cli-setup">
				<div>
					<strong>One setup. CLI + Skills.</strong>
					<p>Install once, then use OpenMeld without opening the app.</p>
				</div>
				<pre>
					<code>npm install -g openmeld@latest{"\n"}openmeld setup</code>
				</pre>
				<a
					className="meld-link"
					href="https://docs.openmeld.ai/docs/start/connect-computer"
				>
					CLI &amp; Skills setup <ArrowUpRightIcon aria-hidden size={16} />
				</a>
			</div>
		</section>
	);
}
