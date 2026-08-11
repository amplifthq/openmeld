"use client";

import {
	BrainIcon,
	FileTextIcon,
	ShieldCheckIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import {
	CenterAgentMark,
	OnboardingDemoLayout,
} from "./onboarding-demo-layout";

const SETUP_FLOW_PATHS = [
	"M220 70 C 236 70, 228 208, 244 216",
	"M380 70 C 364 70, 372 208, 356 216",
	"M220 390 C 236 390, 228 270, 244 248",
	"M356 248 C 372 270, 348 360, 364 360",
] as const;

export function SetupOnboardingDemo() {
	return (
		<OnboardingDemoLayout
			eyebrow="Useful by default"
			title="The right context. The right boundaries."
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
						id="setup-flow-glow"
						width="300%"
						x="-100%"
						y="-100%"
					>
						<feGaussianBlur stdDeviation="4" />
					</filter>
				</defs>
				{SETUP_FLOW_PATHS.map((path, index) => (
					<g key={path}>
						<path
							d={path}
							stroke="#fff"
							strokeDasharray="3 7"
							strokeOpacity=".24"
							strokeWidth="1.5"
						/>
						<circle
							className="motion-reduce:hidden"
							fill="#fff"
							filter="url(#setup-flow-glow)"
							r="2.6"
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

			<ContextCard
				className="top-7 left-7"
				description="Goals and operating context"
				icon={<FileTextIcon />}
				title="Organization brief"
			/>
			<ContextCard
				className="top-7 right-7"
				description="Useful shared context"
				icon={<BrainIcon />}
				title="Organization memory"
			/>
			<ContextCard
				className="bottom-7 left-7"
				description="Private-context guidance"
				icon={<ShieldCheckIcon />}
				title="Information protection"
			/>

			<div className="absolute top-1/2 left-1/2 grid size-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md border border-white/15 bg-[#15171b] shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
				<span className="absolute inset-2 rounded-md border border-white/[0.06]" />
				<CenterAgentMark />
				<span className="absolute -bottom-7 whitespace-nowrap font-medium text-[10px] text-white/45 uppercase tracking-[0.15em]">
					Center Agent
				</span>
			</div>

			<div className="absolute right-7 bottom-7 w-52 rounded-md border border-white/10 bg-[#111318]/95 p-4 shadow-[0_20px_55px_rgba(0,0,0,0.4)]">
				<p className="text-[10px] text-white/35 uppercase tracking-[0.14em]">
					Every response
				</p>
				<p className="mt-2 text-sm text-white/72 leading-6">
					Grounded in your team, governed by your team.
				</p>
			</div>
		</OnboardingDemoLayout>
	);
}

function ContextCard(input: {
	className: string;
	description: string;
	icon: ReactNode;
	title: string;
}) {
	return (
		<div
			className={`absolute w-48 rounded-md border border-white/10 bg-[#111318]/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.38)] ${input.className}`}
		>
			<div className="flex items-center gap-2.5 text-white/65">
				<span className="grid size-7 place-items-center rounded-md bg-white/[0.06] [&_svg]:size-3.5">
					{input.icon}
				</span>
				<p className="font-medium text-xs">{input.title}</p>
			</div>
			<p className="mt-2 text-[10px] text-white/32">{input.description}</p>
		</div>
	);
}
