"use client";

import { Popover } from "@base-ui/react/popover";
import {
	formatProfileKind,
	formatSpaceMemberActivityTime,
} from "@openmeld/agent-profile";
import type {
	AuthProfileView,
	ProfileDetailsField,
	ProfileDetailsRecoveryAction,
	ProfileDetailsSection,
	ProfileDetailsSectionId,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CaretDownIcon,
	ChatCircleTextIcon,
	CopyIcon,
	PencilSimpleIcon,
} from "@phosphor-icons/react";
import type { ReactElement, ReactNode } from "react";
import { toast } from "sonner";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { ProfileDetailsCurrentSession } from "#/components/profiles/profile-details-current-session";
import { ProfileDetailsRecoveryActionButton } from "#/components/profiles/profile-details-recovery-action-button";
import { resolveSpaceMemberInlineStatusTextClassName } from "#/components/spaces/space-member-status-tone";
import { SpaceProfileIcon } from "#/components/spaces/space-profile-icon";
import { copyTextToClipboard } from "#/lib/clipboard";

const AGENT_WORKSPACE_TECHNICAL_SECTION_IDS: ReadonlySet<ProfileDetailsSectionId> =
	new Set(["connection", "agent_controller_permission_mode", "advanced"]);

const AGENT_PROFILE_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	month: "short",
	timeZoneName: "short",
	year: "numeric",
});

export function AgentProfileMoreDetailsDialog(input: {
	agentProfile: AuthProfileView;
	details: ProfileDetailsSnapshot;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="flex max-h-[min(46rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-2xl">
				<DialogHeader className="shrink-0 pr-8">
					<DialogTitle>More details</DialogTitle>
					<DialogDescription>
						Profile ID and creation details.
					</DialogDescription>
				</DialogHeader>

				<AgentProfileMoreDetailsContent
					details={input.details}
					profile={input.agentProfile}
				/>
			</DialogContent>
		</Dialog>
	);
}

export function AgentProfileDetailsContent(input: {
	chatHref?: string;
	className?: string;
	details: ProfileDetailsSnapshot;
	entry: SpaceMemberDirectoryEntry;
	isDirectMessagePending?: boolean;
	isCenterAgent?: boolean;
	moreDetailsHref?: string;
	onOpenDirectMessage?: () => void;
}) {
	const canEdit = input.details.viewerScope === "owner_self";

	return (
		<div
			className={cn("min-h-0 flex-1 overflow-y-auto pr-1", input.className)}
			data-testid="profile-details-popover-scroll-area"
		>
			<AgentProfileDetailsHeader
				canEdit={canEdit}
				details={input.details}
				entry={input.entry}
				isCenterAgent={input.isCenterAgent === true}
				moreDetailsHref={input.moreDetailsHref}
				showAvailabilitySummary
			/>
			<AgentProfileDirectMessageAction
				href={input.chatHref}
				isPending={input.isDirectMessagePending === true}
				onOpen={input.onOpenDirectMessage}
				profileName={input.entry.profileName}
			/>
		</div>
	);
}

function AgentProfileDetailsHeader(input: {
	canEdit: boolean;
	details: ProfileDetailsSnapshot;
	entry: SpaceMemberDirectoryEntry;
	isCenterAgent: boolean;
	moreDetailsHref?: string;
	showAvailabilitySummary: boolean;
}) {
	const modelSummary =
		selectDetailsRows(input.details, ["model"])[0]?.value ??
		input.entry.controllerDisplayName ??
		"Agent";
	const presenceSummary = resolveAgentPresenceSummary(input.entry);
	const showAvailabilitySummary =
		input.showAvailabilitySummary &&
		input.entry.availabilitySummary &&
		input.entry.availabilitySummary !== presenceSummary;
	return (
		<div className="flex min-w-0 items-start gap-3">
			{input.isCenterAgent ? (
				<SpaceProfileIcon
					agentControllerRef={input.entry.agentControllerRef}
					isCenterAgent
					profileId={input.entry.profileId}
					profileKind="agent"
					profileName={input.entry.profileName}
					size="lg"
				/>
			) : (
				<AgentProfileControllerAvatar
					agentControllerRef={input.entry.agentControllerRef}
					profileId={input.entry.profileId}
					size={64}
				/>
			)}
			<div className="min-w-0 flex-1 pt-0.5">
				<p className="break-words font-semibold text-base text-foreground">
					{input.entry.profileName}
				</p>
				<p className="mt-1 break-words text-muted-foreground text-sm">
					{modelSummary}
				</p>
				{presenceSummary ? (
					<p
						className={cn(
							"mt-2 text-xs",
							resolveSpaceMemberInlineStatusTextClassName(input.entry)
						)}
					>
						{presenceSummary}
					</p>
				) : null}
				{showAvailabilitySummary ? (
					<p className="mt-1 text-muted-foreground text-xs">
						{input.entry.availabilitySummary}
					</p>
				) : null}
			</div>
			<AgentProfileDetailsAction
				canEdit={input.canEdit}
				href={input.moreDetailsHref}
				profileName={input.entry.profileName}
			/>
		</div>
	);
}

