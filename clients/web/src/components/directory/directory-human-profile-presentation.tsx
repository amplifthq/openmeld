import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type { ModelCatalog } from "@openmeld/schemas/types";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretRightIcon, DesktopTowerIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import {
	resolveDirectoryComputerStatusTone,
	resolveDirectoryComputerToneClassName,
	resolveDirectoryIdentityAccountCardLabel,
	resolveDirectoryIdentityAccountLabel,
} from "#/components/directory/directory-human-profile-format";
import type {
	DirectoryAgentProfileSummary,
	DirectoryHumanProfileComputer,
	DirectoryHumanProfileRow,
	DirectoryIdentityAccount,
	DirectoryProjectionStatus,
} from "#/components/directory/directory-human-profile-model";
import { AppLogo } from "#/components/organizations/app-logo";
import {
	FEISHU_CHANNEL_IDENTITY,
	LARK_CHANNEL_IDENTITY,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/plugin-catalog";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { resolveAgentProfileControllerModelDetail } from "#/lib/profiles/agent-profile-model-display";

export function DirectoryComputerSummary(input: {
	interactive?: boolean;
	member: DirectoryHumanProfileRow;
	size?: "card" | "detail";
}) {
	if (input.size === "detail") {
		return <DirectoryComputerDetailSummary member={input.member} />;
	}
	return (
		<DirectoryHumanProfileComputerSummary
			computer={input.member.computer}
			interactive={input.interactive}
			ownerName={input.member.name}
		/>
	);
}

export function DirectoryHumanProfileComputerSummary(input: {
	computer: DirectoryHumanProfileComputer;
	interactive?: boolean;
	ownerName: string;
}) {
	const content = (
		<>
			<DesktopTowerIcon
				aria-hidden="true"
				className={cn(
					"size-4",
					"shrink-0",
					resolveDirectoryComputerToneClassName(input.computer.state)
				)}
			/>
			<span className="truncate">{input.computer.label}</span>
		</>
	);
	const className = cn("inline-flex min-w-0 items-center gap-2", "text-xs");
	if (input.interactive === false || !input.computer.path) {
		return (
			<span className={cn(className, "text-muted-foreground")}>{content}</span>
		);
	}
	return (
		<Link
			aria-label={`${input.ownerName}: ${input.computer.label}`}
			className={cn(
				className,
				"touch-manipulation transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 max-lg:min-h-11"
			)}
			to={input.computer.path}
		>
			{content}
		</Link>
	);
}

export function DirectoryComputerStatusIcon(input: {
	member: DirectoryHumanProfileRow;
}) {
	const label = input.member.computer.label;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						aria-label={label}
						className="inline-flex shrink-0 items-center justify-center"
						data-slot="human-profile-computer-status"
						role="img"
					/>
				}
			>
				<DesktopTowerIcon
					aria-hidden="true"
					className={cn(
						"size-3.5 shrink-0",
						resolveDirectoryComputerToneClassName(input.member.computer.state)
					)}
				/>
			</TooltipTrigger>
			<TooltipContent side="top">{label}</TooltipContent>
		</Tooltip>
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
							"status-dot",
							resolveStatusToneIndicatorClassName(
								resolveDirectoryComputerStatusTone(computer.state),
								"quiet"
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

export function DirectoryAgentProfilesSummary(input: {
	modelCatalog: ModelCatalog | null;
	ownerName: string;
	path?: string;
	profiles: readonly DirectoryAgentProfileSummary[];
	status?: DirectoryProjectionStatus;
	variant?: "detail" | "popover";
	manage?: boolean;
}) {
	const status = input.status ?? "ready";
	const isPopover = input.variant === "popover";
	const detailLinkLabel = input.manage ? "Manage Agents" : "All Agents";
	if (isPopover && (status !== "ready" || input.profiles.length === 0)) {
		return null;
	}
	const visibleProfiles = isPopover
		? input.profiles.slice(0, 5)
		: input.profiles;
	const showViewAll =
		Boolean(input.path) &&
		(!isPopover || input.profiles.length > visibleProfiles.length);
	const countLabel =
		isPopover && input.profiles.length > visibleProfiles.length
			? `${visibleProfiles.length} of ${input.profiles.length}`
			: `${input.profiles.length}`;
	return (
		<section className="min-w-0 space-y-2">
			<div className="flex min-w-0 items-center justify-between gap-4">
				<div className="flex min-w-0 items-baseline gap-2">
					<h3 className="font-medium text-muted-foreground text-xs">Agents</h3>
					{status === "ready" ? (
						<span className="text-muted-foreground text-xs">{countLabel}</span>
					) : null}
				</div>
				{showViewAll && input.path ? (
					<DirectoryAgentsViewAllLink
						label={isPopover ? "View all" : detailLinkLabel}
						ownerName={input.ownerName}
						path={input.path}
					/>
				) : null}
			</div>
			<DirectoryAgentProfilesContent
				modelCatalog={input.modelCatalog}
				ownerName={input.ownerName}
				profiles={visibleProfiles}
				status={status}
				variant={input.variant}
			/>
		</section>
	);
}

function DirectoryAgentProfilesContent(input: {
	modelCatalog: ModelCatalog | null;
	ownerName: string;
	profiles: readonly DirectoryAgentProfileSummary[];
	status: DirectoryProjectionStatus;
	variant?: "detail" | "popover";
}) {
	if (input.status === "loading") {
		return <DirectoryAgentProfilesLoading />;
	}
	if (input.status === "failed") {
		return (
			<p className="rounded-md border border-border px-3 py-3 text-muted-foreground text-xs">
				Agents unavailable
			</p>
		);
	}
	if (input.profiles.length === 0) {
		return (
			<p className="rounded-md border border-border px-3 py-3 text-muted-foreground text-xs">
				No Agents yet
			</p>
		);
	}
	return (
		<ul
			aria-label={`${input.ownerName}'s Agents`}
			className="scrollbar-hide flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			{input.profiles.map((profile) => (
				<li className="shrink-0" key={profile.id}>
					<AgentProfileSummaryCard
						modelCatalog={input.modelCatalog}
						profile={profile}
						variant={input.variant}
					/>
				</li>
			))}
		</ul>
	);
}

