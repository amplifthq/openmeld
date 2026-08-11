"use client";

import { CheckIcon, LinkIcon, UserPlusIcon } from "@phosphor-icons/react";
import { OnboardingDemoLayout } from "./onboarding-demo-layout";

const PEOPLE = [
	{ initials: "MY", name: "Maya", position: "top-8 left-8" },
	{ initials: "AL", name: "Alex", position: "top-8 right-8" },
	{ initials: "JO", name: "Jordan", position: "bottom-8 left-8" },
] as const;
const INVITE_FLOW_PATHS = [
	"M244 216 C 220 202, 210 60, 188 60",
	"M356 216 C 380 202, 390 60, 412 60",
	"M244 248 C 220 266, 210 404, 188 404",
	"M356 248 C 372 268, 364 404, 380 404",
] as const;

export function InviteOnboardingDemo() {
	return (
		<OnboardingDemoLayout
			eyebrow="One team"
			title="Everyone joins the same loop."
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
						id="invite-flow-glow"
						width="300%"
						x="-100%"
						y="-100%"
					>
						<feGaussianBlur stdDeviation="4" />
					</filter>
				</defs>
				{INVITE_FLOW_PATHS.map((path, index) => (
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
							filter="url(#invite-flow-glow)"
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

			{PEOPLE.map((person) => (
				<div
					className={`absolute flex w-40 items-center gap-3 rounded-md border border-white/10 bg-[#111318]/95 p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.38)] ${person.position}`}
					key={person.name}
				>
					<span className="grid size-9 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.06] font-medium text-[10px] text-white/65">
						{person.initials}
					</span>
					<div className="min-w-0">
						<p className="truncate font-medium text-white/72 text-xs">
							{person.name}
						</p>
						<p className="mt-1 flex items-center gap-1 text-[9px] text-emerald-300/70">
							<CheckIcon className="size-2.5" weight="bold" />
							Invited
						</p>
					</div>
				</div>
			))}

			<div className="absolute top-1/2 left-1/2 grid size-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md border border-white/15 bg-[#15171b] shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
				<span className="absolute inset-2 rounded-md border border-white/[0.06]" />
				<UserPlusIcon className="size-9 text-white/80" weight="duotone" />
				<span className="absolute -bottom-7 whitespace-nowrap font-medium text-[10px] text-white/45 uppercase tracking-[0.15em]">
					Your organization
				</span>
			</div>

			<div className="absolute right-8 bottom-8 flex w-48 items-center gap-3 rounded-md border border-white/10 bg-[#111318]/95 p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.38)]">
				<span className="grid size-9 shrink-0 place-items-center rounded-md bg-white/[0.06] text-white/55">
					<LinkIcon className="size-4" />
				</span>
				<div>
					<p className="font-medium text-white/70 text-xs">Invite link</p>
					<p className="mt-1 text-[9px] text-white/32">Ready to share</p>
				</div>
			</div>
		</OnboardingDemoLayout>
	);
}
