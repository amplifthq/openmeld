import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import { resolveStatusToneRingIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CaretRightIcon,
	DesktopTowerIcon,
	RobotIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import {
	resolveDirectoryComputerStatusTone,
	resolveDirectoryComputerToneClassName,
	resolveDirectoryIdentityAccountLabel,
} from "#/components/directory/directory-human-profile-format";
import type {
	DirectoryAgentProfileSummary,
	DirectoryHumanProfileRow,
	DirectoryIdentityAccount,
} from "#/components/directory/directory-human-profile-model";
import {
	FEISHU_CHANNEL_IDENTITY,
	LARK_CHANNEL_IDENTITY,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/app-catalog";
import { AppLogo } from "#/components/organizations/app-logo";

export function DirectoryComputerSummary(input: {
	member: DirectoryHumanProfileRow;
	size?: "card" | "detail";
}) {
	if (input.size === "detail") {
		return <DirectoryComputerDetailSummary member={input.member} />;
	}
	const content = (
		<>
			<DesktopTowerIcon
				aria-hidden="true"
				className={cn(
					"size-4",
					"shrink-0",
					resolveDirectoryComputerToneClassName(input.member.computer.state)
				)}
			/>
			<span>{input.member.computer.label}</span>
		</>
	);
	const className = cn("inline-flex min-w-0 items-center gap-2", "text-xs");
	if (!input.member.computer.path) {
		return (
			<div className={cn(className, "text-muted-foreground")}>{content}</div>
		);
	}
	return (
		<Link
			aria-label={`${input.member.name}: ${input.member.computer.label}`}
			className={cn(
				className,
				"transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
			)}
			to={input.member.computer.path}
		>
			{content}
		</Link>
	);
}

function DirectoryComputerDetailSummary(input: {
	member: DirectoryHumanProfileRow;
}) {
	const computer = input.member.computer;
	const showStatusIndicator =
		computer.count > 0 ||
		computer.state === "checking" ||
		computer.state === "unknown";
	const content = (
		<>
			<DesktopTowerIcon
				aria-hidden="true"
				className="size-5 shrink-0 text-muted-foreground"
			/>
			<span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
				{showStatusIndicator ? (
					<span
						aria-hidden="true"
						className={cn(
							"size-2 shrink-0 rounded-full ring-2",
							resolveStatusToneRingIndicatorClassName(
								resolveDirectoryComputerStatusTone(computer.state)
							)
						)}
						data-testid="human-profile-computer-status"
					/>
				) : null}
				<span className="min-w-0 break-words">{computer.label}</span>
			</span>
			{computer.path ? (
				<CaretRightIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
			) : null}
		</>
	);
	const className =
		"flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-3 text-left";
	if (!computer.path) {
		return <div className={className}>{content}</div>;
	}
	return (
		<Link
			aria-label={`Open ${input.member.name}'s computer details: ${computer.label}`}
			className={cn(
				className,
				"hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset"
			)}
			to={computer.path}
		>
			{content}
		</Link>
	);
}

const MAX_VISIBLE_AGENT_PROFILES = 3;

export function DirectoryAgentProfilesSummary(input: {
	profiles: readonly DirectoryAgentProfileSummary[];
}) {
	const visibleProfiles = input.profiles.slice(0, MAX_VISIBLE_AGENT_PROFILES);
	const overflowCount = input.profiles.length - visibleProfiles.length;
	return (
		<div className="flex min-h-14 min-w-0 items-center justify-between gap-4 px-4 py-3">
			<div className="flex min-w-0 items-center -space-x-2">
				{visibleProfiles.length > 0 ? (
					visibleProfiles.map((profile) => (
						<AgentProfileSummaryIcon key={profile.id} profile={profile} />
					))
				) : (
					<span
						aria-hidden="true"
						className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground ring-2 ring-background"
					>
						<RobotIcon className="size-4" />
					</span>
				)}
				{overflowCount > 0 ? (
					<span className="grid size-8 place-items-center rounded-full bg-muted font-medium text-muted-foreground text-xs ring-2 ring-background">
						+{overflowCount}
					</span>
				) : null}
			</div>
			<p className="shrink-0 text-sm">
				{formatAgentProfileCount(input.profiles.length)}
			</p>
		</div>
	);
}

function AgentProfileSummaryIcon(input: {
	profile: DirectoryAgentProfileSummary;
}) {
	return (
		<span
			aria-label={input.profile.name}
			className="grid size-8 place-items-center overflow-hidden rounded-full bg-muted ring-2 ring-background"
			data-testid="agent-profile-summary-icon"
			role="img"
			title={input.profile.name}
		>
			{input.profile.agentId && hasLocalAgentLogo(input.profile.agentId) ? (
				<LocalAgentLogo agentId={input.profile.agentId} size="sm" />
			) : (
				<RobotIcon
					aria-hidden="true"
					className="size-4 text-muted-foreground"
				/>
			)}
		</span>
	);
}

function formatAgentProfileCount(count: number): string {
	return `${count} Agent ${count === 1 ? "Profile" : "Profiles"}`;
}

export function DirectoryIdentityLogo(input: {
	account: Pick<DirectoryIdentityAccount, "provider" | "providerLabel">;
	className?: string;
	muted?: boolean;
	size?: "sm" | "md";
}) {
	return (
		<span aria-label={input.account.providerLabel} role="img">
			<AppLogo
				app={resolveChannelIdentity(input.account.provider)}
				className={input.className}
				muted={input.muted}
				size={input.size ?? "sm"}
			/>
		</span>
	);
}

export function DirectoryIdentityAccountSummary(input: {
	account: DirectoryIdentityAccount;
	context: "card" | "detail";
}) {
	const label = resolveDirectoryIdentityAccountLabel(input.account);
	const showLabel =
		input.context === "detail" || input.account.state !== "not_connected";
	return (
		<div className="inline-flex min-w-0 items-center gap-2">
			<DirectoryIdentityLogo
				account={input.account}
				className={input.context === "card" ? "size-5 rounded-sm" : undefined}
				muted={input.account.state !== "connected"}
				size={input.context === "card" ? "sm" : "md"}
			/>
			{showLabel ? (
				<span
					className={cn(
						"min-w-0 break-all",
						input.context === "detail" ? "text-sm" : "text-xs",
						input.account.state === "unavailable"
							? "text-amber-600 dark:text-amber-400"
							: "text-muted-foreground"
					)}
				>
					{label}
				</span>
			) : null}
		</div>
	);
}

function resolveChannelIdentity(
	provider: DirectoryIdentityAccount["provider"]
) {
	switch (provider) {
		case "slack":
			return SLACK_CHANNEL_IDENTITY;
		case "lark":
			return LARK_CHANNEL_IDENTITY;
		case "feishu":
			return FEISHU_CHANNEL_IDENTITY;
		default:
			throw new Error(`Unsupported Message Channel provider: ${provider}`);
	}
}
