"use client";

import type { ReactNode } from "react";

export function OnboardingDemoLayout(input: {
	children: ReactNode;
	eyebrow: string;
	headerAside?: ReactNode;
	stageClassName?: string;
	title: string;
}) {
	return (
		<div className="w-full max-w-[38rem]">
			<div className="mb-7 flex items-end justify-between gap-8">
				<div>
					<p className="text-white/45 text-xs uppercase tracking-[0.18em]">
						{input.eyebrow}
					</p>
					<p className="mt-2 max-w-md text-pretty font-medium text-2xl text-white tracking-[-0.025em]">
						{input.title}
					</p>
				</div>
				{input.headerAside}
			</div>

			<div
				className={`relative h-[29rem] overflow-hidden rounded-md border border-white/10 bg-[#0f1114] shadow-[0_36px_100px_rgba(0,0,0,0.42)] ${input.stageClassName ?? ""}`}
			>
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(255,255,255,0.055),transparent_54%)]" />
				{input.children}
			</div>
		</div>
	);
}

export function CenterAgentMark(input: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={input.className ?? "size-11 text-white/85"}
			fill="none"
			viewBox="0 0 48 48"
		>
			<path
				d="M24 5.5 40 14.75v18.5L24 42.5 8 33.25v-18.5L24 5.5Z"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<path
				d="M16 20.5 24 16l8 4.5v8L24 33l-8-4.5v-8Z"
				fill="currentColor"
				fillOpacity="0.14"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<circle cx="24" cy="24.5" fill="currentColor" r="2.5" />
		</svg>
	);
}

export function OpenMeldMark(input: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={input.className ?? "size-6 text-white/85"}
			fill="none"
			viewBox="0 0 24 24"
		>
			<path
				d="M4 6.5 8 17l4-10.5L16 17l4-10.5"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.6"
			/>
		</svg>
	);
}
