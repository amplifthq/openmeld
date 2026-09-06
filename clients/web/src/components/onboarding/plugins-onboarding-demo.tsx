"use client";

import { CheckIcon, GitPullRequestIcon } from "@phosphor-icons/react";
import { AppLogo } from "#/components/organizations/app-logo";
import {
	findPluginDefinition,
	GITHUB_PLUGIN,
} from "#/components/organizations/plugin-catalog";
import {
	CenterAgentMark,
	OnboardingDemoLayout,
} from "./onboarding-demo-layout";

const GOOGLE_DRIVE_APP = findPluginDefinition("googledrive");
const NOTION_APP = findPluginDefinition("notion");
const APP_FLOW_PATHS = [
	"M192 62 C 222 62, 220 202, 244 216",
	"M192 134 C 220 134, 220 232, 244 232",
	"M192 206 C 222 206, 220 262, 244 248",
	"M350 232 C 364 232, 374 232, 386 232",
] as const;

export function PluginsOnboardingDemo() {
	return (
		<OnboardingDemoLayout
			eyebrow="Shared context"
			title="Your tools become part of the work."
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0 h-full w-full"
				fill="none"
				viewBox="0 0 600 464"
			>
				<defs>
					<filter
						height="300%"
						id="apps-flow-glow"
						width="300%"
						x="-100%"
						y="-100%"
					>
						<feGaussianBlur stdDeviation="4" />
					</filter>
				</defs>
				{APP_FLOW_PATHS.map((path, index) => (
					<g key={path}>
						<path
							d={path}
							stroke="#fff"
							strokeDasharray="3 7"
							strokeOpacity=".25"
							strokeWidth="1.5"
						/>
						<circle
							className="motion-reduce:hidden"
							fill="#fff"
							filter="url(#apps-flow-glow)"
							r="2.8"
						>
							<animateMotion
								begin={`${index * -0.9}s`}
								dur="3.8s"
								path={path}
								repeatCount="indefinite"
							/>
						</circle>
					</g>
				))}
			</svg>

			<div className="absolute top-7 left-7 space-y-3">
				<AppSource app={GITHUB_PLUGIN} label="Repositories" />
				{GOOGLE_DRIVE_APP ? (
					<AppSource app={GOOGLE_DRIVE_APP} label="Documents" />
				) : null}
				{NOTION_APP ? (
					<AppSource app={NOTION_APP} label="Team knowledge" />
				) : null}
			</div>

			<div className="absolute top-1/2 left-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md border border-white/15 bg-[#15171b] shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
				<span className="absolute inset-2 rounded-md border border-white/[0.06]" />
				<CenterAgentMark />
				<span className="absolute -bottom-7 whitespace-nowrap font-medium text-[10px] text-white/45 uppercase tracking-[0.15em]">
					Center Agent
				</span>
			</div>

			<div className="absolute top-1/2 right-7 w-44 -translate-y-1/2 rounded-md border border-white/10 bg-[#111318]/95 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.42)]">
				<div className="flex items-center gap-2.5">
					<GitPullRequestIcon className="size-4 text-white/50" />
					<p className="font-medium text-white/75 text-xs">Ship the fix</p>
				</div>
				<div className="mt-4 space-y-2.5">
					<ResultLine label="Found the release brief" />
					<ResultLine label="Checked the repository" />
					<ResultLine label="Opened the pull request" />
				</div>
			</div>
		</OnboardingDemoLayout>
	);
}

function AppSource(input: {
	app: NonNullable<ReturnType<typeof findPluginDefinition>>;
	label: string;
}) {
	return (
		<div className="flex w-36 items-center gap-3 rounded-md border border-white/10 bg-[#111318]/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.38)]">
			<AppLogo app={input.app} size="sm" />
			<div className="min-w-0">
				<p className="truncate font-medium text-white/72 text-xs">
					{input.app.name}
				</p>
				<p className="mt-1 truncate text-[9px] text-white/32">{input.label}</p>
			</div>
		</div>
	);
}

function ResultLine(input: { label: string }) {
	return (
		<div className="flex items-center gap-2">
			<span className="grid size-4 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
				<CheckIcon className="size-2.5" weight="bold" />
			</span>
			<span className="text-[10px] text-white/42">{input.label}</span>
		</div>
	);
}