function AgentProfileDetailsAction(input: {
	canEdit: boolean;
	href?: string;
	profileName: string;
}) {
	if (!input.href) {
		return null;
	}
	if (!input.canEdit) {
		return null;
	}
	return (
		<a
			aria-label={`Edit ${input.profileName}`}
			className={cn(
				buttonVariants({ size: "icon-sm", variant: "ghost" }),
				"shrink-0"
			)}
			href={input.href}
		>
			<PencilSimpleIcon aria-hidden="true" />
		</a>
	);
}

function AgentProfileDirectMessageAction(input: {
	href?: string;
	isPending: boolean;
	onOpen?: () => void;
	profileName: string;
}) {
	if (!(input.href || input.onOpen)) {
		return null;
	}
	const content = (
		<>
			<ChatCircleTextIcon aria-hidden="true" className="size-4 shrink-0" />
			<span className="truncate">Chat with {input.profileName}</span>
		</>
	);
	if (input.href) {
		return (
			<a
				className={cn(
					buttonVariants({ size: "default", variant: "default" }),
					"mt-4 min-h-10 w-full min-w-0 justify-center px-4"
				)}
				href={input.href}
			>
				{content}
			</a>
		);
	}
	return (
		<Button
			className="mt-4 min-h-10 w-full min-w-0 justify-center px-4"
			disabled={input.isPending}
			onClick={input.onOpen}
			type="button"
			variant="default"
		>
			{content}
		</Button>
	);
}

export function AgentProfileDetailsPopover(input: {
	chatHref?: string;
	details: ProfileDetailsSnapshot;
	entry: SpaceMemberDirectoryEntry;
	isDirectMessagePending?: boolean;
	isCenterAgent?: boolean;
	moreDetailsHref?: string;
	onOpenDirectMessage?: () => void;
	trigger: ReactElement;
}) {
	return (
		<Popover.Root modal={false}>
			<Popover.Trigger render={input.trigger} />
			<Popover.Portal>
				<Popover.Positioner
					align="start"
					className="z-50"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "none",
						side: "flip",
					}}
					collisionPadding={12}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						aria-label={`${input.entry.profileName} Profile`}
						className="max-h-[var(--available-height)] w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl outline-none"
						role="dialog"
					>
						<AgentProfileDetailsContent
							chatHref={input.chatHref}
							className="max-h-[min(34rem,calc(var(--available-height)-2rem))]"
							details={input.details}
							entry={input.entry}
							isCenterAgent={input.isCenterAgent}
							isDirectMessagePending={input.isDirectMessagePending}
							moreDetailsHref={input.moreDetailsHref}
							onOpenDirectMessage={input.onOpenDirectMessage}
						/>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

export function HumanProfileDetailsPopover(input: {
	editHref?: string;
	entry: SpaceMemberDirectoryEntry;
	isDirectMessagePending?: boolean;
	onOpenDirectMessage?: () => void;
	trigger: ReactElement;
}) {
	const activityTime = input.entry.liveNow
		? "Now"
		: formatSpaceMemberActivityTime(input.entry.lastSeenLabel);
	return (
		<Popover.Root modal={false}>
			<Popover.Trigger render={input.trigger} />
			<Popover.Portal>
				<Popover.Positioner
					align="start"
					className="z-50"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "none",
						side: "flip",
					}}
					collisionPadding={12}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						aria-label={`${input.entry.profileName} Profile`}
						className="w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl outline-none"
						role="dialog"
					>
						<div className="flex min-w-0 items-start gap-3">
							<SpaceProfileIcon
								agentControllerRef={null}
								avatarImageUrl={input.entry.avatarUrl}
								profileId={input.entry.profileId}
								profileKind="human"
								profileName={input.entry.profileName}
								size="lg"
							/>
							<div className="min-w-0 flex-1 pt-0.5">
								<p className="break-words font-semibold text-base text-foreground">
									{input.entry.profileName}
								</p>
								{activityTime ? (
									<p className="mt-2 text-muted-foreground text-xs">
										{activityTime}
									</p>
								) : null}
							</div>
							{input.editHref ? (
								<a
									aria-label={`Edit ${input.entry.profileName}`}
									className={cn(
										buttonVariants({ size: "icon-sm", variant: "ghost" }),
										"shrink-0"
									)}
									href={input.editHref}
								>
									<PencilSimpleIcon aria-hidden="true" />
								</a>
							) : null}
						</div>
						<AgentProfileDirectMessageAction
							isPending={input.isDirectMessagePending === true}
							onOpen={input.onOpenDirectMessage}
							profileName={input.entry.profileName}
						/>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function resolveAgentPresenceSummary(
	entry: SpaceMemberDirectoryEntry
): string | null {
	if (entry.availabilityReasonCode === "agent_execution.ready") {
		return "Available for Wake";
	}
	if (entry.availabilityBadgeLabel) {
		return entry.availabilityBadgeLabel;
	}
	switch (entry.presenceStatus) {
		case "wakeable":
			return "Available for Wake";
		case "checking_connection":
			return "Checking";
		case "offline":
			return "Offline";
		case "unavailable":
			return "Unavailable";
		default:
			return entry.presenceLabel ?? entry.availabilitySummary;
	}
}

