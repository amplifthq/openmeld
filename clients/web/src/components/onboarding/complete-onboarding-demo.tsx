"use client";

import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	ChatCircleDotsIcon,
	CheckIcon,
	CodeIcon,
	PlugIcon,
	PlusIcon,
	UserIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { AppLogo } from "#/components/organizations/app-logo";
import {
	LARK_CHANNEL_IDENTITY,
	PLUGINS,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/plugin-catalog";
import type { CompleteOnboardingState } from "./complete-onboarding-state";
import { OnboardingDemoLayout, OpenMeldMark } from "./onboarding-demo-layout";

const COMPLETE_FLOW_PATHS = [
	{ path: "M224 96 C 224 140, 236 160, 236 200", teamOnly: false },
	{ path: "M376 96 C 376 140, 364 160, 364 200", teamOnly: true },
	{ path: "M224 368 C 224 328, 236 304, 236 264", teamOnly: false },
	{ path: "M376 368 C 376 328, 364 304, 364 264", teamOnly: false },
] as const;

export function CompleteOnboardingDemo(input: {
	state: CompleteOnboardingState;
}) {
	const channelLabel =
		input.state.channelNames.length > 0
			? formatDemoNames(input.state.channelNames)
			: "Channels";
	const appLabel =
		input.state.appNames.length > 0
			? formatDemoNames(input.state.appNames)
			: "Plugins";
	const localAgentLabel =
		input.state.localAgentNames.length > 0
			? formatDemoNames(input.state.localAgentNames)
			: (input.state.computerName ?? "Local agent computer");
	const hasChannel = input.state.channelNames.length > 0;
	const hasApp = input.state.appNames.length > 0;
	const hasComputer = input.state.computerName !== null;
	const hasLocalAgent = input.state.localAgentNames.length > 0;
	const visibleFlowPaths = COMPLETE_FLOW_PATHS.filter(
		(flow) => !(input.state.isPersonal && flow.teamOnly)
	);

	return (
		<OnboardingDemoLayout
			eyebrow="Ready"
			title={resolveCompleteDemoTitle({
				hasApp,
				hasComputer,
				hasLocalAgent,
				isPersonal: input.state.isPersonal,
			})}
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0 h-full w-full"
				fill="none"
				viewBox="0 0 600 464"
			>
				<defs>
					<linearGradient id="complete-loop" x1="224" x2="376" y1="96" y2="368">
						<stop stopColor="#fff" stopOpacity="0.05" />
						<stop offset="0.5" stopColor="#fff" stopOpacity="0.38" />
						<stop offset="1" stopColor="#fff" stopOpacity="0.05" />
					</linearGradient>
					<filter
						height="300%"
						id="complete-loop-glow"
						width="300%"
						x="-100%"
						y="-100%"
					>
						<feGaussianBlur stdDeviation="4" />
					</filter>
				</defs>
				{visibleFlowPaths.map((flow, index) => (
					<g key={flow.path}>
						<path
							d={flow.path}
							stroke="url(#complete-loop)"
							strokeDasharray="3 7"
							strokeWidth="1.5"
						/>
						<circle
							className="motion-reduce:hidden"
							fill="#fff"
							filter="url(#complete-loop-glow)"
							r="2.8"
						>
							<animateMotion
								begin={`${index * -0.9}s`}
								dur="3.8s"
								path={flow.path}
								repeatCount="indefinite"
							/>
						</circle>
					</g>
				))}
			</svg>

			<div className="absolute top-8 left-8">
				<LoopNode
					connected
					icon={input.state.isPersonal ? <UserIcon /> : <UsersThreeIcon />}
					label={input.state.isPersonal ? "You" : "Your team"}
					status={
						!input.state.isPersonal && input.state.invitationCount > 0
							? `${input.state.invitationCount} invited`
							: "Ready"
					}
				/>
			</div>
			{input.state.isPersonal ? null : (
				<div className="absolute top-8 right-8">
					<LoopNode
						connected={hasChannel}
						icon={<ChannelIcon name={input.state.channelNames[0]} />}
						label={channelLabel}
						status={hasChannel ? "Connected" : "Add when ready"}
					/>
				</div>
			)}
			<div className="absolute right-8 bottom-8">
				<LoopNode
					connected={hasApp}
					icon={<ConnectedAppIcon name={input.state.appNames[0]} />}
					label={appLabel}
					status={hasApp ? "Context ready" : "Add when ready"}
				/>
			</div>
			<div className="absolute bottom-8 left-8">
				<LoopNode
					connected={hasComputer}
					icon={
						<LocalAgentIcons
							agentNames={input.state.localAgentNames}
							hasComputer={hasComputer}
						/>
					}
					label={localAgentLabel}
					status={resolveLocalAgentStatus({ hasComputer, hasLocalAgent })}
				/>
			</div>

			<div className="absolute top-1/2 left-1/2 grid size-32 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md border border-white/15 bg-[#15171b] shadow-[0_34px_90px_rgba(0,0,0,0.58)]">
				<span className="absolute inset-2 rounded-md border border-white/[0.06]" />
				<div className="flex flex-col items-center text-white/75">
					<span className="grid size-10 place-items-center rounded-md border border-white/12">
						<OpenMeldMark />
					</span>
					<span className="mt-2 text-[9px] text-white/42 uppercase tracking-[0.14em]">
						OpenMeld
					</span>
				</div>
			</div>
		</OnboardingDemoLayout>
	);
}

function resolveCompleteDemoTitle(input: {
	hasApp: boolean;
	hasComputer: boolean;
	hasLocalAgent: boolean;
	isPersonal: boolean;
}): string {
	if (!input.isPersonal) {
		return "Your team can ask. OpenMeld gets it done.";
	}
	if (input.hasApp && input.hasLocalAgent) {
		return "Your apps and agents are ready.";
	}
	if (input.hasApp) {
		return "Your apps are connected.";
	}
	if (input.hasLocalAgent) {
		return "Your local agents are ready.";
	}
	if (input.hasComputer) {
		return "Your computer is connected.";
	}
	return "Your personal workspace is ready.";
}

function resolveLocalAgentStatus(input: {
	hasComputer: boolean;
	hasLocalAgent: boolean;
}): string {
	if (input.hasLocalAgent) {
		return "Ready";
	}
	return input.hasComputer ? "Computer connected" : "Connect when ready";
}

function ChannelIcon(input: { name: string | undefined }) {
	if (input.name === "Slack") {
		return <AppLogo app={SLACK_CHANNEL_IDENTITY} size="sm" />;
	}
	if (input.name === "Lark" || input.name === "Feishu") {
		return <AppLogo app={LARK_CHANNEL_IDENTITY} size="sm" />;
	}
	return <ChatCircleDotsIcon />;
}

function ConnectedAppIcon(input: { name: string | undefined }) {
	const app = PLUGINS.find((candidate) => candidate.name === input.name);
	if (app) {
		return <AppLogo app={app} size="sm" />;
	}
	return <PlugIcon />;
}

function LocalAgentIcons(input: {
	agentNames: string[];
	hasComputer: boolean;
}) {
	const agentIds = input.agentNames
		.map(resolveLocalAgentId)
		.filter((agentId): agentId is string => agentId !== null)
		.slice(0, 2);
	if (agentIds.length === 0 && input.hasComputer) {
		return <CodeIcon />;
	}
	const visibleAgentIds =
		agentIds.length > 0 ? agentIds : ["builtin:codex", "builtin:claude-code"];
	return (
		<span className="flex items-center -space-x-1 text-white/70">
			{visibleAgentIds.map((agentId) => (
				<span
					className="grid size-7 place-items-center rounded-md border border-white/10 bg-[#17191d]"
					key={agentId}
				>
					<LocalAgentLogo
						agentId={agentId}
						className="size-[15px]"
						size="xs"
						variant="plain"
					/>
				</span>
			))}
		</span>
	);
}

function resolveLocalAgentId(name: string): string | null {
	const normalized = name.trim().toLowerCase();
	if (normalized === "codex") {
		return "builtin:codex";
	}
	if (normalized === "claude code" || normalized === "claude-code") {
		return "builtin:claude-code";
	}
	if (normalized === "cursor") {
		return "builtin:cursor";
	}
	if (normalized === "grok" || normalized === "grok build") {
		return "builtin:grok-build";
	}
	if (normalized === "opencode" || normalized === "open code") {
		return "builtin:opencode";
	}
	return null;
}

function formatDemoNames(names: readonly string[]): string {
	return names.slice(0, 2).join(" + ");
}

function LoopNode(input: {
	connected: boolean;
	icon: ReactNode;
	label: string;
	status: string;
}) {
	return (
		<div className="flex h-16 w-48 items-center gap-3 rounded-md border border-white/10 bg-[#111318]/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
			<span className="flex min-h-9 min-w-9 shrink-0 items-center justify-center text-white/55 [&_svg:not([class*='size-'])]:size-4">
				{input.icon}
			</span>
			<div className="min-w-0">
				<p className="truncate font-medium text-[11px] text-white/72">
					{input.label}
				</p>
				<p
					className={
						input.connected
							? "mt-1 flex items-center gap-1 text-[9px] text-emerald-300/70"
							: "mt-1 flex items-center gap-1 text-[9px] text-white/35"
					}
				>
					{input.connected ? (
						<CheckIcon className="size-2.5" weight="bold" />
					) : (
						<PlusIcon className="size-2.5" weight="bold" />
					)}
					{input.status}
				</p>
			</div>
		</div>
	);
}