function DirectoryAgentsViewAllLink(input: {
	label?: string;
	ownerName: string;
	path: string;
}) {
	return (
		<Link
			aria-label={`View all of ${input.ownerName}'s Agents`}
			className="inline-flex shrink-0 items-center gap-1 rounded-sm text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
			to={input.path}
		>
			{input.label ?? "All Agents"}
			<CaretRightIcon aria-hidden="true" className="size-3.5" />
		</Link>
	);
}

function DirectoryAgentProfilesLoading() {
	return (
		<output
			aria-label="Loading Agents"
			className="flex min-w-0 gap-2 overflow-hidden"
		>
			{[0, 1].map((index) => (
				<div
					className="h-[3.625rem] w-44 shrink-0 rounded-md border border-border bg-muted/35"
					key={index}
				/>
			))}
		</output>
	);
}

function AgentProfileSummaryCard(input: {
	modelCatalog: ModelCatalog | null;
	profile: DirectoryAgentProfileSummary;
	variant?: "detail" | "popover";
}) {
	const parsedControllerRef = parseAgentControllerRef(
		input.profile.agentControllerRef
	);
	const controllerDisplayName = parsedControllerRef
		? formatLocalAgentDisplayName(parsedControllerRef.id)
		: null;
	const controllerModelDetail = input.profile.modelSelectionIsKnown
		? resolveAgentProfileControllerModelDetail({
				agentControllerRef: input.profile.agentControllerRef,
				controllerDisplayName,
				modelCatalog: input.modelCatalog,
				modelSelection: input.profile.modelSelection,
			})
		: controllerDisplayName;
	return (
		<Link
			aria-label={`Open ${input.profile.name}`}
			className={cn(
				"flex shrink-0 items-center gap-3 rounded-md border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
				input.variant === "popover" ? "w-44" : "w-60"
			)}
			to={input.profile.path}
		>
			<AgentProfileSummaryAvatar profile={input.profile} />
			<span className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
				<span className="truncate font-medium text-sm">
					{input.profile.name}
				</span>
				{controllerModelDetail ? (
					<span className="truncate text-muted-foreground text-xs">
						{controllerModelDetail}
					</span>
				) : null}
			</span>
		</Link>
	);
}

function AgentProfileSummaryAvatar(input: {
	profile: DirectoryAgentProfileSummary;
}) {
	if (input.profile.avatarImageUrl) {
		return (
			<img
				alt=""
				className="size-8 shrink-0 rounded-lg object-cover"
				data-testid="agent-profile-summary-avatar"
				height={32}
				referrerPolicy="no-referrer"
				src={input.profile.avatarImageUrl}
				width={32}
			/>
		);
	}
	return (
		<AgentProfileControllerAvatar
			agentControllerRef={input.profile.agentControllerRef}
			profileId={input.profile.id}
			size={32}
		/>
	);
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
	context: "card" | "detail" | "sidebar";
}) {
	const label =
		input.context === "detail"
			? resolveDirectoryIdentityAccountLabel(input.account)
			: resolveDirectoryIdentityAccountCardLabel(input.account);
	return (
		<span
			className={cn(
				"inline-flex min-w-0 items-center",
				input.context === "sidebar" ? "max-w-full gap-1.5" : "gap-2"
			)}
		>
			<DirectoryIdentityLogo
				account={input.account}
				className={cn(
					input.context === "card" ? "size-5 rounded-sm" : null,
					input.context === "sidebar"
						? "size-3 rounded-[3px] border-0 bg-transparent p-0 shadow-none"
						: null
				)}
				muted={input.account.state !== "connected"}
				size={input.context === "card" ? "sm" : "md"}
			/>
			{label ? (
				<span
					className={cn(
						"min-w-0 text-muted-foreground",
						input.context === "detail" ? "select-text break-all text-sm" : null,
						input.context === "card" ? "select-text break-all text-xs" : null,
						input.context === "sidebar" ? "truncate text-xs" : null
					)}
					title={input.context === "sidebar" ? label : undefined}
				>
					{label}
				</span>
			) : null}
		</span>
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