function AgentProfileMoreDetailsContent(input: {
	details: ProfileDetailsSnapshot;
	profile: AuthProfileView;
}) {
	const details = buildAgentProfileMoreDetailsSnapshot(input);
	return (
		<ProfileDetailsContent
			className="min-h-0 flex-1 overflow-y-auto pr-1"
			details={details}
			showSummary={false}
			testId="profile-details-dialog-scroll-area"
		/>
	);
}

function buildAgentProfileMoreDetailsSnapshot(input: {
	details: ProfileDetailsSnapshot;
	profile: AuthProfileView;
}): ProfileDetailsSnapshot {
	const profileRows = selectDetailsRows(input.details, [
		"profile_id",
		"created_from",
		"created_at",
		"updated_at",
	]).map((row) => {
		if (row.id === "created_at") {
			return {
				...row,
				value: formatAgentProfileTimestamp(input.profile.createdAt),
			};
		}
		if (row.id === "updated_at") {
			return {
				...row,
				value: formatAgentProfileTimestamp(input.profile.updatedAt),
			};
		}
		return row;
	});
	const sections: ProfileDetailsSection[] = [];
	if (profileRows.length > 0) {
		sections.push({
			id: "profile",
			recoveryAction: null,
			rows: profileRows,
			title: "Profile details",
		});
	}
	return { ...input.details, sections };
}

function selectDetailsRows(
	details: ProfileDetailsSnapshot,
	rowIds: readonly string[]
): ProfileDetailsField[] {
	const rowsById = new Map<string, ProfileDetailsField>();
	for (const section of details.sections) {
		for (const row of section.rows) {
			rowsById.set(row.id, row);
		}
	}
	return rowIds.flatMap((rowId) => {
		const row = rowsById.get(rowId);
		return row ? [row] : [];
	});
}

function formatAgentProfileTimestamp(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: AGENT_PROFILE_TIMESTAMP_FORMATTER.format(date);
}

