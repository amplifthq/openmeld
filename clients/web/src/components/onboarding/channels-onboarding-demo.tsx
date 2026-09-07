"use client";

import { CheckIcon, GitPullRequestIcon } from "@phosphor-icons/react";
import { AppLogo } from "#/components/organizations/app-logo";
import {
	GITHUB_PLUGIN,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/plugin-catalog";
import {
	CenterAgentMark,
	OnboardingDemoLayout,
} from "./onboarding-demo-layout";

const MESSAGE_TO_AGENT_PATH = "M300 336 C 300 292, 258 292, 258 257";
const AGENT_TO_RESULT_PATH = "M306 190 C 318 190, 320 152, 332 152";

export function ChannelsOnboardingDemo() {
	return (
		<OnboardingDemoLayout
			eyebrow="Slack or Lark"
			headerAside={
				<div className="hidden items-center gap-2 text-white/40 text-xs sm:flex">
					<span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]" />
					Live
				</div>
			}
			title="Ask where your team already works."
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0 h-full w-full"
				fill="none"
				viewBox="0 0 600 464"
			>
				<defs>
					<linearGradient id="channel-line" x1="258" x2="332" y1="336" y2="152">
						<stop stopColor="#ffffff" stopOpacity="0.08" />
						<stop offset="0.5" stopColor="#ffffff" stopOpacity="0.42" />
						<stop offset="1" stopColor="#ffffff" stopOpacity="0.08" />
					</linearGradient>
					<filter
						height="300%"
						id="channel-glow"
						width="300%"
						x="-100%"
						y="-100%"
					>
						<feGaussianBlur stdDeviation="4" />
					</filter>
				</defs>
				{[MESSAGE_TO_AGENT_PATH, AGENT_TO_RESULT_PATH].map((path, index) => (
					<g key={path}>
						<path
							d={path}
							stroke="url(#channel-line)"
							strokeDasharray="3 7"
							strokeWidth="1.5"
						/>
						<circle
							className="motion-reduce:hidden"
							fill="#ffffff"
							filter="url(#channel-glow)"
							r={index === 0 ? 3.5 : 2.8}
						>
							<animateMotion
								begin={`${index * -1.6}s`}
								dur="3.8s"
								path={path}
								repeatCount="indefinite"
							/>
						</circle>
					</g>
				))}
			</svg>

			<div className="absolute top-[45%] left-[40%] z-10 -translate-x-1/2 -translate-y-1/2">
				<div className="relative grid size-24 place-items-center rounded-md border border-white/15 bg-[#15171b] shadow-[0_24px_70px_rgba(0,0,0,0.55)]">
					<div className="absolute inset-2 rounded-md border border-white/[0.06]" />
					<CenterAgentMark />
					<span className="absolute -bottom-7 whitespace-nowrap font-medium text-[11px] text-white/55 uppercase tracking-[0.14em]">
						Center Agent
					</span>
				</div>
			</div>

			<div className="absolute right-7 bottom-7 left-7 z-20 rounded-md border border-white/10 bg-[#111318]/95 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.42)]">
				<div className="flex gap-3">
					<AppLogo app={SLACK_CHANNEL_IDENTITY} size="sm" />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<p className="font-medium text-white/85 text-xs">Maya</p>
							<span className="text-[10px] text-white/30">#shipping</span>
						</div>
						<p className="mt-1 text-sm text-white/72 leading-6">
							<span className="text-[#8da7ff]">@Center Agent</span> summarize
							the release risk and ask Codex to fix the flaky test.
						</p>
					</div>
				</div>
			</div>

			<div className="absolute top-7 right-7 z-20 w-[40%] min-w-52 max-w-60 rounded-md border border-white/10 bg-[#111318]/95 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.42)]">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2.5">
						<AppLogo app={GITHUB_PLUGIN} size="sm" />
						<p className="font-medium text-white/80 text-xs">Release review</p>
					</div>
					<GitPullRequestIcon className="size-4 text-white/30" />
				</div>
				<div className="mt-4 space-y-2.5">
					<ResultLine label="Risk checked" />
					<ResultLine label="Test fixed by Codex" />
					<ResultLine label="Reply sent to Slack" />
				</div>
			</div>
		</OnboardingDemoLayout>
	);
}

function ResultLine(input: { label: string }) {
	return (
		<div className="flex items-center gap-2.5">
			<span className="grid size-4 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
				<CheckIcon className="size-2.5" weight="bold" />
			</span>
			<span className="text-[11px] text-white/50">{input.label}</span>
		</div>
	);
}
