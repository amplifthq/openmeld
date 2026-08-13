"use client";

import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	ChatCircleIcon,
	CheckIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { listLocalAgentInstallGuides } from "#/lib/local-agent-install-guides";
import { OnboardingDemoLayout } from "./onboarding-demo-layout";

const AGENT_PROFILE_PATH = "M112 60 C 200 60, 252 112, 348 112";
const DIRECT_MESSAGE_PATH = "M430 185 C 420 252, 258 272, 161 360";
const SPACE_PATH = "M490 185 C 510 258, 474 300, 439 360";
const LOCAL_AGENT_GUIDES = listLocalAgentInstallGuides();

export function LocalAgentsOnboardingDemo() {
	return (
		<OnboardingDemoLayout
			eyebrow="Your computer, in the loop"
			title="Codex becomes a teammate your team can reach."
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0 h-full w-full"
				fill="none"
				viewBox="0 0 600 464"
			>
				<defs>
					<linearGradient id="agent-flow" x1="112" x2="490" y1="60" y2="360">
						<stop stopColor="#fff" stopOpacity="0.04" />
						<stop offset="0.5" stopColor="#fff" stopOpacity="0.38" />
						<stop offset="1" stopColor="#fff" stopOpacity="0.04" />
					</linearGradient>
					<filter
						height="300%"
						id="agent-flow-glow"
						width="300%"
						x="-100%"
						y="-100%"
					>
						<feGaussianBlur stdDeviation="4" />
					</filter>
				</defs>
				{[AGENT_PROFILE_PATH, DIRECT_MESSAGE_PATH, SPACE_PATH].map(
					(path, index) => (
						<g key={path}>
							<path
								d={path}
								stroke="url(#agent-flow)"
								strokeDasharray="3 7"
								strokeWidth="1.5"
							/>
							<circle
								className="motion-reduce:hidden"
								fill="#fff"
								filter="url(#agent-flow-glow)"
								r={index === 0 ? 3.5 : 2.6}
							>
								<animateMotion
									begin={`${index * -1.1}s`}
									dur="4.2s"
									path={path}
									repeatCount="indefinite"
								/>
							</circle>
						</g>
					)
				)}
			</svg>

			<div
				className="absolute top-7 left-7 z-10 grid w-60 grid-cols-3 gap-2"
				data-testid="onboarding-local-agent-grid"
			>
				{LOCAL_AGENT_GUIDES.map((guide) => (
					<AgentTile
						icon={
							<LocalAgentLogo
								agentId={`builtin:${guide.agentId}`}
								className="size-[22px]"
								size="md"
								variant="plain"
							/>
						}
						key={guide.agentId}
						label={guide.displayName}
						selected={guide.agentId === "codex"}
					/>
				))}
			</div>

			<div className="absolute top-16 right-7 z-10 w-56 rounded-md border border-white/12 bg-[#111318]/95 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.45)]">
				<div className="flex items-center gap-3">
					<span className="relative grid size-11 place-items-center rounded-md border border-white/10 bg-white/[0.055] text-white/80">
						<LocalAgentLogo
							agentId="builtin:codex"
							className="size-6"
							size="md"
							variant="plain"
						/>
						<span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border border-[#111318] bg-emerald-400 text-[#0b0c0e]">
							<CheckIcon className="size-2.5" weight="bold" />
						</span>
					</span>
					<div className="min-w-0">
						<p className="truncate font-medium text-sm text-white/85">
							Your Codex
						</p>
						<p className="mt-0.5 text-[11px] text-white/38">Agent Profile</p>
					</div>
				</div>
				<div className="mt-4 flex items-center justify-between border-white/[0.07] border-t pt-3">
					<span className="text-[10px] text-white/35 uppercase tracking-[0.13em]">
						This computer
					</span>
					<span className="flex items-center gap-1.5 text-[10px] text-emerald-300/75">
						<span className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
						Ready
					</span>
				</div>
			</div>

			<div className="absolute right-7 bottom-7 left-7 z-10 grid grid-cols-2 gap-3">
				<ActionCard
					description="Start a private task"
					icon={<ChatCircleIcon />}
					title="Message directly"
				/>
				<ActionCard
					description="Work with the team"
					icon={<UsersThreeIcon />}
					title="Add to a Space"
				/>
			</div>
		</OnboardingDemoLayout>
	);
}

function AgentTile(input: {
	icon: ReactNode;
	label: string;
	selected?: boolean;
}) {
	return (
		<div
			className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-md border ${
				input.selected
					? "border-white/20 bg-white/[0.09] text-white/80"
					: "border-white/[0.07] bg-black/10 text-white/32"
			}`}
		>
			{input.icon}
			<span className="text-[9px]">{input.label}</span>
		</div>
	);
}

function ActionCard(input: {
	description: string;
	icon: ReactNode;
	title: string;
}) {
	return (
		<div className="rounded-md border border-white/10 bg-[#111318]/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
			<div className="flex items-center gap-2 text-white/65">
				<span className="[&_svg]:size-4">{input.icon}</span>
				<p className="font-medium text-xs">{input.title}</p>
			</div>
			<p className="mt-2 text-[11px] text-white/32">{input.description}</p>
		</div>
	);
}