export function ProfileDetailsContent(input: {
	className?: string;
	collapseAgentTechnicalDetails?: boolean;
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	details: ProfileDetailsSnapshot;
	excludedSectionIds?: readonly ProfileDetailsSectionId[];
	isDirectMessagePending?: boolean;
	isRecoveryActionPending?: boolean;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	onOpenDirectMessage?: () => void;
	showSummary?: boolean;
	summaryAvatar?: ReactNode;
	testId?: string;
}) {
	const excludedSectionIds = new Set(input.excludedSectionIds ?? []);
	const visibleSections = input.details.sections.filter(
		(section) => !excludedSectionIds.has(section.id)
	);
	const technicalSections = input.collapseAgentTechnicalDetails
		? visibleSections.filter((section) =>
				AGENT_WORKSPACE_TECHNICAL_SECTION_IDS.has(section.id)
			)
		: [];
	const primarySections = input.collapseAgentTechnicalDetails
		? visibleSections.filter(
				(section) => !AGENT_WORKSPACE_TECHNICAL_SECTION_IDS.has(section.id)
			)
		: visibleSections;
	const showCollapsedTechnicalDetails =
		input.collapseAgentTechnicalDetails === true &&
		(Boolean(input.currentSession) || technicalSections.length > 0);
	return (
		<div className={cn("min-w-0", input.className)} data-testid={input.testId}>
			{input.showSummary === false ? null : (
				<div className="flex min-w-0 items-start justify-between gap-3">
					<div className="flex min-w-0 items-start gap-2.5">
						{input.summaryAvatar}
						<div className="min-w-0">
							<p className="break-words font-medium text-sm">
								{input.details.profileName}
							</p>
							<p className="text-muted-foreground text-xs">
								{formatProfileKind(input.details.profileKind)}
							</p>
						</div>
					</div>
					{input.onOpenDirectMessage ? (
						<Button
							className="shrink-0"
							disabled={input.isDirectMessagePending === true}
							onClick={input.onOpenDirectMessage}
							size="sm"
							type="button"
							variant="outline"
						>
							<ChatCircleTextIcon data-icon="inline-start" />
							Direct Message
						</Button>
					) : null}
				</div>
			)}
			{input.currentSession && !input.collapseAgentTechnicalDetails ? (
				<ProfileDetailsCurrentSession
					className="mt-5"
					currentSession={input.currentSession}
				/>
			) : null}

			<div className="mt-5 min-w-0 space-y-5">
				{primarySections.map((section) => (
					<ProfileDetailsSectionView
						isRecoveryActionPending={input.isRecoveryActionPending === true}
						key={section.id}
						onRecoveryAction={input.onRecoveryAction}
						section={section}
					/>
				))}
				{showCollapsedTechnicalDetails ? (
					<details
						className="group min-w-0 overflow-hidden rounded-md border border-border"
						data-testid="profile-technical-details"
					>
						<summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 font-medium text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
							<span className="min-w-0 flex-1">Technical details</span>
							<CaretDownIcon
								aria-hidden="true"
								className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
							/>
						</summary>
						<div className="min-w-0 space-y-5 border-border border-t px-3 py-3">
							{input.currentSession ? (
								<ProfileDetailsCurrentSession
									currentSession={input.currentSession}
								/>
							) : null}
							{technicalSections.map((section) => (
								<ProfileDetailsSectionView
									isRecoveryActionPending={
										input.isRecoveryActionPending === true
									}
									key={section.id}
									onRecoveryAction={input.onRecoveryAction}
									section={section}
								/>
							))}
						</div>
					</details>
				) : null}
			</div>
		</div>
	);
}

function ProfileDetailsSectionView(input: {
	isRecoveryActionPending: boolean;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	section: ProfileDetailsSection;
}) {
	const recoveryAction = input.section.recoveryAction;
	return (
		<section className="min-w-0 space-y-2">
			<h3 className="font-medium text-muted-foreground text-xs">
				{input.section.title}
			</h3>
			<div className="min-w-0 divide-y divide-border overflow-hidden rounded-md border border-border">
				{input.section.rows.map((row) => (
					<ProfileDetailsFieldRow
						key={`${input.section.id}:${row.id}`}
						row={row}
					/>
				))}
			</div>
			{recoveryAction && input.onRecoveryAction ? (
				<ProfileDetailsRecoveryActionButton
					isPending={input.isRecoveryActionPending}
					onRecoveryAction={input.onRecoveryAction}
					recoveryAction={recoveryAction}
				/>
			) : null}
		</section>
	);
}

function ProfileDetailsFieldRow(input: { row: ProfileDetailsField }) {
	const value = (
		<span
			className={cn(
				"min-w-0 whitespace-pre-wrap break-all text-xs [overflow-wrap:anywhere]",
				input.row.valueKind === "identifier" || input.row.valueKind === "path"
					? "font-mono"
					: null
			)}
		>
			{input.row.value}
		</span>
	);

	if (input.row.copy) {
		return (
			<button
				aria-label={input.row.copy.label}
				className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset"
				onClick={async () => {
					await copyDetailsValue({
						successMessage:
							input.row.copy?.successMessage ?? `${input.row.label} copied.`,
						value: input.row.value,
					});
				}}
				type="button"
			>
				<span className="min-w-0 space-y-1">
					<span className="block text-muted-foreground text-xs">
						{input.row.label}
					</span>
					{value}
				</span>
				<CopyIcon className="mt-5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
			</button>
		);
	}

	return (
		<div className="min-w-0 space-y-1 px-3 py-2">
			<p className="text-muted-foreground text-xs">{input.row.label}</p>
			{value}
		</div>
	);
}

async function copyDetailsValue(input: {
	successMessage: string;
	value: string;
}) {
	if (await copyTextToClipboard(input.value)) {
		toast.success(input.successMessage);
		return;
	}

	toast.error(
		"OpenMeld could not copy this automatically. Select the text and copy it manually."
	);
}
